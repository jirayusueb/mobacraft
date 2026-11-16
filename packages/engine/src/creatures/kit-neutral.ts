/**
 * Neutral creep models — procedural "polygon dark fantasy" jungle creatures.
 *
 * Every builder returns ONE merged, non-indexed, flat-shaded BufferGeometry following
 * contract.ts: position / normal / color (linear vec3) / glow (0|1) / limb (0, ±1).
 * Feet on y = 0, facing +z, centred on x = z = 0. Left side of a creature is +x.
 * Limb groups: +1 = left-front leg + right-back leg (or left arm + right leg), -1 = the
 * opposite group; wings +1 left / -1 right. Mirrored parts flip the limb sign.
 */
import type { NeutralKind } from "@mobacraft/sim"
import {
  BoxGeometry,
  BufferGeometry,
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

type V3 = readonly [number, number, number]

interface At {
  /** Position (unscaled model units). */
  readonly p?: V3
  /** Euler rotation XYZ, radians. */
  readonly r?: V3
  /** Quaternion rotation (overrides r). */
  readonly q?: Quaternion
  /** Scale (uniform or per axis). */
  readonly s?: V3 | number
}

interface Opt {
  readonly glow?: number
  readonly limb?: number
  /** Also add the part mirrored across x = 0 (limb sign flipped). */
  readonly mirror?: boolean
  /** Radial segments for bones / spikes. */
  readonly seg?: number
  /** Bind to this joint kind only. */
  readonly joint?: JointKind
}

const UP = new Vector3(0, 1, 0)
const tmpM = new Matrix4()
const tmpE = new Euler()
const tmpQ = new Quaternion()
const tmpP = new Vector3()
const tmpS = new Vector3()

const mirrorV = (v: V3): V3 => [-v[0], v[1], v[2]]

/** Collects coloured parts, then merges them into one flat-shaded geometry. */
class Rig {
  private readonly parts: BoundPart[] = []
  private readonly joints: Joint[] = []

  private spec: SkeletonSpec = {}

  constructor(private readonly k = 1) {}

  /** Set the skeleton spec (call before build). */
  withSpec(spec: SkeletonSpec): this {
    this.spec = spec
    return this
  }

  /**
   * Declare a joint for limb group `limb` at p and, mirrored across x = 0, for −limb.
   * Single-pivot kinds (head / tail / cape) are never mirrored; pass child/grandchild
   * to extend the chain.
   */
  joint(kind: JointKind, limb: number, p: V3, child?: V3, grandchild?: V3): this {
    const k = this.k
    const mk = (v: V3): V3 => [v[0] * k, v[1] * k, v[2] * k]
    this.joints.push({
      kind,
      limb,
      at: mk(p),
      child: child ? mk(child) : undefined,
      grandchild: grandchild ? mk(grandchild) : undefined,
    })
    if (kind !== "head" && kind !== "tail" && kind !== "cape" && Math.abs(p[0]) > 1e-6)
      this.joints.push({ kind, limb: -limb, at: [-p[0] * k, p[1] * k, p[2] * k] })
    return this
  }

  /** Attach colour / glow / limb attributes to an already placed, non-indexed geometry. */
  private attach(g: BufferGeometry, hex: number, opt: Opt): void {
    g.deleteAttribute("uv")
    g.deleteAttribute("normal")
    const n = g.getAttribute("position").count
    const c = new Color().setHex(hex)
    const col = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      col[i * 3] = c.r
      col[i * 3 + 1] = c.g
      col[i * 3 + 2] = c.b
    }
    g.setAttribute("color", new Float32BufferAttribute(col, 3))
    g.setAttribute("glow", new Float32BufferAttribute(new Float32Array(n).fill(opt.glow ?? 0), 1))
    g.setAttribute("limb", new Float32BufferAttribute(new Float32Array(n).fill(opt.limb ?? 0), 1))
    this.parts.push({ geo: g, limb: opt.limb ?? 0, joint: opt.joint })
  }

  private place(geo: BufferGeometry, hex: number, at: At, opt: Opt): void {
    const k = this.k
    const p = at.p ?? [0, 0, 0]
    const s = at.s === undefined ? [1, 1, 1] : typeof at.s === "number" ? [at.s, at.s, at.s] : at.s
    if (at.q) tmpQ.copy(at.q)
    else {
      const r = at.r ?? [0, 0, 0]
      tmpQ.setFromEuler(tmpE.set(r[0], r[1], r[2]))
    }
    tmpM.compose(
      tmpP.set(p[0] * k, p[1] * k, p[2] * k),
      tmpQ,
      tmpS.set(s[0] * k, s[1] * k, s[2] * k),
    )
    const g = geo.index ? geo.toNonIndexed() : geo
    g.applyMatrix4(tmpM)
    this.attach(g, hex, opt)
  }

  /** Add a primitive; with opt.mirror also its reflection across x = 0. */
  add(geo: BufferGeometry, hex: number, at: At = {}, opt: Opt = {}): this {
    const copy = opt.mirror ? geo.clone() : undefined
    this.place(geo, hex, at, opt)
    if (copy) {
      const p = at.p ?? [0, 0, 0]
      const r = at.r ?? [0, 0, 0]
      const q = at.q ? new Quaternion(at.q.x, -at.q.y, -at.q.z, at.q.w) : undefined
      this.place(
        copy,
        hex,
        { p: mirrorV(p), r: [r[0], -r[1], -r[2]], q, s: at.s },
        { ...opt, limb: -(opt.limb ?? 0) },
      )
    }
    return this
  }

  private between(a: V3, b: V3): { mid: V3; len: number; q: Quaternion } {
    const d = new Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2])
    const len = d.length()
    const q = new Quaternion().setFromUnitVectors(UP, d.normalize())
    return { mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], len, q }
  }

  /** Tapered prism from a (radius r) to b (radius rb, default r). */
  bone(a: V3, b: V3, r: number, hex: number, opt: Opt = {}, rb = r): this {
    const { mid, len, q } = this.between(a, b)
    return this.add(new CylinderGeometry(rb, r, len, opt.seg ?? 5), hex, { p: mid, q }, opt)
  }

  /** Pointed cone from base point to tip point — horns, claws, spikes, fur tufts. */
  spike(base: V3, tip: V3, r: number, hex: number, opt: Opt = {}): this {
    const { mid, len, q } = this.between(base, tip)
    return this.add(new ConeGeometry(r, len, opt.seg ?? 4), hex, { p: mid, q }, opt)
  }

  /** Double-sided flat membrane (wings, tattered cloth) from points + triangle indices. */
  membrane(pts: readonly V3[], tris: readonly V3[], hex: number, opt: Opt = {}): this {
    const build = (sx: number) => {
      const k = this.k
      const pos: number[] = []
      const v = (i: number) => {
        const p = pts[i] as V3
        pos.push(p[0] * k * sx, p[1] * k, p[2] * k)
      }
      for (const [a, b, c] of tris) {
        v(a)
        v(b)
        v(c)
        v(c)
        v(b)
        v(a)
      }
      const g = new BufferGeometry()
      g.setAttribute("position", new Float32BufferAttribute(pos, 3))
      return g
    }
    this.attach(build(1), hex, opt)
    if (opt.mirror) this.attach(build(-1), hex, { ...opt, limb: -(opt.limb ?? 0) })
    return this
  }

  /** Glowing eyes pair (octahedra, ≥ 0.05 across so they read at map scale). */
  eyes(p: V3, r: number, hex: number): this {
    this.joint("head", 0, [0, p[1] + 0.04, p[2] - 0.06])
    return this.add(
      new OctahedronGeometry(r, 0),
      hex,
      { p, s: [1, 0.8, 0.6] },
      { glow: 1, mirror: true },
    )
  }

  build(): BufferGeometry {
    return bakeModel(this.parts, this.joints, this.spec)
  }
}

