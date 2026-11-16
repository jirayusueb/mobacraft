/**
 * Hero models — procedural "polygon dark fantasy" champions.
 *
 * One parametric builder per HeroShape archetype (knight, brute, rogue, archer, mage,
 * priest, beast, shaman), coloured from the hero's `look`, plus a per-hero signature prop
 * so all twenty read distinct from the 30–38° isometric camera.
 *
 * Every model is ONE merged, non-indexed, flat-shaded BufferGeometry following contract.ts:
 * position / normal / color (linear vec3) / glow (0|1) / limb (0, ±1). Feet on y = 0,
 * facing +z, centred on x = z = 0; the hero's left side is +x.
 * Limb groups: +1 = left arm (+x) + right leg (−x); −1 = right arm (−x) + left leg (+x).
 * Weapons ride their arm's group. Quadrupeds: +1 = front-left + back-right legs.
 * Heroes stand ≈1.0–1.3 tall (brutes up to 1.5) vs lane creeps at 0.75.
 */
import { heroDef } from "@mobacraft/sim"
import {
  BoxGeometry,
  type BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  Euler,
  Float32BufferAttribute,
  IcosahedronGeometry,
  Matrix4,
  OctahedronGeometry,
  Quaternion,
  Vector3,
} from "three/webgpu"
import { bakeModel, type BoundPart, type Joint, type JointKind, type SkeletonSpec } from "./rig.ts"

type Vec = readonly [number, number, number]
interface Place {
  at?: Vec
  rot?: Vec
  scale?: Vec | number
}
interface PartOpts {
  glow?: number
  limb?: number
  /** Bind to this joint kind only (default: nearest joint of the limb group). */
  joint?: JointKind
}

const tmpM = new Matrix4()
const tmpQ = new Quaternion()
const tmpE = new Euler()
const tmpP = new Vector3()
const tmpS = new Vector3()
const tmpC = new Color()
const UP = new Vector3(0, 1, 0)
const PI = Math.PI

/** Collects coloured parts and merges them into one flat-shaded geometry. */
class Model {
  private readonly parts: BoundPart[] = []
  private readonly joints: Joint[] = []

  /** Declare a joint the limb group `limb` pivots around; child/grandchild extend the chain. */
  joint(kind: JointKind, limb: number, at: Vec, child?: Vec, grandchild?: Vec): this {
    this.joints.push({ kind, limb, at, child, grandchild })
    return this
  }

  /** Add a primitive with an optional scale → rotate → translate placement. */
  add(geo: BufferGeometry, hex: number, place: Place = {}, opts: PartOpts = {}): this {
    const { at = [0, 0, 0], rot = [0, 0, 0], scale = 1 } = place
    tmpE.set(rot[0], rot[1], rot[2])
    tmpQ.setFromEuler(tmpE)
    if (typeof scale === "number") tmpS.setScalar(scale)
    else tmpS.set(scale[0], scale[1], scale[2])
    tmpM.compose(tmpP.set(at[0], at[1], at[2]), tmpQ, tmpS)
    geo.applyMatrix4(tmpM)
    return this.push(geo, hex, opts)
  }

  /** Box of cross-section w×d stretched from a to b. */
  beam(a: Vec, b: Vec, w: number, d: number, hex: number, opts: PartOpts = {}): this {
    return this.push(orient(new BoxGeometry(w, dist(a, b), d), a, b), hex, opts)
  }

  /** Low-poly frustum from a (radius r0) to b (radius r1). */
  seg(a: Vec, b: Vec, r0: number, r1: number, n: number, hex: number, opts: PartOpts = {}): this {
    return this.push(orient(new CylinderGeometry(r1, r0, dist(a, b), n), a, b), hex, opts)
  }

  /** Cone/spike with base centred on a and tip at b. */
  spike(a: Vec, b: Vec, r: number, hex: number, opts: PartOpts = {}, n = 4): this {
    return this.push(orient(new ConeGeometry(r, dist(a, b), n), a, b), hex, opts)
  }

  /** Polyline of beams through the given points. */
  chain(pts: readonly Vec[], w: number, hex: number, opts: PartOpts = {}): this {
    for (let i = 1; i < pts.length; i++) this.beam(pts[i - 1]!, pts[i]!, w, w, hex, opts)
    return this
  }

  build(spec: SkeletonSpec = {}): BufferGeometry {
    return bakeModel(this.parts, this.joints, spec)
  }

  private push(geo: BufferGeometry, hex: number, opts: PartOpts): this {
    const g = geo.index ? geo.toNonIndexed() : geo
    if (g !== geo) geo.dispose()
    g.deleteAttribute("uv")
    g.deleteAttribute("normal")
    const n = g.getAttribute("position").count
    tmpC.setHex(hex)
    const col = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      col[i * 3] = tmpC.r
      col[i * 3 + 1] = tmpC.g
      col[i * 3 + 2] = tmpC.b
    }
    g.setAttribute("color", new Float32BufferAttribute(col, 3))
    g.setAttribute("glow", new Float32BufferAttribute(new Float32Array(n).fill(opts.glow ?? 0), 1))
    g.setAttribute("limb", new Float32BufferAttribute(new Float32Array(n).fill(opts.limb ?? 0), 1))
    this.parts.push({ geo: g, limb: opts.limb ?? 0, joint: opts.joint })
    return this
  }
}

const dist = (a: Vec, b: Vec) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])

/** Align a y-axis primitive (centred on origin) to span a → b. */
const orient = (geo: BufferGeometry, a: Vec, b: Vec): BufferGeometry => {
  const dir = new Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize()
  tmpQ.setFromUnitVectors(UP, dir)
  tmpM.compose(
    tmpP.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2),
    tmpQ,
    tmpS.setScalar(1),
  )
  return geo.applyMatrix4(tmpM)
}

const SIDES = [1, -1] as const
/** Limb group for a leg on side s (+1 = left/+x). */
const legLimb = (s: number) => (s > 0 ? -1 : 1)
/** Limb group for an arm on side s (+1 = left/+x). */
const armLimb = (s: number) => (s > 0 ? 1 : -1)
const GLOW = { glow: 1 }
const L = { limb: 1 } // left arm group (+x)
const R = { limb: -1 } // right arm group (−x)
const LG = { glow: 1, limb: 1 }
const RG = { glow: 1, limb: -1 }

// ── Palette ─────────────────────────────────────────────────────────────────

const shade = (hex: number, k: number): number => {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)))
  return (c((hex >> 16) & 255) << 16) | (c((hex >> 8) & 255) << 8) | c(hex & 255)
}
const mixHex = (a: number, b: number, t: number): number => {
  const ch = (sh: number) => Math.round(((a >> sh) & 255) * (1 - t) + ((b >> sh) & 255) * t) & 255
  return (ch(16) << 16) | (ch(8) << 8) | ch(0)
}

interface Pal {
  body: number
  bodyDark: number
  bodyLight: number
  accent: number
  accentDark: number
  glow: number
  dark: number
  bone: number
  wood: number
  metal: number
  skin: number
}

const palette = (look: { body: number; accent: number; glow: number }): Pal => ({
  body: look.body,
  bodyDark: shade(look.body, 0.62),
  bodyLight: shade(look.body, 1.45),
  accent: look.accent,
  accentDark: shade(look.accent, 0.58),
  glow: look.glow,
  dark: 0x15121a,
  bone: 0xd8cfb8,
  wood: 0x5e4129,
  metal: mixHex(0x8e8c96, look.body, 0.25),
  skin: mixHex(0x8a7a70, look.body, 0.35),
})

// ── Shared humanoid parts ───────────────────────────────────────────────────

interface Frame {
  hipY: number
  hipW: number
  legW: number
  shY: number
  shW: number
  armW: number
}

/** Hand positions for a frame: left (+x) and right (−x). */
const hand = (f: Frame, s: number): Vec => [s * (f.shW + 0.05), f.shY - 0.4, 0.11]

const legsOf = (m: Model, f: Frame, leg: number, boot: number) => {
  for (const s of SIDES) {
    const limb = legLimb(s)
    m.joint("leg", limb, [s * f.hipW, f.hipY, 0])
    m.beam([s * f.hipW, f.hipY, 0], [s * f.hipW * 1.08, 0.09, 0.02], f.legW, f.legW * 1.1, leg, {
      limb,
    })
    m.add(
      new BoxGeometry(f.legW * 1.35, 0.1, f.legW * 1.9),
      boot,
      { at: [s * f.hipW * 1.08, 0.05, 0.045] },
      { limb },
    )
  }
}

/** Tiny feet hidden under a robe so gait still reads. */
const robeFeet = (m: Model, boot: number) => {
  for (const s of SIDES) m.joint("leg", legLimb(s), [s * 0.08, 0.3, 0.04])
  for (const s of SIDES)
    m.add(
      new BoxGeometry(0.1, 0.07, 0.16),
      boot,
      { at: [s * 0.08, 0.035, 0.1] },
      { limb: legLimb(s) },
    )
}

