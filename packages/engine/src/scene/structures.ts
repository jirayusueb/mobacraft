import type { Camp, Landmark, MobaMap, Structure, Vec2 } from "@mobacraft/map"
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  ExtrudeGeometry,
  Group,
  IcosahedronGeometry,
  LatheGeometry,
  Mesh,
  MeshStandardNodeMaterial,
  MeshBasicNodeMaterial,
  OctahedronGeometry,
  RingGeometry,
  Shape,
  type Node,
  type Object3D,
  TorusGeometry,
  Vector2,
} from "three/webgpu"
import {
  abs,
  attribute,
  color,
  float,
  positionLocal,
  sin,
  smoothstep,
  time,
  int,
  uniform,
  uniformArray,
  vec2,
  vec3,
} from "three/tsl"
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js"
import { TEAM, WINDOW } from "../palette.ts"

/** 0 day → 1 night; windows, campfires and crystals glow brighter at night. */
export const nightGlow = uniform(0)

type Palette = (typeof TEAM)[keyof typeof TEAM]

const ROCK = { light: 0x6b6762, dark: 0x57534f, moss: 0x5f7a3a, floor: 0x2e2a27, earth: 0x4f4a44 }
const BONE = 0xe6dcc4

const materials = new Map<string, MeshStandardNodeMaterial>()
/**
 * Shared flat-shaded material per colour (+ emissive variant). Every part goes
 * through here so baking can merge by material. `glow` scales the emissive.
 */
const mat = (hex: number, opts: { emissive?: boolean; pulse?: boolean; glow?: number } = {}) => {
  const glowScale = opts.glow ?? 1
  const key = `${hex}-${opts.emissive ?? false}-${opts.pulse ?? false}-${glowScale}`
  let m = materials.get(key)
  if (!m) {
    m = new MeshStandardNodeMaterial({ color: hex, roughness: 0.85, flatShading: true })
    if (opts.emissive) {
      const glow = opts.pulse ? sin(time.mul(2)).mul(0.35).add(1.15) : float(1)
      m.emissiveNode = color(hex).mul(glow).mul(glowScale)
    }
    materials.set(key, m)
  }
  return m
}

const part = (geo: BufferGeometry, material: MeshStandardNodeMaterial, x = 0, y = 0, z = 0) => {
  const m = new Mesh(geo, material)
  m.position.set(x, y, z)
  m.castShadow = true
  m.receiveShadow = true
  return m
}

/** Shared windows glow warmly at night (emissive scaled by the `nightGlow` uniform). */
const windowMat = (() => {
  const m = new MeshStandardNodeMaterial({ color: 0x2a2018, roughness: 0.6, flatShading: true })
  m.emissiveNode = color(WINDOW).mul(nightGlow.mul(3).add(0.1))
  return m
})()

