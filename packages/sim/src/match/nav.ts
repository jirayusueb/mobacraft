/**
 * Navigation — grid A* over MobaMap walkability (1 tile cells, 8-connected,
 * no corner cutting), with path smoothing by line-of-sight string pulling.
 *
 * Interface: createNav(map) → { path(from, to) → Vec2[] (waypoints, excluding start) }
 * Results are cached by (start cell, goal cell); goals inside blocked cells snap to
 * the nearest walkable cell. Water counts as walkable (heroes wade the river).
 */
import { type MobaMap, Terrain, type Vec2 } from "@mobacraft/map"

export const createNav = (map: MobaMap) => {
  const N = map.size
  const open = new Uint8Array(N * N)
  for (let z = 0; z < N; z++)
    for (let x = 0; x < N; x++) {
      const t = map.terrain[z * N + x]
      // Structures are fine to path near; only forest blocks. Water is wadeable.
      open[z * N + x] = t === Terrain.Forest ? 0 : 1
    }

  const cellOf = (p: Vec2) => {
    const x = Math.max(0, Math.min(N - 1, Math.floor(p.x)))
    const z = Math.max(0, Math.min(N - 1, Math.floor(p.z)))
    return z * N + x
  }

  /** Nearest open cell by expanding rings. */
  const snap = (c: number) => {
    if (open[c]) return c
    const cx = c % N
    const cz = (c - cx) / N
    for (let r = 1; r < 12; r++)
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
  const clear = (a: number, b: number) => {
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

  // A* scratch buffers, reused.
  const g = new Float32Array(N * N)
  const came = new Int32Array(N * N)
  const seen = new Uint32Array(N * N)
  let stamp = 0
  // Binary heap of [f, cell].
  const heapF: number[] = []
  const heapC: number[] = []
  const push = (f: number, c: number) => {
    let i = heapF.length
    heapF.push(f)
    heapC.push(c)
    while (i > 0) {
      const p = (i - 1) >> 1
      if (heapF[p]! <= f) break
      heapF[i] = heapF[p]!
      heapC[i] = heapC[p]!
      i = p
    }
    heapF[i] = f
    heapC[i] = c
  }
  const pop = () => {
    const top = heapC[0]!
    const lf = heapF.pop()!
    const lc = heapC.pop()!
    if (heapF.length) {
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        if (l >= heapF.length) break
        const r = l + 1
        const m = r < heapF.length && heapF[r]! < heapF[l]! ? r : l
        if (heapF[m]! >= lf) break
        heapF[i] = heapF[m]!
        heapC[i] = heapC[m]!
        i = m
      }
      heapF[i] = lf
      heapC[i] = lc
    }
    return top
  }

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

  const astar = (s: number, t: number): number[] => {
    stamp++
    heapF.length = 0
    heapC.length = 0
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
    push(h(s), s)
    let expanded = 0
    while (heapF.length && expanded < 20000) {
      const c = pop()
      expanded++
      if (c === t) break
      const cx = c % N
      const cz = (c - cx) / N
      for (const [dx, dz, cost] of DIRS) {
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
          push(ng + h(n), n)
        }
      }
    }
    if (seen[t] !== stamp) return []
    const out: number[] = []
    for (let c = t; c !== -1; c = came[c]!) out.push(c)
    return out.toReversed()
  }

  const cache = new Map<number, readonly Vec2[]>()

  const path = (from: Vec2, to: Vec2): readonly Vec2[] => {
    const s = snap(cellOf(from))
    const t = snap(cellOf(to))
    if (s === t || clear(s, t)) return [to]
    const key = s * N * N + t
    const hit = cache.get(key)
    if (hit) return hit
    const cells = astar(s, t)
    if (cells.length === 0) return [to]
    // String-pull: keep only cells needed to stay in line of sight.
    const pts: number[] = []
    let anchor = cells[0]!
    for (let i = 1; i < cells.length; i++) {
      if (!clear(anchor, cells[i]!)) {
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
    if (cache.size > 4000) cache.clear()
    cache.set(key, result)
    return result
  }

  return { path, walkable: (p: Vec2) => open[cellOf(p)] === 1 }
}

export type Nav = ReturnType<typeof createNav>