const armsOf = (m: Model, f: Frame, upper: number, fore: number, fist: number) => {
  for (const s of SIDES) {
    const limb = armLimb(s)
    m.joint("arm", limb, [s * f.shW, f.shY, 0])
    const elbow: Vec = [s * (f.shW + 0.035), f.shY - 0.2, 0.0]
    const h = hand(f, s)
    m.seg([s * f.shW, f.shY, 0], elbow, f.armW, f.armW * 0.9, 5, upper, { limb })
    m.seg(elbow, h, f.armW * 0.9, f.armW * 1.1, 5, fore, { limb })
    m.add(new BoxGeometry(f.armW * 1.7, f.armW * 1.6, f.armW * 1.7), fist, { at: h }, { limb })
  }
}

const eyes = (m: Model, y: number, z: number, dx: number, hex: number, w = 0.05) => {
  m.joint("head", 0, [0, y + 0.02, z - 0.08])
  for (const s of SIDES) m.add(new BoxGeometry(w, 0.036, 0.03), hex, { at: [s * dx, y, z] }, GLOW)
}

/** Ring of `n` parts on a circle in the xy plane (facing ±z) — halos, crowns. */
const ringXY = (c: Vec, r: number, n: number, fn: (p: Vec, a: number) => void) => {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * PI * 2
    fn([c[0] + Math.sin(a) * r, c[1] + Math.cos(a) * r, c[2]], a)
  }
}

/** Ring of `n` parts on a circle in the xz plane — crowns, hems. */
const ringXZ = (c: Vec, r: number, n: number, fn: (p: Vec, a: number) => void, phase = 0) => {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * PI * 2 + phase
    fn([c[0] + Math.sin(a) * r, c[1], c[2] + Math.cos(a) * r], a)
  }
}

/** Tattered cape hanging behind the shoulders. */
const cape = (m: Model, top: number, bottom: number, w: number, z: number, hex: number) => {
  m.joint(
    "cape",
    0,
    [0, top - 0.02, z + 0.02],
    [0, (top + bottom) / 2, z + 0.05],
    [0, bottom, z + 0.06],
  )
  const h = top - bottom
  m.add(new BoxGeometry(w, h, 0.045), hex, {
    at: [0, (top + bottom) / 2 + 0.03, z],
    rot: [0.12, 0, 0],
  })
  for (const x of [-w / 3, 0, w / 3])
    m.spike([x, bottom + 0.06, z - 0.01], [x + 0.02, bottom - 0.08, z - 0.03], w / 6, hex)
}

// ── Knight ──────────────────────────────────────────────────────────────────

const knight = (p: Pal, id: string): BufferGeometry => {
  const m = new Model()
  const f: Frame = { hipY: 0.44, hipW: 0.1, legW: 0.11, shY: 0.8, shW: 0.25, armW: 0.068 }
  legsOf(m, f, p.bodyDark, p.dark)
  for (const s of SIDES)
    m.add(
      new OctahedronGeometry(0.065),
      p.body,
      { at: [s * 0.105, 0.25, 0.07] },
      { limb: legLimb(s) },
    )
  // Tasset skirt, belt, plated chest + chest rune
  m.add(new CylinderGeometry(0.2, 0.26, 0.2, 6), p.accent, { at: [0, 0.43, 0] })
  m.add(new CylinderGeometry(0.205, 0.205, 0.05, 6), p.metal, { at: [0, 0.545, 0] })
  m.add(new CylinderGeometry(0.3, 0.19, 0.32, 4), p.body, {
    at: [0, 0.69, 0],
    rot: [0, PI / 4, 0],
    scale: [1, 1, 0.75],
  })
  m.add(new OctahedronGeometry(0.06), p.glow, { at: [0, 0.7, 0.17], scale: [1, 1.3, 0.6] }, GLOW)
  m.add(new BoxGeometry(0.16, 0.24, 0.04), p.accent, { at: [0, 0.38, 0.22], rot: [-0.1, 0, 0] })
  cape(m, 0.82, 0.22, 0.46, -0.19, p.accentDark)
  // Gorget + big pauldrons
  m.add(new CylinderGeometry(0.12, 0.16, 0.08, 6), p.bodyDark, { at: [0, 0.87, 0] })
  for (const s of SIDES) {
    m.add(new IcosahedronGeometry(0.155), p.body, {
      at: [s * 0.28, 0.83, 0],
      scale: [1.2, 0.85, 1.1],
    })
    m.add(new BoxGeometry(0.28, 0.05, 0.28), p.accent, {
      at: [s * 0.29, 0.78, 0],
      rot: [0, 0, s * 0.45],
    })
  }
  armsOf(m, f, p.bodyDark, p.body, p.dark)
  // Great helm + glowing visor slit
  m.add(new DodecahedronGeometry(0.155), p.body, { at: [0, 1.0, 0.01], scale: [1, 1.1, 1] })
  m.add(new BoxGeometry(0.21, 0.08, 0.07), p.dark, { at: [0, 0.99, 0.12] })
  m.add(new BoxGeometry(0.17, 0.042, 0.04), p.glow, { at: [0, 0.995, 0.155] }, GLOW)

  const hl = hand(f, 1)
  const hr = hand(f, -1)
  if (id === "ironwarden") {
    // Crest plume
    m.add(new BoxGeometry(0.06, 0.16, 0.3), p.accent, { at: [0, 1.17, -0.02] })
    m.spike([0, 1.14, -0.17], [0, 1.02, -0.3], 0.06, p.accent)
    // Tower shield on the left arm
    const sh: Vec = [hl[0] + 0.07, 0.5, hl[2] + 0.04]
    m.add(new BoxGeometry(0.07, 0.72, 0.44), p.body, { at: sh, rot: [0, -0.28, 0] }, L)
    m.add(
      new BoxGeometry(0.07, 0.56, 0.32),
      p.accent,
      { at: [sh[0] + 0.02, sh[1], sh[2] + 0.005], rot: [0, -0.28, 0] },
      L,
    )
    m.add(
      new OctahedronGeometry(0.075),
      p.glow,
      { at: [sh[0] + 0.065, sh[1] + 0.06, sh[2] + 0.02], scale: [0.6, 1.4, 1] },
      LG,
    )
    m.spike([sh[0], sh[1] - 0.36, sh[2]], [sh[0], sh[1] - 0.46, sh[2]], 0.1, p.metal, L)
    // Flanged mace in the right hand
    m.beam(
      [hr[0], hr[1] - 0.1, hr[2] - 0.04],
      [hr[0] - 0.03, hr[1] + 0.34, hr[2] + 0.2],
      0.05,
      0.05,
      p.wood,
      R,
    )
    const mh: Vec = [hr[0] - 0.035, hr[1] + 0.38, hr[2] + 0.22]
    m.add(new DodecahedronGeometry(0.09), p.metal, { at: mh }, R)
    for (const d of [-1, 1]) m.spike(mh, [mh[0] + d * 0.14, mh[1], mh[2]], 0.05, p.metal, R)
    m.spike(mh, [mh[0], mh[1] + 0.15, mh[2] + 0.05], 0.05, p.glow, RG)
  } else {
    // ashbringer (default knight): curled horns, ember pauldron spikes, flaming greatsword
    for (const s of SIDES) {
      m.seg([s * 0.12, 1.08, 0], [s * 0.24, 1.15, -0.04], 0.05, 0.04, 4, p.bone)
      m.spike([s * 0.24, 1.15, -0.04], [s * 0.27, 1.29, 0.03], 0.04, p.bone)
      m.spike([s * 0.3, 0.9, -0.02], [s * 0.42, 1.02, -0.08], 0.05, p.accent)
    }
    // Hilt, guard, blade (glowing core) with flame tongues along its edge
    m.beam(
      [hr[0], hr[1] - 0.12, hr[2] - 0.05],
      [hr[0] - 0.01, hr[1] + 0.06, hr[2] + 0.03],
      0.05,
      0.05,
      p.dark,
      R,
    )
    m.add(new OctahedronGeometry(0.05), p.accent, { at: [hr[0], hr[1] - 0.15, hr[2] - 0.06] }, R)
    const g0: Vec = [hr[0] - 0.01, hr[1] + 0.07, hr[2] + 0.04]
    m.beam([g0[0] - 0.13, g0[1], g0[2]], [g0[0] + 0.13, g0[1], g0[2]], 0.06, 0.06, p.accent, R)
    const tip: Vec = [g0[0] - 0.06, g0[1] + 0.72, g0[2] + 0.34]
    m.beam(g0, tip, 0.13, 0.045, p.bodyDark, R)
    m.beam(
      [g0[0], g0[1] + 0.04, g0[2] + 0.04],
      [tip[0], tip[1] - 0.04, tip[2]],
      0.06,
      0.06,
      p.glow,
      RG,
    )
    m.spike(tip, [tip[0] - 0.01, tip[1] + 0.1, tip[2] + 0.05], 0.065, p.glow, RG)
    for (const t of [0.3, 0.55, 0.8]) {
      const q: Vec = [
        g0[0] + (tip[0] - g0[0]) * t,
        g0[1] + (tip[1] - g0[1]) * t,
        g0[2] + (tip[2] - g0[2]) * t,
      ]
      m.spike(q, [q[0] - 0.02, q[1] + 0.14, q[2] - 0.08], 0.045, p.glow, RG)
    }
    // Ember in the off hand
    m.add(new IcosahedronGeometry(0.06), p.glow, { at: [hl[0], hl[1] + 0.02, hl[2] + 0.05] }, LG)
  }
  return m.build()
}

