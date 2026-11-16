/**
 * Creature model kit — the one place that maps a CreatureKind to geometry and material.
 * Geometry comes from kit-lane.ts / kit-neutral.ts (contract.ts describes the attribute layout).
 */
import type { CreatureKind, UnitKind } from "@mobacraft/sim"
import { Box3, MeshStandardNodeMaterial, type Node } from "three/webgpu"
import {
  attribute,
  color,
  float,
  hash,
  instanceIndex,
  mix,
  positionGeometry,
  positionLocal,
  referenceAttribute,
  sin,
  time,
  vec4,
} from "three/tsl"

import { nightGlow } from "../scene/structures.ts"
import type { CreatureModel, Gait } from "./contract.ts"
import { heroModel } from "./kit-hero.ts"
import { laneModels } from "./kit-lane.ts"
import { neutralModels } from "./kit-neutral.ts"

/** The InstancedMesh's per-instance matrix, as three binds it for instanced draws. */
// Typings model ReferenceAttributeNode as a bare node; at runtime it is a mat4 node.
const instanceMatrix = referenceAttribute("instanceMatrix", "mat4") as unknown as Node<"mat4">

const builders: Record<CreatureKind, () => import("three/webgpu").BufferGeometry> = {
  ...laneModels,
  ...neutralModels,
}

const models = new Map<UnitKind, CreatureModel>()

/** Geometry for any unit kind: creatures from the creep/neutral kits, heroes from the hero kit. */
export const creatureModel = (kind: UnitKind): CreatureModel => {
  let m = models.get(kind)
  if (!m) {
    const geometry = kind in builders ? builders[kind as CreatureKind]() : heroModel(kind)
    geometry.computeBoundingBox()
    const box = geometry.boundingBox ?? new Box3()
    m = {
      kind,
      geometry,
      height: box.max.y - box.min.y,
      radius: Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2,
    }
    models.set(kind, m)
  }
  return m
}

const materials = new Map<string, MeshStandardNodeMaterial>()

/**
 * Shared faceted material. Animation is pure TSL (no CPU per frame):
 *  - limb ±1 parts swing around the hip line (x-axis rotation approximated by a
 *    z/y shear proportional to height above the hip), opposite groups in antiphase;
 *  - the body bobs with the stride (walk) or breathes (idle);
 *  - per-instance phase from hash(instanceIndex) so a wave never moves in lockstep;
 *  - glow parts are emissive, brighter at night (feeds the selective bloom).
 */
export const creatureMaterial = (gait: Gait, height = 0.75): MeshStandardNodeMaterial => {
  // Hip line sits at ~38% of body height; materials are cached per (gait, hip).
  const hipY = Math.round(height * 0.38 * 100) / 100
  const key = `${gait}:${hipY}`
  let m = materials.get(key)
  if (m) return m
  m = new MeshStandardNodeMaterial({
    vertexColors: true,
    roughness: 0.78,
    metalness: 0.05,
    flatShading: true,
  })
  const limb = attribute<"float">("limb", "float")
  const glow = attribute<"float">("glow", "float")
  // Local-space height (pre-instance) drives the swing; the offset is added in the
  // rotated instance frame so limbs swing along each creature's own heading.
  const p = positionGeometry
  const phase = hash(instanceIndex).mul(6.283)
  const walking = gait === "walk"
  const rate = walking ? 7.5 : 1.6
  const cyc = sin(time.mul(rate).add(phase))
  // Swing amplitude in radians-ish, measured about the hip line.
  const hip = float(hipY)
  const below = hip.sub(p.y).max(float(0))
  const above = p.y.sub(hip).max(float(0))
  const swing = limb.mul(cyc).mul(walking ? 0.55 : 0.08)
  // Legs (below hip) swing forward/back; arms (above hip) swing opposite.
  const dz = below.mul(swing).sub(above.mul(swing).mul(0.6))
  const bob = walking
    ? cyc.abs().mul(0.035 * Math.max(1, height / 0.8))
    : sin(time.mul(1.3).add(phase)).mul(0.012).mul(p.y)
  // Wings / flappy limbs on idle creatures (limb ±1 well above hip) flap vertically.
  const flap = walking
    ? float(0)
    : limb
        .abs()
        .mul(sin(time.mul(3).add(phase)))
        .mul(above)
        .mul(0.15)
  // three applies the instance matrix to positionLocal *before* positionNode runs,
  // so a positionNode built from positionGeometry alone would drop it (every
  // creature collapsed to the world origin).
  // Rotate the local offset by the instance matrix (w = 0) and add it to the
  // already-instanced position — keeps three's own instancing path intact.
  const offset = instanceMatrix.mul(vec4(float(0), bob.add(flap), dz, float(0))).xyz
  m.positionNode = positionLocal.add(offset)
  const base = attribute<"vec3">("color", "vec3")
  m.emissiveNode = base.mul(glow).mul(mix(float(0.9), float(2.4), nightGlow))
  // Darken toward the feet so creatures sit on the grass instead of floating.
  m.colorNode = mix(color(0x111014), base, p.y.mul(6).clamp(0.55, 1))
  materials.set(key, m)
  return m
}