const box = (w: number, h: number, d: number) => new BoxGeometry(w, h, d)
const cyl = (rt: number, rb: number, h: number, seg = 6) => new CylinderGeometry(rt, rb, h, seg)
const ico = () => new IcosahedronGeometry(1, 0)
const oct = () => new OctahedronGeometry(1, 0)
const dod = () => new DodecahedronGeometry(1, 0)

// ─── Kobolds ─────────────────────────────────────────────────────────────────

const kobold = (foreman: boolean): BufferGeometry => {
  const FUR = foreman ? 0x7a5a3e : 0x8a6a48
  const DARK = 0x5a4230
  const RAG = foreman ? 0x4a5a6a : 0x6e3a2a
  const WAX = 0xe8dcc0
  const FLAME = 0xffb040
  const WOOD = 0x5a3a22
  const IRON = 0x8e8e96
  const r = new Rig(foreman ? 1.05 : 0.84)
  r.joint("leg", -1, [0.07, 0.21, -0.01]).joint("arm", 1, [0.12, 0.36, 0.02])
  // Legs (left leg −1) + big feet.
  r.bone([0.07, 0.21, -0.01], [0.085, 0.05, 0.01], 0.045, FUR, { limb: -1, mirror: true })
  r.add(box(0.09, 0.05, 0.13), DARK, { p: [0.085, 0.025, 0.04] }, { limb: -1, mirror: true })
  // Loincloth + hunched torso.
  r.add(cyl(0.1, 0.13, 0.1, 5), RAG, { p: [0, 0.21, 0] })
  r.add(ico(), FUR, { p: [0, 0.31, 0.01], r: [0.3, 0, 0], s: [0.13, 0.13, 0.11] })
  // Rat-dog head: blocky skull, long snout, huge ears, glowing eyes.
  r.add(box(0.17, 0.14, 0.16), FUR, { p: [0, 0.43, 0.07], r: [0.15, 0, 0] })
  r.spike([0, 0.41, 0.14], [0, 0.39, 0.3], 0.06, FUR, { seg: 4 })
  r.add(oct(), 0x221a16, { p: [0, 0.395, 0.29], s: 0.03 })
  r.spike([0.07, 0.46, 0.05], [0.2, 0.55, 0.02], 0.05, DARK, { mirror: true })
  r.eyes([0.045, 0.45, 0.15], 0.028, 0xffd040)
  r.joint("tail", 0, [0, 0.16, -0.06], [0, 0.2, -0.16])
  // Tail.
  r.spike([0, 0.22, -0.08], [0, 0.08, -0.28], 0.035, DARK)
  // Arms (left arm +1); right hand carries the pick.
  r.bone([0.12, 0.36, 0.02], [0.16, 0.22, 0.09], 0.032, FUR, { limb: 1, mirror: true })
  r.add(ico(), DARK, { p: [0.16, 0.2, 0.1], s: 0.04 }, { limb: 1, mirror: true })
  const pick = { limb: -1, joint: "arm" } as const
  r.bone([-0.16, 0.1, 0.07], [-0.16, 0.48, 0.13], 0.022, WOOD, pick)
  r.spike([-0.16, 0.48, 0.13], [-0.32, 0.43, 0.13], 0.03, IRON, pick)
  r.spike([-0.16, 0.48, 0.13], [-0.0, 0.43, 0.13], 0.03, IRON, pick)
  // Candle on the head (the iconic kobold light).
  if (foreman) {
    r.add(cyl(0.1, 0.11, 0.05, 6), IRON, { p: [0, 0.51, 0.06] })
    r.add(box(0.07, 0.06, 0.05), IRON, { p: [0, 0.51, 0.15] })
    r.add(
      box(0.12, 0.09, 0.08),
      0xb0884a,
      { p: [0.15, 0.4, 0.0], r: [0, 0, -0.4] },
      { mirror: true },
    )
    r.add(box(0.2, 0.04, 0.12), 0x3a2a1e, { p: [0, 0.255, 0.01] })
  }
  const cy = foreman ? 0.57 : 0.53
  r.add(cyl(0.032, 0.035, 0.08, 5), WAX, { p: [0, cy, 0.05] })
  r.add(oct(), FLAME, { p: [0, cy + 0.075, 0.05], s: [0.035, 0.06, 0.035] }, { glow: 1 })
  return r.withSpec({ pelvisY: 0.26 }).build()
}

