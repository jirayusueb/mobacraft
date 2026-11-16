/**
 * Lane creeps + Roshan — procedural "polygon dark fantasy" models.
 *
 * Every builder returns one merged, non-indexed, flat-shaded BufferGeometry with
 * attributes position / normal / color (linear) / glow / limb, feet on y = 0,
 * facing +z (creature's left = +x). See ./contract.ts.
 *
 * Limb groups: +1 = left arm (+x) + right leg (−x); −1 = right arm (−x) + left leg (+x).
 * Siege engines: +1 = front wheels + throwing arm, −1 = rear wheels.
 */
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
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js"
import { type BoundPart, bindJoints, type Joint, type JointKind, transformPivots } from "./rig.ts"

type Vec = readonly [number, number, number]
interface Place {
  at?: Vec
  rot?: Vec
  scale?: Vec | number
}
interface PartOpts {
  glow?: number
  limb?: number
  joint?: JointKind
}

const tmpM = new Matrix4()
const tmpQ = new Quaternion()
const tmpE = new Euler()
const tmpP = new Vector3()
const tmpS = new Vector3()
const tmpC = new Color()
const UP = new Vector3(0, 1, 0)

/** Collects coloured parts and merges them into one flat-shaded geometry. */
class Model {
  private readonly parts: BoundPart[] = []
  private readonly joints: Joint[] = []

  /** Declare a joint the limb group `limb` pivots around. */
  joint(kind: JointKind, limb: number, at: Vec): this {
    this.joints.push({ kind, limb, at })
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
    const len = dist(a, b)
    return this.push(orient(new BoxGeometry(w, len, d), a, b), hex, opts)
  }

  /** Low-poly frustum from a (radius r0) to b (radius r1). */
  seg(a: Vec, b: Vec, r0: number, r1: number, n: number, hex: number, opts: PartOpts = {}): this {
    const len = dist(a, b)
    return this.push(orient(new CylinderGeometry(r1, r0, len, n), a, b), hex, opts)
  }

  /** Cone/spike with base centred on a and tip at b. */
  spike(a: Vec, b: Vec, r: number, hex: number, opts: PartOpts = {}, n = 4): this {
    const len = dist(a, b)
    return this.push(orient(new ConeGeometry(r, len, n), a, b), hex, opts)
  }