// ── Brute ───────────────────────────────────────────────────────────────────

const brute = (p: Pal, id: string): BufferGeometry => {
  const m = new Model()
  const tree = id === "rootfather"

  if (tree) {
    // Root legs splaying into the ground
    for (const s of SIDES) {
      const limb = legLimb(s)
      m.joint("leg", limb, [s * 0.15, 0.55, 0])
      m.seg([s * 0.15, 0.55, 0], [s * 0.2, 0.08, 0.03], 0.13, 0.15, 5, p.body, { limb })
      for (const d of [-1, 0, 1])
        m.spike(
          [s * 0.2, 0.1, 0.03],
          [s * 0.2 + d * 0.13, 0.0, 0.03 + (d === 0 ? 0.18 : 0.06)],
          0.06,
          p.bodyDark,
          { limb },
        )
    }
    // Bark trunk, mossy belly, glowing heart-knot
    m.add(new CylinderGeometry(0.32, 0.24, 0.62, 6), p.body, { at: [0, 0.82, -0.02] })
    m.add(new DodecahedronGeometry(0.22), p.accent, { at: [0, 0.62, 0.12], scale: [1.2, 0.8, 0.6] })
    for (const a of [0.4, 2.2, 4.1])
      m.beam(
        [Math.sin(a) * 0.3, 0.55, Math.cos(a) * 0.3],
        [Math.sin(a) * 0.3, 1.1, Math.cos(a) * 0.3],
        0.06,
        0.06,
        p.bodyDark,
      )
    m.add(new OctahedronGeometry(0.07), p.glow, { at: [0, 0.86, 0.3], scale: [1, 1.4, 0.6] }, GLOW)
    // Shoulder burls with moss
    for (const s of SIDES) {
      m.add(new DodecahedronGeometry(0.17), p.bodyDark, { at: [s * 0.36, 1.05, 0] })
      m.add(new IcosahedronGeometry(0.12), p.accent, {
        at: [s * 0.37, 1.15, -0.02],
        scale: [1.2, 0.6, 1.1],
      })
    }
    // Branch arms ending in twig claws
    for (const s of SIDES) {
      const limb = armLimb(s)
      m.joint("arm", limb, [s * 0.38, 1.02, 0])
      const el: Vec = [s * 0.48, 0.78, 0.02]
      const h: Vec = [s * 0.5, 0.45, 0.16]
      m.seg([s * 0.38, 1.02, 0], el, 0.1, 0.085, 5, p.body, { limb })
      m.seg(el, h, 0.085, 0.07, 5, p.body, { limb })
      for (const d of [-1, 0, 1])
        m.spike(h, [h[0] + d * 0.08, h[1] - 0.2, h[2] + 0.08], 0.04, p.bodyDark, { limb })
    }
    // Stump head with glowing eye-knots, branch crown with leaf clusters
    m.add(new CylinderGeometry(0.2, 0.24, 0.26, 6), p.body, { at: [0, 1.25, 0.04] })
    m.add(new BoxGeometry(0.3, 0.06, 0.08), p.bodyDark, { at: [0, 1.3, 0.21] })
    eyes(m, 1.24, 0.24, 0.08, p.glow, 0.06)
    m.add(new BoxGeometry(0.14, 0.12, 0.08), p.accent, { at: [0, 1.11, 0.22] }) // mossy beard
    for (const [x, z, h] of [
      [-0.2, 0.0, 1.4],
      [0.18, -0.05, 1.43],
      [0.0, -0.12, 1.47],
    ] as const) {
      m.seg([x * 0.5, 1.35, z * 0.5], [x, h - 0.1, z], 0.05, 0.035, 4, p.bodyDark)
      m.add(new IcosahedronGeometry(0.11), p.accent, { at: [x, h - 0.04, z] })
    }
    return m.build()
  }

  // Squat legs, belly, hunched slab torso
  for (const s of SIDES) {
    const limb = legLimb(s)
    m.joint("leg", limb, [s * 0.16, 0.5, 0])
    m.seg([s * 0.16, 0.5, 0], [s * 0.18, 0.1, 0.03], 0.13, 0.11, 5, p.bodyDark, { limb })
    m.add(new BoxGeometry(0.2, 0.11, 0.26), p.dark, { at: [s * 0.18, 0.055, 0.06] }, { limb })
  }
  m.add(new CylinderGeometry(0.26, 0.3, 0.18, 6), p.accentDark, { at: [0, 0.48, 0] })
  m.add(new DodecahedronGeometry(0.3), p.skin, { at: [0, 0.68, 0.06], scale: [1.1, 0.95, 0.9] })
  m.add(new DodecahedronGeometry(0.38), p.body, {
    at: [0, 0.92, -0.04],
    rot: [0.3, 0, 0],
    scale: [1.3, 0.8, 1],
  })
  for (const s of SIDES)
    m.add(new IcosahedronGeometry(0.19), p.body, {
      at: [s * 0.4, 1.02, -0.02],
      scale: [1.1, 0.95, 1.05],
    })
  // Gorilla arms: knuckles near the knees
  for (const s of SIDES) {
    const limb = armLimb(s)
    m.joint("arm", limb, [s * 0.42, 0.98, 0])
    const el: Vec = [s * 0.5, 0.75, 0.04]
    const h: Vec = [s * 0.5, 0.4, 0.18]
    m.seg([s * 0.42, 0.98, 0], el, 0.11, 0.1, 5, p.skin, { limb })
    m.seg(el, h, 0.1, 0.12, 5, p.bodyDark, { limb })
    m.add(new DodecahedronGeometry(0.11), p.skin, { at: h }, { limb })
  }
  // Small head low and forward
  m.add(new DodecahedronGeometry(0.15), p.skin, { at: [0, 1.06, 0.24] })
  eyes(m, 1.08, 0.37, 0.06, p.glow)

  const hl: Vec = [0.5, 0.4, 0.18]
  const hr: Vec = [-0.5, 0.4, 0.18]
  if (id === "chainwarden") {
    // Executioner hood, chains across the chest, lantern on the left, hook-chain on the right
    m.add(new ConeGeometry(0.2, 0.36, 5), p.accentDark, { at: [0, 1.2, 0.2], rot: [-0.3, 0, 0] })
    m.add(new BoxGeometry(0.2, 0.08, 0.05), p.dark, { at: [0, 1.08, 0.36] })
    for (let i = 0; i < 6; i++) {
      const t = i / 5
      m.add(new BoxGeometry(0.1, 0.06, 0.06), p.metal, {
        at: [0.36 - t * 0.72, 1.15 - t * 0.45, 0.28 - Math.sin(t * PI) * -0.06],
        rot: [0, 0, 0.6 + (i % 2) * 0.9],
      })
    }
    m.chain([hl, [hl[0] + 0.02, 0.32, hl[2] + 0.05]], 0.04, p.metal, L)
    m.add(new BoxGeometry(0.16, 0.2, 0.16), p.dark, { at: [hl[0] + 0.02, 0.2, hl[2] + 0.06] }, L)
    m.add(new IcosahedronGeometry(0.075), p.glow, { at: [hl[0] + 0.02, 0.2, hl[2] + 0.06] }, LG)
    m.add(
      new ConeGeometry(0.12, 0.08, 4),
      p.metal,
      { at: [hl[0] + 0.02, 0.34, hl[2] + 0.06], rot: [0, PI / 4, 0] },
      L,
    )
    m.chain(
      [hr, [hr[0] - 0.05, 0.22, 0.32], [hr[0] + 0.05, 0.08, 0.5], [hr[0] + 0.2, 0.06, 0.62]],
      0.05,
      p.metal,
      R,
    )
    m.add(new DodecahedronGeometry(0.09), p.metal, { at: [hr[0] + 0.24, 0.09, 0.66] }, R)
    m.spike([hr[0] + 0.24, 0.12, 0.66], [hr[0] + 0.24, 0.26, 0.7], 0.05, p.glow, RG)
    // Shackle collars on the shoulders
    for (const s of SIDES)
      m.add(
        new CylinderGeometry(0.13, 0.13, 0.07, 6),
        p.metal,
        { at: [s * 0.42, 0.88, 0.02], rot: [0, 0, s * 0.3] },
        { limb: armLimb(s) },
      )
  } else {
    // gravejaw: bone skull-helm with tusks, spine ridge, giant bone hook
    m.add(new DodecahedronGeometry(0.13), p.accent, {
      at: [0, 1.12, 0.26],
      scale: [1.15, 0.8, 1.1],
    })
    m.add(new BoxGeometry(0.24, 0.07, 0.14), p.accent, { at: [0, 0.98, 0.33] })
    for (const s of SIDES) {
      m.spike([s * 0.09, 0.99, 0.38], [s * 0.15, 1.13, 0.46], 0.04, p.accent)
      m.spike([s * 0.42, 1.14, -0.05], [s * 0.5, 1.32, -0.12], 0.06, p.accent)
    }
    for (const [y, z] of [
      [1.18, -0.18],
      [1.04, -0.35],
      [0.82, -0.38],
    ] as const)
      m.spike([0, y, z], [0, y + 0.1, z - 0.2], 0.07, p.accent)
    m.add(new OctahedronGeometry(0.07), p.glow, { at: [0, 0.94, 0.36], scale: [1.2, 1, 0.5] }, GLOW)
    // Hook: shaft from the right fist up, then a curved bone hook
    const top: Vec = [hr[0] - 0.04, 1.2, hr[2] + 0.16]
    m.beam([hr[0], 0.22, hr[2] - 0.06], top, 0.06, 0.06, p.wood, R)
    m.chain(
      [top, [top[0], top[1] + 0.12, top[2] - 0.12], [top[0], top[1] + 0.04, top[2] - 0.28]],
      0.07,
      p.accent,
      R,
    )
    m.spike(
      [top[0], top[1] + 0.04, top[2] - 0.28],
      [top[0], top[1] - 0.12, top[2] - 0.24],
      0.055,
      p.accent,
      R,
    )
    m.spike(
      [top[0], top[1] - 0.05, top[2] + 0.02],
      [top[0], top[1] - 0.17, top[2] + 0.1],
      0.05,
      p.glow,
      RG,
    )
    // Bone bracer on the left
    m.seg([hl[0], 0.56, 0.13], [hl[0], 0.48, 0.16], 0.13, 0.13, 6, p.accent, L)
  }
  return m.build()
}

