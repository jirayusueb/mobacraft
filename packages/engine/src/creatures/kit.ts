/**
 * Creature model kit — the one place that maps a CreatureKind to geometry and material.
 * Geometry comes from kit-lane.ts / kit-neutral.ts (contract.ts describes the attribute layout).
 */
import type { CreatureKind, UnitKind } from "@mobacraft/sim"
import {
  Box3,
  type BufferGeometry,
  Float32BufferAttribute,
  MeshStandardNodeMaterial,
  type Node,
} from "three/webgpu"
import {
  attribute,
  color,
  cos,
  float,
  max,
  mix,
  positionGeometry,
  positionLocal,
  referenceAttribute,
  sin,
  smoothstep,
  time,
  vec3,
  vec4,
} from "three/tsl"

import { nightGlow } from "../scene/structures.ts"
import { ANIM, type CreatureModel } from "./contract.ts"
import { heroModel } from "./kit-hero.ts"
import { laneModels } from "./kit-lane.ts"
import { neutralModels } from "./kit-neutral.ts"
import { hipHeight } from "./rig.ts"

/** The InstancedMesh's per-instance matrix, as three binds it for instanced draws. */
// Typings model ReferenceAttributeNode as a bare node; at runtime it is a mat4 node.
const instanceMatrix = referenceAttribute("instanceMatrix", "mat4") as unknown as Node<"mat4">

const builders: Record<CreatureKind, () => BufferGeometry> = {
  ...laneModels,
  ...neutralModels,
}

const models = new Map<UnitKind, CreatureModel>()

/**
 * WebGPU allows 8 vertex buffers per pipeline (position, normal, color, the instance
 * matrix and instanced `anim` already take 5), so the kit's scalar attributes are
 * packed into two vec4s:
 *   rig  = (pivot.xyz, bone)
 *   partInfo = (limb, glow, model height, hip height)
 */
const packRig = (g: BufferGeometry, height: number): void => {
  // Kit caches (heroModel) can hand back an already packed geometry (e.g. after HMR).
  if (g.hasAttribute("rig")) return
  const hip = hipHeight(g)
  const pivot = g.getAttribute("pivot")
  const bone = g.getAttribute("bone")
  const limb = g.getAttribute("limb")
  const glow = g.getAttribute("glow")
  const n = pivot.count
  const rig = new Float32Array(n * 4)
  const info = new Float32Array(n * 4)
  for (let i = 0; i < n; i++) {
    rig.set([pivot.getX(i), pivot.getY(i), pivot.getZ(i), bone.getX(i)], i * 4)
    info.set([limb.getX(i), glow.getX(i), height, hip], i * 4)
  }
  for (const name of ["pivot", "bone", "limb", "glow"]) g.deleteAttribute(name)
  g.setAttribute("rig", new Float32BufferAttribute(rig, 4))
  g.setAttribute("partInfo", new Float32BufferAttribute(info, 4))
}

/** Ground distance per full gait cycle. Siege wheels (r = 0.2) roll without slipping. */
const strideOf = (kind: UnitKind, height: number): number =>
  kind.endsWith("-siege") ? 2 * Math.PI * 0.2 : Math.max(0.55, height * 1.15)

/** Geometry for any unit kind: creatures from the creep/neutral kits, heroes from the hero kit. */
export const creatureModel = (kind: UnitKind): CreatureModel => {
  let m = models.get(kind)
  if (!m) {
    const geometry = kind in builders ? builders[kind as CreatureKind]() : heroModel(kind)
    geometry.computeBoundingBox()
    const box = geometry.boundingBox ?? new Box3()
    const height = box.max.y - box.min.y
    packRig(geometry, height)
    m = {
      kind,
      geometry,
      height,
      radius: Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2,
      stride: strideOf(kind, height),
    }
    models.set(kind, m)
  }
  return m
}

let material: MeshStandardNodeMaterial | undefined

/** 1 where `v` equals the integer code `k`, else 0. */
const is = (v: Node<"float">, k: number) => float(1).sub(v.sub(k).abs().min(1))

/**
 * The one shared creature material. Animation is pure TSL over two inputs:
 *
 *  - baked per vertex (rig.ts): `pivot` + `bone` — every limb part rotates rigidly about
 *    its own joint (hip, shoulder, wing root, wheel hub, siege lever), so limbs stay
 *    attached instead of shearing; `limb` (±1) picks the antiphase group;
 *  - per instance (render.ts writes it each frame): `anim` = (stride phase, move 0..1,
 *    attack progress 0..1 (≥ 1 = none), seed). Phase advances with distance travelled,
 *    so feet match ground speed at any game speed, and units at rest stop walking.
 *
 *  Legs swing about the hip with a knee lift on the forward pass; the body drops by
 *  exactly the leg's vertical shortening so planted feet stay on the ground. Arms
 *  counter-swing; on attack the weapon arm (−1) winds up overhead and strikes, the body
 *  lunges, quadrupeds rear their front legs, siege levers throw. Wings flap, wheels roll.
 *  Glow parts are emissive, brighter at night (feeds the selective bloom).
 */
