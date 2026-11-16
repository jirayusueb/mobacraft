/**
 * Locomotion — Dota-style movement (spec/09).
 *
 * Turn-rate physics with the 0.2 rad movement gate, clearance-aware
 * dynamic navigation over the forest grid with cut/regrow chunk
 * invalidation, RVO2-lite local avoidance with priority yields (creep
 * blocking), hard hull separation, phase movement, wall sliding, and
 * free pathing after forced displacement.
 *
 * Scale: 64 Dota units = 1 tile (hero hull 0.375 tiles). Pure code; no
 * renderer, no I/O, deterministic (fixed candidate orders, (distance, id)
 * neighbour ordering).
 */
import { type MobaMap, Terrain, type Vec2 } from "@mobacraft/map"

// --- constants (spec/09 §scale convention) ----------------------------------------

/** Forward acceleration gate: 0.2 rad ≈ 11.5°, as in Dota. */
export const GATE = 0.2
export const MAX_SPEED = 3.5
export const ACCEL = 12
/** Free-pathing duration after forced displacement (seconds). */
export const FREE_PATH_T = 5
const CHUNK = 16
const MAX_EXPANDED = 20000
const MAX_CACHE = 4000
const SNAP_RADIUS = 12

export const HULL = {
  hero: 0.375,
  heroLarge: 0.125,
  creep: 0.25,
  neutral: 0.25,
} as const

/** Turn rates in rad/s (spec/09): fast hero 10, sluggish 5, creeps 7. */
export const TURN = { fast: 10, mid: 7, slow: 5 } as const

// --- headings & scalar approach ---------------------------------------------------

/** Shortest signed difference `desired − heading`, in (−π, π]. */
export const angDiff = (desired: number, heading: number): number => {
  let d = desired - heading
  while (d > Math.PI) d -= 2 * Math.PI
  while (d <= -Math.PI) d += 2 * Math.PI
  return d
}

/** Rotate `heading` toward `desired` by at most `turnRate * dt`. */
export const turnToward = (heading: number, desired: number, turnRate: number, dt: number) => {
  const d = angDiff(desired, heading)
  const max = turnRate * dt
  return heading + Math.max(-max, Math.min(max, d))
}

/** Move `v` toward `target` by at most `step` (linear accel/decel). */
export const approach = (v: number, target: number, step: number): number =>
  v < target ? Math.min(target, v + step) : Math.max(target, v - step)

// --- dynamic navigation ------------------------------------------------------------

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
    const fv = f
    let i = hf.length
    hf.push(fv)
    hc.push(c)
    while (i > 0) {
      const p = (i - 1) >> 1
      if (hf[p]! <= fv) break
      hf[i] = hf[p]!
      hc[i] = hc[p]!
      i = p
    }
    hf[i] = fv
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

export interface PathOpts {
  /** Layer 4 free pathing: ignore forest blocking and clearance pruning. */
  readonly ignoreForest?: boolean
}

/**
 * Grid A* over the (dynamic) forest grid with a clearance field.
 * `cutTree`/`regrowTree` update cells and invalidate the path cache;
 * `path(from, to, radius)` prunes cells whose free space fits the hull.
 */
export class DynamicNav {
  readonly #n: number
  readonly #blocked: Uint8Array
  readonly #clearance: Float32Array
  readonly #g: Float32Array
  readonly #came: Int32Array
  readonly #seen: Uint32Array
  readonly #heap = new CellHeap()
  #stamp = 0
  #cache = new Map<number, readonly Vec2[]>()
  /** Chunks dirtied by the last cut/regrow event (for tests/telemetry). */
  lastDirtyChunks: readonly number[] = []

  constructor(map: MobaMap) {
    const N = map.size
    this.#n = N
    this.#blocked = new Uint8Array(N * N)
    for (let i = 0; i < N * N; i++) this.#blocked[i] = map.terrain[i] === Terrain.Forest ? 1 : 0
    this.#clearance = new Float32Array(N * N)
    this.#g = new Float32Array(N * N)
    this.#came = new Int32Array(N * N)
    this.#seen = new Uint32Array(N * N)
    this.#recomputeClearance()
  }