/** Small deterministic PRNG so rocks and stonework look hand-placed but stable. */
const rng = (seed: number) => {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Ring of `n` boxes around the Y axis — crenellations, fence posts, stones. */
const ringOf = (
  n: number,
  r: number,
  geo: () => BufferGeometry,
  material: MeshStandardNodeMaterial,
  y: number,
  phase = 0,
) =>
  Array.from({ length: n }, (_, k) => {
    const a = (k / n) * Math.PI * 2 + phase
    const m = part(geo(), material, Math.cos(a) * r, y, Math.sin(a) * r)
    m.rotation.y = -a
    return m
  })

/** Triangular gable-end wall: prism along X, base `depth` wide, apex at `h`. */
const gableWall = (length: number, depth: number, h: number) => {
  const shape = new Shape()
  shape.moveTo(-depth / 2, 0)
  shape.lineTo(depth / 2, 0)
  shape.lineTo(0, h)
  shape.closePath()
  return new ExtrudeGeometry(shape, { depth: length, bevelEnabled: false })
    .translate(0, 0, -length / 2)
    .rotateY(Math.PI / 2)
}

/**
 * Thick chevron roof slab along X. Its underside follows the wall pitch (wall top
 * at y=0, ridge at `h`) and it overhangs the walls by `over` on every side.
 */
const roofSlab = (length: number, depth: number, h: number, over: number, t = 0.08) => {
  const k = h / (depth / 2)
  const half = depth / 2 + over
  const shape = new Shape()
  shape.moveTo(-half, h + t - k * half)
  shape.lineTo(0, h + t)
  shape.lineTo(half, h + t - k * half)
  shape.lineTo(half, h - k * half)
  shape.lineTo(0, h)
  shape.lineTo(-half, h - k * half)
  shape.closePath()
  return new ExtrudeGeometry(shape, { depth: length + over * 2, bevelEnabled: false })
    .translate(0, 0, -(length + over * 2) / 2)
    .rotateY(Math.PI / 2)
}

/**
 * A recessed opening on a wall whose outer face is the local z=0 plane: the
 * pane/leaf sits just proud of the wall while a frame (jambs, lintel, sill)
 * stands further out, so the opening reads as set back.
 */
const opening = (
  w: number,
  h: number,
  fill: MeshStandardNodeMaterial,
  frame: MeshStandardNodeMaterial,
  mullion?: MeshStandardNodeMaterial,
) => {
  const g = new Group()
  g.add(
    part(new BoxGeometry(w, h, 0.04), fill),
    part(new BoxGeometry(0.06, h + 0.02, 0.09), frame, -(w / 2 + 0.03), 0, 0.04),
    part(new BoxGeometry(0.06, h + 0.02, 0.09), frame, w / 2 + 0.03, 0, 0.04),
    part(new BoxGeometry(w + 0.16, 0.07, 0.1), frame, 0, h / 2 + 0.035, 0.045),
    part(new BoxGeometry(w + 0.14, 0.05, 0.12), frame, 0, -h / 2 - 0.025, 0.05),
  )
  if (mullion) {
    g.add(
      part(new BoxGeometry(0.03, h, 0.03), mullion, 0, 0, 0.025),
      part(new BoxGeometry(w, 0.03, 0.03), mullion, 0, 0, 0.025),
    )
  }
  return g
}

/** Place `obj` on a wall face: `face` 0=+z, 1=+x, 2=-z, 3=-x at distance `dist`. */
const onFace = (obj: Group, face: number, dist: number, along: number, y: number) => {
  const a = (face * Math.PI) / 2
  obj.rotation.y = a
  obj.position.set(
    Math.sin(a) * dist + Math.cos(a) * along,
    y,
    Math.cos(a) * dist - Math.sin(a) * along,
  )
  return obj
}

/** Irregular low-poly boulder; returns the rock plus an optional moss cap. */
const boulder = (
  rand: () => number,
  r: number,
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  moss: boolean,
) => {
  const ico = rand() < 0.5
  const geo = () => (ico ? new IcosahedronGeometry(r, 0) : new DodecahedronGeometry(r, 0))
  const rx = rand() * 0.5 - 0.25
  const ry = rand() * Math.PI * 2
  const rz = rand() * 0.5 - 0.25
  const rock = part(geo(), mat(rand() < 0.5 ? ROCK.light : ROCK.dark), x, y, z)
  rock.scale.set(sx, sy, sz)
  rock.rotation.set(rx, ry, rz)
  const out = [rock]
  if (moss) {
    const cap = part(geo(), mat(ROCK.moss), x, y + r * sy * 0.55, z)
    cap.scale.set(sx * 0.86, sy * 0.42, sz * 0.86)
    cap.rotation.set(rx, ry, rz)
    out.push(cap)
  }
  return out
}

/** Pointed horn/spike: a 4-sided cone tipped outward by `tilt` toward local +z, then yawed. */
const horn = (
  material: MeshStandardNodeMaterial,
  r: number,
  len: number,
  tilt: number,
  yaw: number,
  x: number,
  y: number,
  z: number,
) =>
  part(
    new ConeGeometry(r, len, 4)
      .translate(0, len / 2, 0)
      .rotateX(tilt)
      .rotateY(yaw),
    material,
    x,
    y,
    z,
  )

// --- contact shadows ----------------------------------------------------------

interface Blob {
  x: number
  y: number
  z: number
  rx: number
  rz: number
  rot: number
  strength: number
}

const BLOB_SEGMENTS = 20

/**
 * All contact shadows in one mesh. Each blob is a fan with a plateau: centre and
 * inner ring carry `blob = strength`, rim carries 0, so the shader just shapes it.
 */
const buildBlobs = (blobs: readonly Blob[]) => {
  const n = BLOB_SEGMENTS
  const perBlob = 1 + n * 2
  const pos = new Float32Array(blobs.length * perBlob * 3)
  const val = new Float32Array(blobs.length * perBlob)
  const idx: number[] = []
  blobs.forEach((b, i) => {
    const base = i * perBlob
    const c = Math.cos(b.rot)
    const s = Math.sin(b.rot)
    const put = (v: number, lx: number, lz: number, value: number) => {
      pos[(base + v) * 3] = b.x + lx * c + lz * s
      pos[(base + v) * 3 + 1] = b.y + 0.02
      pos[(base + v) * 3 + 2] = b.z - lx * s + lz * c
      val[base + v] = value
    }
    put(0, 0, 0, b.strength)
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2
      put(1 + k, Math.cos(a) * b.rx * 0.5, Math.sin(a) * b.rz * 0.5, b.strength)
      put(1 + n + k, Math.cos(a) * b.rx, Math.sin(a) * b.rz, 0)
    }
    for (let k = 0; k < n; k++) {
      const k1 = (k + 1) % n
      const i0 = base + 1 + k
      const i1 = base + 1 + k1
      const o0 = base + 1 + n + k
      const o1 = base + 1 + n + k1
      // Counter-clockwise seen from above (+Y normal).
      idx.push(base, i1, i0, i0, i1, o1, i0, o1, o0)
    }
  })
  const geo = new BufferGeometry()
  geo.setAttribute("position", new BufferAttribute(pos, 3))
  geo.setAttribute("blob", new BufferAttribute(val, 1))
  geo.setIndex(idx)
  const m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false })
  m.colorNode = color(0x1c1610)
  m.opacityNode = smoothstep(float(0), float(0.85), attribute("blob", "float")).mul(0.35)
  const mesh = new Mesh(geo, m)
  mesh.name = "contact-shadows"
  mesh.renderOrder = 1
  return mesh
}

// --- buildings ----------------------------------------------------------------

/** Octagonal prism with flat faces on the axes. */
const oct = (top: number, bottom: number, height: number) =>
  new CylinderGeometry(top, bottom, height, 8).rotateY(Math.PI / 8)

