import type { MobaMap } from "@mobacraft/map"

/**
 * Corner chamfering for the stepped tile terrain.
 *
 * Tile corners are numbered in circulation order — c0 (tx,tz), c1 (tx,tz+1),
 * c2 (tx+1,tz+1), c3 (tx+1,tz) — and edge k runs from corner k to corner k+1:
 * e0 faces -x, e1 faces +z, e2 faces +x, e3 faces -z. Corner k sits between
 * edges k-1 and k.
 *
 * A corner is *cut* when both edge-neighbours touching it and the diagonal
 * neighbour are all lower (an outward staircase step). The cut replaces the
 * square corner with a 45° bevel between the two edge midpoints, turning
 * diagonal riverbanks and plateau rims into smooth diagonals instead of
 * saw-teeth. The triangle under the bevel is filled at `fillHeight`.
 */
export const EDGE_DIR: readonly (readonly [number, number])[] = [
  [-1, 0],
  [0, 1],
  [1, 0],
  [0, -1],
]
export const CORNER_OFFSET: readonly (readonly [number, number])[] = [
  [0, 0],
  [0, 1],
  [1, 1],
  [1, 0],
]

export interface CornerCut {
  /** Height of the triangle filling the bevelled-away corner. */
  readonly fillHeight: number
  /** Tile index the fill borrows its look from (the higher lower neighbour). */
  readonly fillTile: number
}

export class CornerCuts {
  readonly #map: MobaMap
  readonly #cache = new Map<number, CornerCut | null>()

  constructor(map: MobaMap) {
    this.#map = map
  }

  /** The cut at corner `k` of tile `(tx, tz)`, or null if the corner stays square. */
  at(tx: number, tz: number, k: number): CornerCut | null {
    const map = this.#map
    const N = map.size
    const key = (tz * N + tx) * 4 + k
    const hit = this.#cache.get(key)
    if (hit !== undefined) return hit
    const inside = (x: number, z: number) => x >= 0 && z >= 0 && x < N && z < N
    const h = map.height[tz * N + tx]!
    const [ax, az] = EDGE_DIR[(k + 3) % 4]!
    const [bx, bz] = EDGE_DIR[k]!
    const a = [tx + ax, tz + az] as const
    const b = [tx + bx, tz + bz] as const
    const d = [tx + ax + bx, tz + az + bz] as const
    let result: CornerCut | null = null
    if (inside(...a) && inside(...b) && inside(...d)) {
      const ia = a[1] * N + a[0]
      const ib = b[1] * N + b[0]
      const id = d[1] * N + d[0]
      const ha = map.height[ia]!
      const hb = map.height[ib]!
      const hd = map.height[id]!
      if (ha < h && hb < h && hd < h) {
        const fillTile = ha >= hb ? ia : ib
        result = { fillHeight: Math.max(ha, hb), fillTile }
      }
    }
    this.#cache.set(key, result)
    return result
  }
}