// ─── Spirits (floating) ──────────────────────────────────────────────────────

const PALE = 0x9fc4d6
const PALE2 = 0xc9e6ef
const SHADE = 0x1c2a33

const spiritShadow = (r: Rig): void => {
  // Tiny dark wisp hugging the ground so the floating body casts presence (min y = 0).
  r.add(oct(), SHADE, { p: [0, 0.02, 0], s: [0.17, 0.02, 0.17] })
  r.spike([0, 0.035, 0], [0, 0.2, -0.03], 0.045, 0x3a5866)
}

const ghost = (): BufferGeometry => {
  const r = new Rig(0.88)
  spiritShadow(r)
  // Swirling tail drawing down to the shadow.
  r.spike([0, 0.5, 0], [0.03, 0.2, -0.12], 0.17, PALE, { seg: 6 })
  r.spike([0.06, 0.42, -0.05], [0.16, 0.24, -0.2], 0.07, PALE2)
  r.spike([-0.06, 0.44, -0.04], [-0.14, 0.27, -0.18], 0.06, PALE2)
  // Body shell + exposed glowing core.
  r.add(ico(), PALE, { p: [0, 0.56, 0], s: [0.2, 0.18, 0.17] })
  r.add(ico(), PALE2, { p: [0, 0.57, 0.11], s: 0.095 }, { glow: 1 })
  // Wispy arms trailing back.
  r.joint("arm", 1, [0.15, 0.6, 0.02])
  r.spike([0.15, 0.6, 0.02], [0.32, 0.42, -0.12], 0.06, PALE, { limb: 1, mirror: true })
  // Round head with hollow face and bright eyes.
  r.add(ico(), PALE2, { p: [0, 0.74, 0.03], s: [0.13, 0.12, 0.12] })
  r.add(box(0.17, 0.08, 0.04), SHADE, { p: [0, 0.74, 0.135] })
  r.eyes([0.045, 0.745, 0.16], 0.03, 0xe8ffff)
  // Flickering crown wisps.
  r.spike([0.04, 0.82, 0.0], [0.07, 0.92, -0.1], 0.04, PALE2)
  r.spike([-0.04, 0.83, 0.0], [-0.05, 0.9, -0.12], 0.035, PALE2)
  // Orbiting spirit motes.
  r.add(oct(), PALE2, { p: [0.26, 0.7, 0.1], s: 0.035 }, { glow: 1 })
  r.add(oct(), PALE2, { p: [-0.24, 0.5, 0.14], s: 0.03 }, { glow: 1 })
  return r.withSpec({ floating: true }).build()
}

const fellSpirit = (): BufferGeometry => {
  const HOOD = 0x6f97ab
  const r = new Rig(0.84)
  spiritShadow(r)
  // Tattered robe: a skirt of downward shards.
  r.add(cyl(0.13, 0.08, 0.2, 6), PALE, { p: [0, 0.5, 0] })
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3
    const x = Math.sin(a) * 0.1
    const z = Math.cos(a) * 0.1
    const len = i % 2 ? 0.22 : 0.3
    r.spike([x, 0.44, z], [x * 1.7, 0.44 - len, z * 1.7 - 0.05], 0.05, i % 2 ? PALE : HOOD)
  }
  // Chest + core.
  r.add(ico(), PALE, { p: [0, 0.64, 0], s: [0.17, 0.13, 0.13] })
  r.add(oct(), PALE2, { p: [0, 0.64, 0.11], s: [0.06, 0.08, 0.05] }, { glow: 1 })
  // Long clawed arms reaching forward.
  r.joint("arm", 1, [0.14, 0.68, 0])
  r.bone([0.14, 0.68, 0], [0.24, 0.52, 0.15], 0.04, PALE, { limb: 1, mirror: true }, 0.025)
  r.spike([0.24, 0.52, 0.15], [0.27, 0.42, 0.27], 0.03, PALE2, { limb: 1, mirror: true })
  r.spike([0.23, 0.52, 0.15], [0.2, 0.42, 0.28], 0.025, PALE2, { limb: 1, mirror: true })
  // Pointed hood with a dark void face and glaring eyes.
  r.spike([0, 0.7, -0.02], [0, 0.98, -0.12], 0.15, HOOD, { seg: 5 })
  r.add(box(0.15, 0.11, 0.06), SHADE, { p: [0, 0.75, 0.1] })
  r.eyes([0.04, 0.76, 0.135], 0.03, 0xd8fbff)
  // Hood shoulder tatters.
  r.spike([0.12, 0.7, -0.04], [0.22, 0.58, -0.16], 0.05, HOOD, { mirror: true })
  return r.withSpec({ floating: true }).build()
}

// ─── Wolves ──────────────────────────────────────────────────────────────────