  build(scale = 1): BufferGeometry {
    bindJoints(this.parts, this.joints)
    const merged = mergeGeometries(
      this.parts.map((p) => p.geo),
      false,
    )
    if (!merged) throw new Error("kit-lane: merge failed")
    for (const p of this.parts) p.geo.dispose()
    if (scale !== 1) {
      merged.scale(scale, scale, scale)
      transformPivots(merged, scale)
    }
    merged.computeVertexNormals()
    merged.computeBoundingBox()
    merged.computeBoundingSphere()
    return merged
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

// ── Palettes ────────────────────────────────────────────────────────────────

interface Team {
  armour: number
  armourDark: number
  cloth: number
  clothDark: number
  trim: number
  eye: number
  leather: number
  visor: number
  wood: number
  woodDark: number
}

const RADIANT: Team = {
  armour: 0xd9cfb4,
  armourDark: 0xa89d84,
  cloth: 0x3f7a52,
  clothDark: 0x2c5a3c,
  trim: 0xc9a34a,
  eye: 0x7dffb0,
  leather: 0x5a4330,
  visor: 0x1c2420,
  wood: 0x8a6440,
  woodDark: 0x5e4129,
}

const DIRE: Team = {
  armour: 0x3a3236,
  armourDark: 0x262024,
  cloth: 0x8a2a22,
  clothDark: 0x5e1c18,
  trim: 0xcfc3a8, // bone
  eye: 0xff6a2a,
  leather: 0x2e2420,
  visor: 0x120e10,
  wood: 0x4a3428,
  woodDark: 0x2e211a,
}

// ── Melee footsoldier (≈0.75 tall) ──────────────────────────────────────────

const melee = (t: Team, dire: boolean): BufferGeometry => {
  const m = new Model()

  for (const s of SIDES) {
    const limb = legLimb(s)
    m.joint("leg", limb, [s * 0.085, 0.28, 0])
    m.beam([s * 0.085, 0.28, 0], [s * 0.09, 0.06, 0.01], 0.1, 0.11, t.armourDark, { limb })
    m.add(new BoxGeometry(0.13, 0.07, 0.17), t.leather, { at: [s * 0.09, 0.035, 0.025] }, { limb })
    // knee guard
    m.add(new OctahedronGeometry(0.055), t.armour, { at: [s * 0.09, 0.17, 0.06] }, { limb })
  }

  // Skirt + belt + torso
  m.add(new CylinderGeometry(0.15, 0.2, 0.15, 6), t.cloth, { at: [0, 0.27, 0] })
  m.add(new CylinderGeometry(0.16, 0.16, 0.045, 6), t.trim, { at: [0, 0.345, 0] })
  m.add(new CylinderGeometry(0.21, 0.145, 0.22, 4), t.armour, {
    at: [0, 0.45, 0],
    rot: [0, Math.PI / 4, 0],
    scale: [1, 1, 0.78],
  })
  // Tabard hanging at the front
  m.add(new BoxGeometry(0.14, 0.17, 0.04), t.cloth, { at: [0, 0.26, 0.15], rot: [0.1, 0, 0] })
  if (dire) {
    // Bone ribs on the chest
    for (const y of [0.42, 0.48])
      m.add(new BoxGeometry(0.2, 0.04, 0.04), t.trim, { at: [0, y, 0.135] })
  } else {
    m.add(new OctahedronGeometry(0.055), t.trim, { at: [0, 0.46, 0.14], scale: [1, 1.3, 0.7] })
  }

  // Cape (tattered bottom edge)
  m.add(new BoxGeometry(0.3, 0.3, 0.04), dire ? t.clothDark : t.cloth, {
    at: [0, 0.37, -0.135],
    rot: [0.14, 0, 0],
  })
  for (const x of [-0.1, 0, 0.1])
    m.spike(
      [x, 0.23, -0.155],
      [x + 0.02, dire ? 0.12 : 0.16, -0.17],
      0.05,
      dire ? t.clothDark : t.cloth,
    )

  // Pauldrons
  for (const s of SIDES) {
    m.add(new IcosahedronGeometry(0.105), t.armour, {
      at: [s * 0.21, 0.54, 0],
      scale: [1.15, 0.8, 1.05],
    })
    if (dire) m.spike([s * 0.24, 0.58, 0], [s * 0.34, 0.71, -0.03], 0.04, t.trim)
    else
      m.add(new BoxGeometry(0.2, 0.04, 0.2), t.trim, {
        at: [s * 0.21, 0.505, 0],
        rot: [0, 0, s * 0.35],
      })
  }

  // Arms
  for (const s of SIDES) {
    const limb = armLimb(s)
    m.joint("arm", limb, [s * 0.23, 0.52, 0])
    m.beam([s * 0.23, 0.52, 0], [s * 0.25, 0.34, 0.06], 0.085, 0.085, t.armourDark, { limb })
    m.add(new BoxGeometry(0.095, 0.09, 0.1), t.leather, { at: [s * 0.25, 0.32, 0.07] }, { limb })
  }

  // Shield — left arm (+x)
  const sh = { limb: armLimb(1), joint: "arm" } as const
  if (dire) {
    m.add(
      new BoxGeometry(0.05, 0.32, 0.24),
      t.armour,
      { at: [0.32, 0.36, 0.08], rot: [0, -0.35, 0] },
      sh,
    )
    m.spike([0.32, 0.17, 0.08], [0.32, 0.1, 0.08], 0.09, t.armour, sh)
    m.spike([0.35, 0.37, 0.09], [0.45, 0.37, 0.13], 0.05, t.trim, sh)
    m.add(
      new BoxGeometry(0.055, 0.06, 0.25),
      t.cloth,
      { at: [0.32, 0.45, 0.08], rot: [0, -0.35, 0] },
      sh,
    )
  } else {
    m.add(
      new CylinderGeometry(0.19, 0.19, 0.035, 6),
      t.trim,
      { at: [0.31, 0.36, 0.08], rot: [0, -0.35, Math.PI / 2] },
      sh,
    )
    m.add(
      new CylinderGeometry(0.16, 0.16, 0.05, 6),
      t.armour,
      { at: [0.325, 0.36, 0.085], rot: [0, -0.35, Math.PI / 2] },
      sh,
    )
    m.spike([0.345, 0.36, 0.09], [0.41, 0.36, 0.115], 0.055, t.trim, sh, 5)
  }

  // Weapon — right arm (−x)
  const wp = { limb: armLimb(-1), joint: "arm" } as const
  if (dire) {
    m.beam([-0.25, 0.22, 0.04], [-0.27, 0.66, 0.2], 0.045, 0.045, t.wood, wp)
    m.add(
      new BoxGeometry(0.04, 0.17, 0.15),
      0x5a5258,
      { at: [-0.27, 0.6, 0.27], rot: [-0.35, 0, 0] },
      wp,
    )
    m.spike([-0.27, 0.62, 0.15], [-0.27, 0.7, 0.07], 0.035, t.trim, wp)
    m.spike([-0.27, 0.66, 0.2], [-0.28, 0.76, 0.24], 0.035, t.trim, wp)
  } else {
    m.beam([-0.25, 0.3, 0.09], [-0.27, 0.66, 0.27], 0.07, 0.04, 0xe8e4da, wp)
    m.spike([-0.27, 0.66, 0.27], [-0.275, 0.73, 0.31], 0.05, 0xe8e4da, wp)
    m.add(
      new BoxGeometry(0.15, 0.04, 0.05),
      t.trim,
      { at: [-0.25, 0.33, 0.1], rot: [-0.45, 0, 0] },
      wp,
    )
    m.add(new OctahedronGeometry(0.03), t.trim, { at: [-0.245, 0.27, 0.06] }, wp)
  }

  // Head
  m.add(new DodecahedronGeometry(0.125), t.armour, { at: [0, 0.635, 0.01], scale: [1, 1.05, 1] })
  m.add(new BoxGeometry(0.17, 0.07, 0.05), t.visor, { at: [0, 0.625, 0.11] })
  for (const s of SIDES)
    m.add(new BoxGeometry(0.05, 0.035, 0.03), t.eye, { at: [s * 0.04, 0.628, 0.135] }, GLOW)
  if (dire) {
    for (const s of SIDES) {
      m.seg([s * 0.1, 0.68, 0], [s * 0.18, 0.74, -0.02], 0.045, 0.035, 4, t.trim)
      m.spike([s * 0.18, 0.74, -0.02], [s * 0.19, 0.84, 0.02], 0.035, t.trim)
    }
    // jaw grille
    m.add(new BoxGeometry(0.13, 0.05, 0.05), t.armourDark, { at: [0, 0.575, 0.1] })
  } else {
    m.add(new BoxGeometry(0.045, 0.1, 0.22), t.trim, { at: [0, 0.75, -0.01] })
    m.add(new BoxGeometry(0.05, 0.08, 0.12), t.cloth, { at: [0, 0.72, -0.13], rot: [0.5, 0, 0] })
  }

  return m.build()
}

// ── Ranged caster (≈0.7 tall incl. hood) ────────────────────────────────────

const ranged = (t: Team, dire: boolean): BufferGeometry => {
  const m = new Model()

  for (const s of SIDES) {
    const limb = legLimb(s)
    m.joint("leg", limb, [s * 0.07, 0.18, 0])
    m.beam([s * 0.07, 0.18, 0], [s * 0.075, 0.05, 0.02], 0.08, 0.09, t.leather, { limb })
    m.add(new BoxGeometry(0.1, 0.06, 0.15), t.leather, { at: [s * 0.075, 0.03, 0.04] }, { limb })
  }

  // Robe + hem
  m.add(new CylinderGeometry(0.13, 0.22, 0.34, 6), t.cloth, { at: [0, 0.23, 0] })
  if (dire) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.5
      const x = Math.sin(a) * 0.19
      const z = Math.cos(a) * 0.19
      m.spike([x, 0.1, z], [x * 1.1, 0.03, z * 1.1], 0.06, t.clothDark)
    }
  } else {
    m.add(new CylinderGeometry(0.215, 0.225, 0.045, 6), t.trim, { at: [0, 0.075, 0] })
  }
  // Front panel
  m.add(new BoxGeometry(0.1, 0.26, 0.04), dire ? t.clothDark : t.armour, {
    at: [0, 0.22, 0.17],
    rot: [-0.22, 0, 0],
  })
  // Chest + belt
  m.add(new CylinderGeometry(0.155, 0.13, 0.17, 5), t.armour, { at: [0, 0.46, 0] })
  m.add(new CylinderGeometry(0.14, 0.14, 0.04, 6), t.trim, { at: [0, 0.385, 0] })
  // Mantle
  m.add(new ConeGeometry(0.25, 0.12, 6), t.clothDark, { at: [0, 0.54, -0.01] })
  for (const s of SIDES) {
    m.add(new IcosahedronGeometry(0.075), t.armour, {
      at: [s * 0.17, 0.54, 0],
      scale: [1.1, 0.8, 1],
    })
    if (dire) m.spike([s * 0.19, 0.57, -0.01], [s * 0.26, 0.66, -0.04], 0.035, t.trim)
  }