const tower = (p: Palette, tier: number, dire: boolean, seed: number) => {
  const g = new Group()
  const h = 1.8 + tier * 0.3
  const y0 = 0.43
  const rb = 0.58
  const rt = 0.44
  const cos8 = Math.cos(Math.PI / 8)
  /** Shaft radius at fraction `t` of the height (flat-face distance). */
  const rAt = (t: number) => (rb - (rb - rt) * t) * cos8
  const yTop = y0 + h
  g.add(
    // Stone plinth sunk into the ground, then a stepped footing.
    part(oct(0.98, 1.06, 0.4), mat(p.stoneDark), 0, 0.05),
    part(oct(0.8, 0.88, 0.18), mat(p.stone), 0, 0.34),
    // Tapered shaft.
    part(oct(rt, rb, h).translate(0, h / 2, 0), mat(p.stone), 0, y0),
  )
  // Stone courses: a heavy base course and two thinner bands.
  for (const [t, th, out] of [
    [0.03, 0.12, 0.05],
    [0.36, 0.07, 0.035],
    [0.68, 0.07, 0.035],
  ] as const) {
    const r = rb - (rb - rt) * t + out
    g.add(part(oct(r, r, th), mat(p.stoneDark), 0, y0 + h * t))
  }
  // A few proud ashlar blocks so the shaft is not a clean extrusion.
  const rand = rng(seed)
  for (let k = 0; k < 6; k++) {
    const face = Math.floor(rand() * 8)
    const t = 0.12 + rand() * 0.75
    if (face === 0 && t < 0.3) continue // keep the door clear
    const a = (face / 8) * Math.PI * 2
    const r = rAt(t)
    const block = part(
      new BoxGeometry(0.18 + rand() * 0.1, 0.1, 0.06),
      mat(p.stoneDark),
      Math.sin(a) * r,
      y0 + h * t,
      Math.cos(a) * r,
    )
    block.rotation.y = a
    g.add(block)
  }
  // Small arched door at the base and an arrow-slit window, both on the front face.
  const door = opening(0.26, 0.4, mat(p.wood), mat(p.stoneDark))
  door.add(
    part(
      new CylinderGeometry(0.17, 0.17, 0.09, 8, 1, false, -Math.PI / 2, Math.PI).rotateX(
        Math.PI / 2,
      ),
      mat(p.stoneDark),
      0,
      0.235,
      0.045,
    ),
  )
  g.add(onFace(door, 0, rAt(0.08) + 0.01, 0, y0 + 0.2))
  g.add(onFace(opening(0.09, 0.3, windowMat, mat(p.stoneDark)), 0, rAt(0.52), 0, y0 + h * 0.52))
  g.add(onFace(opening(0.09, 0.26, windowMat, mat(p.stoneDark)), 2, rAt(0.5), 0, y0 + h * 0.5))
  // Timber corbels and a hoarding floor carrying the battlement.
  const rTop = rt * cos8
  g.add(
    ...ringOf(8, rTop + 0.06, () => new BoxGeometry(0.12, 0.18, 0.1), mat(p.wood), yTop - 0.12),
    part(oct(0.78, 0.74, 0.07), mat(p.wood), 0, yTop + 0.01),
    part(oct(0.74, 0.62, 0.24), mat(p.stoneDark), 0, yTop + 0.16),
  )
  const merlonY = yTop + 0.39
  if (dire) {
    // Pointed iron-and-bone merlons.
    g.add(
      ...ringOf(8, 0.64, () => new BoxGeometry(0.16, 0.2, 0.12), mat(p.stone), merlonY - 0.02),
      ...ringOf(8, 0.64, () => new ConeGeometry(0.08, 0.18, 4), mat(p.spike), merlonY + 0.17),
    )
  } else {
    g.add(...ringOf(8, 0.64, () => new BoxGeometry(0.17, 0.22, 0.13), mat(p.stone), merlonY))
  }
  // Roof on four short posts, overhanging the merlons, with a dark eave band.
  const roofY = merlonY + 0.2
  const roofR = dire ? 0.72 : 0.76
  const roofH = dire ? 1.2 : 0.9
  g.add(
    ...ringOf(
      4,
      0.42,
      () => new BoxGeometry(0.06, 0.24, 0.06),
      mat(p.wood),
      roofY - 0.1,
      Math.PI / 4,
    ),
    part(oct(roofR + 0.02, roofR + 0.02, 0.07), mat(p.roofDark), 0, roofY),
    part(new ConeGeometry(roofR, roofH, 8).rotateY(Math.PI / 8), mat(p.roof), 0, roofY + roofH / 2),
    part(
      new ConeGeometry(0.14, 0.26, 8).rotateY(Math.PI / 8),
      mat(p.roofDark),
      0,
      roofY + roofH - 0.08,
    ),
    part(new CylinderGeometry(0.03, 0.03, 0.45, 4), mat(p.wood), 0, roofY + roofH + 0.15),
    part(
      new OctahedronGeometry(0.2).scale(1, 1.4, 1),
      mat(p.accent, { emissive: true, pulse: true }),
      0,
      roofY + roofH + 0.5,
    ),
  )
  if (dire) {
    // Curved-looking horns sweeping out of the eaves.
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 8
      g.add(
        horn(
          mat(p.spike),
          0.07,
          0.5,
          0.95,
          a,
          Math.sin(a) * 0.55,
          roofY + 0.12,
          Math.cos(a) * 0.55,
        ),
      )
    }
    g.add(horn(mat(p.spike), 0.05, 0.35, 0.5, 0, 0, roofY + roofH * 0.55, roofR * 0.45))
  } else {
    // Clean white trim ring under the eave.
    g.add(part(oct(rTop + 0.05, rTop + 0.05, 0.05), mat(p.cloth), 0, yTop - 0.24))
  }
  // Banner on higher tiers.
  if (tier >= 2) {
    g.add(
      part(new CylinderGeometry(0.025, 0.025, 1, 4), mat(p.wood), 0.82, yTop + 0.75, 0),
      part(
        new BoxGeometry(0.02, 0.34, 0.26),
        mat(p.accent, { emissive: true }),
        0.83,
        yTop + 1.05,
        0.14,
      ),
    )
  }
  return g
}

/** The Ancient's crystals glow at 60% so its bloom does not swamp the base. */
const ANCIENT_GLOW = 0.6