const wolf = (alpha: boolean): BufferGeometry => {
  const FUR = alpha ? 0x4a4a52 : 0x6a6a72
  const DARK = alpha ? 0x2e2e34 : 0x4a4a52
  const LIGHT = alpha ? 0x6a6a72 : 0x8e8e96
  const EYE = alpha ? 0xff2a1a : 0xffd040
  const r = new Rig(alpha ? 1.1 : 0.85)
  r.joint("leg", 1, [0.1, 0.38, 0.25]).joint("leg", -1, [0.1, 0.42, -0.25])
  // Front legs (left-front +1).
  r.bone([0.1, 0.36, 0.25], [0.1, 0.05, 0.29], 0.05, FUR, { limb: 1, mirror: true }, 0.035)
  r.add(box(0.08, 0.05, 0.11), DARK, { p: [0.1, 0.025, 0.31] }, { limb: 1, mirror: true })
  // Back legs: haunch, then reversed hock (left-back −1).
  r.add(ico(), FUR, { p: [0.1, 0.38, -0.25], s: [0.08, 0.12, 0.11] }, { limb: -1, mirror: true })
  r.bone([0.1, 0.33, -0.26], [0.1, 0.16, -0.33], 0.045, FUR, { limb: -1, mirror: true })
  r.bone([0.1, 0.16, -0.33], [0.1, 0.04, -0.28], 0.035, FUR, { limb: -1, mirror: true })
  r.add(box(0.08, 0.05, 0.11), DARK, { p: [0.1, 0.025, -0.26] }, { limb: -1, mirror: true })
  r.withSpec({ quadruped: true, pelvisY: 0.42 })
  // Lean body, deep chest.
  r.add(ico(), FUR, { p: [0, 0.42, -0.04], s: [0.15, 0.13, 0.34] })
  r.add(ico(), LIGHT, { p: [0, 0.43, 0.2], s: [0.16, 0.17, 0.16] })
  // Hackles: tattered fur spikes along the spine.
  for (let i = 0; i < 4; i++) {
    const z = 0.18 - i * 0.13
    r.spike([0, 0.52 - i * 0.015, z], [0, 0.63 - i * 0.03, z - 0.12], 0.05 - i * 0.004, DARK)
  }
  // Head: skull, long snout, nose, ears, glowing eyes.
  r.add(box(0.18, 0.15, 0.18), FUR, { p: [0, 0.53, 0.39], r: [0.1, 0, 0] })
  r.add(box(0.1, 0.08, 0.17), LIGHT, { p: [0, 0.49, 0.54] })
  r.add(box(0.055, 0.045, 0.04), 0x18181c, { p: [0, 0.515, 0.625] })
  r.add(box(0.08, 0.04, 0.13), DARK, { p: [0, 0.44, 0.52], r: [-0.2, 0, 0] })
  r.spike([0.055, 0.59, 0.36], [0.09, 0.73, 0.33], 0.045, DARK, { mirror: true })
  r.eyes([0.06, 0.56, 0.48], 0.03, EYE)
  r.joint("tail", 0, [0, 0.44, -0.34], [0, 0.55, -0.52], [0, 0.42, -0.7])
  // Bushy tail.
  r.spike([0, 0.46, -0.36], [0, 0.26, -0.62], 0.065, FUR, { seg: 5 })
  if (alpha) {
    // Mane ruff around the neck + scar-white fangs.
    for (let i = 0; i < 7; i++) {
      const a = ((i - 3) / 3) * 1.35
      const x = Math.sin(a) * 0.13
      const y = 0.48 + Math.cos(a) * 0.12
      r.spike([x * 0.6, y - 0.03, 0.3], [x * 1.25, y + 0.03, 0.12], 0.06, DARK, { seg: 4 })
    }
    r.spike([0.03, 0.46, 0.58], [0.03, 0.4, 0.6], 0.02, 0xe8e0d0, { mirror: true })
  }
  return r.build() // satyr: biped default
}

// ─── Satyrs ──────────────────────────────────────────────────────────────────

const satyr = (trickster: boolean): BufferGeometry => {
  const FUR = 0x6a4e3a
  const HOOF = 0x2a2220
  const ROBE = 0x5a3a6a
  const TRIM = trickster ? 0xc9a24a : 0x3e2648
  const SKIN = 0x8a6a5a
  const HORN = 0xd8ccb0
  const WOOD = 0x4a3222
  const MAGIC = trickster ? 0x6affd0 : 0xc08aff
  const r = new Rig(trickster ? 0.8 : 0.84)
  r.joint("leg", -1, [0.08, 0.42, 0]).joint("arm", 1, [0.14, 0.75, 0])
  // Goat legs (digitigrade), left leg −1.
  r.bone([0.08, 0.42, 0], [0.09, 0.25, 0.08], 0.055, FUR, { limb: -1, mirror: true })
  r.bone([0.09, 0.25, 0.08], [0.09, 0.07, -0.02], 0.035, FUR, { limb: -1, mirror: true })
  r.add(box(0.07, 0.06, 0.09), HOOF, { p: [0.09, 0.03, 0.01] }, { limb: -1, mirror: true })
  // Robe: flared skirt, torso, sash.
  r.add(cyl(0.13, 0.21, 0.26, 6), ROBE, { p: [0, 0.48, 0] })
  r.add(box(0.25, 0.22, 0.16), ROBE, { p: [0, 0.68, 0] })
  r.add(box(0.27, 0.05, 0.18), TRIM, { p: [0, 0.6, 0] })
  r.spike([0, 0.55, -0.12], [0, 0.32, -0.24], 0.07, ROBE)
  // Arms (left +1), right hand grips the staff.
  r.bone([0.14, 0.75, 0], [0.2, 0.55, 0.09], 0.045, ROBE, { limb: 1, mirror: true }, 0.035)
  r.add(ico(), SKIN, { p: [0.2, 0.53, 0.1], s: 0.045 }, { limb: 1, mirror: true })
  const staff = { limb: -1, joint: "arm" } as const
  r.bone([-0.2, 0.12, 0.11], [-0.2, 0.98, 0.13], 0.024, WOOD, staff)
  if (trickster) {
    // Crescent fork cradling a crystal.
    r.spike([-0.2, 0.96, 0.13], [-0.28, 1.1, 0.13], 0.03, TRIM, staff)
    r.spike([-0.2, 0.96, 0.13], [-0.12, 1.1, 0.13], 0.03, TRIM, staff)
    r.add(oct(), MAGIC, { p: [-0.2, 1.06, 0.13], s: [0.05, 0.09, 0.05] }, { glow: 1, ...staff })
  } else {
    r.add(oct(), MAGIC, { p: [-0.2, 1.02, 0.13], s: 0.065 }, { glow: 1, ...staff })
    r.spike([-0.2, 0.96, 0.13], [-0.2, 0.9, 0.2], 0.025, HORN, staff)
  }
  // Goat head: skull, muzzle, beard, floppy ears, glowing eyes.
  r.add(box(0.15, 0.15, 0.14), SKIN, { p: [0, 0.87, 0.03] })
  r.add(box(0.09, 0.08, 0.1), SKIN, { p: [0, 0.83, 0.12] })
  r.spike([0, 0.8, 0.12], [0, 0.69, 0.13], 0.04, 0x3a2a22)
  r.spike([0.07, 0.88, 0.03], [0.17, 0.84, 0.05], 0.035, SKIN, { mirror: true })
  r.eyes([0.04, 0.89, 0.105], 0.028, MAGIC)
  // Horns: chunky curving sweep back (bigger for the trickster).
  const h = trickster ? 1.35 : 1
  r.bone([0.05, 0.93, 0.02], [0.05 + 0.06 * h, 0.93 + 0.1 * h, -0.05 * h], 0.035, HORN, {
    mirror: true,
  })
  r.spike(
    [0.05 + 0.06 * h, 0.93 + 0.1 * h, -0.05 * h],
    [0.05 + 0.13 * h, 0.93 + 0.06 * h, -0.13 * h],
    0.035,
    HORN,
    { mirror: true },
  )
  if (trickster) {
    // Mantle collar spikes + shoulder trim.
    r.spike([0.1, 0.78, -0.03], [0.2, 0.9, -0.1], 0.045, TRIM, { mirror: true })
    r.add(box(0.1, 0.05, 0.16), TRIM, { p: [0.14, 0.79, 0], r: [0, 0, -0.35] }, { mirror: true })
  }
  return r.build() // satyr: biped default
}

