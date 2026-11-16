import { Terrain, type MobaMap } from "@mobacraft/map"
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Mesh,
  MeshStandardNodeMaterial,
} from "three/webgpu"
import {
  attribute,
  color,
  float,
  floor,
  fract,
  vec2,
  mix,
  mx_noise_float,
  normalWorld,
  positionWorld,
  smoothstep,
  vec3,
} from "three/tsl"
import { CLIFF, GROUND_GRADE, TERRAIN_COLOR } from "../palette.ts"
import { CORNER_OFFSET, EDGE_DIR, createCornerCuts } from "./corner-cuts.ts"

/** Depth of the island slab below ground — the visible "diorama" cross-section. */
export const ISLAND_BOTTOM = -6

/** Soil bands, then stone near the slab bottom — like a cut cake. */
const strata = (y: number) => {
  if (y > -1.6) return new Color(CLIFF.soil)
  if (y > -3.4) return new Color(CLIFF.soilDark)
  return new Color(y > -4.9 ? CLIFF.stone : CLIFF.stoneDark)
}

/** Per-vertex surface kind for the shader: 0 grass … 1 path/plaza (interpolated), 2 cliff/side. */
const KIND_GRASS = 0
const KIND_SIDE = 2

/**
 * Stepped tile terrain as one mesh: a top quad per tile plus vertical faces
 * wherever a neighbour is lower (cliffs, riverbanks) and down to the slab
 * bottom along the island edge.
 *
 * Top colours are averaged at tile corners across same-height neighbours, so
 * lanes and team borders blend softly instead of stair-stepping. A TSL shader
 * adds world-space grain: grass blades/speckles, path pebbles, cliff strata.
 */
