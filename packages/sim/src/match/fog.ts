/**
 * Fog of War — spec/08. Multi-state visibility grid + recursive shadowcasting
 * LoS with height bands (high ground) and tree blockers, day/night radii,
 * vision linger, attack-reveal bubbles, and dirty-region recompute.
 *
 * Pure module: owns no match state; the match feeds sources and a tick count.
 * All state is typed arrays keyed by Team ("radiant"/"dire"); DraftSide
 * converts via SIDE_TEAM in match.ts.
 *
 * Layout per team (64×64 cells at FOG_CELL = 2 world units, map size 128):
 *   bits    Uint8Array  bit0 Explored | bit1 Visible | bit2 TrueSight
 *   lastLit Uint32Array tick of the last recompute that lit the cell
 */
import type { MobaMap, Vec2 } from "@mobacraft/map"
import { Terrain } from "@mobacraft/map"
import { VISION_RADIUS } from "./vision.ts"

export const FOG_CELL = 2

/** 0.1 s sim ticks; day/night alternate every 3600 ticks (3 real minutes). */
export const DAY_NIGHT_PERIOD = 3600
export const NIGHT_TICKS = 5
export const NIGHT_RADIUS_SCALE = 0.6

export const LINGER_TICKS = 5
export const ATTACK_REVEAL_RADIUS = 2
export const ATTACK_REVEAL_TICKS = 20
export const TREE_REGROW_TICKS = 1200

export const isNight = (tick: number) => Math.floor(tick / DAY_NIGHT_PERIOD) % 2 === 1

export const Bits = { Explored: 1, Visible: 2, TrueSight: 4 } as const

export interface FogStatic {
  readonly cols: number
  /** Height band 0..3 per cell (band = floor((h - minH) / 0.75), clamped). */
  readonly band: Uint8Array
  /** Terrain.Forest cells (sight-blocking trees), runtime-mutable via cutTrees. */
  readonly forest: Uint8Array
  /** Cells whose tree was destroyed (also a blocker state change, spec/08 §4c). */
  readonly cutTrees: Uint8Array
}

export interface TeamFog {
  readonly bits: Uint8Array
  readonly lastLit: Uint32Array
}

export interface VisionSource {
  x: number
  z: number
  radius: number
  /** Flying vision ignores height bands and trees. */
  flying?: boolean
}

export const createStaticFog = (map: MobaMap): FogStatic => {
  const cols = Math.ceil(map.size / FOG_CELL)
  let minH = Infinity
  for (const h of map.height) minH = Math.min(minH, h)
  const band = new Uint8Array(cols * cols)
  const forest = new Uint8Array(cols * cols)
  for (let z = 0; z < cols; z++)
    for (let x = 0; x < cols; x++) {
      const i = z * cols + x
      const wx = (x + 0.5) * FOG_CELL
      const wz = (z + 0.5) * FOG_CELL
      band[i] = Math.min(3, Math.floor((map.heightAt(wx, wz) - minH) / 0.75))
      forest[i] = map.terrainAt(wx, wz) === Terrain.Forest ? 1 : 0
    }
  return { cols, band, forest, cutTrees: new Uint8Array(cols * cols) }
}

export const createTeamFog = (cols: number): TeamFog => ({
  bits: new Uint8Array(cols * cols),
  lastLit: new Uint32Array(cols * cols),
})

const cellOf = (cols: number, p: Vec2) => ({
  x: Math.floor(p.x / FOG_CELL),
  z: Math.floor(p.z / FOG_CELL),
})

/** Hero radii shrink at night; every other source type is time-invariant. */
export const sourceRadius = (kind: keyof typeof VISION_RADIUS, tick: number, nightVision = 1) => {
  const base = VISION_RADIUS[kind]
  if (kind !== "hero") return base
  return isNight(tick)
    ? Math.round(base * NIGHT_RADIUS_SCALE * nightVision)
    : Math.round(base * nightVision)
}

// --- tree destruction ----------------------------------------------------------------

export interface TreeEvent {
  x: number
  z: number
  regrowAt: number
}