// ─── Centaurs ────────────────────────────────────────────────────────────────

const centaur = (khan: boolean): BufferGeometry => {
  const HIDE = 0x6a4a32
  const DARK = 0x4a3222
  const HOOF = 0x2a1e18
  const SKIN = 0x8a6048
  const ARMOR = khan ? 0x4e4a52 : 0x5a5a62
  const BRASS = 0x9a7a3a
  const HORN = 0xd8ccb0
  const STEEL = 0xa8acb4
  const r = new Rig(khan ? 1.0 : 0.9)
  r.joint("leg", 1, [0.13, 0.66, 0.38]).joint("leg", -1, [0.14, 0.7, -0.38])
  r.joint("arm", 1, [0.23, 1.24, 0.42])
  // Front legs (left-front +1).
  r.bone([0.13, 0.66, 0.38], [0.14, 0.33, 0.43], 0.07, HIDE, { limb: 1, mirror: true }, 0.05)
  r.bone([0.14, 0.33, 0.43], [0.14, 0.07, 0.41], 0.05, HIDE, { limb: 1, mirror: true })
  r.add(cyl(0.065, 0.075, 0.07, 5), HOOF, { p: [0.14, 0.035, 0.41] }, { limb: 1, mirror: true })
  // Back legs (left-back −1).
  r.add(ico(), HIDE, { p: [0.14, 0.7, -0.38], s: [0.1, 0.17, 0.15] }, { limb: -1, mirror: true })
  r.bone([0.14, 0.62, -0.4], [0.15, 0.34, -0.5], 0.065, HIDE, { limb: -1, mirror: true }, 0.05)
  r.bone([0.15, 0.34, -0.5], [0.14, 0.07, -0.43], 0.05, HIDE, { limb: -1, mirror: true })
  r.add(cyl(0.065, 0.075, 0.07, 5), HOOF, { p: [0.14, 0.035, -0.43] }, { limb: -1, mirror: true })
  r.joint("tail", 0, [0, 1.1, -0.5], [0, 0.9, -0.72])
  // Horse barrel + rump + tail.
  r.add(ico(), HIDE, { p: [0, 0.78, -0.02], s: [0.23, 0.2, 0.52] })
  r.add(ico(), HIDE, { p: [0, 0.82, -0.32], s: [0.21, 0.18, 0.2] })
  r.spike([0, 0.88, -0.5], [0, 0.45, -0.72], 0.08, DARK, { seg: 5 })
  // Saddle cloth.
  r.add(box(0.5, 0.2, 0.3), khan ? 0x6a1e1e : 0x3e4a2a, { p: [0, 0.82, -0.02] })
  // Humanoid torso with armoured chest.
  r.add(cyl(0.16, 0.2, 0.26, 6), SKIN, { p: [0, 0.98, 0.38] })
  r.add(box(0.36, 0.3, 0.24), ARMOR, { p: [0, 1.17, 0.4] })
  r.add(box(0.2, 0.06, 0.26), BRASS, { p: [0, 1.06, 0.4] })
  // Pauldrons + spikes.
  r.add(ico(), ARMOR, { p: [0.22, 1.29, 0.39], s: [0.11, 0.08, 0.11] }, { mirror: true })
  r.spike([0.23, 1.33, 0.39], [0.33, 1.47, 0.36], 0.04, HORN, { mirror: true })
  // Arms (left +1).
  const arm = { limb: 1, mirror: true, joint: "arm" } as const
  r.bone([0.23, 1.24, 0.42], [0.29, 1.0, 0.56], 0.05, SKIN, arm, 0.04)
  r.add(ico(), SKIN, { p: [0.29, 0.97, 0.58], s: 0.055 }, arm)
  // Head: brow, jaw, small horns, glowing eyes.
  r.add(box(0.16, 0.17, 0.16), SKIN, { p: [0, 1.4, 0.44] })
  r.add(box(0.13, 0.06, 0.09), DARK, { p: [0, 1.31, 0.5] })
  r.eyes([0.04, 1.42, 0.52], 0.03, 0xffb040)
  if (khan) {
    // Great curling horns + war-axe in the right hand.
    r.bone([0.07, 1.46, 0.42], [0.2, 1.56, 0.4], 0.045, HORN, { mirror: true }, 0.035)
    r.spike([0.2, 1.56, 0.4], [0.24, 1.72, 0.5], 0.035, HORN, { mirror: true })
    r.bone([-0.29, 0.62, 0.66], [-0.29, 1.5, 0.5], 0.028, DARK, { limb: -1, joint: "arm" })
    r.add(
      box(0.05, 0.28, 0.2),
      STEEL,
      { p: [-0.29, 1.4, 0.4], r: [0.18, 0, 0], s: [1, 1, 1] },
      { limb: -1, joint: "arm" },
    )
    r.spike([-0.29, 1.44, 0.6], [-0.29, 1.47, 0.72], 0.04, STEEL, { limb: -1, joint: "arm" })
    r.spike([-0.29, 1.5, 0.5], [-0.29, 1.6, 0.48], 0.03, STEEL, { limb: -1, joint: "arm" })
    // Bone trophies on the saddle.
    r.spike([0.25, 0.86, -0.1], [0.34, 0.98, -0.2], 0.04, HORN, { mirror: true })
  } else {
    r.spike([0.06, 1.47, 0.42], [0.11, 1.57, 0.38], 0.035, HORN, { mirror: true })
    // Heavy cleaver.
    r.bone([-0.29, 0.9, 0.6], [-0.29, 1.12, 0.62], 0.025, DARK, { limb: -1, joint: "arm" })
    r.add(box(0.04, 0.3, 0.14), STEEL, { p: [-0.29, 0.74, 0.62] }, { limb: -1, joint: "arm" })
  }
  return r.withSpec({ quadruped: true, pelvisY: 0.95 }).build()
}

