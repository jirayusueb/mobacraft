/** World-space point in tile units. `x` grows east, `z` grows south (toward the camera). */
export interface Vec2 {
  readonly x: number
  readonly z: number
}

export type Team = "radiant" | "dire"
export type LaneId = "top" | "mid" | "bot"

export const Terrain = {
  Water: 0,
  Shore: 1,
  Grass: 2,
  Lane: 3,
  Plaza: 4,
  Forest: 5,
} as const
export type Terrain = (typeof Terrain)[keyof typeof Terrain]

export interface MapSpec {
  /** Seeds every random choice (tree scatter, colour noise). Layout itself is fixed, like Dota. */
  readonly seed: number
  /** Tiles per side. The map is always square. */
  readonly size: number
  /** 0..1 — how much of the jungle becomes forest. */
  readonly forestDensity: number
}

export interface Lane {
  readonly id: LaneId
  /** Ordered from the Radiant base toward the Dire base. */
  readonly path: readonly Vec2[]
}

export type StructureKind =
  | "ancient"
  | "tower"
  | "barracks-melee"
  | "barracks-ranged"
  | "fountain"
  | "shop"
  | "secret-shop"

export interface Structure {
  readonly id: string
  readonly kind: StructureKind
  readonly team: Team | "neutral"
  readonly position: Vec2
  /** Blocking radius in tiles. */
  readonly radius: number
  readonly lane?: LaneId
  /** Tower tier 1..4. */
  readonly tier?: 1 | 2 | 3 | 4
}

export type CampKind = "small" | "medium" | "large" | "ancient"

export interface Camp {
  readonly id: string
  readonly kind: CampKind
  readonly team: Team
  readonly position: Vec2
}

export type LandmarkKind = "roshan" | "rune"

export interface Landmark {
  readonly id: string
  readonly kind: LandmarkKind
  readonly position: Vec2
}

export interface Tree {
  readonly position: Vec2
  /** Uniform scale, ~0.7..1.3. */
  readonly scale: number
  /** Which side of the river it grows on — drives palette. */
  readonly team: Team
  /** 0..1 stable per-tree random, for shape/colour variation. */
  readonly variant: number
}

export interface Prop {
  readonly kind: "flower" | "rock" | "bush"
  readonly position: Vec2
  readonly scale: number
  readonly variant: number
}

/**
 * A generated MOBA map. Plain immutable data plus three spatial queries.
 * Tile grids are row-major: index = tz * size + tx.
 */
export interface MobaMap {
  readonly spec: MapSpec
  readonly size: number
  readonly terrain: Uint8Array
  /** Top-surface height of each tile, quantised to 0.25. */
  readonly height: Float32Array
  /** 0 = radiant, 1 = dire. */
  readonly side: Uint8Array
  /** 0..1 low-frequency noise per tile, for colour variation. */
  readonly tint: Float32Array
  readonly waterLevel: number
  readonly lanes: readonly Lane[]
  readonly river: readonly Vec2[]
  readonly structures: readonly Structure[]
  readonly camps: readonly Camp[]
  readonly landmarks: readonly Landmark[]
  readonly trees: readonly Tree[]
  readonly props: readonly Prop[]

  /** Terrain under a world point; out of bounds reads as Water. */
  terrainAt(x: number, z: number): Terrain
  /** Surface height under a world point (bilinear across tiles). */
  heightAt(x: number, z: number): number
  /** False for out-of-bounds, trees and structure footprints. */
  isWalkable(x: number, z: number): boolean
}