// ── Rogue ───────────────────────────────────────────────────────────────────

const rogue = (p: Pal, id: string): BufferGeometry => {
  const m = new Model()
  const f: Frame = { hipY: 0.42, hipW: 0.085, legW: 0.09, shY: 0.75, shW: 0.2, armW: 0.055 }
  legsOf(m, f, p.bodyDark, p.dark)
  m.add(new CylinderGeometry(0.15, 0.2, 0.18, 6), p.body, { at: [0, 0.42, 0] })
  m.add(new CylinderGeometry(0.2, 0.15, 0.3, 5), p.body, {
    at: [0, 0.63, 0.01],
    scale: [1, 1, 0.8],
  })
  // Sash + belt pouches
  m.add(new BoxGeometry(0.32, 0.05, 0.26), p.accent, { at: [0, 0.6, 0.01], rot: [0, 0, 0.4] })
  m.add(new CylinderGeometry(0.16, 0.16, 0.05, 6), p.dark, { at: [0, 0.5, 0] })
  for (const s of SIDES) {
    m.add(new IcosahedronGeometry(0.1), p.bodyDark, {
      at: [s * 0.21, 0.76, 0],
      scale: [1.2, 0.8, 1.1],
    })
    m.spike([s * 0.24, 0.8, -0.02], [s * 0.33, 0.9, -0.08], 0.04, p.accent)
  }
  armsOf(m, f, p.body, p.bodyDark, p.dark)
  const hl = hand(f, 1)
  const hr = hand(f, -1)

  if (id === "vexlash") {
    // Horned half-mask, long ponytail, whip coil on the hip and a glowing lash
    m.add(new DodecahedronGeometry(0.135), p.skin, { at: [0, 0.9, 0.01] })
    m.add(new BoxGeometry(0.22, 0.09, 0.06), p.accent, { at: [0, 0.92, 0.11] })
    eyes(m, 0.92, 0.145, 0.05, p.glow)
    for (const s of SIDES) m.spike([s * 0.08, 0.99, 0.04], [s * 0.17, 1.16, -0.06], 0.045, p.accent)
    m.chain(
      [
        [0, 0.98, -0.1],
        [0, 0.88, -0.22],
        [0, 0.64, -0.26],
      ],
      0.07,
      p.bodyDark,
    )
    cape(m, 0.78, 0.34, 0.3, -0.15, p.bodyDark)
    // Coil on the left hip
    ringXZ([0.17, 0.46, 0.04], 0.1, 6, (q, a) =>
      m.add(new BoxGeometry(0.07, 0.05, 0.11), p.accentDark, { at: q, rot: [0, a + PI / 2, 0] }),
    )
    // Handle + lash snaking forward along the ground
    m.beam(
      [hr[0], hr[1] - 0.06, hr[2] - 0.04],
      [hr[0], hr[1] + 0.08, hr[2] + 0.04],
      0.05,
      0.05,
      p.accent,
      R,
    )
    const lash: Vec[] = [
      [hr[0], hr[1] + 0.08, hr[2] + 0.05],
      [hr[0] - 0.1, hr[1] + 0.24, hr[2] + 0.2],
      [hr[0] - 0.02, hr[1] + 0.1, hr[2] + 0.4],
      [hr[0] + 0.16, hr[1] - 0.12, hr[2] + 0.46],
      [hr[0] + 0.28, 0.06, 0.48],
    ]
    m.chain(lash, 0.045, p.glow, RG)
    for (let i = 1; i < 4; i++) {
      const q = lash[i]!
      m.spike(q, [q[0] - 0.04, q[1] + 0.07, q[2]], 0.035, p.accent, R)
    }
    m.spike(lash[4]!, [lash[4]![0] + 0.12, 0.04, 0.5], 0.05, p.glow, RG)
  } else {
    // duskblade: deep hood, mask, tattered cape, reverse-grip twin daggers
    m.add(new DodecahedronGeometry(0.12), p.dark, { at: [0, 0.89, 0.02] })
    m.add(new ConeGeometry(0.17, 0.32, 5), p.accent, { at: [0, 0.95, -0.03], rot: [-0.3, 0, 0] })
    m.add(new BoxGeometry(0.2, 0.07, 0.06), p.accentDark, { at: [0, 0.83, 0.1] })
    eyes(m, 0.9, 0.13, 0.045, p.glow)
    m.spike([0, 1.0, -0.12], [0, 0.9, -0.3], 0.06, p.accent)
    cape(m, 0.8, 0.24, 0.34, -0.15, p.accentDark)
    for (const [h, opts, gopts] of [
      [hl, L, LG],
      [hr, R, RG],
    ] as const) {
      m.add(new BoxGeometry(0.12, 0.04, 0.05), p.accent, { at: [h[0], h[1] + 0.05, h[2]] }, opts)
      m.beam([h[0], h[1] + 0.02, h[2]], [h[0], h[1] - 0.3, h[2] + 0.12], 0.07, 0.035, p.glow, gopts)
      m.spike([h[0], h[1] - 0.3, h[2] + 0.12], [h[0], h[1] - 0.4, h[2] + 0.17], 0.04, p.glow, gopts)
    }
  }
  return m.build()
}

// ── Archer ──────────────────────────────────────────────────────────────────