  /** Boundary free space: chamfer distance-to-blocked minus half a cell. */
  #recomputeClearance(): void {
    const N = this.#n
    const cl = this.#clearance
    const bl = this.#blocked
    const INF = 1e6
    for (let i = 0; i < N * N; i++) cl[i] = bl[i] ? 0 : INF
    // Forward pass (NW → SE).
    for (let z = 0; z < N; z++)
      for (let x = 0; x < N; x++) {
        const i = z * N + x
        let d = cl[i]!
        if (x > 0) d = Math.min(d, cl[i - 1]! + 1)
        if (z > 0) d = Math.min(d, cl[i - N]! + 1)
        if (x > 0 && z > 0) d = Math.min(d, cl[i - N - 1]! + Math.SQRT2)
        if (x < N - 1 && z > 0) d = Math.min(d, cl[i - N + 1]! + Math.SQRT2)
        cl[i] = d
      }
    // Backward pass (SE → NW).
    for (let z = N - 1; z >= 0; z--)
      for (let x = N - 1; x >= 0; x--) {
        const i = z * N + x
        let d = cl[i]!
        if (x < N - 1) d = Math.min(d, cl[i + 1]! + 1)
        if (z < N - 1) d = Math.min(d, cl[i + N]! + 1)
        if (x < N - 1 && z < N - 1) d = Math.min(d, cl[i + N + 1]! + Math.SQRT2)
        if (x > 0 && z < N - 1) d = Math.min(d, cl[i + N - 1]! + Math.SQRT2)
        cl[i] = d
      }
    for (let i = 0; i < N * N; i++) cl[i] = cl[i]! - 0.5
  }

  /** Chunks overlapping `cell` and its 1-tile halo (≤ 4 at a corner). */
  #chunksAround(cell: number): number[] {
    const N = this.#n
    const per = Math.ceil(N / CHUNK)
    const cx = cell % N
    const cz = (cell - cx) / N
    const out = new Set<number>()
    for (const dz of [-1, 0, 1])
      for (const dx of [-1, 0, 1]) {
        const x = cx + dx
        const z = cz + dz
        if (x >= 0 && z >= 0 && x < N && z < N)
          out.add(Math.floor(z / CHUNK) * per + Math.floor(x / CHUNK))
      }
    return [...out]
  }

  /** Open a forest cell (tree destroyed). Invalidates the path cache. */
  cutTree(p: Vec2): boolean {
    const c = this.#cellOf(p)
    if (!this.#blocked[c]) return false
    this.#blocked[c] = 0
    this.lastDirtyChunks = this.#chunksAround(c)
    this.#recomputeClearance()
    this.#cache.clear()
    return true
  }

  /** Re-block a cell (tree regrown). Invalidates the path cache. */
  regrowTree(p: Vec2): boolean {
    const c = this.#cellOf(p)
    if (this.#blocked[c]) return false
    this.#blocked[c] = 1
    this.lastDirtyChunks = this.#chunksAround(c)
    this.#recomputeClearance()
    this.#cache.clear()
    return true
  }

  blocked(p: Vec2): boolean {
    return this.#blocked[this.#cellOf(p)] === 1
  }

  clearance(p: Vec2): number {
    return this.#clearance[this.#cellOf(p)]!
  }

  walkable(p: Vec2): boolean {
    return this.#blocked[this.#cellOf(p)] === 0
  }

  /** Waypoints from `from` to `to`, excluding the start; always ends at `to`. */
  path(from: Vec2, to: Vec2, radius: number, opts: PathOpts = {}): readonly Vec2[] {
    const N = this.#n
    const ignore = opts.ignoreForest === true
    const s = this.#snap(this.#cellOf(from), radius, ignore)
    const t = this.#snap(this.#cellOf(to), radius, ignore)
    if (s === t || (ignore ? this.#clearIgnoring(s, t) : this.#clear(s, t, radius))) return [to]
    const key = (s * N * N + t) * 8 + Math.round(radius * 64) + (ignore ? 1 : 0)
    const hit = this.#cache.get(key)
    if (hit) return hit
    const cells = this.#astar(s, t, radius, ignore)
    if (cells.length === 0) return [to]
    // String-pull: keep only cells needed to stay in line of sight.
    const clear = (a: number, b: number) =>
      ignore ? this.#clearIgnoring(a, b) : this.#clear(a, b, radius)
    const pts: number[] = []
    let anchor = cells[0]!
    for (let i = 1; i < cells.length; i++) {
      if (!clear(anchor, cells[i]!)) {
        anchor = cells[i - 1]!
        pts.push(anchor)
      }
    }
    // Keep the final corner when the last leg is not hull-clear either.
    if (!clear(anchor, t)) {
      const prev = cells[cells.length - 2]
      if (prev !== undefined && pts.at(-1) !== prev) pts.push(prev)
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

  #fits(c: number, radius: number, ignore: boolean): boolean {
    if (ignore) return true
    return this.#clearance[c]! >= radius
  }

  /** Nearest open-and-fitting cell by expanding rings. */
  #snap(c: number, radius: number, ignore: boolean): number {
    const N = this.#n
    const bl = this.#blocked
    if (!bl[c] && this.#fits(c, radius, ignore)) return c
    const cx = c % N
    const cz = (c - cx) / N
    let fallback = -1
    for (let r = 1; r < SNAP_RADIUS; r++)
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue
          const x = cx + dx
          const z = cz + dz
          if (x >= 0 && z >= 0 && x < N && z < N) {
            const n = z * N + x
            if (!bl[n]) {
              if (this.#fits(n, radius, ignore)) return n
              if (fallback < 0) fallback = n
            }
          }
        }
    return fallback < 0 ? c : fallback
  }

  /** Supercover line test over open cells that also fit the hull. */
  #clear(a: number, b: number, radius: number): boolean {
    const N = this.#n
    const bl = this.#blocked
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
      const c = z0 * N + x0
      if (bl[c] || this.#clearance[c]! < radius) return false
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

  #clearIgnoring(a: number, b: number): boolean {
    const N = this.#n
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

  #astar(s: number, t: number, radius: number, ignore: boolean): number[] {
    const N = this.#n
    const bl = this.#blocked
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
      for (const [dx, dz, cost] of DIRS) {
        const x = cx + dx
        const z = cz + dz
        if (x < 0 || z < 0 || x >= N || z >= N) continue
        const n = z * N + x
        if (bl[n]) continue
        if (!this.#fits(n, radius, ignore) && n !== t) continue
        if (dx && dz && (bl[cz * N + x] || bl[z * N + cx])) continue
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

// --- wall sliding -------------------------------------------------------------------

export interface SlidingBody {
  x: number
  z: number
}

/**
 * Axis-projected wall slide: `V ← V − (V·N)N` for the axis-aligned cell
 * normal of the blocked cell. Tries the full step, then the x-only and
 * z-only projections, then gives up (corner).
 */
export const slideMove = (
  nav: DynamicNav,
  b: SlidingBody,
  dx: number,
  dz: number,
  ignoreForest = false,
): void => {
  if (dx === 0 && dz === 0) return
  if (ignoreForest || !nav.blocked({ x: b.x + dx, z: b.z + dz })) {
    b.x += dx
    b.z += dz
    return
  }
  // Project out the blocked axis: slide along the wall.
  if (dx !== 0 && !nav.blocked({ x: b.x + dx, z: b.z })) b.x += dx
  else if (dz !== 0 && !nav.blocked({ x: b.x, z: b.z + dz })) b.z += dz
}

// --- turn-rate movement -------------------------------------------------------------

export interface MoveBody extends SlidingBody {
  heading: number
  /** Desired ground speed (tiles/s), after slows/buffs. */
  speed: number
  /** Turn rate in rad/s (defaults to TURN.mid). */
  turnRate?: number
  /** Current scalar speed (accel/decel state). */
  velMag?: number
  moveWithoutTurning?: boolean
  /** Remaining phase-movement seconds (skip unit collision). */
  phase?: number
  /** Remaining free-pathing seconds (ignore forest). */
  freePath?: number
}

export interface MoveNav {
  blocked(p: Vec2): boolean
}

/**
 * Dota turn-gated step toward `goal` (spec/09 §Layer 2): rotate toward
 * the goal; accelerate along the *current heading* only once the angular
 * difference is inside the 0.2 rad gate (or the body may move without
 * turning); decelerate inside `stopAt`. Movement resolves via wall slide.
 */
export const moveBody = (b: MoveBody, nav: MoveNav, goal: Vec2, stopAt: number, dt: number) => {
  const dx = goal.x - b.x
  const dz = goal.z - b.z
  const d = Math.hypot(dx, dz)
  const cur = b.velMag ?? 0
  if (d <= stopAt) {
    b.velMag = approach(cur, 0, ACCEL * dt)
    if (b.velMag <= 0) return
  } else {
    const desired = Math.atan2(dx, dz)
    if (b.moveWithoutTurning === true) b.heading = desired
    else b.heading = turnToward(b.heading, desired, b.turnRate ?? TURN.mid, dt)
    const gateOpen = b.moveWithoutTurning === true || Math.abs(angDiff(desired, b.heading)) < GATE
    const target = gateOpen ? Math.min(b.speed, MAX_SPEED) : 0
    b.velMag = approach(cur, target, ACCEL * dt)
  }
  if (b.velMag! <= 0) return
  const step = Math.min(b.velMag!, d) * dt
  const mx = Math.sin(b.heading) * step
  const mz = Math.cos(b.heading) * step
  slideMove(nav as DynamicNav, b, mx, mz, (b.freePath ?? 0) > 0)
}

// --- local avoidance ------------------------------------------------------------------

export interface AvoidBody extends SlidingBody {
  id: string
  heading: number
  /** Desired velocity for this tick (tiles/s), set before the call. */
  vx: number
  vz: number
  radius: number
  /** Avoidance priority: hero 2, creep/neutral 1. */
  priority: number
  /** Separation mass: hero 2, creep/neutral 1. */
  mass: number
  /** Ground speed scalar (for yields). */
  speed: number
  phase?: number
}

const RAYS = [-Math.PI / 3, -Math.PI / 6, 0, Math.PI / 6, Math.PI / 3]
const MAX_NEIGHBOURS = 8

/**
 * RVO2-lite avoidance + hard hull separation (spec/09 §Layer 3).
 *
 * For each non-phased body: pick, from the fixed 5-ray candidate set
 * around the desired velocity, the one maximising the minimum predicted
 * overlap time against the ≤ 8 nearest neighbours (ordered by distance
 * then id). Then yield to slower higher-priority blockers directly
 * ahead. Finally push overlapping hulls apart, mass-weighted, and keep
 * them out of blocked cells.
 */
export const resolveUnits = (units: readonly AvoidBody[], nav: DynamicNav, dt: number) => {
  if (units.length < 2) return
  // Spatial hash (1-tile buckets), insertion order = units order.
  const minx = Math.floor(Math.min(...units.map((u) => u.x)))
  const minz = Math.floor(Math.min(...units.map((u) => u.z)))
  const w = Math.floor(Math.max(...units.map((u) => u.x))) - minx + 2
  const d = Math.floor(Math.max(...units.map((u) => u.z))) - minz + 2
  const buckets = new Map<number, AvoidBody[]>()
  const keyOf = (u: AvoidBody) => (Math.floor(u.z) - minz) * w + (Math.floor(u.x) - minx)
  for (const u of units) {
    if ((u.phase ?? 0) > 0) continue
    const k = keyOf(u)
    const b = buckets.get(k)
    if (b) b.push(u)
    else buckets.set(k, [u])
  }

  const neighbours = (u: AvoidBody): AvoidBody[] => {
    const cx = Math.floor(u.x) - minx
    const cz = Math.floor(u.z) - minz
    const out: AvoidBody[] = []
    for (let z = cz - 1; z <= cz + 1; z++)
      for (let x = cx - 1; x <= cx + 1; x++) {
        if (x < 0 || z < 0 || x >= w || z >= d) continue
        const b = buckets.get(z * w + x)
        if (b) for (const o of b) if (o !== u) out.push(o)
      }
    out.sort(
      (a, b) =>
        Math.hypot(a.x - u.x, a.z - u.z) - Math.hypot(b.x - u.x, b.z - u.z) ||
        (a.id < b.id ? -1 : 1),
    )
    return out.slice(0, MAX_NEIGHBOURS)
  }

  // 1. Velocity adjustment (RVO-lite rays + priority yield).
  const chosen = new Map<string, { vx: number; vz: number }>()
  for (const u of units) {
    if ((u.phase ?? 0) > 0) continue
    const want = Math.hypot(u.vx, u.vz)
    if (want <= 1e-9) {
      chosen.set(u.id, { vx: 0, vz: 0 })
      continue
    }
    // The direction the body *wants* to go.
    const ns = neighbours(u)
    let bestVx = u.vx
    let bestVz = u.vz
    let bestScore = -Infinity
    for (const ray of RAYS) {
      const c = Math.cos(ray)
      const s = Math.sin(ray)
      // Rotate desired velocity by `ray`.
      const vx = u.vx * c - u.vz * s
      const vz = u.vx * s + u.vz * c
      let score = Infinity
      for (const o of ns) {
        const rsum = u.radius + o.radius
        const dx = o.x - u.x
        const dz = o.z - u.z
        const dist = Math.hypot(dx, dz)
        const ov = chosen.get(o.id) ?? o
        const relvx = ov.vx - vx
        const relvz = ov.vz - vz
        const closing = -(dx * relvx + dz * relvz) // >0 when approaching
        const t = closing > 0 ? (dist - rsum) / Math.hypot(relvx, relvz) : Infinity
        score = Math.min(score, t)
      }
      if (score > bestScore) {
        bestScore = score
        bestVx = vx
        bestVz = vz
      }
    }
    // 3. Body-blocking yield: slower, higher-priority body ahead (within
    //    2 × hull sum and in the front half-plane of the desired heading)
    //    caps this body's speed to the blocker's speed along the way.
    for (const o of ns) {
      const rsum = u.radius + o.radius
      const dx = o.x - u.x
      const dz = o.z - u.z
      if (Math.hypot(dx, dz) > 2 * rsum) continue
      if (o.priority <= u.priority || o.speed >= Math.hypot(bestVx, bestVz)) continue
      // Blocker roughly ahead: positive projection on the desired direction.
      const dirx = u.vx / want
      const dirz = u.vz / want
      if (dx * dirx + dz * dirz <= 0) continue
      // Cap the component along the blocker's heading at the blocker's speed.
      const bhx = Math.sin(o.heading)
      const bhz = Math.cos(o.heading)
      const along = bestVx * bhx + bestVz * bhz
      if (along > o.speed) {
        bestVx += (o.speed - along) * bhx
        bestVz += (o.speed - along) * bhz
      }
      // And cap the overall magnitude so a sideways RVO drift cannot
      // slip the body past a blocker it still overlaps.
      const mag = Math.hypot(bestVx, bestVz)
      if (mag > o.speed) {
        bestVx *= o.speed / mag
        bestVz *= o.speed / mag
      }
    }
    chosen.set(u.id, { vx: bestVx, vz: bestVz })
  }
  for (const u of units) {
    if ((u.phase ?? 0) > 0) continue
    const v = chosen.get(u.id)
    if (!v) continue
    slideMove(nav, u, v.vx * dt, v.vz * dt, false)
    u.heading = Math.hypot(v.vx, v.vz) > 1e-6 ? Math.atan2(v.vx, v.vz) : u.heading
  }

  // 2. Hard hull separation (mass-weighted, never into blocked cells).
  for (const u of units) {
    if ((u.phase ?? 0) > 0) continue
    for (const o of neighbours(u)) {
      if ((o.phase ?? 0) > 0) continue
      const rsum = u.radius + o.radius
      const dx = o.x - u.x
      const dz = o.z - u.z
      const dist = Math.hypot(dx, dz)
      if (dist >= rsum || dist === 0) continue
      const push = (rsum - dist) / dist
      const wu = o.mass / (u.mass + o.mass)
      const wo = 1 - wu
      const ux = u.x - dx * push * wu
      const uz = u.z - dz * push * wu
      if (!nav.blocked({ x: ux, z: uz })) {
        u.x = ux
        u.z = uz
      }
      const ox = o.x + dx * push * wo
      const oz = o.z + dz * push * wo
      if (!nav.blocked({ x: ox, z: oz })) {
        o.x = ox
        o.z = oz
      }
    }
  }
}