export const buildTerrain = (map: MobaMap): Mesh => {
  const N = map.size
  const pos: number[] = []
  const col: number[] = []
  const nrm: number[] = []
  const kind: number[] = []
  const pathCol: number[] = []
  const paved: number[] = []

  const tileColor = (() => {
    const cache: Color[] = []
    const c = new Color()
    for (let i = 0; i < N * N; i++) {
      const team = map.side[i] === 0 ? "radiant" : "dire"
      const t = map.terrain[i] as Terrain
      c.setHex(TERRAIN_COLOR[team][t])
      const flat = t === Terrain.Lane || t === Terrain.Plaza
      const n = (map.tint[i]! - 0.5) * (flat ? 0.1 : 0.26)
      c.offsetHSL(n * 0.12, flat ? 0 : n * 0.2, n * 0.55)
      cache.push(c.clone())
    }
    return (i: number) => cache[i]!
  })()

  const isPath = (i: number) => map.terrain[i] === Terrain.Lane || map.terrain[i] === Terrain.Plaza
  /** 0..1 "pathiness" of each tile, softened over neighbours — drives the pebble shader. */
  const pathiness = new Float32Array(N * N)
  for (let i = 0; i < N * N; i++) pathiness[i] = isPath(i) ? 1 : 0

  /**
   * Corner sample over the (up to) 4 same-height tiles touching (cx, cz):
   * ground colour averaged over non-path tiles, path colour over path tiles,
   * and the path fraction. Keeping the two colours apart lets the shader cut a
   * crisp, noisy path edge instead of a blurry gradient.
   */
  const corner = (cx: number, cz: number, h: number) => {
    let plazas = 0
    const g = { r: 0, g: 0, b: 0, n: 0 }
    const q = { r: 0, g: 0, b: 0, n: 0 }
    let total = 0
    for (const [ox, oz] of [
      [-1, -1],
      [0, -1],
      [-1, 0],
      [0, 0],
    ] as const) {
      const tx = cx + ox
      const tz = cz + oz
      if (tx < 0 || tz < 0 || tx >= N || tz >= N) continue
      const j = tz * N + tx
      if (map.height[j] !== h) continue
      const tc = tileColor(j)
      if (map.terrain[j] === Terrain.Plaza) plazas++
      const acc = pathiness[j] ? q : g
      acc.r += tc.r
      acc.g += tc.g
      acc.b += tc.b
      acc.n++
      total++
    }
    const avg = (a: typeof g, fb: typeof g) => {
      const src = a.n > 0 ? a : fb
      const k = 1 / Math.max(1, src.n)
      return { r: src.r * k, g: src.g * k, b: src.b * k }
    }
    return {
      ground: avg(g, q),
      path: avg(q, g),
      mask: q.n / Math.max(1, total),
      plaza: plazas / Math.max(1, total),
    }
  }

  type RGB = { r: number; g: number; b: number }
  const pushV = (
    x: number,
    y: number,
    z: number,
    n: readonly number[],
    c: RGB,
    k: number,
    pc: RGB = c,
    pv = 0,
  ) => {
    pos.push(x, y, z)
    nrm.push(n[0]!, n[1]!, n[2]!)
    col.push(c.r, c.g, c.b)
    pathCol.push(pc.r, pc.g, pc.b)
    kind.push(k)
    paved.push(pv)
  }

  const heightOf = (tx: number, tz: number) =>
    tx < 0 || tz < 0 || tx >= N || tz >= N ? ISLAND_BOTTOM : map.height[tz * N + tx]!

  const UP = [0, 1, 0] as const
  const cutAt = createCornerCuts(map)
  const lip = new Color()

  type Sample = ReturnType<typeof corner>
  const lerpRGB = (p: RGB, q: RGB, t: number): RGB => ({
    r: p.r + (q.r - p.r) * t,
    g: p.g + (q.g - p.g) * t,
    b: p.b + (q.b - p.b) * t,
  })
  const lerpSample = (p: Sample, q: Sample, t: number): Sample => ({
    ground: lerpRGB(p.ground, q.ground, t),
    path: lerpRGB(p.path, q.path, t),
    mask: p.mask + (q.mask - p.mask) * t,
    plaza: p.plaza + (q.plaza - p.plaza) * t,
  })
  type Pt = { x: number; z: number; s: Sample }
  const top = (pt: Pt, y: number) =>
    pushV(pt.x, y, pt.z, UP, pt.s.ground, pt.s.mask, pt.s.path, pt.s.plaza)

  /** Vertical face from P→Q (circulation order) between heights y0 > y1, with strata bands. */
  const wall = (
    p: { x: number; z: number },
    q: { x: number; z: number },
    h: number,
    nh: number,
    n: readonly number[],
    tile: number,
  ) => {
    const edge = nh === ISLAND_BOTTOM
    const bands = edge ? [h, h - 0.32, -1.6, -3.4, -4.9, nh] : [h, h - 0.12, nh]
    const topC = tileColor(tile)
    for (let k = 0; k < bands.length - 1; k++) {
      const y0 = bands[k]!
      const y1 = Math.max(nh, bands[k + 1]!)
      if (y1 >= y0) continue
      const faceColor =
        k === 0
          ? lip.setHex(CLIFF.lip).lerp(topC, 0.55).multiplyScalar(0.85)
          : edge
            ? strata(y1)
            : new Color(CLIFF.soil).lerp(topC, 0.25).multiplyScalar(0.8)
      const kk = k === 0 ? KIND_GRASS : KIND_SIDE
      pushV(p.x, y0, p.z, n, faceColor, kk)
      pushV(p.x, y1, p.z, n, faceColor, kk)
      pushV(q.x, y1, q.z, n, faceColor, kk)
      pushV(p.x, y0, p.z, n, faceColor, kk)
      pushV(q.x, y1, q.z, n, faceColor, kk)
      pushV(q.x, y0, q.z, n, faceColor, kk)
    }
  }
  const tileSample = (j: number): Sample => {
    const c = tileColor(j)
    const path = pathiness[j]!
    return { ground: c, path: c, mask: path, plaza: map.terrain[j] === Terrain.Plaza ? 1 : 0 }
  }

  for (let tz = 0; tz < N; tz++) {
    for (let tx = 0; tx < N; tx++) {
      const i = tz * N + tx
      const h = map.height[i]!
      const corners: Pt[] = CORNER_OFFSET.map(([ox, oz]) => ({
        x: tx + ox,
        z: tz + oz,
        s: corner(tx + ox, tz + oz, h),
      }))
      const mid = (k: number): Pt => {
        const p = corners[k]!
        const q = corners[(k + 1) % 4]!
        return { x: (p.x + q.x) / 2, z: (p.z + q.z) / 2, s: lerpSample(p.s, q.s, 0.5) }
      }
      const cuts = [0, 1, 2, 3].map((k) => cutAt(tx, tz, k))

      // Top polygon in circulation order, with bevelled corners.
      const poly: Pt[] = []
      for (let k = 0; k < 4; k++) {
        if (cuts[k]) poly.push(mid((k + 3) % 4), mid(k))
        else poly.push(corners[k]!)
      }
      const centre: Pt = {
        x: tx + 0.5,
        z: tz + 0.5,
        s: lerpSample(
          lerpSample(corners[0]!.s, corners[2]!.s, 0.5),
          lerpSample(corners[1]!.s, corners[3]!.s, 0.5),
          0.5,
        ),
      }
      for (let k = 0; k < poly.length; k++) {
        top(centre, h)
        top(poly[k]!, h)
        top(poly[(k + 1) % poly.length]!, h)
      }

      // Bevel walls + fill triangles for cut corners.
      for (let k = 0; k < 4; k++) {
        const cut = cuts[k]
        if (!cut) continue
        const m0 = mid((k + 3) % 4)
        const m1 = mid(k)
        const [ax, az] = EDGE_DIR[(k + 3) % 4]!
        const [bx, bz] = EDGE_DIR[k]!
        const len = Math.hypot(ax + bx, az + bz)
        wall(m0, m1, h, cut.fillHeight, [(ax + bx) / len, 0, (az + bz) / len], i)
        const fs = tileSample(cut.fillTile)
        const c = corners[k]!
        top({ ...m0, s: fs }, cut.fillHeight)
        top({ ...c, s: fs }, cut.fillHeight)
        top({ ...m1, s: fs }, cut.fillHeight)
        // Walls under the fill toward whichever edge-neighbour is lower still.
        const ha = heightOf(tx + ax, tz + az)
        const hb = heightOf(tx + bx, tz + bz)
        if (ha < cut.fillHeight) wall(m0, c, cut.fillHeight, ha, [ax, 0, az], cut.fillTile)
        if (hb < cut.fillHeight) wall(c, m1, cut.fillHeight, hb, [bx, 0, bz], cut.fillTile)
      }

      // Straight walls along each edge, trimmed where a corner was cut.
      for (let k = 0; k < 4; k++) {
        const [dx, dz] = EDGE_DIR[k]!
        const nh = heightOf(tx + dx, tz + dz)
        if (nh >= h) continue
        const p = cuts[k] ? mid(k) : corners[k]!
        const q = cuts[(k + 1) % 4] ? mid(k) : corners[(k + 1) % 4]!
        if (p.x === q.x && p.z === q.z) continue
        wall(p, q, h, nh, [dx, 0, dz], i)
      }
    }
  }
  // Underside so the slab looks solid from low angles.
  const s = N
  const under = new Color(CLIFF.stoneDark).multiplyScalar(0.6)
  for (const [x, z] of [
    [0, 0],
    [s, s],
    [0, s],
    [0, 0],
    [s, 0],
    [s, s],
  ] as const)
    pushV(x, ISLAND_BOTTOM, z, [0, -1, 0], under, KIND_SIDE)

  const geometry = new BufferGeometry()
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3))
  geometry.setAttribute("normal", new BufferAttribute(new Float32Array(nrm), 3))
  geometry.setAttribute("color", new BufferAttribute(new Float32Array(col), 3))
  geometry.setAttribute("surface", new BufferAttribute(new Float32Array(kind), 1))
  geometry.setAttribute("pathColor", new BufferAttribute(new Float32Array(pathCol), 3))
  geometry.setAttribute("paved", new BufferAttribute(new Float32Array(paved), 1))
  geometry.computeBoundingSphere()

  const material = new MeshStandardNodeMaterial({ roughness: 0.95, metalness: 0 })
  material.colorNode = terrainColor()
  const mesh = new Mesh(geometry, material)
  mesh.receiveShadow = true
  mesh.castShadow = true
  mesh.name = "terrain"
  return mesh
}