const archer = (p: Pal, id: string): BufferGeometry => {
  const m = new Model()
  const crow = id === "grimfeather"
  const f: Frame = { hipY: 0.43, hipW: 0.09, legW: 0.095, shY: 0.77, shW: 0.21, armW: 0.058 }
  legsOf(m, f, p.bodyDark, p.dark)
  m.add(new CylinderGeometry(0.16, 0.22, 0.24, 6), p.accentDark, { at: [0, 0.44, 0] })
  m.add(new CylinderGeometry(0.21, 0.16, 0.3, 5), p.body, {
    at: [0, 0.65, 0.01],
    scale: [1, 1, 0.8],
  })
  m.add(new CylinderGeometry(0.17, 0.17, 0.05, 6), p.wood, { at: [0, 0.53, 0] })
  // Bracer straps + quiver on the back
  m.beam([0.15, 0.78, 0.12], [-0.16, 0.5, 0.12], 0.05, 0.03, p.wood)
  m.beam([0.1, 0.42, -0.17], [-0.12, 0.84, -0.17], 0.11, 0.1, p.wood)
  for (const dx of [-0.1, -0.15, -0.06])
    m.spike([dx, 0.82, -0.17], [dx - 0.03, 0.97, -0.19], 0.04, crow ? p.dark : p.accent)
  armsOf(m, f, p.body, p.bodyDark, p.dark)

  // Longbow held out in the left hand (+x)
  const hl = hand(f, 1)
  const bc: Vec = [hl[0] + 0.02, hl[1] + 0.02, hl[2] + 0.12]
  const span = crow ? 0.55 : 0.46
  const bowCol = crow ? p.dark : p.wood
  const bow: Vec[] = [
    [bc[0], bc[1] - span, bc[2] - 0.12],
    [bc[0], bc[1] - span * 0.5, bc[2] + 0.02],
    bc,
    [bc[0], bc[1] + span * 0.5, bc[2] + 0.02],
    [bc[0], bc[1] + span, bc[2] - 0.12],
  ]
  m.chain(bow, 0.055, bowCol, L)
  m.beam(bow[0]!, bow[4]!, 0.035, 0.035, p.glow, LG)
  m.add(new BoxGeometry(0.07, 0.1, 0.07), p.accent, { at: bc }, L)
  // Nocked glowing arrow
  m.beam(
    [bc[0] - 0.02, bc[1], bc[2] - 0.12],
    [bc[0] - 0.02, bc[1], bc[2] + 0.22],
    0.04,
    0.04,
    p.glow,
    LG,
  )
  m.spike([bc[0] - 0.02, bc[1], bc[2] + 0.22], [bc[0] - 0.02, bc[1], bc[2] + 0.3], 0.04, p.glow, LG)

  if (crow) {
    // Beaked crow mask + feather cloak
    m.add(new DodecahedronGeometry(0.135), p.body, { at: [0, 0.91, 0.01] })
    m.spike([0, 0.89, 0.1], [0, 0.85, 0.3], 0.06, p.bone)
    eyes(m, 0.93, 0.12, 0.055, p.glow)
    m.add(new ConeGeometry(0.17, 0.26, 5), p.dark, { at: [0, 1.0, -0.04], rot: [-0.35, 0, 0] })
    for (const s of SIDES) {
      m.add(new IcosahedronGeometry(0.11), p.dark, {
        at: [s * 0.22, 0.79, -0.01],
        scale: [1.2, 0.8, 1.1],
      })
      for (const k of [0, 1, 2])
        m.spike(
          [s * (0.2 + k * 0.03), 0.84, -0.02 - k * 0.04],
          [s * (0.3 + k * 0.07), 0.98 - k * 0.05, -0.1 - k * 0.04],
          0.04,
          k === 1 ? p.accent : p.dark,
        )
    }
    m.add(new BoxGeometry(0.42, 0.55, 0.04), p.dark, { at: [0, 0.54, -0.2], rot: [0.12, 0, 0] })
    for (let i = 0; i < 5; i++) {
      const x = -0.18 + i * 0.09
      m.spike(
        [x, 0.32, -0.23],
        [x + 0.02, 0.12, -0.26 - (i % 2) * 0.03],
        0.05,
        i % 2 ? p.accent : p.dark,
      )
    }
  } else {
    // ivyshade: leaf hood with leaf crest and leafy shoulders
    m.add(new DodecahedronGeometry(0.125), p.skin, { at: [0, 0.9, 0.02] })
    eyes(m, 0.91, 0.125, 0.045, p.glow)
    m.add(new ConeGeometry(0.17, 0.3, 6), p.body, { at: [0, 0.98, -0.03], rot: [-0.3, 0, 0] })
    for (const [x, rz] of [
      [0, 0],
      [0.1, -0.5],
      [-0.1, 0.5],
    ] as const)
      m.add(new OctahedronGeometry(0.09), p.glow, {
        at: [x, 1.08, -0.06],
        rot: [0, 0, rz],
        scale: [0.5, 1.4, 0.25],
      })
    for (const s of SIDES)
      for (const k of [0, 1])
        m.add(new OctahedronGeometry(0.09), k ? p.accent : p.body, {
          at: [s * (0.22 + k * 0.05), 0.8 - k * 0.04, -0.02 + k * 0.03],
          rot: [0, 0, s * (0.9 + k * 0.4)],
          scale: [0.55, 1.3, 0.3],
        })
    cape(m, 0.82, 0.3, 0.36, -0.17, p.bodyDark)
    for (const t of [0.25, 0.75]) {
      const q = bow[t < 0.5 ? 1 : 3]!
      m.add(
        new OctahedronGeometry(0.07),
        p.glow,
        { at: [q[0] + 0.05, q[1], q[2]], scale: [1, 0.5, 0.3] },
        LG,
      )
    }
  }
  return m.build()
}

// ── Robed casters (mage / priest share a base) ──────────────────────────────

const robeBase = (m: Model, p: Pal, f: Frame, robe: number, trim: number) => {
  robeFeet(m, p.dark)
  m.add(new CylinderGeometry(0.17, 0.3, 0.58, 7), robe, { at: [0, 0.33, 0] })
  m.add(new CylinderGeometry(0.3, 0.31, 0.05, 7), trim, { at: [0, 0.065, 0] })
  m.add(new BoxGeometry(0.12, 0.42, 0.04), trim, { at: [0, 0.32, 0.22], rot: [-0.25, 0, 0] })
  m.add(new CylinderGeometry(0.2, 0.16, 0.24, 6), robe, { at: [0, 0.71, 0], scale: [1, 1, 0.85] })
  m.add(new CylinderGeometry(0.175, 0.175, 0.05, 6), trim, { at: [0, 0.6, 0] })
  // Wide bell sleeves
  for (const s of SIDES) {
    const limb = armLimb(s)
    const h = hand(f, s)
    m.joint("arm", limb, [s * f.shW, f.shY, 0])
    m.seg([s * f.shW, f.shY, 0], [h[0], h[1] + 0.06, h[2] - 0.02], 0.06, 0.09, 5, robe, { limb })
    m.add(new BoxGeometry(0.07, 0.07, 0.07), p.skin, { at: h }, { limb })
  }
}

const MAGE_FRAME: Frame = { hipY: 0.4, hipW: 0.08, legW: 0.08, shY: 0.8, shW: 0.2, armW: 0.06 }

