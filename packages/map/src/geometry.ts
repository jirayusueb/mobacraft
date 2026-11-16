import type { Vec2 } from "./types.ts"

export const v = (x: number, z: number): Vec2 => ({ x, z })

/** Point symmetry about the map centre — how Dire mirrors Radiant. */
export const mirror = (p: Vec2): Vec2 => v(1 - p.x, 1 - p.z)

export const scale = (p: Vec2, s: number): Vec2 => v(p.x * s, p.z * s)

export const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z)

export const distToSegment = (p: Vec2, a: Vec2, b: Vec2): number => {
  const dx = b.x - a.x
  const dz = b.z - a.z
  const len2 = dx * dx + dz * dz
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2))
  return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t))
}

export const distToPath = (p: Vec2, path: readonly Vec2[]): number => {
  let best = Infinity
  for (let i = 0; i < path.length - 1; i++) {
    best = Math.min(best, distToSegment(p, path[i]!, path[i + 1]!))
  }
  return best
}

const pathLength = (path: readonly Vec2[]) => {
  let len = 0
  for (let i = 0; i < path.length - 1; i++) len += dist(path[i]!, path[i + 1]!)
  return len
}

/** Point at arc-length fraction `t` (0..1) along a polyline, plus its unit direction. */
export const alongPath = (path: readonly Vec2[], t: number): { point: Vec2; dir: Vec2 } => {
  let remaining = pathLength(path) * Math.max(0, Math.min(1, t))
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]!
    const b = path[i + 1]!
    const seg = dist(a, b)
    if (remaining <= seg || i === path.length - 2) {
      const k = seg === 0 ? 0 : remaining / seg
      return {
        point: v(a.x + (b.x - a.x) * k, a.z + (b.z - a.z) * k),
        dir: v((b.x - a.x) / seg, (b.z - a.z) / seg),
      }
    }
    remaining -= seg
  }
  return { point: path[0]!, dir: v(1, 0) }
}

export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}
