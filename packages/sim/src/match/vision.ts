/**
 * Vision — per-team visibility on a coarse grid (spec/06 §3c). Radius only, no line of sight.
 * Pure helpers; the match owns the grids and recomputes them every 0.5 s.
 */
import type { MobaMap, Team, Vec2 } from "@mobacraft/map"
import type { VisionZone } from "./tactics.ts"

export const VISION_CELL = 2

export const VISION_RADIUS = {
  hero: 8,
  creep: 6,
  tower: 9,
  ward: 9,
  structure: 7,
} as const

export const WARD_LIFETIME = 360
export const WARD_RECHARGE = 90
export const WARD_MAX = 3
export const WARD_START = 2
export const WARD_BOUNTY = 50

export interface WardSpot {
  readonly id: string
  readonly zone: VisionZone
  /** Team whose jungle this is (jungle spots only). */
  readonly owner?: Team
  readonly at: Vec2
}

const nearestWalkable = (map: MobaMap, p: Vec2): Vec2 => {
  if (map.isWalkable(p.x, p.z)) return p
  for (let r = 1; r < 12; r++)
    for (let a = 0; a < 16; a++) {
      const x = p.x + Math.cos((a / 16) * Math.PI * 2) * r
      const z = p.z + Math.sin((a / 16) * Math.PI * 2) * r
      if (map.isWalkable(x, z)) return { x, z }
    }
  return p
}

const centroid = (ps: readonly Vec2[]): Vec2 => ({
  x: ps.reduce((s, p) => s + p.x, 0) / ps.length,
  z: ps.reduce((s, p) => s + p.z, 0) / ps.length,
})

/** 7 symmetric spots derived from map data: 2 runes, Roshan, 2 jungle centroids per team. */
export const wardSpots = (map: MobaMap): readonly WardSpot[] => {
  const spots: WardSpot[] = []
  for (const l of map.landmarks) {
    if (l.kind === "rune")
      spots.push({ id: `ward-${l.id}`, zone: "runes", at: nearestWalkable(map, l.position) })
  }
  const rosh = map.landmarks.find((l) => l.kind === "roshan")
  if (rosh)
    spots.push({
      id: "ward-roshan",
      zone: "roshan",
      // Stand at the pit's mouth (toward map centre), not inside it.
      at: nearestWalkable(map, {
        x: rosh.position.x + (map.size / 2 - rosh.position.x) * 0.35,
        z: rosh.position.z + (map.size / 2 - rosh.position.z) * 0.35,
      }),
    })
  for (const team of ["radiant", "dire"] as const) {
    const camps = map.camps
      .filter((c) => c.team === team)
      .toSorted((a, b) => Number(a.id.split("-").at(-1)) - Number(b.id.split("-").at(-1)))
    const groups = [camps.slice(0, 4), camps.slice(4)]
    groups.forEach((g, i) => {
      if (g.length === 0) return
      spots.push({
        id: `ward-${team}-jungle-${i}`,
        zone: "own-jungle",
        owner: team,
        at: nearestWalkable(map, centroid(g.map((c) => c.position))),
      })
    })
  }
  return spots
}

/** Zone of a spot as seen from `team` (one team's own jungle is the other's enemy jungle). */
export const zoneFor = (spot: WardSpot, team: Team): VisionZone =>
  spot.owner ? (spot.owner === team ? "own-jungle" : "enemy-jungle") : spot.zone

export interface VisionGrid {
  readonly cols: number
  readonly cells: Uint8Array
  /** Precomputed walkable mask (cell centre walkable). */
  readonly walkable: Uint8Array
  readonly walkableCount: number
}

export const createVisionGrid = (map: MobaMap): VisionGrid => {
  const cols = Math.ceil(map.size / VISION_CELL)
  const walkable = new Uint8Array(cols * cols)
  let n = 0
  for (let z = 0; z < cols; z++)
    for (let x = 0; x < cols; x++) {
      const w = map.isWalkable((x + 0.5) * VISION_CELL, (z + 0.5) * VISION_CELL) ? 1 : 0
      walkable[z * cols + x] = w
      n += w
    }
  return { cols, cells: new Uint8Array(cols * cols), walkable, walkableCount: Math.max(1, n) }
}

export const clearGrid = (g: VisionGrid) => g.cells.fill(0)

export const reveal = (g: VisionGrid, at: Vec2, r: number) => {
  const c0 = Math.max(0, Math.floor((at.x - r) / VISION_CELL))
  const c1 = Math.min(g.cols - 1, Math.floor((at.x + r) / VISION_CELL))
  const r0 = Math.max(0, Math.floor((at.z - r) / VISION_CELL))
  const r1 = Math.min(g.cols - 1, Math.floor((at.z + r) / VISION_CELL))
  const r2 = r * r
  for (let z = r0; z <= r1; z++)
    for (let x = c0; x <= c1; x++) {
      const dx = (x + 0.5) * VISION_CELL - at.x
      const dz = (z + 0.5) * VISION_CELL - at.z
      if (dx * dx + dz * dz <= r2) g.cells[z * g.cols + x] = 1
    }
}

export const isVisible = (g: VisionGrid, at: Vec2) => {
  const x = Math.floor(at.x / VISION_CELL)
  const z = Math.floor(at.z / VISION_CELL)
  if (x < 0 || z < 0 || x >= g.cols || z >= g.cols) return false
  return g.cells[z * g.cols + x] === 1
}

/** Visible walkable cells / walkable cells, 0..1. */
export const mapControl = (g: VisionGrid) => {
  let n = 0
  for (let i = 0; i < g.cells.length; i++) if (g.cells[i] && g.walkable[i]) n++
  return n / g.walkableCount
}