// ─── Hellbears ───────────────────────────────────────────────────────────────

const hellbear = (smasher: boolean): BufferGeometry => {
  const FUR = 0x3a2e2a
  const DARK = 0x2a201e
  const MUZZLE = 0x4e3e36
  const CLAW = 0xd8ccb0
  const LAVA = 0xff5a1a
  const r = new Rig(smasher ? 1.24 : 1)
  r.joint("leg", -1, [0.17, 0.42, -0.06]).joint("arm", 1, [0.33, 0.94, 0.06])
  // Short thick legs (left leg −1).
  r.bone([0.17, 0.42, -0.06], [0.2, 0.1, 0], 0.11, FUR, { limb: -1, mirror: true }, 0.09)
  r.add(box(0.2, 0.1, 0.25), DARK, { p: [0.2, 0.05, 0.04] }, { limb: -1, mirror: true })
  // Hips, hunched barrel torso, hump.
  r.add(ico(), FUR, { p: [0, 0.46, -0.06], s: [0.28, 0.18, 0.23] })
  r.add(ico(), FUR, { p: [0, 0.76, 0.04], r: [0.3, 0, 0], s: [0.37, 0.32, 0.29] })
  r.add(ico(), DARK, { p: [0, 0.96, -0.04], s: [0.32, 0.18, 0.24] })
  // Molten cracks across the chest and back.
  r.add(box(0.04, 0.3, 0.04), LAVA, { p: [0.08, 0.76, 0.32], r: [0.3, 0, 0.35] }, { glow: 1 })
  r.add(box(0.04, 0.22, 0.04), LAVA, { p: [-0.1, 0.72, 0.32], r: [0.3, 0, -0.5] }, { glow: 1 })
  r.add(box(0.2, 0.04, 0.04), LAVA, { p: [0, 0.62, 0.3], r: [0.2, 0, 0.15] }, { glow: 1 })
  // Volcanic dorsal spikes, ember-tipped.
  const spikes = smasher ? 5 : 3
  for (let i = 0; i < spikes; i++) {
    const x = (i - (spikes - 1) / 2) * 0.13
    r.spike([x, 1.0, -0.06], [x * 1.4, 1.2 - Math.abs(x) * 0.5, -0.2], 0.06, DARK)
    r.add(oct(), LAVA, { p: [x, 1.04, -0.12], s: [0.03, 0.05, 0.03] }, { glow: 1 })
  }
  // Head thrust low and forward.
  r.add(box(0.25, 0.22, 0.22), FUR, { p: [0, 0.9, 0.34] })
  r.add(box(0.14, 0.11, 0.15), MUZZLE, { p: [0, 0.86, 0.5] })
  r.add(box(0.07, 0.05, 0.04), 0x141010, { p: [0, 0.9, 0.58] })
  r.spike([0.05, 0.81, 0.53], [0.05, 0.75, 0.55], 0.02, CLAW, { mirror: true })
  r.spike([0.09, 0.99, 0.3], [0.14, 1.07, 0.28], 0.05, DARK, { mirror: true })
  r.eyes([0.065, 0.93, 0.455], 0.032, 0xffb030)
  // Long arms (left +1) dragging huge clawed paws.
  r.bone([0.33, 0.94, 0.06], [0.42, 0.6, 0.2], 0.1, FUR, { limb: 1, mirror: true }, 0.085)
  r.bone([0.42, 0.6, 0.2], [0.4, 0.33, 0.3], 0.085, FUR, { limb: 1, mirror: true }, 0.08)
  r.add(
    box(0.04, 0.18, 0.04),
    LAVA,
    { p: [0.44, 0.64, 0.26], r: [0.4, 0, 0.2] },
    { glow: 1, limb: 1, mirror: true },
  )
  const paw = smasher ? 0.15 : 0.12
  r.add(ico(), DARK, { p: [0.4, 0.27, 0.32], s: paw }, { limb: 1, mirror: true })
  for (let c = -1; c <= 1; c++) {
    r.spike([0.4 + c * 0.05, 0.24, 0.38], [0.4 + c * 0.07, 0.16, 0.5], 0.025, CLAW, {
      limb: 1,
      mirror: true,
    })
  }
  if (smasher) {
    // Obsidian knuckle spikes and a molten shoulder plate.
    r.spike([0.4, 0.33, 0.32], [0.5, 0.42, 0.36], 0.04, 0x1a1418, { limb: 1, mirror: true })
    r.add(dod(), 0x1a1418, { p: [0.33, 1.0, 0.04], s: [0.13, 0.1, 0.13] }, { mirror: true })
    r.add(oct(), LAVA, { p: [0.33, 1.08, 0.04], s: [0.05, 0.06, 0.05] }, { glow: 1, mirror: true })
  }
  return r.withSpec({ quadruped: true, pelvisY: 0.5 }).build()
}

