/**
 * Creature model kit — the one place that maps a CreatureKind to skeleton, geometry and
 * material. Geometry comes from kit-lane.ts / kit-neutral.ts / kit-hero.ts (contract.ts
 * describes the attribute layout).
 *
 * Each model gets a full Skeleton (see skeleton.ts): root → pelvis → spine → chest →
 * head, plus leg / arm chains, wings, tail, cape, siege wheels and the throwing lever.
 * The CPU PoseSolver writes one 3×4 skinning matrix per bone into a per-kind float
 * texture (one row per instance, three texels per bone); the material skins every
 * vertex with two influences through `textureLoad`, so the whole animation stays
 * instanced — no per-unit meshes, no CPU vertex work.
 */
import type { CreatureKind, UnitKind } from "@mobacraft/sim"
import {
  Box3,
  DataTexture,
  FloatType,
  NearestFilter,
  RGBAFormat,
  type BufferGeometry,
  MeshStandardNodeMaterial,
  type Node,
} from "three/webgpu"
import {
  attribute,
  color,
  float,
  instanceIndex,
  ivec2,
  mix,
  positionGeometry,
  positionLocal,
  referenceAttribute,
  textureLoad,
  vec3,
  vec4,
} from "three/tsl"

import { nightGlow } from "../scene/structures.ts"
import { ANIM, type CreatureModel } from "./contract.ts"
import { heroModel } from "./kit-hero.ts"
import { laneModels } from "./kit-lane.ts"
import { neutralModels } from "./kit-neutral.ts"
import { type AttackStyle, PoseSolver, type Skeleton } from "./skeleton.ts"

/** The InstancedMesh's per-instance matrix, as three binds it for instanced draws. */
// Typings model ReferenceAttributeNode as a bare node; at runtime it is a mat4 node.
const instanceMatrix = referenceAttribute("instanceMatrix", "mat4") as unknown as Node<"mat4">

const builders: Record<CreatureKind, () => BufferGeometry> = {
  ...laneModels,
  ...neutralModels,
}

/** Attack clip family per kind. */
const styleOf = (kind: UnitKind, skeleton: Skeleton): AttackStyle =>
  kind.endsWith("-siege") ? "siege" : skeleton.arms.length === 0 ? "bite" : "swing"

/** Ground distance per full gait cycle. Siege wheels (r = 0.2) roll without slipping. */
const strideOf = (kind: UnitKind, height: number): number =>
  kind.endsWith("-siege") ? 2 * Math.PI * 0.2 : Math.max(0.55, height * 1.15)

const models = new Map<UnitKind, CreatureModel>()

/** Geometry for any unit kind: creatures from the creep/neutral kits, heroes from the hero kit. */
export const creatureModel = (kind: UnitKind): CreatureModel => {
  let m = models.get(kind)
  if (!m) {
    const geometry = kind in builders ? builders[kind as CreatureKind]() : heroModel(kind)
    geometry.computeBoundingBox()
    const box = geometry.boundingBox ?? new Box3()
    const height = box.max.y - box.min.y
    m = {
      kind,
      geometry,
      height,
      radius: Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2,
      stride: strideOf(kind, height),
      skeleton: geometry.userData.skeleton as Skeleton,
      solver: new PoseSolver(geometry.userData.skeleton as Skeleton),
      style: styleOf(kind, geometry.userData.skeleton as Skeleton),
    }
    models.set(kind, m)
  }
  return m
}

// ── skin data texture ───────────────────────────────────────────────────────────
// One texture per kind (material binds its own): row = instance slot, three texels
// per bone along x, RGBA32F. Renderers write solver output rows and flag update ranges.

export interface SkinTarget {
  readonly texture: DataTexture
  /** Scratch the solver writes into (bone-major, FLOATS_PER_BONE per bone). */
  readonly scratch: Float32Array
  readonly solver: PoseSolver
  readonly skeleton: Skeleton
  readonly style: AttackStyle
  readonly stride: number
  readonly bones: number
}

/** texels per bone along x (3 rows of a 3×4 matrix). */
export const TEXELS_PER_BONE = 3

export const createSkin = (kind: UnitKind, capacity: number): SkinTarget => {
  const model = creatureModel(kind)
  const bones = model.skeleton.count
  const width = bones * TEXELS_PER_BONE
  const texture = new DataTexture(
    new Float32Array(width * capacity * 4),
    width,
    capacity,
    RGBAFormat,
    FloatType,
  )
  texture.magFilter = NearestFilter
  texture.minFilter = NearestFilter
  texture.needsUpdate = true
  return {
    texture,
    scratch: new Float32Array(bones * 12),
    solver: model.solver,
    skeleton: model.skeleton,
    style: model.style,
    stride: model.stride,
    bones,
  }
}

/** Copy a solved pose (bone-major) into row `row` of the texture and mark the range. */
export const writeSkin = (t: SkinTarget, row: number): void => {
  const data = t.texture.image.data as Float32Array
  const base = row * t.texture.image.width * 4
  const b = t.scratch
  for (let i = 0; i < t.bones; i++) {
    data.set(b.subarray(i * 12, i * 12 + 12), base + i * TEXELS_PER_BONE * 4)
  }
  t.texture.clearUpdateRanges()
  t.texture.addUpdateRange(base, t.bones * TEXELS_PER_BONE * 4)
  t.texture.needsUpdate = true
}