  // Hood + shadowed face + eyes
  m.add(new ConeGeometry(0.155, 0.25, 5), t.cloth, { at: [0, 0.64, -0.02], rot: [-0.25, 0, 0] })
  m.add(new OctahedronGeometry(0.085), t.visor, { at: [0, 0.6, 0.065], scale: [1, 1, 0.9] })
  for (const s of SIDES)
    m.add(new BoxGeometry(0.042, 0.032, 0.03), t.eye, { at: [s * 0.033, 0.61, 0.135] }, GLOW)
  if (!dire)
    m.add(new BoxGeometry(0.15, 0.04, 0.04), t.trim, { at: [0, 0.665, 0.08], rot: [0.3, 0, 0] })

  // Sleeves
  for (const s of SIDES) {
    const limb = armLimb(s)
    m.joint("arm", limb, [s * 0.17, 0.53, 0])
    m.seg([s * 0.17, 0.53, 0], [s * 0.21, 0.36, 0.08], 0.05, 0.065, 5, t.cloth, { limb })
    m.add(new BoxGeometry(0.07, 0.07, 0.07), t.leather, { at: [s * 0.21, 0.33, 0.09] }, { limb })
  }
  // Off-hand glow rune
  m.add(
    new OctahedronGeometry(0.04),
    t.eye,
    { at: [0.22, 0.27, 0.12] },
    { glow: 1, limb: armLimb(1), joint: "arm" },
  )