/**
 * Full surface colour. Top faces: a crisp, noise-wobbled cut between ground
 * and path colours; grass gets blade speckle + mottling, paths get pebbles and
 * dusty edges. Side faces get horizontal strata streaks.
 */
const terrainColor = () => {
  const ground = attribute<"vec3">("color", "vec3")
  const pathC = attribute<"vec3">("pathColor", "vec3")
  const surface = attribute<"float">("surface", "float")
  const p = positionWorld
  const up = smoothstep(float(0.6), float(0.9), normalWorld.y)

  const speckle = mx_noise_float(p.xz.mul(6.5)).mul(0.5).add(0.5)
  const mottle = mx_noise_float(p.xz.mul(0.55)).mul(0.5).add(0.5)
  const grassShade = float(0.88).add(speckle.mul(0.16)).add(mottle.mul(0.1))
  // Colour grading toward warm / cool / dry targets by large-scale noise (Quack-style meadow).
  const warmCool = mx_noise_float(p.xz.mul(0.08).add(17)).mul(0.5).add(0.5)
  const dryN = smoothstep(
    float(0.58),
    float(0.72),
    mx_noise_float(p.xz.mul(0.16).sub(9)).mul(0.5).add(0.5),
  )
  const graded = mix(
    mix(color(GROUND_GRADE.cool), color(GROUND_GRADE.warm), warmCool),
    color(GROUND_GRADE.dry),
    dryN,
  )
  // Keep each tile's own hue (team side, forest floor) but pull 35% toward the grade.
  const groundGraded = mix(ground, graded.mul(ground.length().div(graded.length())), float(0.35))

  const pebble = smoothstep(float(0.55), float(0.7), mx_noise_float(p.xz.mul(4.2)))
  const dust = mx_noise_float(p.xz.mul(1.3)).mul(0.06)
  const pathShade = float(0.97).add(dust).sub(pebble.mul(0.1)).add(speckle.mul(0.04))

  // Organic edge: perturb the interpolated mask, then cut it nearly hard.
  const wobble = mx_noise_float(p.xz.mul(1.1))
    .mul(0.22)
    .add(mx_noise_float(p.xz.mul(3.7)).mul(0.08))
  const m = surface.clamp(0, 1).add(wobble)
  const pathMask = smoothstep(float(0.47), float(0.53), m)
  // Slightly darker rim where grass meets path (worn edge).
  const rim = smoothstep(float(0.3), float(0.47), m).mul(float(1).sub(pathMask)).mul(0.12)

  // Plazas: flagstone paving — a cell grid with mortar lines and per-stone tone.
  const paved = smoothstep(float(0.5), float(0.9), attribute<"float">("paved", "float"))
  const cell = p.xz.mul(1.35)
  const stone = cell.add(vec2(floor(cell.y).mul(0.5), 0))
  const f = fract(stone)
  const mortar = smoothstep(float(0.0), float(0.07), f.x)
    .mul(smoothstep(float(1.0), float(0.93), f.x))
    .mul(smoothstep(float(0.0), float(0.07), f.y))
    .mul(smoothstep(float(1.0), float(0.93), f.y))
  const tone = mx_noise_float(floor(stone).mul(0.9)).mul(0.08)
  const paveShade = mix(float(0.78), float(1.0).add(tone), mortar)
  const pathFinal = pathC.mul(mix(pathShade, paveShade, paved))
  const top = mix(groundGraded.mul(grassShade.sub(rim)), pathFinal, pathMask)

  const streak = mx_noise_float(vec3(p.x.add(p.z).mul(0.4), p.y.mul(5), float(0))).mul(0.1)
  const side = ground.mul(float(0.95).add(streak))
  const sideMask = smoothstep(float(1.5), float(1.9), surface).max(float(1).sub(up))
  return mix(top, side, sideMask)
}
