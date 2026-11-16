import { Terrain, type MobaMap } from "@mobacraft/map"
import { BufferAttribute, BufferGeometry, Color, Mesh } from "three/webgpu"
import { MeshStandardNodeMaterial } from "three/webgpu"
import { CLIFF, TERRAIN_COLOR } from "../palette.ts"

/** Depth of the island slab below ground — the visible "diorama" cross-section. */
export const ISLAND_BOTTOM = -6

/** Grass lip, then soil, then stone near the slab bottom — like a cut cake. */
const strata = (y: number, edge: boolean) => {
  if (y > -0.01 && !edge) return new Color(CLIFF.soil)
  if (y > -1.5) return new Color(CLIFF.soil)
  if (y > -3.5) return new Color(CLIFF.soilDark)
  return new Color(y > -5 ? CLIFF.stone : CLIFF.stoneDark)
}

/**
 * Stepped tile terrain as one mesh: a top quad per tile plus vertical faces
 * wherever a neighbour is lower (cliffs, riverbanks) and down to the slab
 * bottom along the island edge. Colours are baked per vertex.
 */
export const buildTerrain = (map: MobaMap): Mesh => {
  const N = map.size
  const pos: number[] = []
  const col: number[] = []
  const nrm: number[] = []
  const c = new Color()

  const tileColor = (i: number) => {
    const team = map.side[i] === 0 ? "radiant" : "dire"
    const t = map.terrain[i] as Terrain
    c.setHex(TERRAIN_COLOR[team][t])
    // Low-frequency noise breaks up flat colour fields.
    const n = (map.tint[i]! - 0.5) * (t === Terrain.Lane || t === Terrain.Plaza ? 0.12 : 0.22)
    c.offsetHSL(n * 0.15, 0, n)
    return c
  }

  const quad = (
    a: readonly number[],
    b: readonly number[],
    cc: readonly number[],
    d: readonly number[],
    normal: readonly number[],
    colors: readonly Color[],
  ) => {
    for (const [v, k] of [
      [a, 0],
      [b, 1],
      [cc, 2],
      [a, 0],
      [cc, 2],
      [d, 3],
    ] as const) {
      pos.push(v[0]!, v[1]!, v[2]!)
      nrm.push(normal[0]!, normal[1]!, normal[2]!)
      const cv = colors[k] ?? colors[0]!
      col.push(cv.r, cv.g, cv.b)
    }
  }

  const heightOf = (tx: number, tz: number) =>
    tx < 0 || tz < 0 || tx >= N || tz >= N ? ISLAND_BOTTOM : map.height[tz * N + tx]!

  const cliffTop = new Color(CLIFF.lip)
  const DIRS = [
    { dx: 1, dz: 0, n: [1, 0, 0] },
    { dx: -1, dz: 0, n: [-1, 0, 0] },
    { dx: 0, dz: 1, n: [0, 0, 1] },
    { dx: 0, dz: -1, n: [0, 0, -1] },
  ] as const

  for (let tz = 0; tz < N; tz++) {
    for (let tx = 0; tx < N; tx++) {
      const i = tz * N + tx
      const h = map.height[i]!
      const top = tileColor(i).clone()
      quad([tx, h, tz], [tx, h, tz + 1], [tx + 1, h, tz + 1], [tx + 1, h, tz], [0, 1, 0], [top])

      for (const { dx, dz, n } of DIRS) {
        const nh = heightOf(tx + dx, tz + dz)
        if (nh >= h) continue
        const edge = nh === ISLAND_BOTTOM
        // Edge of the face, ordered so it winds outward.
        const [x0, z0, x1, z1] =
          dx === 1
            ? [tx + 1, tz + 1, tx + 1, tz]
            : dx === -1
              ? [tx, tz, tx, tz + 1]
              : dz === 1
                ? [tx, tz + 1, tx + 1, tz + 1]
                : [tx + 1, tz, tx, tz]
        // Split tall faces into bands so strata colours read.
        const bands = edge ? [h, h - 0.35, -1.5, -3.5, -5, nh] : [h, h - 0.2, nh]
        for (let b = 0; b < bands.length - 1; b++) {
          const y0 = bands[b]!
          const y1 = Math.max(nh, bands[b + 1]!)
          if (y1 >= y0) continue
          const color = b === 0 ? cliffTop.clone().lerp(top, 0.3) : strata(y1, edge)
          quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z1], [x1, y0, z1], n, [color])
        }
      }
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3))
  geometry.setAttribute("normal", new BufferAttribute(new Float32Array(nrm), 3))
  geometry.setAttribute("color", new BufferAttribute(new Float32Array(col), 3))
  geometry.computeBoundingSphere()

  const material = new MeshStandardNodeMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0,
  })
  const mesh = new Mesh(geometry, material)
  mesh.receiveShadow = true
  mesh.castShadow = true
  mesh.name = "terrain"
  return mesh
}
