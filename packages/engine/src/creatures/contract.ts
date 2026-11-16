/**
 * Contract between the creature model kit (kit.ts) and its renderers.
 *
 * kit.ts must export:
 *   creatureModel(kind: CreatureKind): CreatureModel   — memoised, pure geometry
 *   creatureMaterial(gait: Gait): MeshStandardNodeMaterial — shared per gait, cached
 *
 * Model conventions (every kind):
 *   - Non-indexed BufferGeometry, flat-shaded faceted low-poly ("polygon dark fantasy").
 *   - Attributes: position, normal, color (vec3, linear), glow (float 0..1 → emissive eyes/runes),
 *     limb (float: 0 body, +1 / -1 opposite limb groups for gait animation).
 *   - Feet on y = 0, facing +z, centred on x = z = 0, real world size (1 unit = 1 map tile).
 *     Lane melee creep ≈ 0.75 tall; Roshan ≈ 3.2 tall.
 *   - No per-frame CPU work: animation lives in the material (TSL `time`, `instanceIndex`).
 *
 * Renderers place models with InstancedMesh (one per kind) and only write instance matrices.
 */
import type { UnitKind } from "@mobacraft/sim"
import type { BufferGeometry } from "three/webgpu"

export type Gait =
  /** Lane creeps: marching stride (limb swing + body bob). */
  | "walk"
  /** Neutrals and Roshan at rest: slow breathing, head sway, idle shuffle. */
  | "idle"

export interface CreatureModel {
  readonly kind: UnitKind
  readonly geometry: BufferGeometry
  /** Bounding height, world units — for picking proxies, labels, selection rings. */
  readonly height: number
  /** Footprint radius, world units. */
  readonly radius: number
}