export const creatureMaterial = (): MeshStandardNodeMaterial => {
  if (material) return material
  const m = new MeshStandardNodeMaterial({
    vertexColors: true,
    roughness: 0.78,
    metalness: 0.05,
    flatShading: true,
  })
  const p = positionGeometry
  const rig = attribute<"vec4">("rig", "vec4")
  const info = attribute<"vec4">("partInfo", "vec4")
  const pivot = rig.xyz
  const bone = rig.w
  const limb = info.x
  const glow = info.y
  const size = info.z
  const hip = info.w
  const legged = hip.mul(100).clamp(0, 1)
  const anim = attribute<"vec4">(ANIM, "vec4")
  const phase = anim.x
  const move = anim.y
  const atk = anim.z
  const seed = anim.w

  const leg = is(bone, 1)
  const arm = is(bone, 2)
  const wing = is(bone, 3)
  const wheel = is(bone, 4)
  const lever = is(bone, 5)

  // Attack envelope: wind-up → strike → recover; all zero once atk ≥ 1.
  const live = float(1).sub(smoothstep(0.98, 1, atk))
  const wind = smoothstep(0, 0.32, atk).mul(live)
  const strike = smoothstep(0.32, 0.5, atk).mul(live)
  const rec = smoothstep(0.5, 1, atk).mul(live)
  const busy = wind.sub(rec).clamp(0, 1)

  // Gait.
  const LEG_AMP = 0.5
  const legSwing = sin(phase).mul(LEG_AMP).mul(move)
  const breath = sin(time.mul(1.4).add(seed))
  const front = smoothstep(0.03, 0.1, pivot.z) // quadruped forelegs (bipeds sit at z ≈ 0)
  const rear = front.mul(busy).mul(-0.9)
  const legA = limb
    .mul(legSwing)
    .mul(float(1).sub(front.mul(busy)))
    .add(rear)
  // Arms: counter-swing with the legs (shared groups pair opposite arm + leg), idle sway.
  const walkArm = limb.mul(legSwing).mul(0.8).add(breath.mul(limb).mul(0.04))
  const weapon = limb.negate().clamp(0, 1) // right-hand group (−1) carries the weapon
  const swingAtk = wind.mul(-2.1).add(strike.mul(2.5)).sub(rec.mul(0.4))
  const offAtk = busy.mul(-0.45)
  const armA = mix(walkArm, mix(offAtk, swingAtk, weapon), busy.max(strike.sub(rec)))
  const leverA = strike.sub(rec).mul(1.9)
  const angX = leg.mul(legA).add(arm.mul(armA)).add(wheel.mul(phase)).add(lever.mul(leverA))
  // Wings: slow beat at rest, faster aloft-looking beat when moving, big beat on attack.
  const beat = sin(time.mul(mix(2.6, 7, move)).add(seed))
  const angZ = wing.mul(limb).mul(beat.mul(0.45).add(0.12).add(busy.mul(0.6)))

  // Rotate about the pivot: x-axis (pitch) then z-axis (roll); body parts have angle 0.
  const rel = p.sub(pivot)
  const cx = cos(angX)
  const sx = sin(angX)
  const ry = rel.y.mul(cx).sub(rel.z.mul(sx))
  const rz = rel.y.mul(sx).add(rel.z.mul(cx))
  const cz = cos(angZ)
  const sz = sin(angZ)
  const rx = rel.x.mul(cz).sub(ry.mul(sz))
  const ry2 = rel.x.mul(sz).add(ry.mul(cz))
  // Knee lift on the forward pass (foot clears the ground, lands planted).
  const lift = leg
    .mul(max(float(0), limb.mul(cos(phase))))
    .mul(rel.y.negate().max(0))
    .mul(0.32)
    .mul(move)
  const posed = pivot.add(vec3(rx, ry2.add(lift), rz))

  // Whole body: drop by the legs' shortening, lean into the walk, breathe, lunge.
  // Legless models (siege carts, spirits) neither drop nor lean into a stride.
  const drop = hip
    .mul(float(1).sub(cos(legSwing)))
    .add(sin(phase.mul(2)).abs().mul(hip).mul(0.03).mul(move))
  const lean = move
    .mul(0.07)
    .mul(legged)
    .add(strike.sub(rec).mul(0.22))
    .sub(wind.mul(float(1).sub(strike)).mul(0.08))
  const lunge = strike.sub(rec).mul(size).mul(0.12)
  const chest = smoothstep(0.35, 0.8, p.y.div(size))
  const breathe = breath.mul(0.012).mul(p.y).mul(chest).mul(float(1).sub(move))
  const local = vec3(
    posed.x,
    posed.y.sub(drop).add(breathe),
    posed.z.add(posed.y.mul(lean)).add(lunge),
  )

  // three applies the instance matrix to positionLocal *before* positionNode runs, so
  // rotate the local offset by the instance matrix (w = 0) and add it to the already
  // instanced position — keeps three's own instancing path intact.
  const offset = instanceMatrix.mul(vec4(local.sub(p), float(0))).xyz
  m.positionNode = positionLocal.add(offset)
  const base = attribute<"vec3">("color", "vec3")
  m.emissiveNode = base.mul(glow).mul(mix(float(0.9), float(2.4), nightGlow))
  // Darken toward the feet so creatures sit on the grass instead of floating.
  m.colorNode = mix(color(0x111014), base, p.y.mul(6).clamp(0.55, 1))
  material = m
  return m
}