const mage = (p: Pal, id: string): BufferGeometry => {
  const m = new Model()
  const f = MAGE_FRAME
  const hl = hand(f, 1)
  const hr = hand(f, -1)
  robeBase(m, p, f, p.body, p.accent)

  if (id === "embercall") {
    // Bare-headed pyromancer: flame hair, smouldering shoulders, fire orbs in both hands
    for (const s of SIDES)
      m.add(new IcosahedronGeometry(0.1), p.accentDark, {
        at: [s * 0.2, 0.82, 0],
        scale: [1.2, 0.8, 1.1],
      })
    m.add(new DodecahedronGeometry(0.13), p.skin, { at: [0, 0.94, 0.02] })
    eyes(m, 0.95, 0.13, 0.05, p.glow)
    for (const [x, z, h] of [
      [0, -0.02, 1.26],
      [0.08, -0.06, 1.17],
      [-0.08, -0.06, 1.17],
      [0, -0.12, 1.12],
    ] as const)
      m.spike([x, 1.0, z], [x * 1.4, h, z - 0.06], 0.07, p.glow, GLOW, 5)
    m.add(new OctahedronGeometry(0.06), p.glow, { at: [0, 0.72, 0.17], scale: [1, 1.3, 0.5] }, GLOW)
    for (const [h, gopts] of [
      [hl, LG],
      [hr, RG],
    ] as const) {
      const c: Vec = [h[0] + Math.sign(h[0]) * 0.02, h[1] + 0.09, h[2] + 0.06]
      m.add(new IcosahedronGeometry(0.085), p.glow, { at: c }, gopts)
      m.spike(c, [c[0], c[1] + 0.18, c[2] - 0.04], 0.06, p.accent, gopts)
    }
    return m.build()
  }

  // The remaining casters wear a mantle
  m.add(new ConeGeometry(0.3, 0.14, 6), p.accentDark, { at: [0, 0.84, -0.01] })

  if (id === "frostveil") {
    // Ice crown, long pale hair, ice-shard shoulders, crystal staff
    m.add(new DodecahedronGeometry(0.13), p.skin, { at: [0, 0.97, 0.02] })
    m.add(new BoxGeometry(0.24, 0.4, 0.06), p.accent, { at: [0, 0.82, -0.12], rot: [0.15, 0, 0] })
    eyes(m, 0.98, 0.13, 0.05, p.glow)
    ringXZ([0, 1.06, 0.01], 0.12, 5, (q, a) =>
      m.spike(
        q,
        [q[0] * 1.3, 1.06 + (Math.cos(a) > 0.5 ? 0.24 : 0.14), q[2] * 1.3],
        0.04,
        p.glow,
        GLOW,
      ),
    )
    for (const s of SIDES) m.spike([s * 0.2, 0.86, 0], [s * 0.3, 1.0, -0.06], 0.05, p.glow, GLOW)
    m.beam([hr[0], 0.03, hr[2]], [hr[0] - 0.01, 1.08, hr[2] + 0.02], 0.05, 0.05, p.accent, R)
    m.add(
      new OctahedronGeometry(0.09),
      p.glow,
      { at: [hr[0] - 0.01, 1.2, hr[2] + 0.02], scale: [0.8, 1.8, 0.8] },
      RG,
    )
    for (const s of SIDES)
      m.spike([hr[0], 1.1, hr[2]], [hr[0] + s * 0.1, 1.24, hr[2]], 0.035, p.accent, R)
    return m.build()
  }

  // Hooded casters: bonecaller + voidmother
  m.add(new ConeGeometry(0.17, 0.34, 6), p.body, { at: [0, 1.02, -0.03], rot: [-0.28, 0, 0] })
  m.add(new OctahedronGeometry(0.1), p.dark, { at: [0, 0.94, 0.06], scale: [1, 1, 0.9] })

  if (id === "voidmother") {
    // Third eye, tentacle hem, floating rune halo, void orb
    eyes(m, 0.94, 0.15, 0.05, p.glow)
    m.add(
      new OctahedronGeometry(0.045),
      p.glow,
      { at: [0, 1.02, 0.12], scale: [1, 1.4, 0.6] },
      GLOW,
    )
    ringXZ(
      [0, 0.1, 0],
      0.27,
      6,
      (q) => m.spike(q, [q[0] * 1.45, 0.04, q[2] * 1.45], 0.06, p.accent),
      0.5,
    )
    const hc: Vec = [0, 1.0, -0.2]
    ringXY(hc, 0.27, 8, (q, a) =>
      m.add(
        new OctahedronGeometry(0.05),
        p.glow,
        { at: q, rot: [0, 0, -a], scale: [0.7, 1.4, 0.5] },
        GLOW,
      ),
    )
    // Arc segments linking the runes, offset half a step
    ringXY(hc, 0.27, 8, (_q, a) => {
      const a2 = a + PI / 8
      m.add(new BoxGeometry(0.2, 0.04, 0.04), p.accent, {
        at: [hc[0] + Math.sin(a2) * 0.27, hc[1] + Math.cos(a2) * 0.27, hc[2] - 0.01],
        rot: [0, 0, -a2],
      })
    })
    m.add(new IcosahedronGeometry(0.075), p.glow, { at: [hl[0], hl[1] + 0.12, hl[2] + 0.05] }, LG)
    m.add(new IcosahedronGeometry(0.06), p.accent, { at: [hr[0], hr[1] + 0.1, hr[2] + 0.05] }, R)
    return m.build()
  }

  // bonecaller (default mage): skull face, ribcage, skull staff
  m.add(new DodecahedronGeometry(0.085), p.accent, { at: [0, 0.94, 0.09], scale: [1, 1.1, 0.8] })
  eyes(m, 0.95, 0.16, 0.04, p.glow, 0.045)
  for (const y of [0.68, 0.74])
    m.add(new BoxGeometry(0.22, 0.04, 0.04), p.accent, { at: [0, y, 0.15] })
  for (const s of SIDES) m.spike([s * 0.2, 0.86, -0.02], [s * 0.27, 1.0, -0.06], 0.04, p.accent)
  const top: Vec = [hr[0] - 0.01, 1.08, hr[2] + 0.02]
  m.beam([hr[0], 0.03, hr[2]], top, 0.05, 0.05, p.wood, R)
  m.add(
    new DodecahedronGeometry(0.1),
    p.accent,
    { at: [top[0], top[1] + 0.08, top[2]], scale: [1, 0.95, 1.1] },
    R,
  )
  for (const s of SIDES) {
    m.add(
      new BoxGeometry(0.045, 0.04, 0.03),
      p.glow,
      { at: [top[0] + s * 0.04, top[1] + 0.09, top[2] + 0.1] },
      RG,
    )
    m.spike(
      [top[0] + s * 0.07, top[1] + 0.13, top[2]],
      [top[0] + s * 0.14, top[1] + 0.26, top[2] - 0.04],
      0.035,
      p.accent,
      R,
    )
  }
  m.add(new IcosahedronGeometry(0.06), p.glow, { at: [hl[0], hl[1] + 0.1, hl[2] + 0.04] }, LG)
  return m.build()
}

// ── Priest ──────────────────────────────────────────────────────────────────

const priest = (p: Pal, id: string): BufferGeometry => {
  const m = new Model()
  const f = MAGE_FRAME
  const hl = hand(f, 1)
  const hr = hand(f, -1)
  robeBase(m, p, f, p.body, p.accent)
  // Tall collar
  m.add(new CylinderGeometry(0.17, 0.12, 0.14, 6), p.accent, { at: [0, 0.88, -0.02] })
  for (const s of SIDES)
    m.add(new IcosahedronGeometry(0.095), p.accent, {
      at: [s * 0.2, 0.82, 0],
      scale: [1.2, 0.8, 1.1],
    })

  if (id === "hexweaver") {
    // Porcelain doll mask with button eyes + stitched mouth, giant needles crossed on the back
    m.add(new DodecahedronGeometry(0.15), p.accent, { at: [0, 0.99, 0.02], scale: [1.05, 1, 0.95] })
    for (const s of SIDES)
      m.add(
        new CylinderGeometry(0.04, 0.04, 0.03, 6),
        p.glow,
        { at: [s * 0.055, 1.01, 0.15], rot: [PI / 2, 0, 0] },
        GLOW,
      )
    m.add(new BoxGeometry(0.12, 0.035, 0.03), p.dark, { at: [0, 0.93, 0.14] })
    m.add(new ConeGeometry(0.16, 0.12, 6), p.bodyDark, { at: [0, 1.12, 0], rot: [-0.15, 0, 0] })
    for (const s of SIDES) {
      m.beam([s * 0.25, 0.4, -0.2], [-s * 0.22, 1.18, -0.2], 0.05, 0.05, p.metal)
      m.spike([-s * 0.22, 1.18, -0.2], [-s * 0.26, 1.27, -0.2], 0.04, p.glow, GLOW)
    }
    // Needle in hand, voodoo doll in the other
    m.beam(
      [hr[0], hr[1] - 0.04, hr[2] - 0.05],
      [hr[0], hr[1] + 0.3, hr[2] + 0.18],
      0.045,
      0.045,
      p.metal,
      R,
    )
    m.spike(
      [hr[0], hr[1] + 0.3, hr[2] + 0.18],
      [hr[0], hr[1] + 0.4, hr[2] + 0.24],
      0.035,
      p.glow,
      RG,
    )
    const d: Vec = [hl[0], hl[1] + 0.1, hl[2] + 0.06]
    m.add(new BoxGeometry(0.08, 0.1, 0.06), p.accentDark, { at: d }, L)
    m.add(new DodecahedronGeometry(0.05), p.accent, { at: [d[0], d[1] + 0.09, d[2]] }, L)
    m.add(new BoxGeometry(0.04, 0.04, 0.03), p.glow, { at: [d[0], d[1] + 0.1, d[2] + 0.05] }, LG)
    return m.build()
  }

  // lumenmaid (default priest): sun halo, braided hair, sunburst staff
  m.add(new DodecahedronGeometry(0.13), p.skin, { at: [0, 0.98, 0.02] })
  eyes(m, 0.99, 0.13, 0.05, p.glow)
  m.add(new BoxGeometry(0.26, 0.12, 0.2), p.accent, { at: [0, 1.06, -0.03] })
  m.add(new BoxGeometry(0.1, 0.36, 0.06), p.accent, { at: [0, 0.86, -0.13], rot: [0.15, 0, 0] })
  const hc: Vec = [0, 1.02, -0.17]
  m.add(new CylinderGeometry(0.13, 0.13, 0.04, 8), p.glow, { at: hc, rot: [PI / 2, 0, 0] }, GLOW)
  ringXY(hc, 0.19, 10, (q) =>
    m.spike(
      [hc[0] + (q[0] - hc[0]) * 0.6, hc[1] + (q[1] - hc[1]) * 0.6, hc[2]],
      [hc[0] + (q[0] - hc[0]) * 1.45, hc[1] + (q[1] - hc[1]) * 1.45, hc[2]],
      0.045,
      p.glow,
      GLOW,
    ),
  )
  const top: Vec = [hr[0] - 0.01, 1.08, hr[2] + 0.02]
  m.beam([hr[0], 0.03, hr[2]], top, 0.05, 0.05, p.accent, R)
  m.add(
    new CylinderGeometry(0.1, 0.1, 0.05, 8),
    p.accent,
    { at: [top[0], top[1] + 0.1, top[2]], rot: [PI / 2, 0, 0] },
    R,
  )
  m.add(new OctahedronGeometry(0.07), p.glow, { at: [top[0], top[1] + 0.1, top[2] + 0.03] }, RG)
  for (const a of [0, PI / 2, PI, -PI / 2])
    m.spike(
      [top[0] + Math.sin(a) * 0.09, top[1] + 0.1 + Math.cos(a) * 0.09, top[2]],
      [top[0] + Math.sin(a) * 0.18, top[1] + 0.1 + Math.cos(a) * 0.18, top[2]],
      0.04,
      p.glow,
      RG,
    )
  m.add(new IcosahedronGeometry(0.055), p.glow, { at: [hl[0], hl[1] + 0.1, hl[2] + 0.04] }, LG)
  return m.build()
}