  // Staff in right hand (−x)
  const st = { limb: armLimb(-1), joint: "arm" } as const
  m.beam([-0.22, 0.04, 0.1], [-0.235, 0.7, 0.13], 0.045, 0.045, t.wood, st)
  m.add(new IcosahedronGeometry(0.065), t.eye, { at: [-0.235, 0.77, 0.13] }, { glow: 1, ...st })
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2
    const dx = Math.sin(a) * 0.07
    const dz = Math.cos(a) * 0.07
    m.spike(
      [-0.235 + dx * 0.5, 0.7, 0.13 + dz * 0.5],
      [-0.235 + dx, dire ? 0.85 : 0.82, 0.13 + dz],
      0.025,
      t.trim,
      st,
    )
  }
  // Authored slightly large for proportion; normalise so the staff orb tops out ≈0.72.
  return m.build(0.86)
}

// ── Siege engines (≈0.9 tall, ≈1.3 long) ────────────────────────────────────

const wheels = (m: Model, tire: number, hub: number, spikes: number | undefined) => {
  for (const s of SIDES)
    for (const z of [0.36, -0.36]) {
      const limb = z > 0 ? 1 : -1
      m.joint("wheel", limb, [s * 0.34, 0.2, z])
      m.add(
        new CylinderGeometry(0.2, 0.2, 0.09, 8),
        tire,
        { at: [s * 0.34, 0.2, z], rot: [0, 0, Math.PI / 2] },
        { limb },
      )
      m.add(
        new CylinderGeometry(0.075, 0.075, 0.13, 5),
        hub,
        { at: [s * 0.36, 0.2, z], rot: [0, 0, Math.PI / 2] },
        { limb },
      )
      if (spikes !== undefined)
        m.spike([s * 0.42, 0.2, z], [s * 0.53, 0.2, z], 0.05, spikes, { limb })
    }
}

