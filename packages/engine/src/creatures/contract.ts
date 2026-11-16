/**
 * Contract between the creature model kit (kit.ts) and its renderers.
 *
 * kit.ts exports:
 *   creatureModel(kind): CreatureModel        — memoised skeleton + geometry
 *   creatureMaterial(kind, skin)              — the skinning material (one per kind)
 *   createSkin(kind, capacity) / writeSkin / bindSkin — the per-kind skin data texture
 *
 * Model conventions (every kind):
 *   - Non-indexed BufferGeometry, flat-shaded faceted low-poly ("polygon dark fantasy").
 *   - Attributes: position, normal, color (vec3, linear), and two packed vec4s:
 *       partInfo = (limb, glow 0..1, model height, hip height)
 *       bind     = (boneA, boneB, weightA, 0) — global skin-texture texel indices
 *     (bones are the skeleton built in rig.ts; see skeleton.ts for the pose solver).
 *   - Feet on y = 0, facing +z, centred on x = z = 0, real world size (1 unit = 1 map tile).
 *     Lane melee creep ≈ 0.75 tall; Roshan ≈ 3.2 tall.
 *
 * Renderers place models with InstancedMesh (one per kind) and write, per instance, the
 * matrix plus an `ANIM` vec4 (InstancedBufferAttribute on the geometry clone):
 *   x = stride phase (radians; advance by 2π per `stride` world units travelled),
 *   y = move 0..1 (eased walk weight), z = attack progress 0..1 (≥ 1 = not attacking),
 *   w = per-instance seed (radians) for idle / wing phase.
 * Per-frame skinning matrices go through writeSkin(); the solver output is uploaded as
 * texture rows, never as vertices.
 */
import type { UnitKind } from "@mobacraft/sim"
import type { BufferGeometry } from "three/webgpu"
import type { AttackStyle, PoseSolver, Skeleton } from "./skeleton.ts"

/** Instanced attribute name for per-instance animation state. */
export const ANIM = "anim"

export interface CreatureModel {
  readonly kind: UnitKind
  readonly geometry: BufferGeometry
  /** Bounding height, world units — for picking proxies, labels, selection rings. */
  readonly height: number
  /** Footprint radius, world units. */
  readonly radius: number
  /** World units travelled per full gait cycle. */
  readonly stride: number
  readonly skeleton: Skeleton
  readonly solver: PoseSolver
  readonly style: AttackStyle
}