// ── Beast ───────────────────────────────────────────────────────────────────

/** Four legs; front-left + back-right = +1, front-right + back-left = −1. */
const quadLegs = (
  m: Model,
  x: number,
  zf: number,
  zb: number,
  top: number,
  r: number,
  col: number,
  paw: number,
) => {
  for (const s of SIDES)
    for (const [z, front] of [
      [zf, true],
      [zb, false],
    ] as const) {
      const limb = s > 0 === front ? 1 : -1
      m.joint("leg", limb, [s * x, top, z])
      m.seg([s * x, top, z], [s * x * 1.05, 0.08, z + 0.03], r, r * 0.75, 5, col, { limb })
      m.add(
        new BoxGeometry(r * 1.7, 0.08, r * 2.2),
        paw,
        { at: [s * x * 1.05, 0.04, z + 0.06] },
        { limb },
      )
    }
}

const beast = (p: Pal, id: string): BufferGeometry => {
  const m = new Model()

  if (id === "goreclaw") {
    // Upright hunched ravager: digitigrade legs, massive bone claws, tusks, spine ridge
    for (const s of SIDES) {
      const limb = legLimb(s)
      m.joint("leg", limb, [s * 0.14, 0.5, -0.02])
      m.seg([s * 0.14, 0.5, -0.02], [s * 0.17, 0.28, 0.12], 0.11, 0.08, 5, p.body, { limb })
      m.seg([s * 0.17, 0.28, 0.12], [s * 0.17, 0.08, -0.02], 0.08, 0.06, 5, p.bodyDark, { limb })
      m.add(new BoxGeometry(0.13, 0.08, 0.2), p.dark, { at: [s * 0.17, 0.04, 0.04] }, { limb })
    }
    m.add(new DodecahedronGeometry(0.22), p.bodyDark, {
      at: [0, 0.55, -0.04],
      scale: [1.1, 0.8, 1],
    })
    m.add(new DodecahedronGeometry(0.3), p.body, {
      at: [0, 0.82, 0.06],
      rot: [0.5, 0, 0],
      scale: [1.25, 0.9, 1],
    })
    m.add(new BoxGeometry(0.2, 0.25, 0.05), p.accentDark, {
      at: [0, 0.48, 0.18],
      rot: [-0.15, 0, 0],
    })
    for (const [y, z] of [
      [1.06, -0.06],
      [0.95, -0.22],
      [0.76, -0.3],
    ] as const)
      m.spike([0, y, z], [0, y + 0.12, z - 0.14], 0.06, p.accent)
    for (const s of SIDES) {
      const limb = armLimb(s)
      m.joint("arm", limb, [s * 0.33, 0.9, 0.04])
      m.add(new IcosahedronGeometry(0.15), p.body, {
        at: [s * 0.32, 0.93, 0.04],
        scale: [1.1, 0.9, 1],
      })
      const el: Vec = [s * 0.42, 0.7, 0.08]
      const h: Vec = [s * 0.42, 0.48, 0.26]
      m.seg([s * 0.33, 0.9, 0.04], el, 0.09, 0.08, 5, p.body, { limb })
      m.seg(el, h, 0.08, 0.1, 5, p.bodyDark, { limb })
      m.add(new DodecahedronGeometry(0.09), p.bodyDark, { at: h }, { limb })
      for (const d of [-1, 0, 1])
        m.spike(
          [h[0] + d * 0.06, h[1] - 0.02, h[2] + 0.06],
          [h[0] + d * 0.09, h[1] - 0.24, h[2] + 0.26],
          0.04,
          p.accent,
          { limb },
          4,
        )
      m.add(
        new BoxGeometry(0.04, 0.12, 0.04),
        p.glow,
        { at: [s * 0.36, 0.78, 0.12], rot: [0, 0, s * 0.3] },
        { glow: 1, limb },
      )
    }
    m.add(new DodecahedronGeometry(0.15), p.body, { at: [0, 0.98, 0.26], scale: [1.1, 0.9, 1.1] })
    m.add(new BoxGeometry(0.2, 0.09, 0.16), p.bodyDark, { at: [0, 0.9, 0.38] })
    eyes(m, 1.0, 0.39, 0.06, p.glow)
    for (const s of SIDES) {
      m.spike([s * 0.08, 0.9, 0.44], [s * 0.12, 1.02, 0.5], 0.035, p.accent)
      m.seg([s * 0.1, 1.08, 0.2], [s * 0.2, 1.14, 0.12], 0.045, 0.04, 4, p.accent)
      m.spike([s * 0.2, 1.14, 0.12], [s * 0.24, 1.27, 0.18], 0.04, p.accent)
    }
    return m.build()
  }

  if (id === "hollowfang") {
    // Maned dire wolf: lean body, raised head, long snout, ears, bushy tail
    quadLegs(m, 0.13, 0.27, -0.27, 0.42, 0.065, p.body, p.dark)
    m.add(new DodecahedronGeometry(0.22), p.body, { at: [0, 0.5, -0.12], scale: [0.95, 0.85, 1.4] })
    m.add(new DodecahedronGeometry(0.26), p.bodyDark, { at: [0, 0.6, 0.2], scale: [1.05, 1.0, 1] })
    // Mane: spikes radiating around the neck
    ringXZ(
      [0, 0.72, 0.2],
      0.17,
      7,
      (q) => m.spike(q, [q[0] * 1.8, 0.84, q[2] - 0.15], 0.06, p.bodyDark),
      0,
    )
    m.spike([0, 0.78, 0.12], [0, 0.94, -0.08], 0.08, p.accent)
    m.spike([0, 0.62, -0.1], [0, 0.74, -0.3], 0.06, p.accent)
    // Head + snout + ears
    m.add(new DodecahedronGeometry(0.14), p.body, { at: [0, 0.82, 0.4] })
    m.add(new BoxGeometry(0.13, 0.1, 0.2), p.body, { at: [0, 0.77, 0.56], rot: [0.15, 0, 0] })
    m.add(new BoxGeometry(0.1, 0.05, 0.16), p.accent, { at: [0, 0.71, 0.53], rot: [0.3, 0, 0] })
    m.add(new BoxGeometry(0.06, 0.05, 0.05), p.dark, { at: [0, 0.8, 0.66] })
    for (const s of SIDES) {
      m.spike([s * 0.07, 0.92, 0.36], [s * 0.1, 1.06, 0.32], 0.05, p.bodyDark)
      m.spike([s * 0.04, 0.72, 0.58], [s * 0.04, 0.66, 0.62], 0.025, p.bone)
    }
    eyes(m, 0.86, 0.5, 0.06, p.glow)
    // Moon-rune on the shoulder, tail
    m.joint("tail", 0, [0, 0.5, -0.4], [0, 0.58, -0.6], [0, 0.48, -0.8])
    m.add(
      new OctahedronGeometry(0.06),
      p.glow,
      { at: [0.2, 0.62, 0.18], scale: [0.5, 1.2, 1] },
      GLOW,
    )
    m.seg([0, 0.52, -0.42], [0, 0.6, -0.62], 0.08, 0.1, 5, p.bodyDark)
    m.spike([0, 0.6, -0.62], [0, 0.5, -0.82], 0.1, p.bodyDark, {}, 5)
    return m.build({ quadruped: true, pelvisY: 0.5 })
  }

  // thornmaw (default beast): bulky briar bear, thorn-crusted back, mossy hide
  quadLegs(m, 0.2, 0.25, -0.25, 0.45, 0.1, p.body, p.accentDark)
  m.add(new DodecahedronGeometry(0.34), p.body, { at: [0, 0.6, -0.04], scale: [1.05, 0.85, 1.25] })
  m.add(new DodecahedronGeometry(0.26), p.bodyDark, { at: [0, 0.68, 0.24], scale: [1.15, 1, 1] })
  // Thorny back: ranks of spikes over the hump
  for (const [x, y, z, h] of [
    [0, 0.92, 0.12, 0.26],
    [0.15, 0.86, 0.1, 0.2],
    [-0.15, 0.86, 0.1, 0.2],
    [0, 0.88, -0.12, 0.24],
    [0.17, 0.8, -0.1, 0.18],
    [-0.17, 0.8, -0.1, 0.18],
    [0.08, 0.78, -0.3, 0.16],
    [-0.08, 0.78, -0.3, 0.16],
  ] as const)
    m.spike([x, y - 0.05, z], [x * 1.6, y + h, z - 0.08], 0.05, p.accent)
  for (const [x, z] of [
    [0.1, 0.02],
    [-0.12, -0.18],
  ] as const)
    m.add(new IcosahedronGeometry(0.06), p.glow, { at: [x, 0.86, z] }, GLOW)
  // Head with jaw + tusks
  m.add(new DodecahedronGeometry(0.16), p.body, { at: [0, 0.66, 0.5], scale: [1.1, 0.9, 1] })
  m.add(new BoxGeometry(0.22, 0.08, 0.18), p.bodyDark, { at: [0, 0.54, 0.56], rot: [0.2, 0, 0] })
  eyes(m, 0.7, 0.64, 0.07, p.glow)
  for (const s of SIDES) {
    m.spike([s * 0.08, 0.56, 0.62], [s * 0.1, 0.68, 0.7], 0.035, p.bone)
    m.spike([s * 0.1, 0.78, 0.46], [s * 0.17, 0.92, 0.38], 0.045, p.accent)
  }
  return m.build({ quadruped: true, pelvisY: 0.55 })
}