const radiantSiege = (): BufferGeometry => {
  const t = RADIANT
  const m = new Model()
  wheels(m, t.woodDark, t.trim, undefined)
  // Chassis
  m.add(new BoxGeometry(0.56, 0.13, 1.02), t.wood, { at: [0, 0.32, 0] })
  for (const z of [0.42, -0.42])
    m.add(new BoxGeometry(0.6, 0.05, 0.06), t.trim, { at: [0, 0.39, z] })
  // Tow tongue
  m.beam([0, 0.3, -0.5], [0, 0.26, -0.66], 0.07, 0.07, t.woodDark)
  // Stone base
  m.add(new BoxGeometry(0.44, 0.16, 0.46), t.armour, { at: [0, 0.465, -0.08] })
  m.add(new CylinderGeometry(0.16, 0.2, 0.08, 6), t.armourDark, { at: [0, 0.585, -0.06] })
  m.add(new OctahedronGeometry(0.06), t.eye, { at: [0, 0.47, 0.16], scale: [1, 1.3, 0.6] }, GLOW)
  // Ballista stock + bow arms
  m.beam([0, 0.64, -0.36], [0, 0.66, 0.42], 0.09, 0.08, t.wood)
  m.add(new BoxGeometry(0.12, 0.1, 0.1), t.trim, { at: [0, 0.665, 0.37] })
  for (const s of SIDES) {
    m.seg([s * 0.05, 0.67, 0.37], [s * 0.4, 0.71, 0.22], 0.045, 0.035, 4, t.wood)
    m.spike([s * 0.4, 0.71, 0.22], [s * 0.46, 0.73, 0.14], 0.04, t.trim)
    // Bowstring (kept chunky)
    m.beam([s * 0.4, 0.71, 0.2], [0, 0.71, -0.14], 0.04, 0.04, 0xe8e0c8)
  }
  // Loaded bolt with glowing rune head
  m.beam([0, 0.72, -0.18], [0, 0.72, 0.56], 0.045, 0.045, t.woodDark)
  m.spike([0, 0.72, 0.55], [0, 0.72, 0.68], 0.05, t.eye, GLOW)
  // Banner
  m.beam([-0.22, 0.38, -0.44], [-0.22, 0.92, -0.44], 0.045, 0.045, t.woodDark)
  m.add(new BoxGeometry(0.04, 0.22, 0.2), t.cloth, { at: [-0.22, 0.77, -0.55] })
  m.spike([-0.22, 0.66, -0.5], [-0.22, 0.6, -0.5], 0.06, t.cloth)
  m.spike([-0.22, 0.66, -0.6], [-0.22, 0.6, -0.6], 0.06, t.cloth)
  m.add(new OctahedronGeometry(0.045), t.trim, { at: [-0.22, 0.95, -0.44] })
  return m.build()
}

const direSiege = (): BufferGeometry => {
  const t = DIRE
  const m = new Model()
  wheels(m, t.armour, t.armourDark, t.trim)
  // Chassis with iron plates
  m.add(new BoxGeometry(0.56, 0.14, 1.02), t.wood, { at: [0, 0.32, 0] })
  m.add(new BoxGeometry(0.6, 0.06, 0.3), t.armour, { at: [0, 0.4, 0.34] })
  m.add(new BoxGeometry(0.6, 0.06, 0.24), t.armour, { at: [0, 0.4, -0.38] })
  // Front ram: bone skull + spikes
  m.add(new DodecahedronGeometry(0.13), t.trim, { at: [0, 0.38, 0.56], scale: [1.1, 0.9, 1] })
  for (const s of SIDES) {
    m.add(new BoxGeometry(0.05, 0.04, 0.03), t.eye, { at: [s * 0.05, 0.4, 0.675] }, GLOW)
    m.spike([s * 0.2, 0.32, 0.5], [s * 0.26, 0.36, 0.68], 0.05, t.trim)
    m.spike([s * 0.1, 0.46, 0.55], [s * 0.15, 0.6, 0.62], 0.04, t.trim)
  }
  // A-frame + crossbar
  for (const s of SIDES) {
    m.beam([s * 0.22, 0.4, -0.08], [s * 0.18, 0.7, 0.08], 0.07, 0.07, t.armourDark)
    m.beam([s * 0.22, 0.4, 0.24], [s * 0.18, 0.7, 0.08], 0.07, 0.07, t.armourDark)
  }
  m.add(new BoxGeometry(0.46, 0.07, 0.08), t.armour, { at: [0, 0.71, 0.08] })
  // Throwing arm (limb +1) cocked back, ember boulder in bucket
  // Lever pivots on the axle; shares limb +1 with the front wheels, so pin the kind.
  m.joint("lever", 1, [0, 0.46, 0.18])
  const arm = { limb: 1, joint: "lever" } as const
  m.add(
    new CylinderGeometry(0.06, 0.06, 0.4, 6),
    t.armour,
    { at: [0, 0.46, 0.18], rot: [0, 0, Math.PI / 2] },
    arm,
  )
  m.beam([0, 0.46, 0.2], [0, 0.62, -0.46], 0.08, 0.07, t.wood, arm)
  m.add(new CylinderGeometry(0.15, 0.09, 0.1, 6), t.armour, { at: [0, 0.66, -0.5] }, arm)
  m.add(new IcosahedronGeometry(0.12), t.eye, { at: [0, 0.76, -0.5] }, { glow: 1, ...arm })
  m.add(new DodecahedronGeometry(0.1), 0x2a2224, { at: [0.04, 0.73, -0.47] }, arm)
  // Tattered rust banner on a bone pole
  m.beam([0.22, 0.4, -0.46], [0.22, 0.92, -0.46], 0.045, 0.045, t.trim)
  m.add(new BoxGeometry(0.04, 0.2, 0.2), t.cloth, { at: [0.22, 0.78, -0.57] })
  m.spike([0.22, 0.68, -0.52], [0.22, 0.58, -0.52], 0.055, t.cloth)
  m.spike([0.22, 0.68, -0.62], [0.22, 0.62, -0.63], 0.055, t.cloth)
  m.spike([0.22, 0.92, -0.46], [0.22, 0.98, -0.46], 0.04, t.trim)
  return m.build()
}

