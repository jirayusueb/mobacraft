/**
 * Vision — per-team visibility on a coarse grid (spec/06 §3c). Radius only, no line of sight.
 * Pure helpers; the match owns the grids and recomputes them every 0.5 s.
 */
import { type MobaMap, type Team, Terrain, type Vec2 } from "@mobacraft/map"
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
export const wardSpots = (
  map: MobaMap,
  /** Seen-area score for a ward at `p` (e.g. real LOS fog); default = open-ground proxy. */
  coverOf?: (p: Vec2) => number,
): readonly WardSpot[] => {
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
  // Jungle spots: forest noise isn't mirrored, so each team's spot is chosen on its own —
  // the most open walkable ground near each camp-group centroid (fog LOS is blocked by trees).
  for (const team of ["radiant", "dire"] as const) {
    const camps = map.camps
      .filter((c) => c.team === team)
      .toSorted((a, b) => Number(a.id.split("-").at(-1)) - Number(b.id.split("-").at(-1)))
    ;[camps.slice(0, 4), camps.slice(4)].forEach((g, i) => {
      if (g.length === 0) return
      // Search around each camp of the group; prefer spots watching more of the group's camps.
      const near = (c: Vec2) =>
        g.filter((k) => Math.hypot(k.position.x - c.x, k.position.z - c.z) <= 9).length
      const score = coverOf ? (c: Vec2) => coverOf(c) + near(c) * 40 : undefined
      let at = bestSpot(map, centroid(g.map((c) => c.position)), score)
      if (score)
        for (const k of g) {
          const cand = bestSpot(map, k.position, score)
          if (score(cand) > score(at)) at = cand
        }
      spots.push({ id: `ward-${team}-jungle-${i}`, zone: "own-jungle", owner: team, at })
    })
  }
  return spots
}

/** Walkable tile within 12 tiles of `p` that sees the most ground (`coverOf`, or open-ground proxy). */
const bestSpot = (map: MobaMap, p: Vec2, coverOf?: (p: Vec2) => number): Vec2 => {
  const proxy = (c: Vec2) => {
    let n = 0
    for (let dz = -8; dz <= 8; dz += 2)
      for (let dx = -8; dx <= 8; dx += 2)
        if (dx * dx + dz * dz <= 64 && map.terrainAt(c.x + dx, c.z + dz) !== Terrain.Forest) n++
    return n
  }
  const open = coverOf ?? proxy
  let best = nearestWalkable(map, p)
  let bestN = open(best)
  for (let dz = -12; dz <= 12; dz++)
    for (let dx = -12; dx <= 12; dx++) {
      const c = { x: Math.floor(p.x) + dx + 0.5, z: Math.floor(p.z) + dz + 0.5 }
      if (!map.isWalkable(c.x, c.z)) continue
      const n = open(c) - Math.hypot(dx, dz) * (coverOf ? 1 : 0.25)
      if (n > bestN) {
        bestN = n
        best = c
      }
    }
  return best
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
