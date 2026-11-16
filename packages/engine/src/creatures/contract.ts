/**
 * Contract between the creature model kit (kit.ts) and its renderers.
 *
 * kit.ts exports:
 *   creatureModel(kind): CreatureModel        — memoised, pure geometry
 *   creatureMaterial(): MeshStandardNodeMaterial — one shared animated material
 *
 * Model conventions (every kind):
 *   - Non-indexed BufferGeometry, flat-shaded faceted low-poly ("polygon dark fantasy").
 *   - Attributes: position, normal, color (vec3, linear), glow (float 0..1 → emissive eyes/runes),
 *     limb (float: 0 body, +1 / -1 opposite limb groups), and the joint binding baked by
 *     rig.ts: pivot (vec3, joint position) + bone (float, joint kind code).
 *   - Feet on y = 0, facing +z, centred on x = z = 0, real world size (1 unit = 1 map tile).
 *     Lane melee creep ≈ 0.75 tall; Roshan ≈ 3.2 tall.
 *
 * Renderers place models with InstancedMesh (one per kind) and write, per instance,
 * the matrix plus an `ANIM` vec4 (InstancedBufferAttribute on the geometry clone):
 *   x = stride phase (radians; advance by 2π per `stride` world units travelled),
 *   y = move 0..1 (eased walk weight), z = attack progress 0..1 (≥ 1 = not attacking),
 *   w = per-instance seed (radians) for idle / wing phase.
 */
import type { UnitKind } from "@mobacraft/sim"
import type { BufferGeometry } from "three/webgpu"

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
}