const ancient = (p: Palette) => {
  const g = new Group()
  g.add(
    // Three-tier stepped dais, the lowest sunk into the ground.
    part(new CylinderGeometry(2.4, 2.6, 0.45, 12), mat(p.stoneDark), 0, 0.075),
    part(new CylinderGeometry(2.0, 2.2, 0.3, 12), mat(p.stone), 0, 0.45),
    part(new CylinderGeometry(1.5, 1.7, 0.35, 12), mat(p.stone), 0, 0.77),
    part(new CylinderGeometry(1.0, 1.2, 0.5, 8), mat(p.stoneDark), 0, 1.2),
    // Floating crystal with a smaller twin and orbit rings.
    part(
      new OctahedronGeometry(0.95).scale(1, 1.9, 1),
      mat(p.accent, { emissive: true, pulse: true, glow: ANCIENT_GLOW }),
      0,
      3.1,
    ),
    part(
      new OctahedronGeometry(0.3).scale(1, 1.6, 1),
      mat(p.accent, { emissive: true, glow: ANCIENT_GLOW }),
      0,
      1.75,
    ),
    part(
      new TorusGeometry(1.35, 0.06, 6, 32).rotateX(Math.PI / 2),
      mat(p.accent, { emissive: true, glow: ANCIENT_GLOW }),
      0,
      2.6,
    ),
    part(
      new TorusGeometry(1.05, 0.05, 6, 32).rotateX(Math.PI / 2 + 0.35),
      mat(p.accent, { emissive: true, glow: ANCIENT_GLOW }),
      0,
      3.4,
    ),
    // Steps toward the front.
    part(new BoxGeometry(1, 0.15, 0.5), mat(p.stone), 0, 0.08, 2.65),
  )
  // Obelisks with glowing tips.
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + Math.PI / 6
    const x = Math.cos(a) * 1.85
    const z = Math.sin(a) * 1.85
    g.add(
      part(new CylinderGeometry(0.14, 0.24, 2, 4).rotateY(Math.PI / 4), mat(p.stone), x, 1.6, z),
      part(new OctahedronGeometry(0.11), mat(p.accent, { emissive: true }), x, 2.7, z),
    )
    if (p === TEAM.dire) {
      g.add(horn(mat(p.spike), 0.06, 0.4, 0.6, Math.atan2(x, z), x * 1.06, 2.1, z * 1.06))
    }
  }
  return g
}

const barracks = (p: Palette, ranged: boolean, dire: boolean) => {
  const g = new Group()
  const w = ranged ? 1.7 : 2.1
  const d = w * 0.75
  const wallH = 0.95
  const base = 0.2
  const top = base + wallH
  const roofH = dire ? 0.98 : 0.72
  const over = 0.08
  g.add(
    // Stone plinth sunk 0.15 into the ground, 0.1 proud of the walls.
    part(new BoxGeometry(w + 0.2, base + 0.15, d + 0.2), mat(p.stoneDark), 0, (base - 0.15) / 2),
    // Stone sill course, plastered walls above.
    part(new BoxGeometry(w + 0.03, 0.26, d + 0.03), mat(p.stone), 0, base + 0.13),
    part(new BoxGeometry(w, wallH, d), mat(p.plaster), 0, base + wallH / 2),
    // Gable ends + roof slab + dark ridge cap.
    part(gableWall(w, d, roofH), mat(p.plaster), 0, top),
    part(roofSlab(w, d, roofH, over), mat(p.roof), 0, top),
    part(
      new BoxGeometry(w + over * 2 + 0.06, 0.12, 0.12).rotateX(Math.PI / 4),
      mat(p.roofDark),
      0,
      top + roofH + 0.08,
    ),
  )
  // Timber framing: corner posts, wall plate, studs, and barge boards.
  const timber = mat(p.wood)
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      g.add(
        part(
          new BoxGeometry(0.12, wallH, 0.12),
          timber,
          (sx * w) / 2,
          base + wallH / 2,
          (sz * d) / 2,
        ),
      )
  g.add(
    part(new BoxGeometry(w + 0.06, 0.09, d + 0.06), timber, 0, top - 0.02, 0),
    part(new BoxGeometry(w + 0.04, 0.06, d + 0.04), timber, 0, base + 0.29, 0),
  )
  for (const sz of [-1, 1])
    for (const x of [-w * 0.16, w * 0.16])
      g.add(
        part(
          new BoxGeometry(0.07, wallH - 0.1, 0.03),
          timber,
          x,
          base + wallH / 2 + 0.05,
          (sz * d) / 2 + 0.012,
        ),
      )
  for (const sx of [-1, 1]) {
    for (const z of [-d * 0.28, d * 0.28])
      g.add(
        part(
          new BoxGeometry(0.03, wallH - 0.1, 0.07),
          timber,
          (sx * w) / 2 + 0.012,
          base + wallH / 2 + 0.05,
          z,
        ),
      )
    // King post on each gable end.
    g.add(
      part(
        new BoxGeometry(0.03, roofH * 0.8, 0.07),
        timber,
        (sx * w) / 2 + 0.012,
        top + roofH * 0.4,
        0,
      ),
    )
  }
  // Recessed door with stone surround and step, framed windows.
  const door = opening(0.38, 0.56, mat(p.wood), mat(p.stoneDark))
  g.add(
    onFace(door, 0, d / 2, 0, base + 0.3),
    part(new BoxGeometry(0.6, 0.08, 0.22), mat(p.stoneDark), 0, base - 0.02, d / 2 + 0.14),
  )
  const win = () => opening(0.24, 0.22, windowMat, timber, timber)
  g.add(
    onFace(win(), 0, d / 2, -w * 0.32, base + 0.6),
    onFace(win(), 0, d / 2, w * 0.32, base + 0.6),
    onFace(win(), 1, w / 2, 0, base + 0.6),
    onFace(win(), 3, w / 2, 0, base + 0.6),
    onFace(win(), 2, d / 2, 0, base + 0.6),
  )
  // Chimney with a dark cap.
  g.add(
    part(
      new BoxGeometry(0.22, 0.75, 0.22),
      mat(p.stoneDark),
      w * 0.3,
      top + roofH * 0.55,
      -d * 0.18,
    ),
    part(
      new BoxGeometry(0.28, 0.06, 0.28),
      mat(p.roofDark),
      w * 0.3,
      top + roofH * 0.55 + 0.4,
      -d * 0.18,
    ),
  )
  if (dire) {
    // Horns on the gable peaks and a row of ridge spikes.
    for (const sx of [-1, 1]) {
      g.add(
        horn(
          mat(p.spike),
          0.06,
          0.42,
          0.6,
          (sx * Math.PI) / 2,
          sx * (w / 2 + over),
          top + roofH,
          0,
        ),
      )
    }
    for (const x of [-w * 0.2, w * 0.05])
      g.add(part(new ConeGeometry(0.05, 0.24, 4), mat(p.spike), x, top + roofH + 0.24, 0))
  } else {
    // Small accent finials on the ridge ends.
    for (const sx of [-1, 1])
      g.add(
        part(
          new OctahedronGeometry(0.07).scale(1, 1.5, 1),
          mat(p.accent, { emissive: true }),
          sx * (w / 2 + over),
          top + roofH + 0.22,
          0,
        ),
      )
  }
  if (ranged) {
    // Archery target outside.
    g.add(
      part(
        new BoxGeometry(0.05, 0.55, 0.05).rotateX(-0.25),
        timber,
        w / 2 + 0.45,
        0.27,
        d * 0.2 - 0.12,
      ),
      part(
        new CylinderGeometry(0.22, 0.22, 0.06, 12).rotateX(Math.PI / 2),
        mat(p.cloth),
        w / 2 + 0.45,
        0.42,
        d * 0.2,
      ),
      part(
        new CylinderGeometry(0.1, 0.1, 0.07, 10).rotateX(Math.PI / 2),
        mat(p.accent, { emissive: true }),
        w / 2 + 0.45,
        0.42,
        d * 0.2 + 0.01,
      ),
    )
  } else {
    // Weapon rack: two posts and a crossbar.
    g.add(
      part(new BoxGeometry(0.06, 0.5, 0.06), timber, w / 2 + 0.4, 0.25, -0.25),
      part(new BoxGeometry(0.06, 0.5, 0.06), timber, w / 2 + 0.4, 0.25, 0.25),
      part(new BoxGeometry(0.06, 0.06, 0.6), timber, w / 2 + 0.4, 0.45, 0),
    )
  }
  return g
}