// ── Shaman ──────────────────────────────────────────────────────────────────

const shaman = (p: Pal, id: string): BufferGeometry => {
  const m = new Model()
  const f: Frame = { hipY: 0.42, hipW: 0.09, legW: 0.1, shY: 0.79, shW: 0.22, armW: 0.062 }
  const hl = hand(f, 1)
  const hr = hand(f, -1)
  const moss = id === "mossmother"

  if (moss) {
    robeFeet(m, p.dark)
    m.add(new CylinderGeometry(0.17, 0.32, 0.58, 7), p.body, { at: [0, 0.33, 0] })
    ringXZ([0, 0.08, 0], 0.29, 7, (q) =>
      m.spike([q[0], 0.1, q[2]], [q[0] * 1.15, 0.02, q[2] * 1.15], 0.07, p.bodyDark),
    )
  } else {
    legsOf(m, f, p.bodyDark, p.dark)
    m.add(new CylinderGeometry(0.17, 0.24, 0.24, 6), p.accentDark, { at: [0, 0.44, 0] })
    // Loincloth flap
    m.add(new BoxGeometry(0.14, 0.26, 0.04), p.accent, { at: [0, 0.36, 0.2], rot: [-0.1, 0, 0] })
  }
  m.add(new CylinderGeometry(0.22, 0.17, 0.3, 6), p.body, { at: [0, 0.66, 0], scale: [1, 1, 0.85] })
  m.add(new CylinderGeometry(0.18, 0.18, 0.05, 6), p.wood, { at: [0, 0.54, 0] })
  // Fur / moss mantle
  for (const s of SIDES)
    m.add(new DodecahedronGeometry(0.12), moss ? p.glow : p.accent, {
      at: [s * 0.21, 0.81, -0.01],
      scale: [1.25, 0.75, 1.15],
    })
  m.add(new CylinderGeometry(0.14, 0.24, 0.1, 6), moss ? p.bodyDark : p.accent, {
    at: [0, 0.83, -0.01],
  })
  armsOf(m, f, p.body, p.bodyDark, p.skin)
  // Glowing body runes
  m.add(
    new BoxGeometry(0.04, 0.14, 0.04),
    p.glow,
    { at: [0.07, 0.66, 0.19], rot: [0, 0, 0.4] },
    GLOW,
  )
  m.add(
    new BoxGeometry(0.04, 0.14, 0.04),
    p.glow,
    { at: [-0.07, 0.66, 0.19], rot: [0, 0, -0.4] },
    GLOW,
  )

  if (moss) {
    // Mossy antlers, leaf veil, flowering gourd staff
    m.add(new DodecahedronGeometry(0.13), p.skin, { at: [0, 0.96, 0.02] })
    eyes(m, 0.97, 0.13, 0.05, p.glow)
    m.add(new BoxGeometry(0.26, 0.42, 0.06), p.bodyDark, {
      at: [0, 0.82, -0.12],
      rot: [0.12, 0, 0],
    })
    for (const s of SIDES) {
      const a: Vec = [s * 0.08, 1.04, 0]
      const b: Vec = [s * 0.2, 1.18, -0.02]
      const c: Vec = [s * 0.26, 1.32, -0.06]
      m.chain([a, b, c], 0.045, p.accent)
      m.spike(b, [s * 0.32, 1.2, 0.06], 0.035, p.accent)
      m.spike(c, [s * 0.24, 1.42, -0.02], 0.035, p.accent)
      m.add(new IcosahedronGeometry(0.06), p.glow, { at: b, scale: [1.3, 0.8, 1.3] }, GLOW)
    }
    const top: Vec = [hr[0] - 0.01, 1.05, hr[2] + 0.02]
    m.beam([hr[0], 0.03, hr[2]], top, 0.05, 0.05, p.accent, R)
    m.add(new DodecahedronGeometry(0.08), p.accentDark, { at: [top[0], top[1] + 0.06, top[2]] }, R)
    ringXZ([top[0], top[1] + 0.13, top[2]], 0.07, 4, (q) =>
      m.add(new OctahedronGeometry(0.06), p.glow, { at: q, scale: [1, 0.4, 1] }, RG),
    )
    m.add(new IcosahedronGeometry(0.055), p.glow, { at: [hl[0], hl[1] + 0.09, hl[2] + 0.04] }, LG)
    return m.build()
  }

  // stormcaller (default shaman): horned mask, feathers, lightning totem
  m.add(new DodecahedronGeometry(0.14), p.skin, { at: [0, 0.96, 0.02] })
  m.add(new BoxGeometry(0.22, 0.2, 0.06), p.accent, { at: [0, 0.96, 0.12] })
  eyes(m, 0.98, 0.16, 0.055, p.glow)
  m.add(new BoxGeometry(0.06, 0.08, 0.04), p.glow, { at: [0, 0.89, 0.16] }, GLOW)
  for (const s of SIDES) {
    m.seg([s * 0.1, 1.04, 0], [s * 0.22, 1.08, -0.02], 0.045, 0.04, 4, p.accent)
    m.spike([s * 0.22, 1.08, -0.02], [s * 0.24, 1.24, 0.02], 0.04, p.accent)
    m.spike([s * 0.06, 1.06, -0.08], [s * 0.1, 1.22, -0.2], 0.04, p.glow, GLOW)
  }
  // Totem: pole, carved stacked heads, glowing zig-zag bolt, crossbar with feathers
  const x = hr[0] - 0.01
  const z = hr[2] + 0.02
  m.beam([hr[0], 0.03, hr[2]], [x, 1.02, z], 0.06, 0.06, p.wood, R)
  m.add(new BoxGeometry(0.15, 0.14, 0.13), p.accent, { at: [x, 1.07, z] }, R)
  m.add(new BoxGeometry(0.1, 0.04, 0.03), p.glow, { at: [x, 1.08, z + 0.07] }, RG)
  m.add(new BoxGeometry(0.3, 0.05, 0.05), p.wood, { at: [x, 0.95, z] }, R)
  for (const d of [-1, 1])
    m.spike([x + d * 0.14, 0.94, z], [x + d * 0.16, 0.8, z], 0.04, p.accent, R)
  m.chain(
    [
      [x, 1.14, z],
      [x + 0.07, 1.22, z],
      [x - 0.04, 1.26, z],
      [x + 0.04, 1.36, z],
    ],
    0.045,
    p.glow,
    RG,
  )
  m.add(new IcosahedronGeometry(0.055), p.glow, { at: [hl[0], hl[1] + 0.09, hl[2] + 0.04] }, LG)
  return m.build()
}

// ── Public API ──────────────────────────────────────────────────────────────

const BUILDERS: Record<string, (p: Pal, id: string) => BufferGeometry> = {
  knight,
  brute,
  rogue,
  archer,
  mage,
  priest,
  beast,
  shaman,
}

const cache = new Map<string, BufferGeometry>()

/** Merged hero geometry for `heroId` (memoised; shared — do not dispose or mutate). */
export const heroModel = (heroId: string): BufferGeometry => {
  let g = cache.get(heroId)
  if (!g) {
    const { look } = heroDef(heroId)
    const build = BUILDERS[look.shape] ?? knight
    g = build(palette(look), heroId)
    cache.set(heroId, g)
  }
  return g
}