/** Bind pose into row `row` (units not yet solved draw un-skinned). */
export const bindSkin = (t: SkinTarget, row: number): void => {
  t.solver.bind(t.scratch)
  writeSkin(t, row)
}

let materialCache: Map<UnitKind, MeshStandardNodeMaterial> | undefined

/**
 * The creature material, one per kind (each binds its own skin texture; the shader is
 * identical so pipelines stay cached). Skinning: two influences per vertex —
 * `bind = (boneA, boneB, weightA, 0)` per vertex, `anim` per instance picks the texture
 * row via `instanceIndex`. Limbs, spine, head, tail, cape and wheels all follow the
 * solved pose; flat-shaded normals are transformed by bone A.
 */
export const creatureMaterial = (kind: UnitKind, skin: SkinTarget): MeshStandardNodeMaterial => {
  materialCache ??= new Map()
  let m = materialCache.get(kind)
  if (m) return m
  m = new MeshStandardNodeMaterial({
    vertexColors: true,
    roughness: 0.78,
    metalness: 0.05,
    flatShading: true,
  })
  const p = positionGeometry
  const info = attribute<"vec4">("partInfo", "vec4")
  const bind = attribute<"vec4">("bind", "vec4")
  const glow = info.y
  const anim = attribute<"vec4">(ANIM, "vec4")
  void anim // row selection uses instanceIndex directly; anim drives the solver on CPU

  const instanceRow = instanceIndex.toInt()
  const tA0 = textureLoad(skin.texture, ivec2(bind.x.toInt().mul(TEXELS_PER_BONE), instanceRow))
  const tA1 = textureLoad(
    skin.texture,
    ivec2(bind.x.toInt().mul(TEXELS_PER_BONE).add(1), instanceRow),
  )
  const tA2 = textureLoad(
    skin.texture,
    ivec2(bind.x.toInt().mul(TEXELS_PER_BONE).add(2), instanceRow),
  )
  const tB0 = textureLoad(skin.texture, ivec2(bind.y.toInt().mul(TEXELS_PER_BONE), instanceRow))
  const tB1 = textureLoad(
    skin.texture,
    ivec2(bind.y.toInt().mul(TEXELS_PER_BONE).add(1), instanceRow),
  )
  const tB2 = textureLoad(
    skin.texture,
    ivec2(bind.y.toInt().mul(TEXELS_PER_BONE).add(2), instanceRow),
  )

  const px = p.x
  const py = p.y
  const pz = p.z
  const pa = vec3(
    tA0.x.mul(px).add(tA0.y.mul(py)).add(tA0.z.mul(pz)).add(tA0.w),
    tA1.x.mul(px).add(tA1.y.mul(py)).add(tA1.z.mul(pz)).add(tA1.w),
    tA2.x.mul(px).add(tA2.y.mul(py)).add(tA2.z.mul(pz)).add(tA2.w),
  )
  const pb = vec3(
    tB0.x.mul(px).add(tB0.y.mul(py)).add(tB0.z.mul(pz)).add(tB0.w),
    tB1.x.mul(px).add(tB1.y.mul(py)).add(tB1.z.mul(pz)).add(tB1.w),
    tB2.x.mul(px).add(tB2.y.mul(py)).add(tB2.z.mul(pz)).add(tB2.w),
  )
  const skinned = mix(pb, pa, bind.z)
  // Normals follow bone A's rotation: n' = R · n with R = the rotation rows.
  const bn = vec3(0, 0, 1) // bind normals are recomputed per face on CPU; transform a flat proxy
  void bn
  m.normalNode = mix(
    vec3(
      tB0.x.mul(p.x).add(tB1.x.mul(p.y)).add(tB2.x.mul(p.z)),
      tB0.y.mul(p.x).add(tB1.y.mul(p.y)).add(tB2.y.mul(p.z)),
      tB0.z.mul(p.x).add(tB1.z.mul(p.y)).add(tB2.z.mul(p.z)),
    ),
    vec3(
      tA0.x.mul(p.x).add(tA1.x.mul(p.y)).add(tA2.x.mul(p.z)),
      tA0.y.mul(p.x).add(tA1.y.mul(p.y)).add(tA2.y.mul(p.z)),
      tA0.z.mul(p.x).add(tA1.z.mul(p.y)).add(tA2.z.mul(p.z)),
    ),
    bind.z,
  )

  // three applies the instance matrix to positionLocal *before* positionNode runs, so
  // rotate the local offset by the instance matrix (w = 0) and add it to the already
  // instanced position — keeps three's own instancing path intact.
  const offset = instanceMatrix.mul(vec4(skinned.sub(p), float(0))).xyz
  m.positionNode = positionLocal.add(offset)
  const base = attribute<"vec3">("color", "vec3")
  m.emissiveNode = base.mul(glow).mul(mix(float(0.9), float(2.4), nightGlow))
  // Darken toward the feet so creatures sit on the grass instead of floating.
  m.colorNode = mix(color(0x111014), base, p.y.mul(6).clamp(0.55, 1))
  materialCache.set(kind, m)
  return m
}