const fountain = (p: Palette) => {
  const g = new Group()
  g.add(
    part(new CylinderGeometry(1.9, 2.0, 0.45, 16), mat(p.stoneDark), 0, 0.075),
    part(new CylinderGeometry(1.75, 1.75, 0.08, 16), mat(p.stone), 0, 0.34),
    part(
      new CylinderGeometry(1.55, 1.55, 0.1, 16),
      mat(p.accent, { emissive: true, pulse: true }),
      0,
      0.35,
    ),
    part(new CylinderGeometry(0.55, 0.7, 0.4, 10), mat(p.stone), 0, 0.55),
    part(new CylinderGeometry(0.18, 0.28, 1.3, 8), mat(p.stone), 0, 1.2),
    part(new CylinderGeometry(0.6, 0.2, 0.18, 10), mat(p.stoneDark), 0, 1.9),
    part(new IcosahedronGeometry(0.28, 0), mat(p.accent, { emissive: true }), 0, 2.2),
    ...ringOf(10, 1.85, () => new BoxGeometry(0.18, 0.26, 0.18), mat(p.stone), 0.42),
  )
  return g
}

const shop = (p: Palette) => {
  const g = new Group()
  g.add(
    // Stone pad, market stall: counter, posts, striped awning, goods.
    part(new BoxGeometry(1.8, 0.22, 1.2), mat(p.stoneDark), 0, -0.04, 0.1),
    part(new BoxGeometry(1.5, 0.6, 0.7), mat(p.wood), 0, 0.3, 0.1),
    part(new BoxGeometry(1.56, 0.06, 0.76), mat(0xb08a5a), 0, 0.62, 0.1),
    ...[-0.72, 0.72].flatMap((x) =>
      [-0.3, 0.5].map((z) => part(new BoxGeometry(0.07, 1.4, 0.07), mat(p.wood), x, 0.7, z)),
    ),
    part(new BoxGeometry(1.7, 0.06, 1.1).rotateX(0.22), mat(p.roof), 0, 1.45, 0.15),
    part(new BoxGeometry(1.7, 0.065, 0.2).rotateX(0.22), mat(p.cloth), 0, 1.465, -0.12),
    part(new BoxGeometry(1.7, 0.065, 0.2).rotateX(0.22), mat(p.cloth), 0, 1.38, 0.28),
    part(new BoxGeometry(0.3, 0.3, 0.3), mat(0xd9b26a), 0.95, 0.15, 0.55),
    part(new BoxGeometry(0.24, 0.24, 0.24), mat(0xc9a25a), 1.05, 0.12, 0.15),
    part(new CylinderGeometry(0.14, 0.16, 0.36, 8), mat(0x8a5a34), -0.98, 0.18, 0.5),
    part(new IcosahedronGeometry(0.09, 0), mat(0xe05a4a), -0.3, 0.72, 0.1),
    part(new IcosahedronGeometry(0.09, 0), mat(0xf2c14a), 0, 0.72, 0.05),
    part(new IcosahedronGeometry(0.1, 0), mat(p.accent, { emissive: true }), 0.35, 0.73, 0.15),
  )
  return g
}