// ─── Drakes ──────────────────────────────────────────────────────────────────

const drake = (dragon: boolean): BufferGeometry => {
  const SCALE = 0x2a2630
  const SCALE2 = 0x3e3848
  const BELLY = 0x4a3a52
  const WING = 0x3a2440
  const HORN = 0x8a7e94
  const EMBER = 0xb05aff
  const FIRE = 0xff7a3a
  const r = new Rig(dragon ? 1.8 : 1)
  r.joint("leg", 1, [0.14, 0.4, 0.24]).joint("leg", -1, [0.15, 0.42, -0.22])
  // Front legs (left-front +1), back legs (left-back −1).
  r.bone([0.14, 0.4, 0.24], [0.16, 0.06, 0.3], 0.06, SCALE, { limb: 1, mirror: true }, 0.045)
  r.add(box(0.1, 0.06, 0.13), SCALE2, { p: [0.16, 0.03, 0.33] }, { limb: 1, mirror: true })
  r.add(ico(), SCALE, { p: [0.15, 0.42, -0.22], s: [0.1, 0.15, 0.14] }, { limb: -1, mirror: true })
  r.bone([0.16, 0.34, -0.24], [0.17, 0.16, -0.32], 0.055, SCALE, { limb: -1, mirror: true })
  r.bone([0.17, 0.16, -0.32], [0.17, 0.05, -0.24], 0.045, SCALE, { limb: -1, mirror: true })
  r.add(box(0.1, 0.06, 0.13), SCALE2, { p: [0.17, 0.03, -0.21] }, { limb: -1, mirror: true })
  // Body + ember-veined belly.
  r.add(ico(), SCALE, { p: [0, 0.48, 0], s: [0.21, 0.19, 0.38] })
  r.add(box(0.16, 0.06, 0.4), BELLY, { p: [0, 0.34, 0.02] })
  r.add(box(0.04, 0.04, 0.3), EMBER, { p: [0, 0.31, 0.02] }, { glow: 1 })
  r.joint("tail", 0, [0, 0.62, -0.36], [0, 0.58, -0.72], [0, 0.62, -1.05])
  // Spine ridge + tail.
  for (let i = 0; i < 4; i++) {
    const z = 0.22 - i * 0.15
    r.spike([0, 0.62 - i * 0.02, z], [0, 0.74 - i * 0.03, z - 0.1], 0.04, SCALE2)
  }
  r.bone([0, 0.47, -0.32], [0, 0.34, -0.62], 0.1, SCALE, {}, 0.07)
  r.bone([0, 0.34, -0.62], [0, 0.2, -0.88], 0.07, SCALE, {}, 0.04)
  r.spike([0, 0.2, -0.88], [0, 0.14, -1.05], 0.07, EMBER, { glow: 1, seg: 3 })
  // Neck + head: long wedge snout, jaw, swept horns, glowing eyes, ember throat.
  r.bone([0, 0.56, 0.28], [0, 0.78, 0.46], 0.09, SCALE, {}, 0.07)
  r.add(oct(), FIRE, { p: [0, 0.62, 0.4], s: [0.05, 0.08, 0.05] }, { glow: 1 })
  r.add(box(0.17, 0.13, 0.2), SCALE, { p: [0, 0.82, 0.54] })
  r.add(box(0.12, 0.08, 0.18), SCALE2, { p: [0, 0.81, 0.71] })
  r.add(box(0.1, 0.04, 0.2), SCALE, { p: [0, 0.73, 0.64], r: [-0.25, 0, 0] })
  r.add(box(0.08, 0.03, 0.05), FIRE, { p: [0, 0.765, 0.74] }, { glow: 1 })
  r.spike([0.06, 0.87, 0.5], [0.12, 0.98, 0.32], 0.04, HORN, { mirror: true })
  r.spike([0.08, 0.82, 0.48], [0.17, 0.84, 0.36], 0.03, HORN, { mirror: true })
  r.eyes([0.07, 0.86, 0.62], 0.032, EMBER)
  // Wings (left +1, right −1): finger bones + tattered double-sided membrane.
  const S: V3 = [0.13, 0.62, 0.12]
  const E: V3 = dragon ? [0.5, 1.0, 0.05] : [0.38, 0.92, 0.0]
  const T: V3 = dragon ? [0.95, 1.12, -0.14] : [0.62, 1.0, -0.2]
  const F1: V3 = dragon ? [1.0, 0.62, -0.32] : [0.68, 0.58, -0.32]
  const F2: V3 = dragon ? [0.7, 0.42, -0.42] : [0.48, 0.44, -0.4]
  const R: V3 = [0.12, 0.56, -0.22]
  r.joint("wing", 1, S)
  const wing = { limb: 1, mirror: true, joint: "wing" } as const
  r.bone(S, E, 0.04, SCALE2, wing, 0.03)
  r.bone(E, T, 0.03, HORN, wing, 0.02)
  r.bone(E, F1, 0.025, HORN, wing, 0.02)
  r.bone(E, F2, 0.025, HORN, wing, 0.02)
  r.spike(E, [E[0] + 0.02, E[1] + 0.1, E[2] + 0.04], 0.03, HORN, wing)
  // Tattered trailing edge: notch points between fingers.
  const N1: V3 = [(T[0] + F1[0]) / 2 - 0.06, (T[1] + F1[1]) / 2, (T[2] + F1[2]) / 2 + 0.03]
  const N2: V3 = [
    (F1[0] + F2[0]) / 2 - 0.05,
    (F1[1] + F2[1]) / 2 + 0.06,
    (F1[2] + F2[2]) / 2 + 0.03,
  ]
  const N3: V3 = [(F2[0] + R[0]) / 2, (F2[1] + R[1]) / 2 + 0.04, (F2[2] + R[2]) / 2 + 0.04]
  r.membrane(
    [S, E, T, N1, F1, N2, F2, N3, R],
    [
      [1, 2, 3],
      [1, 3, 4],
      [1, 4, 5],
      [1, 5, 6],
      [1, 6, 7],
      [1, 7, 8],
      [1, 8, 0],
    ],
    WING,
    wing,
  )
  // Glowing ember veins along the membrane.
  r.bone(E, [(F1[0] + F2[0]) / 2, (F1[1] + F2[1]) / 2, (F1[2] + F2[2]) / 2], 0.02, EMBER, {
    ...wing,
    glow: 1,
    seg: 3,
  })
  if (dragon) {
    // Crown of extra horns + chest ember plate for the elder dragon.
    r.spike([0.03, 0.89, 0.56], [0.04, 1.02, 0.46], 0.03, HORN, { mirror: true })
    r.add(oct(), EMBER, { p: [0, 0.5, 0.33], s: [0.07, 0.09, 0.05] }, { glow: 1 })
    for (let i = 0; i < 3; i++) {
      const z = -0.55 - i * 0.15
      r.spike([0, 0.4 - i * 0.07, z], [0, 0.5 - i * 0.08, z - 0.08], 0.03, SCALE2)
    }
  }
  return r.withSpec({ quadruped: true, pelvisY: 0.55 }).build()
}

