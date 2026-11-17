/**
 * Navigation — grid A* over MobaMap walkability (1 tile cells, 8-connected,
 * no corner cutting), with path smoothing by line-of-sight string pulling.
 *
 * Interface: `new Nav(map)` → `path(from, to)` → Vec2[] (waypoints, excluding start).
 * Results are cached by (start cell, goal cell); goals inside blocked cells snap to
 * the nearest walkable cell. Water counts as walkable (heroes wade the river).
 */
import { type MobaMap, Terrain, type Vec2 } from "@mobacraft/map"

const DIRS = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
] as const
// Flat views of DIRS for the A* inner loop: `for (const [dx, dz, cost] of DIRS)` allocated
// an array iterator per expanded cell (the sim's largest allocation source after fog).
const DIR_X = DIRS.map((d) => d[0])
const DIR_Z = DIRS.map((d) => d[1])
const DIR_COST = DIRS.map((d) => d[2])

const MAX_EXPANDED = 20000
const MAX_CACHE = 4000
const SNAP_RADIUS = 12

/** Min-heap of (f, cell) pairs in parallel arrays; reused across searches. */
class CellHeap {
  readonly #f: number[] = []
  readonly #c: number[] = []

  get size(): number {
    return this.#f.length
  }

  clear(): void {
    this.#f.length = 0
    this.#c.length = 0
  }

  push(f: number, c: number): void {
    const hf = this.#f
    const hc = this.#c
    let i = hf.length
    hf.push(f)
    hc.push(c)
    while (i > 0) {
      const p = (i - 1) >> 1
      if (hf[p]! <= f) break
      hf[i] = hf[p]!
      hc[i] = hc[p]!
      i = p
    }
    hf[i] = f
    hc[i] = c
  }

  pop(): number {
    const hf = this.#f
    const hc = this.#c
    const top = hc[0]!
    const lf = hf.pop()!
    const lc = hc.pop()!
    if (hf.length) {
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        if (l >= hf.length) break
        const r = l + 1
        const m = r < hf.length && hf[r]! < hf[l]! ? r : l
        if (hf[m]! >= lf) break
        hf[i] = hf[m]!
        hc[i] = hc[m]!
        i = m
      }
      hf[i] = lf
      hc[i] = lc
    }
    return top
  }
}

export class Nav {
  readonly #n: number
  readonly #open: Uint8Array
  // A* scratch buffers, reused.
  readonly #g: Float32Array
  readonly #came: Int32Array
  readonly #seen: Uint32Array
  readonly #heap = new CellHeap()
  #stamp = 0
  readonly #cache = new Map<number, readonly Vec2[]>()

  constructor(map: MobaMap) {
    const N = map.size
    this.#n = N
    this.#open = new Uint8Array(N * N)
    for (let i = 0; i < N * N; i++) {
      // Structures are fine to path near; only forest blocks. Water is wadeable.
      this.#open[i] = map.terrain[i] === Terrain.Forest ? 0 : 1
    }
    this.#g = new Float32Array(N * N)
    this.#came = new Int32Array(N * N)
    this.#seen = new Uint32Array(N * N)
  }

  walkable(p: Vec2): boolean {
    return this.#open[this.#cellOf(p)] === 1
  }

  /** Waypoints from `from` to `to`, excluding the start; always ends at `to`. */
  path(from: Vec2, to: Vec2): readonly Vec2[] {
    const N = this.#n
    const s = this.#snap(this.#cellOf(from))
    const t = this.#snap(this.#cellOf(to))
    if (s === t || this.#clear(s, t)) return [to]
    const key = s * N * N + t
    const hit = this.#cache.get(key)
    if (hit) return hit
    const cells = this.#astar(s, t)
    if (cells.length === 0) return [to]
    // String-pull: keep only cells needed to stay in line of sight.
    const pts: number[] = []
    let anchor = cells[0]!
    for (let i = 1; i < cells.length; i++) {
      if (!this.#clear(anchor, cells[i]!)) {
        anchor = cells[i - 1]!
        pts.push(anchor)
      }
    }
    const result = [
      ...pts.map((c) => {
        const x = c % N
        return { x: x + 0.5, z: (c - x) / N + 0.5 }
      }),
      to,
    ]
    if (this.#cache.size > MAX_CACHE) this.#cache.clear()
    this.#cache.set(key, result)
    return result
  }

  #cellOf(p: Vec2): number {
    const N = this.#n
    const x = Math.max(0, Math.min(N - 1, Math.floor(p.x)))
    const z = Math.max(0, Math.min(N - 1, Math.floor(p.z)))
    return z * N + x
  }

  /** Nearest open cell by expanding rings. */
  #snap(c: number): number {
    const N = this.#n
    const open = this.#open
    if (open[c]) return c
    const cx = c % N
    const cz = (c - cx) / N
    for (let r = 1; r < SNAP_RADIUS; r++)
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue
          const x = cx + dx
          const z = cz + dz
          if (x >= 0 && z >= 0 && x < N && z < N && open[z * N + x]) return z * N + x
        }
    return c
  }

  /** Bresenham-ish supercover line test over open cells. */
  #clear(a: number, b: number): boolean {
    const N = this.#n
    const open = this.#open
    let x0 = a % N
    let z0 = (a - x0) / N
    const x1 = b % N
    const z1 = (b - x1) / N
    const dx = Math.abs(x1 - x0)
    const dz = Math.abs(z1 - z0)
    const sx = x0 < x1 ? 1 : -1
    const sz = z0 < z1 ? 1 : -1
    let err = dx - dz
    for (let i = 0; i < dx + dz + 2; i++) {
      if (!open[z0 * N + x0]) return false
      if (x0 === x1 && z0 === z1) return true
      const e2 = 2 * err
      if (e2 > -dz) {
        err -= dz
        x0 += sx
      }
      if (e2 < dx) {
        err += dx
        z0 += sz
      }
    }
    return true
  }

  #astar(s: number, t: number): number[] {
    const N = this.#n
    const open = this.#open
    const g = this.#g
    const came = this.#came
    const seen = this.#seen
    const heap = this.#heap
    const stamp = ++this.#stamp
    heap.clear()
    const tx = t % N
    const tz = (t - tx) / N
    const h = (c: number) => {
      const x = c % N
      const z = (c - x) / N
      const dx = Math.abs(x - tx)
      const dz = Math.abs(z - tz)
      return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz)
    }
    seen[s] = stamp
    g[s] = 0
    came[s] = -1
    heap.push(h(s), s)
    let expanded = 0
    while (heap.size && expanded < MAX_EXPANDED) {
      const c = heap.pop()
      expanded++
      if (c === t) break
      const cx = c % N
      const cz = (c - cx) / N
      for (let k = 0; k < 8; k++) {
        const dx = DIR_X[k]!
        const dz = DIR_Z[k]!
        const cost = DIR_COST[k]!
        const x = cx + dx
        const z = cz + dz
        if (x < 0 || z < 0 || x >= N || z >= N) continue
        const n = z * N + x
        if (!open[n]) continue
        if (dx && dz && (!open[cz * N + x] || !open[z * N + cx])) continue
        const ng = g[c]! + cost
        if (seen[n] !== stamp || ng < g[n]!) {
          seen[n] = stamp
          g[n] = ng
          came[n] = c
          heap.push(ng + h(n), n)
        }
      }
    }
    if (seen[t] !== stamp) return []
    const out: number[] = []
    for (let c = t; c !== -1; c = came[c]!) out.push(c)
    return out.toReversed()
  }
}

/** @deprecated Prefer `new Nav(map)`. */
export const createNav = (map: MobaMap): Nav => new Nav(map)