/** Contact-shadow footprint (radii in local X/Z) per structure kind. */
const STRUCTURE_BLOB: Record<Structure["kind"], readonly [number, number]> = {
  tower: [1.3, 1.3],
  ancient: [3.1, 3.1],
  "barracks-melee": [1.6, 1.3],
  "barracks-ranged": [1.35, 1.1],
  fountain: [2.4, 2.4],
  shop: [1.3, 1.0],
  "secret-shop": [1.3, 1.0],
}

const structure = (s: Structure, y: number, centre: number, index: number) => {
  const p = TEAM[s.team]
  const dire = s.team === "dire"
  const g =
    s.kind === "tower"
      ? tower(p, s.tier ?? 1, dire, index * 977 + 13)
      : s.kind === "ancient"
        ? ancient(p)
        : s.kind === "barracks-melee"
          ? barracks(p, false, dire)
          : s.kind === "barracks-ranged"
            ? barracks(p, true, dire)
            : s.kind === "fountain"
              ? fountain(p)
              : shop(p)
  g.position.set(s.position.x, y, s.position.z)
  // Face the map centre so doors/details look toward the action.
  g.rotation.y = Math.atan2(centre - s.position.x, centre - s.position.z)
  g.name = s.id
  g.userData = { kind: s.kind, team: s.team, id: s.id }
  return g
}

const CAMP_TENTS: Record<Camp["kind"], number> = { small: 1, medium: 2, large: 2, ancient: 3 }

/** Neutral camp: a campfire with log seats, tents and a crate pile; ancient camps get standing stones. */
const camp = (c: Camp, y: number) => {
  const g = new Group()
  const ancientCamp = c.kind === "ancient"
  // Fire pit: stone ring, crossed logs, flame.
  g.add(
    ...ringOf(7, 0.32, () => new DodecahedronGeometry(0.09, 0), mat(0x8a8478), 0.06),
    part(new BoxGeometry(0.5, 0.07, 0.07).rotateY(0.6), mat(0x5a3e2b), 0, 0.07),
    part(new BoxGeometry(0.5, 0.07, 0.07).rotateY(-0.6), mat(0x5a3e2b), 0, 0.09),
    part(new ConeGeometry(0.14, 0.38, 5), mat(0xff9a3a, { emissive: true, pulse: true }), 0, 0.3),
    part(new ConeGeometry(0.08, 0.24, 5), mat(0xffe08a, { emissive: true }), 0, 0.26),
  )
  // Log seats.
  for (const a of [0.4, 2.5, 4.4]) {
    g.add(
      part(
        new CylinderGeometry(0.08, 0.08, 0.5, 6).rotateZ(Math.PI / 2).rotateY(a),
        mat(0x6a4a32),
        Math.cos(a) * 0.75,
        0.08,
        Math.sin(a) * 0.75,
      ),
    )
  }
  // Tents.
  const tents = CAMP_TENTS[c.kind]
  for (let k = 0; k < tents; k++) {
    const a = 1.4 + k * 1.6
    const tent = part(
      new ConeGeometry(0.42, 0.62, 4),
      mat(k % 2 ? 0xc9b48a : 0xa88a6a),
      Math.cos(a) * 1.25,
      0.31,
      Math.sin(a) * 1.25,
    )
    tent.rotation.y = a
    g.add(tent)
  }
  g.add(
    part(new BoxGeometry(0.26, 0.26, 0.26), mat(0x8a6a48), -1.1, 0.13, -0.5),
    part(new BoxGeometry(0.2, 0.2, 0.2).rotateY(0.5), mat(0x7a5a3c), -1.05, 0.36, -0.48),
  )
  if (ancientCamp) {
    g.add(...ringOf(5, 1.75, () => new BoxGeometry(0.28, 1.1, 0.22), mat(0x7a7468), 0.55, 0.3))
  }
  g.position.set(c.position.x, y, c.position.z)
  g.name = c.id
  g.userData = { kind: `camp-${c.kind}`, team: c.team, id: c.id }
  return g
}

/** A long bone with knobbly ends, lying flat at yaw `a`. */
const bone = (len: number, a: number, x: number, z: number) => {
  const g = new Group()
  g.add(
    part(new CylinderGeometry(0.04, 0.04, len, 5).rotateZ(Math.PI / 2), mat(BONE), 0, 0, 0),
    part(new IcosahedronGeometry(0.07, 0), mat(BONE), -len / 2, 0, 0),
    part(new IcosahedronGeometry(0.07, 0), mat(BONE), len / 2, 0, 0),
  )
  g.rotation.y = a
  g.position.set(x, 0.1, z)
  return g
}

/**
 * Roshan's lair: a sunken crater ringed by mossy boulders, a stacked-rock arch
 * whose mouth faces local +z (the river), bones, and the glowing aegis.
 */