// ─── Golems ──────────────────────────────────────────────────────────────────

const golem = (granite: boolean): BufferGeometry => {
  const ROCK = granite ? 0x57534f : 0x6b6762
  const DARK = granite ? 0x3e3b38 : 0x4f4b47
  const MOSS = 0x5f7a3a
  const RUNE = 0x7fd0ff
  const r = new Rig(granite ? 1.6 : 1.07)
  r.joint("leg", -1, [0.14, 0.36, 0]).joint("arm", 1, [0.38, 0.74, 0.02])
  // Stumpy legs (left leg −1).
  r.bone([0.14, 0.36, 0], [0.16, 0.1, 0.02], 0.1, DARK, { limb: -1, mirror: true }, 0.085)
  r.add(dod(), ROCK, { p: [0.16, 0.08, 0.05], s: [0.13, 0.08, 0.15] }, { limb: -1, mirror: true })
  // Pelvis + boulder torso.
  r.add(dod(), DARK, { p: [0, 0.4, 0], s: [0.21, 0.13, 0.16] })
  r.add(dod(), ROCK, { p: [0, 0.68, 0], r: [0.2, 0.3, 0], s: [0.34, 0.26, 0.26] })
  // Glowing rune cracks across the chest.
  r.add(box(0.04, 0.24, 0.04), RUNE, { p: [0.05, 0.68, 0.25], r: [0.2, 0, 0.4] }, { glow: 1 })
  r.add(box(0.16, 0.04, 0.04), RUNE, { p: [-0.06, 0.63, 0.24], r: [0.2, 0, -0.3] }, { glow: 1 })
  r.add(oct(), RUNE, { p: [0, 0.74, 0.25], s: 0.05 }, { glow: 1 })
  // Small sunken head with a mossy brow and glaring eyes.
  r.add(dod(), ROCK, { p: [0, 0.92, 0.14], s: [0.13, 0.11, 0.12] })
  r.add(box(0.2, 0.05, 0.08), DARK, { p: [0, 0.96, 0.22], r: [0.2, 0, 0] })
  r.eyes([0.045, 0.92, 0.25], 0.032, RUNE)
  // Massive shoulders capped with moss.
  r.add(dod(), ROCK, { p: [0.34, 0.82, 0], s: 0.16 }, { mirror: true })
  r.add(ico(), MOSS, { p: [0.34, 0.95, -0.01], s: [0.13, 0.05, 0.12] }, { mirror: true })
  r.add(ico(), MOSS, { p: [0, 0.9, -0.12], s: [0.2, 0.07, 0.12] })
  // Arms (left +1) ending in huge boulder fists.
  r.bone([0.38, 0.74, 0.02], [0.44, 0.44, 0.1], 0.09, DARK, { limb: 1, mirror: true }, 0.08)
  r.add(dod(), ROCK, { p: [0.45, 0.32, 0.12], s: [0.15, 0.14, 0.15] }, { limb: 1, mirror: true })
  r.add(box(0.04, 0.12, 0.04), RUNE, { p: [0.45, 0.33, 0.26] }, { glow: 1, limb: 1, mirror: true })
  if (granite) {
    // Rune-lit crystal spires erupting from the back, plus extra shoulder slabs.
    r.add(
      oct(),
      0x8fdcff,
      { p: [0, 1.0, -0.16], r: [-0.3, 0, 0], s: [0.06, 0.16, 0.06] },
      { glow: 1 },
    )
    r.add(
      oct(),
      RUNE,
      { p: [0.12, 0.96, -0.15], r: [-0.3, 0, -0.4], s: [0.05, 0.12, 0.05] },
      { glow: 1, mirror: true },
    )
    r.spike([0.36, 0.9, -0.04], [0.44, 1.08, -0.1], 0.07, DARK, { mirror: true })
    r.add(ico(), MOSS, { p: [0.45, 0.43, 0.08], s: [0.1, 0.04, 0.1] }, { limb: 1, mirror: true })
  } else {
    r.spike([0.33, 0.93, -0.02], [0.36, 1.02, -0.08], 0.05, DARK, { mirror: true })
  }
  return r.build() // golem: biped default
}

export const neutralModels: Record<NeutralKind, () => BufferGeometry> = {
  kobold: () => kobold(false),
  "kobold-foreman": () => kobold(true),
  "fell-spirit": fellSpirit,
  ghost,
  wolf: () => wolf(false),
  "alpha-wolf": () => wolf(true),
  satyr: () => satyr(false),
  "satyr-trickster": () => satyr(true),
  centaur: () => centaur(false),
  "centaur-khan": () => centaur(true),
  hellbear: () => hellbear(false),
  "hellbear-smasher": () => hellbear(true),
  "black-drake": () => drake(false),
  "black-dragon": () => drake(true),
  "rock-golem": () => golem(false),
  "granite-golem": () => golem(true),
}
