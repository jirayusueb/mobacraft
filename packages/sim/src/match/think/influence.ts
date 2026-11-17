/**
 * Hero Think — Threat Map (spec/09 Layer 1): a coarse per-team influence grid of
 * danger 0..1. Inputs are only what the team knows: enemy towers (static, always
 * known), visible enemy heroes, and ghosts that went dark recently ("missing from
 * the minimap near there"). Deterministic: no RNG, fixed iteration order.
 */
import type { Vec2 } from "@mobacraft/map"
import { clamp01 } from "./awareness.ts"

export const THREAT_CELL = 8
export const MISSING_WINDOW = 20

export interface TowerThreat {
  readonly x: number
  readonly z: number
  readonly range: number
}
export interface HeroThreat {
  readonly x: number
  readonly z: number
  readonly level: number
}
export interface GhostThreat extends HeroThreat {
  /** Seconds since the enemy was last seen. */
  readonly age: number
  /** Tiles per second. */
  readonly speed: number
}

export interface ThreatInput {
  readonly towers: readonly TowerThreat[]
  readonly visible: readonly HeroThreat[]
  readonly ghosts: readonly GhostThreat[]
}

export class ThreatMap {
  readonly cols: number
  readonly cells: Float32Array

  constructor(mapSize: number) {
    this.cols = Math.ceil(mapSize / THREAT_CELL)
    this.cells = new Float32Array(this.cols * this.cols)
  }

  #cell(x: number, z: number) {
    const c = this.cols
    const cx = Math.max(0, Math.min(c - 1, Math.floor(x / THREAT_CELL)))
    const cz = Math.max(0, Math.min(c - 1, Math.floor(z / THREAT_CELL)))
    return { cx, cz }
  }

  #add(cx: number, cz: number, v: number) {
    if (cx < 0 || cz < 0 || cx >= this.cols || cz >= this.cols) return
    this.cells[cz * this.cols + cx]! += v
  }

  /** Recompute from scratch (call with the fog cadence). */
  update(input: ThreatInput): void {
    this.cells.fill(0)
    const c = this.cols
    for (const t of input.towers) {
      const reach = t.range + 2
      // Only cells whose centre can be within reach (plus the tower's own cell); the same
      // cells, in the same row-major order, as a full-grid scan — so sums are identical.
      const tx = Math.floor(t.x / THREAT_CELL)
      const tz = Math.floor(t.z / THREAT_CELL)
      const span = Math.ceil(reach / THREAT_CELL) + 1
      const z0 = Math.max(0, tz - span)
      const z1 = Math.min(c - 1, tz + span)
      const x0 = Math.max(0, tx - span)
      const x1 = Math.min(c - 1, tx + span)
      for (let cz = z0; cz <= z1; cz++)
        for (let cx = x0; cx <= x1; cx++) {
          const mx = (cx + 0.5) * THREAT_CELL
          const mz = (cz + 0.5) * THREAT_CELL
          const inCell = tx === cx && tz === cz
          if (inCell || Math.hypot(mx - t.x, mz - t.z) <= reach) this.#add(cx, cz, 0.6)
        }
    }
    for (const h of input.visible) {
      const v = 0.25 * (1 + h.level / 10)
      const { cx, cz } = this.#cell(h.x, h.z)
      this.#add(cx, cz, v)
      this.#add(cx + 1, cz, v / 2)
      this.#add(cx - 1, cz, v / 2)
      this.#add(cx, cz + 1, v / 2)
      this.#add(cx, cz - 1, v / 2)
    }
    for (const g of input.ghosts) {
      if (g.age > MISSING_WINDOW || g.age < 0) continue
      const v = 0.35 * (1 - g.age / MISSING_WINDOW)
      const r = Math.min(3, 1 + (g.age * g.speed) / THREAT_CELL)
      const { cx, cz } = this.#cell(g.x, g.z)
      const ri = Math.floor(r)
      for (let dz = -ri; dz <= ri; dz++)
        for (let dx = -ri; dx <= ri; dx++)
          if (Math.hypot(dx, dz) <= r) this.#add(cx + dx, cz + dz, v)
    }
    for (let i = 0; i < this.cells.length; i++) this.cells[i] = clamp01(this.cells[i]!)
  }

  danger(p: Vec2): number {
    const { cx, cz } = this.#cell(p.x, p.z)
    return this.cells[cz * this.cols + cx]!
  }
}