const roshanLair = () => {
  const g = new Group()
  const rand = rng(0x705a)
  // Crater berm (lathe profile: sunken centre, raised rim, skirt into the ground).
  const profile = [
    [1.7, 0.0],
    [1.95, 0.22],
    [2.4, 0.34],
    [2.9, 0.16],
    [3.15, -0.15],
  ].map(([r, y]) => new Vector2(r, y))
  g.add(
    part(new LatheGeometry(profile, 16), mat(ROCK.earth)),
    part(new CircleGeometry(1.75, 16).rotateX(-Math.PI / 2), mat(ROCK.floor), 0, 0.01),
  )
  // Rim boulders, open toward +z for the cave mouth; taller at the back.
  const mouth = Math.PI / 2
  const gap = 0.55
  const rim = 13
  for (let k = 0; k < rim; k++) {
    const a = mouth + gap + (k / (rim - 1)) * (Math.PI * 2 - gap * 2) + (rand() - 0.5) * 0.15
    const back = (1 - Math.sin(a)) / 2
    const r = 0.42 + rand() * 0.22
    const rr = 2.2 + (rand() - 0.5) * 0.3
    g.add(
      ...boulder(
        rand,
        r,
        Math.cos(a) * rr,
        0.2 + r * 0.4 * (1 + back),
        Math.sin(a) * rr,
        0.9 + rand() * 0.4,
        0.8 + back * 0.9 + rand() * 0.3,
        0.9 + rand() * 0.4,
        rand() < 0.65,
      ),
    )
  }
  // Outer scatter of smaller rocks.
  for (let k = 0; k < 9; k++) {
    const a = mouth + 0.8 + (k / 8) * (Math.PI * 2 - 1.6) + (rand() - 0.5) * 0.3
    const r = 0.22 + rand() * 0.16
    const rr = 2.85 + rand() * 0.3
    g.add(
      ...boulder(
        rand,
        r,
        Math.cos(a) * rr,
        0.05,
        Math.sin(a) * rr,
        1.1,
        0.7 + rand() * 0.4,
        1,
        rand() < 0.5,
      ),
    )
  }
  // Arched cave mouth: two stacked-rock pillars and a lintel facing the river.
  const mz = 2.25
  for (const sx of [-1, 1]) {
    const x = sx * 0.95
    g.add(
      ...boulder(rand, 0.44, x, 0.32, mz, 1, 0.9, 1, false),
      ...boulder(rand, 0.36, x - sx * 0.04, 0.88, mz + 0.03, 1, 0.95, 1, false),
      ...boulder(rand, 0.3, x - sx * 0.12, 1.32, mz, 1, 0.9, 1, rand() < 0.5),
    )
  }
  g.add(
    ...boulder(rand, 0.4, -0.38, 1.66, mz, 1.5, 0.62, 1.1, true),
    ...boulder(rand, 0.4, 0.4, 1.68, mz + 0.02, 1.5, 0.58, 1.1, true),
    ...boulder(rand, 0.26, 0.02, 1.98, mz - 0.05, 1.2, 0.8, 1, true),
  )
  // Bones: femurs, a little ribcage and a horned skull.
  g.add(bone(0.6, 0.7, 0.9, 0.55), bone(0.5, -0.4, -0.75, 0.85), bone(0.45, 1.9, 0.3, -1.0))
  for (let k = 0; k < 3; k++) {
    g.add(
      part(
        new TorusGeometry(0.22 - k * 0.03, 0.025, 4, 8, Math.PI).rotateY(Math.PI / 2 + 0.2),
        mat(BONE),
        -0.95 + k * 0.14,
        0.02,
        -0.35 - k * 0.05,
      ),
    )
  }
  const skull = part(new IcosahedronGeometry(0.17, 0), mat(BONE), -0.35, 0.13, 1.15)
  skull.scale.set(1, 0.85, 1.2)
  g.add(
    skull,
    horn(mat(BONE), 0.04, 0.18, 0.9, -1.2, -0.48, 0.2, 1.12),
    horn(mat(BONE), 0.04, 0.18, 0.9, 1.2, -0.22, 0.2, 1.12),
  )
  // Aegis on a pedestal of stacked stones.
  g.add(
    ...boulder(rand, 0.38, 0, 0.18, 0, 1.2, 0.6, 1.2, true),
    part(new CylinderGeometry(0.22, 0.3, 0.32, 6), mat(ROCK.light), 0, 0.5),
    part(new IcosahedronGeometry(0.42, 0), mat(0xb07cff, { emissive: true, pulse: true }), 0, 1.1),
  )
  return g
}

const rune = () => {
  const g = new Group()
  // Stone disc with carved ring, hovering crystal.
  g.add(
    part(new CylinderGeometry(0.7, 0.78, 0.22, 12), mat(0xa89c86), 0, 0.01),
    part(
      new TorusGeometry(0.5, 0.04, 4, 20).rotateX(Math.PI / 2),
      mat(0x56d6ff, { emissive: true }),
      0,
      0.13,
    ),
    part(
      new OctahedronGeometry(0.26).scale(1, 1.4, 1),
      mat(0x56d6ff, { emissive: true, pulse: true }),
      0,
      0.95,
    ),
  )
  return g
}

/** Nearest point on a polyline. */
const nearestOnPath = (p: Vec2, path: readonly Vec2[]): Vec2 => {
  let best = path[0] ?? p
  let bestD = Infinity
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i]!
    const b = path[i + 1]!
    const dx = b.x - a.x
    const dz = b.z - a.z
    const len2 = dx * dx + dz * dz || 1
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2))
    const q = { x: a.x + dx * t, z: a.z + dz * t }
    const d = Math.hypot(q.x - p.x, q.z - p.z)
    if (d < bestD) {
      bestD = d
      best = q
    }
  }
  return best
}

const landmark = (l: Landmark, y: number, river: readonly Vec2[]) => {
  const g = l.kind === "roshan" ? roshanLair() : rune()
  g.position.set(l.position.x, y, l.position.z)
  if (l.kind === "roshan") {
    const q = nearestOnPath(l.position, river)
    g.rotation.y = Math.atan2(q.x - l.position.x, q.z - l.position.z)
  }
  g.name = l.id
  g.userData = { kind: l.kind, team: "neutral", id: l.id }
  return g
}

/**
 * Bake every part into one merged mesh per material (≈10 draw calls for ~110
 * structures). Picking uses invisible per-entity proxy cylinders: raycasts
 * ignore `visible`, the renderer does not.
 */