// ── Roshan (≈3.2 tall) ──────────────────────────────────────────────────────

const roshan = (): BufferGeometry => {
  const HIDE = 0x5a5560
  const DARK = 0x423e48
  const BELLY = 0x6e6874
  const BONE = 0xd8cfb8
  const EMBER = 0xff7a2a
  const m = new Model()

  // Legs — thick, bowed
  for (const s of SIDES) {
    const limb = legLimb(s)
    m.joint("leg", limb, [s * 0.52, 1.2, -0.2])
    m.seg([s * 0.52, 1.2, -0.2], [s * 0.64, 0.62, 0.08], 0.32, 0.25, 6, HIDE, { limb })
    m.seg([s * 0.64, 0.62, 0.08], [s * 0.6, 0.14, -0.04], 0.22, 0.18, 6, DARK, { limb })
    m.add(
      new DodecahedronGeometry(0.17),
      BONE,
      { at: [s * 0.66, 0.66, 0.24], scale: [1, 0.8, 0.7] },
      { limb },
    )
    m.add(new BoxGeometry(0.44, 0.22, 0.56), DARK, { at: [s * 0.6, 0.11, 0.1] }, { limb })
    for (const dx of [-0.13, 0, 0.13])
      m.spike([s * 0.6 + dx, 0.09, 0.36], [s * 0.6 + dx, 0.03, 0.52], 0.06, BONE, { limb })
  }

  // Pelvis, torso, belly
  m.add(new DodecahedronGeometry(0.55), DARK, { at: [0, 1.25, -0.2], scale: [1.3, 0.8, 1] })
  m.add(new DodecahedronGeometry(0.9), HIDE, {
    at: [0, 1.9, 0.02],
    rot: [0.35, 0, 0],
    scale: [1.25, 1, 1],
  })
  m.add(new IcosahedronGeometry(0.6), BELLY, { at: [0, 1.62, 0.5], scale: [1, 1.1, 0.6] })

  // Chest runes — glowing V + diamond
  m.add(new OctahedronGeometry(0.11), EMBER, { at: [0, 1.95, 0.84], scale: [1, 1.3, 0.6] }, GLOW)
  for (const s of SIDES) {
    m.beam([s * 0.32, 1.82, 0.74], [s * 0.1, 1.55, 0.86], 0.07, 0.08, EMBER, GLOW)
    m.add(
      new BoxGeometry(0.07, 0.07, 0.07),
      EMBER,
      { at: [s * 0.36, 1.98, 0.7], rot: [0, 0, Math.PI / 4] },
      GLOW,
    )
  }

  // Shoulders + bone spurs
  for (const s of SIDES) {
    m.add(new IcosahedronGeometry(0.56), HIDE, { at: [s * 0.95, 2.42, 0.02], scale: [1.1, 0.9, 1] })
    m.add(new DodecahedronGeometry(0.42), DARK, {
      at: [s * 0.98, 2.55, -0.05],
      scale: [1.1, 0.6, 1],
    })
    m.spike([s * 1.0, 2.75, -0.05], [s * 1.2, 3.05, -0.2], 0.13, BONE)
    m.spike([s * 1.25, 2.55, 0.0], [s * 1.55, 2.68, -0.1], 0.11, BONE)
  }

  // Back spines along the hump
  const spines: [Vec, Vec, number][] = [
    [[0, 2.62, -0.3], [0, 3.0, -0.6], 0.14],
    [[0, 2.35, -0.62], [0, 2.7, -0.95], 0.13],
    [[0, 1.95, -0.78], [0, 2.22, -1.12], 0.11],
    [[0, 1.5, -0.68], [0, 1.68, -1.0], 0.09],
  ]
  for (const [a, b, r] of spines) m.spike(a, b, r, BONE)

  // Head — low and forward
  m.add(new DodecahedronGeometry(0.42), HIDE, { at: [0, 2.3, 0.92], scale: [1.15, 0.9, 1.15] })
  m.add(new BoxGeometry(0.5, 0.28, 0.42), DARK, { at: [0, 2.16, 1.3] })
  m.add(new BoxGeometry(0.46, 0.14, 0.38), DARK, { at: [0, 1.96, 1.24], rot: [0.2, 0, 0] })
  m.add(new BoxGeometry(0.62, 0.1, 0.16), DARK, { at: [0, 2.49, 1.18], rot: [0.25, 0, 0] })
  for (const s of SIDES) {
    m.add(
      new OctahedronGeometry(0.075),
      EMBER,
      { at: [s * 0.18, 2.4, 1.3], scale: [1.3, 0.8, 0.8] },
      GLOW,
    )
    // Tusks
    m.spike([s * 0.18, 1.98, 1.36], [s * 0.26, 2.32, 1.5], 0.06, BONE)
    // Great horns: two-segment curve sweeping up and back
    m.seg([s * 0.28, 2.55, 0.92], [s * 0.62, 2.88, 0.78], 0.15, 0.11, 5, BONE)
    m.spike([s * 0.62, 2.88, 0.78], [s * 0.58, 3.2, 0.42], 0.11, BONE, {}, 5)
  }

  // Arms — knuckle-dragging, clawed
  for (const s of SIDES) {
    const limb = armLimb(s)
    m.joint("arm", limb, [s * 1.05, 2.4, 0.05])
    m.seg([s * 1.05, 2.4, 0.05], [s * 1.2, 1.5, 0.3], 0.27, 0.22, 6, HIDE, { limb })
    m.seg([s * 1.2, 1.5, 0.3], [s * 1.15, 0.58, 0.55], 0.25, 0.28, 6, DARK, { limb })
    // Bone bracer + spike
    m.seg([s * 1.19, 1.25, 0.37], [s * 1.17, 0.95, 0.45], 0.3, 0.3, 6, BONE, { limb })
    m.spike([s * 1.38, 1.1, 0.38], [s * 1.6, 1.2, 0.3], 0.08, BONE, { limb })
    // Fist + claws
    m.add(new DodecahedronGeometry(0.27), DARK, { at: [s * 1.15, 0.42, 0.62] }, { limb })
    for (const dx of [-0.13, 0, 0.13])
      m.spike([s * 1.15 + dx, 0.3, 0.8], [s * 1.15 + dx, 0.1, 0.98], 0.065, BONE, { limb })
  }

  // Tail — tapering chain ending in a bone club
  m.seg([0, 1.2, -0.6], [0, 0.95, -1.15], 0.22, 0.17, 5, HIDE)
  m.seg([0, 0.95, -1.15], [0, 0.6, -1.6], 0.17, 0.12, 5, DARK)
  m.seg([0, 0.6, -1.6], [0, 0.42, -1.95], 0.12, 0.08, 5, DARK)
  m.add(new OctahedronGeometry(0.15), BONE, { at: [0, 0.4, -2.0], scale: [1, 0.8, 1.3] })
  m.spike([0, 0.5, -2.0], [0, 0.72, -2.1], 0.07, BONE)

  return m.build()
}

export const laneModels: Record<
  | "radiant-melee"
  | "radiant-ranged"
  | "radiant-siege"
  | "dire-melee"
  | "dire-ranged"
  | "dire-siege"
  | "roshan",
  () => BufferGeometry
> = {
  "radiant-melee": () => melee(RADIANT, false),
  "radiant-ranged": () => ranged(RADIANT, false),
  "radiant-siege": radiantSiege,
  "dire-melee": () => melee(DIRE, true),
  "dire-ranged": () => ranged(DIRE, true),
  "dire-siege": direSiege,
  roshan,
}