/** Marks the tree destroyed (blocker removed → vision opens); returns true if it was a tree cell. */
export const destroyTree = (staticFog: FogStatic, p: Vec2): boolean => {
  const { x, z } = cellOf(staticFog.cols, p)
  if (x < 0 || z < 0 || x >= staticFog.cols || z >= staticFog.cols) return false
  const i = z * staticFog.cols + x
  if (!staticFog.forest[i] || staticFog.cutTrees[i]) return false
  staticFog.cutTrees[i] = 1
  return true
}

export const treeAt = (staticFog: FogStatic, p: Vec2): boolean => {
  const { x, z } = cellOf(staticFog.cols, p)
  if (x < 0 || z < 0 || x >= staticFog.cols || z >= staticFog.cols) return false
  return (
    staticFog.forest[z * staticFog.cols + x] === 1 && !staticFog.cutTrees[z * staticFog.cols + x]
  )
}

/** Regrows due trees unless a body occupies the cell; retried 100 ticks later. */
export const regrowTrees = (
  staticFog: FogStatic,
  events: TreeEvent[],
  tick: number,
  occupied: (p: Vec2) => boolean,
) => {
  const stillCut: TreeEvent[] = []
  for (const e of events) {
    if (tick < e.regrowAt) {
      stillCut.push(e)
      continue
    }
    if (occupied(e)) {
      stillCut.push({ ...e, regrowAt: tick + 100 })
      continue
    }
    const { x, z } = cellOf(staticFog.cols, e)
    staticFog.cutTrees[z * staticFog.cols + x] = 0
  }
  events.length = 0
  events.push(...stillCut)
}

// --- shadowcasting ---------------------------------------------------------------------

// Octant transforms: (row = distance along axis, col = lateral offset) → (dx, dz).
const OCTANTS: readonly ((row: number, col: number) => [number, number])[] = [
  (r, c) => [c, r],
  (r, c) => [c, -r],
  (r, c) => [-c, r],
  (r, c) => [-c, -r],
  (r, c) => [r, c],
  (r, c) => [r, -c],
  (r, c) => [-r, c],
  (r, c) => [-r, -c],
]

interface FogTarget {
  bits: Uint8Array
  lastLit: Uint32Array
}

/**
 * Recursive shadowcasting for one source. Height/tree rule (spec/08 §2):
 * a cell is an occluder if it is a tree, or its band > the band of the last
 * lit cell on this branch (an upslope). Occluders are themselves lit; a
 * blocked branch relights when it reaches a cell whose band drops below the
 * occluder's band (descending terrain). Flying sources never occlude.
 */