const bake = (source: Group, ownerOf: (root: Object3D) => number) => {
  source.updateMatrixWorld(true)
  const buckets = new Map<MeshStandardNodeMaterial, BufferGeometry[]>()
  source.traverse((o) => {
    if (!(o instanceof Mesh)) return
    const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(
      o.matrixWorld,
    )
    for (const name of Object.keys(g.attributes))
      if (name !== "position" && name !== "normal") g.deleteAttribute(name)
    // Which destructible structure this vertex belongs to (-1 = never destroyed).
    let root: Object3D = o
    while (root.parent && root.parent !== source) root = root.parent
    g.setAttribute(
      "owner",
      new BufferAttribute(new Float32Array(g.attributes.position!.count).fill(ownerOf(root)), 1),
    )
    const list = buckets.get(o.material as MeshStandardNodeMaterial) ?? []
    list.push(g)
    buckets.set(o.material as MeshStandardNodeMaterial, list)
  })
  const out = new Group()
  for (const [material, geos] of buckets) {
    const merged = mergeGeometries(geos)
    for (const g of geos) g.dispose()
    if (!merged) continue
    const mesh = new Mesh(merged, destructible(material))
    mesh.castShadow = true
    mesh.receiveShadow = true
    out.add(mesh)
  }
  return out
}

const proxyMaterial = new MeshBasicNodeMaterial()

/** Up to 64 destructible structures; 1 = standing, 0 = destroyed. */
const MAX_DESTRUCTIBLE = 64
export const structureAlive = uniformArray(
  Array.from({ length: MAX_DESTRUCTIBLE }, () => 1),
  "float",
)

/**
 * Clone a shared baked material so vertices whose owner is destroyed collapse to
 * a point below ground (no draw-call cost, no per-structure meshes).
 */
const destructibleCache = new Map<MeshStandardNodeMaterial, MeshStandardNodeMaterial>()
const destructible = (base: MeshStandardNodeMaterial) => {
  let m = destructibleCache.get(base)
  if (m) return m
  m = base.clone()
  m.emissiveNode = base.emissiveNode
  m.colorNode = base.colorNode
  const owner = attribute<"float">("owner", "float")
  const alive = owner
    .lessThan(0)
    .select(
      float(1),
      (structureAlive as unknown as { element: (i: unknown) => Node<"float"> }).element(
        int(owner.max(0)),
      ),
    )
  m.positionNode = positionLocal.mul(alive).add(vec3(0, alive.oneMinus().mul(-50), 0))
  destructibleCache.set(base, m)
  return m
}

/** All buildings, camps and landmarks: merged visuals + named, pickable proxies. */
export const buildStructures = (
  map: MobaMap,
): { visuals: Group; pickables: Group; destructibleIds: readonly string[] } => {
  const source = new Group()
  const blobs: Blob[] = []
  const ground = (x: number, z: number) => map.heightAt(x, z)
  map.structures.forEach((s, i) => {
    const g = structure(s, ground(s.position.x, s.position.z), map.size / 2, i)
    source.add(g)
    const [rx, rz] = STRUCTURE_BLOB[s.kind]
    blobs.push({ ...g.position, rx, rz, rot: g.rotation.y, strength: 1 })
  })
  for (const c of map.camps) {
    const g = camp(c, ground(c.position.x, c.position.z))
    source.add(g)
    blobs.push({ ...g.position, rx: 1.7, rz: 1.7, rot: 0, strength: 0.7 })
  }
  for (const l of map.landmarks) {
    const g = landmark(l, Math.max(map.waterLevel, ground(l.position.x, l.position.z)), map.river)
    source.add(g)
    const r = l.kind === "roshan" ? 3.4 : 0.95
    blobs.push({ ...g.position, rx: r, rz: r, rot: 0, strength: l.kind === "roshan" ? 0.8 : 1 })
  }

  const pickables = new Group()
  pickables.name = "pickables"
  for (const g of source.children) {
    const r =
      g.userData.kind === "ancient" || g.userData.kind === "roshan"
        ? 2.4
        : g.userData.kind === "tower"
          ? 0.9
          : 1.3
    const h = g.userData.kind === "tower" ? 4.5 : g.userData.kind === "ancient" ? 4.5 : 2
    const proxy = new Mesh(new CylinderGeometry(r, r, h, 8).translate(0, h / 2, 0), proxyMaterial)
    proxy.position.copy(g.position)
    proxy.visible = false
    proxy.name = g.name
    proxy.userData = { ...g.userData, radius: r }
    pickables.add(proxy)
  }

  // Destructible = towers, barracks, ancients (index into structureAlive by structure order).
  const destructibleIds = map.structures
    .filter(
      (s) =>
        s.team !== "neutral" &&
        (s.kind === "tower" || s.kind === "ancient" || s.kind.startsWith("barracks")),
    )
    .map((s) => s.id)
  const ownerIndex = new Map(destructibleIds.map((id, i) => [id, i]))
  const visuals = bake(source, (root) => ownerIndex.get(root.name) ?? -1)
  visuals.add(buildBlobs(blobs))
  visuals.name = "structures"
  source.traverse((o) => {
    if (o instanceof Mesh) o.geometry.dispose()
  })
  return { visuals, pickables, destructibleIds }
}

/**
 * Soft ground ring that marks the selected entity: a thin warm-white band at
 * radius 1 plus a faint outer halo, gently breathing. Radius is 1 before scale.
 */
export const buildSelectionRing = () => {
  const m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false })
  const r = vec2(positionLocal.x, positionLocal.z).length()
  const band = (centre: number, width: number) =>
    float(1).sub(smoothstep(float(0), float(width), abs(r.sub(centre))))
  const pulse = sin(time.mul(2.4)).mul(0.15).add(0.85)
  m.colorNode = color(0xfff4d6)
  m.opacityNode = band(1, 0.045).mul(0.55).add(band(1.13, 0.03).mul(0.18)).mul(pulse)
  const ring = new Mesh(new RingGeometry(0.9, 1.2, 64, 1).rotateX(-Math.PI / 2), m)
  ring.visible = false
  ring.name = "selection-ring"
  ring.renderOrder = 2
  return ring
}