export const castVision = (
  staticFog: FogStatic,
  target: FogTarget,
  src: VisionSource,
  tick: number,
) => {
  const { cols, band, forest, cutTrees } = staticFog
  const ox = cellOf(cols, src).x
  const oz = cellOf(cols, src).z
  const r2 = src.radius * src.radius
  const srcBand = band[oz * cols + ox] ?? 0

  const light = (cx: number, cz: number) => {
    const i = cz * cols + cx
    target.bits[i] = (target.bits[i]! | Bits.Visible | Bits.Explored) as number
    target.lastLit[i] = tick
  }
  const isTree = (cx: number, cz: number) => {
    const i = cz * cols + cx
    return forest[i] === 1 && cutTrees[i] === 0
  }

  if (ox >= 0 && oz >= 0 && ox < cols && oz < cols) light(ox, oz)

  const scan = (
    oct: number,
    row: number,
    startSlope: number,
    endSlope: number,
    litBand: number,
  ) => {
    // Two independent block modes: slope-blocking trees (unblock at a slope
    // gap, canonical shadowcasting) and height shadow from an upslope
    // (unblocks only when terrain descends below the occluder's band).
    let treeBlock = false
    let shadowBand = -1
    let newStart = 0
    for (let d = row; d <= src.radius && !(treeBlock || shadowBand >= 0); d++) {
      for (let col = d; col >= 0; col--) {
        const [dx, dz] = OCTANTS[oct]!(d, col)
        const cx = ox + dx
        const cz = oz + dz
        if (cx < 0 || cz < 0 || cx >= cols || cz >= cols) continue
        // Slope window of this cell: cellStart ≤ window ≤ cellEnd.
        const cellStart = (col - 0.5) / (d + 0.5)
        const cellEnd = (col + 0.5) / (d - 0.5)
        if (startSlope < cellStart) continue // cell above the cone
        if (endSlope > cellEnd) break // cell below the cone — rest are lower
        if (dx * dx + dz * dz > r2) continue
        const i = cz * cols + cx
        const b = band[i] ?? 0
        const tree = isTree(cx, cz)
        light(cx, cz)
        if (treeBlock || shadowBand >= 0) {
          if (!tree && (shadowBand < 0 || b < shadowBand)) {
            // Transparent cell: slope gap clears tree blocking; descending
            // terrain clears the height shadow.
            if (shadowBand >= 0 && b < shadowBand) litBand = b
            shadowBand = -1
            treeBlock = false
            startSlope = newStart
          } else {
            newStart = cellStart
          }
        } else if (!src.flying && (tree || b > litBand)) {
          // Lit-but-occluding: light the segment up to (not past) this cell,
          // then shadow everything behind it.
          scan(oct, d + 1, startSlope, cellEnd, litBand)
          newStart = cellStart
          if (tree) treeBlock = true
          if (b > litBand) {
            shadowBand = b
            litBand = b
          }
        } else {
          newStart = cellStart
        }
      }
      if (treeBlock || shadowBand >= 0) break
    }
  }

  for (let oct = 0; oct < 8; oct++) scan(oct, 1, 1, 0, srcBand)
}

// --- recompute passes -------------------------------------------------------------------

export interface RecomputeInput {
  staticFog: FogStatic
  fog: TeamFog
  tick: number
  sources: readonly VisionSource[]
  /** Short-lived attack-reveal bubbles granted by the *enemy* team's attacks. */
  reveals?: readonly VisionSource[]
}

export const recomputeFog = (input: RecomputeInput) => {
  const { staticFog, fog, tick } = input
  const { bits, lastLit } = fog
  // Clear live state only — Explored (bit0) persists forever once set.
  for (let i = 0; i < bits.length; i++) bits[i] = bits[i]! & Bits.Explored
  for (const s of input.sources) castVision(staticFog, fog, s, tick)
  for (const s of input.reveals ?? []) castVision(staticFog, fog, s, tick)
  // Vision linger (spec/08 §4b): cells whose last light is within
  // LINGER_TICKS stay Visible until tick > lastLit + LINGER_TICKS.
  const cutoff = tick - LINGER_TICKS
  for (let i = 0; i < bits.length; i++)
    if (!(bits[i]! & Bits.Visible) && lastLit[i] !== 0 && lastLit[i]! >= cutoff)
      bits[i] = (bits[i]! | Bits.Visible) as number
}

export const fogState = (fog: TeamFog, staticFog: FogStatic, p: Vec2) => {
  const { x, z } = cellOf(staticFog.cols, p)
  if (x < 0 || z < 0 || x >= staticFog.cols || z >= staticFog.cols) return 0
  return fog.bits[z * staticFog.cols + x]!
}

export const isVisibleToTeam = (fog: TeamFog, staticFog: FogStatic, p: Vec2) =>
  (fogState(fog, staticFog, p) & Bits.Visible) !== 0

export const hasTrueSightToTeam = (fog: TeamFog, staticFog: FogStatic, p: Vec2) =>
  (fogState(fog, staticFog, p) & Bits.TrueSight) !== 0

/** Render snapshot: 0 unexplored, 1 explored-dark, 2 visible (spec/08 §5). */
export const fogSnapshot = (fog: TeamFog, staticFog: FogStatic) => {
  const bytes = new Uint8Array(staticFog.cols * staticFog.cols)
  for (let i = 0; i < bytes.length; i++)
    bytes[i] = fog.bits[i]! & Bits.Visible ? 2 : fog.bits[i]! & Bits.Explored ? 1 : 0
  return { cols: staticFog.cols, bytes }
}
