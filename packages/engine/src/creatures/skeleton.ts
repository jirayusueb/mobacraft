/**
 * Creature skeleton + pose solver — pure math, no three.js, no allocation per frame.
 *
 * A Skeleton is a bone hierarchy in bind pose (rest rotations are identity; each bone
 * is just its rest head position). rig.ts builds one per model from the kit's joint
 * declarations and skins every vertex to ≤ 2 bones.
 *
 * `PoseSolver.solve` turns a unit's animation state into one skinning matrix per bone:
 *
 *  1. procedural clips write local rotations (+ root translation):
 *     idle (breath, weight shift, look-around), locomotion (stride-locked arm swing,
 *     pelvis twist, counter-rotating chest, head stabilisation, lean into turns),
 *     attack (melee swing / cast / bite / siege throw), hit flinch, death (buckle,
 *     topple, sink), secondary motion (tail whip, cape drag, wing beats, wheel roll);
 *  2. forward kinematics down the hierarchy;
 *  3. two-bone analytic IK per leg: feet follow a stance/swing cycle locked to ground
 *     distance travelled, so planted feet do not slide; targets include the terrain
 *     height under each foot; knees bend toward a per-leg pole from the bind pose;
 *  4. skin matrices M = World · Bind⁻¹ written as 3×4 rows (12 floats / bone).
 */

export interface LegChain {
  readonly thigh: number
  readonly shin: number
  readonly foot: number
  /** Gait group (±1): opposite groups are half a cycle apart. */
  readonly group: number
  /** +1 left (+x), −1 right. */
  readonly side: number
  /** Quadruped foreleg (rears on bite attacks). */
  readonly front: boolean
}

export interface ArmChain {
  readonly upper: number
  readonly fore: number
  readonly hand: number
  readonly group: number
  readonly side: number
  /** Something is held in this hand (weapon, shield, staff). */
  readonly holds: boolean
}

export interface WingChain {
  readonly root: number
  readonly mid: number
  readonly side: number
}

export interface Skeleton {
  readonly count: number
  readonly names: readonly string[]
  readonly parent: Int16Array
  /** Bind-pose head position per bone (model space), xyz × count. */
  readonly rest: Float32Array
  readonly height: number
  readonly hipY: number
  readonly root: number
  readonly pelvis: number
  readonly spine: number
  readonly chest: number
  /** −1 when the model has no head (siege carts). */
  readonly head: number
  readonly legs: readonly LegChain[]
  /** Knee pole per leg (unit vector, model space), xyz × legs. */
  readonly poles: Float32Array
  readonly arms: readonly ArmChain[]
  readonly wings: readonly WingChain[]
  readonly tail: readonly number[]
  readonly cape: readonly number[]
  readonly wheels: readonly number[]
  readonly lever: number
  readonly quadruped: boolean
  /** No legs and no wheels: hovers (spirits). */
  readonly floating: boolean
}

export type AttackStyle = "swing" | "cast" | "bite" | "siege"

export interface PoseInput {
  /** Seconds (any monotonic clock). */
  readonly time: number
  /** Stride phase, radians (2π per `stride` world units travelled). */
  readonly phase: number
  /** 0..1 eased walk weight. */
  readonly move: number
  /** World units per full gait cycle. */
  readonly stride: number
  /** 0..1 attack progress; ≥ 1 = not attacking. */
  readonly attack: number
  readonly style: AttackStyle
  /** 1 at the moment of a hit, decaying to 0. */
  readonly hit: number
  /** < 0 alive; 0..1 death progress. */
  readonly death: number
  /** Smoothed yaw rate, rad/s (+ = turning left). */
  readonly turn: number
  /** Per-unit seed, radians. */
  readonly seed: number
  /** Terrain height under each leg's foot relative to the unit origin; omitted = flat. */
  readonly feetDy?: Float32Array | undefined
}

// ── tiny quaternion / vector kit on flat arrays ─────────────────────────────────

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
/** Hermite smoothstep from a to b (a > b allowed). */
export const sstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

const TAU = Math.PI * 2

/** o = a ⊗ b */
const qmul = (
  a: Float32Array,
  ai: number,
  b: Float32Array,
  bi: number,
  o: Float32Array,
  oi: number,
) => {
  const ax = a[ai]!
  const ay = a[ai + 1]!
  const az = a[ai + 2]!
  const aw = a[ai + 3]!
  const bx = b[bi]!
  const by = b[bi + 1]!
  const bz = b[bi + 2]!
  const bw = b[bi + 3]!
  o[oi] = aw * bx + ax * bw + ay * bz - az * by
  o[oi + 1] = aw * by - ax * bz + ay * bw + az * bx
  o[oi + 2] = aw * bz + ax * by - ay * bx + az * bw
  o[oi + 3] = aw * bw - ax * bx - ay * by - az * bz
}

/** o = conj(a) ⊗ b (a unit). */
const qcmul = (
  a: Float32Array,
  ai: number,
  b: Float32Array,
  bi: number,
  o: Float32Array,
  oi: number,
) => {
  const ax = -a[ai]!
  const ay = -a[ai + 1]!
  const az = -a[ai + 2]!
  const aw = a[ai + 3]!
  const bx = b[bi]!
  const by = b[bi + 1]!
  const bz = b[bi + 2]!
  const bw = b[bi + 3]!
  o[oi] = aw * bx + ax * bw + ay * bz - az * by
  o[oi + 1] = aw * by - ax * bz + ay * bw + az * bx
  o[oi + 2] = aw * bz + ax * by - ay * bx + az * bw
  o[oi + 3] = aw * bw - ax * bx - ay * by - az * bz
}

const V = new Float32Array(3)
/** V = rotate(q, (x, y, z)) */
const qrot = (q: Float32Array, qi: number, x: number, y: number, z: number) => {
  const qx = q[qi]!
  const qy = q[qi + 1]!
  const qz = q[qi + 2]!
  const qw = q[qi + 3]!
  const tx = 2 * (qy * z - qz * y)
  const ty = 2 * (qz * x - qx * z)
  const tz = 2 * (qx * y - qy * x)
  V[0] = x + qw * tx + (qy * tz - qz * ty)
  V[1] = y + qw * ty + (qz * tx - qx * tz)
  V[2] = z + qw * tz + (qx * ty - qy * tx)
}

/** Euler (pitch x, yaw y, roll z) applied as yaw · pitch · roll. */
const qEuler = (o: Float32Array, oi: number, x: number, y: number, z: number) => {
  const cx = Math.cos(x / 2)
  const sx = Math.sin(x / 2)
  const cy = Math.cos(y / 2)
  const sy = Math.sin(y / 2)
  const cz = Math.cos(z / 2)
  const sz = Math.sin(z / 2)
  // qy * qx
  const ax = cy * sx
  const ay = sy * cx
  const az = -sy * sx
  const aw = cy * cx
  // (qy*qx) * qz
  o[oi] = ax * cz + ay * sz
  o[oi + 1] = ay * cz - ax * sz
  o[oi + 2] = aw * sz + az * cz
  o[oi + 3] = aw * cz - az * sz
}

/** Shortest rotation taking unit a to unit b. */
const qFromTo = (
  o: Float32Array,
  oi: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
) => {
  const d = ax * bx + ay * by + az * bz
  if (d < -0.999999) {
    // Opposite: rotate π about any axis ⟂ a.
    const px = Math.abs(ax) < 0.9 ? 1 : 0
    const py = 1 - px
    let cx = ay * 0 - az * py
    let cy = az * px - ax * 0
    let cz = ax * py - ay * px
    const l = Math.hypot(cx, cy, cz) || 1
    cx /= l
    cy /= l
    cz /= l
    o[oi] = cx
    o[oi + 1] = cy
    o[oi + 2] = cz
    o[oi + 3] = 0
    return
  }
  const cx = ay * bz - az * by
  const cy = az * bx - ax * bz
  const cz = ax * by - ay * bx
  const w = 1 + d
  const l = Math.hypot(cx, cy, cz, w)
  o[oi] = cx / l
  o[oi + 1] = cy / l
  o[oi + 2] = cz / l
  o[oi + 3] = w / l
}

/** o = normalize(lerp(a, b, t)) along the short arc. */
const qnlerp = (
  a: Float32Array,
  ai: number,
  b: Float32Array,
  bi: number,
  t: number,
  o: Float32Array,
  oi: number,
) => {
  const s =
    a[ai]! * b[bi]! + a[ai + 1]! * b[bi + 1]! + a[ai + 2]! * b[bi + 2]! + a[ai + 3]! * b[bi + 3]! <
    0
      ? -1
      : 1
  let l = 0
  for (let k = 0; k < 4; k++) {
    const v = a[ai + k]! * (1 - t) + b[bi + k]! * t * s
    o[oi + k] = v
    l += v * v
  }
  l = Math.sqrt(l) || 1
  for (let k = 0; k < 4; k++) o[oi + k]! /= l
}

// ── solver ───────────────────────────────────────────────────────────────────────

/** Floats per bone in the skinning output (3 rows of a 3×4 affine matrix). */
export const FLOATS_PER_BONE = 12

export class PoseSolver {
  /** Local rotations (xyzw × count). */
  private readonly lq: Float32Array
  /** World rotations / positions after FK. */
  readonly wq: Float32Array
  readonly wp: Float32Array
  private readonly tmp = new Float32Array(8)
  private readonly len1: Float32Array
  private readonly len2: Float32Array
  /** Root translation (model space). */
  private tx = 0
  private ty = 0
  private tz = 0

  constructor(readonly skel: Skeleton) {
    const n = skel.count
    this.lq = new Float32Array(n * 4)
    this.wq = new Float32Array(n * 4)
    this.wp = new Float32Array(n * 3)
    this.len1 = new Float32Array(skel.legs.length)
    this.len2 = new Float32Array(skel.legs.length)
    const r = skel.rest
    skel.legs.forEach((l, i) => {
      this.len1[i] = Math.hypot(
        r[l.shin * 3]! - r[l.thigh * 3]!,
        r[l.shin * 3 + 1]! - r[l.thigh * 3 + 1]!,
        r[l.shin * 3 + 2]! - r[l.thigh * 3 + 2]!,
      )
      this.len2[i] = Math.hypot(
        r[l.foot * 3]! - r[l.shin * 3]!,
        r[l.foot * 3 + 1]! - r[l.shin * 3 + 1]!,
        r[l.foot * 3 + 2]! - r[l.shin * 3 + 2]!,
      )
    })
  }

  /** Write `count × 12` skinning floats for `inp` into `out` at `offset`. */
  solve(inp: PoseInput, out: Float32Array, offset = 0): void {
    this.strideLen = inp.stride * 0.5
    this.clips(inp)
    for (let i = 0; i < this.skel.count; i++) this.fk(i)
    this.legIK(inp)
    this.write(out, offset)
  }

  /** Bind pose (identity skinning) — for tests and the first frame. */
  bind(out: Float32Array, offset = 0): void {
    this.lq.fill(0)
    for (let i = 0; i < this.skel.count; i++) this.lq[i * 4 + 3] = 1
    this.tx = this.ty = this.tz = 0
    for (let i = 0; i < this.skel.count; i++) this.fk(i)
    this.write(out, offset)
  }

  private set(i: number, x: number, y: number, z: number) {
    if (i >= 0) qEuler(this.lq, i * 4, x, y, z)
  }

  // eslint-disable-next-line max-statements
  private clips(inp: PoseInput): void {
    const s = this.skel
    const lq = this.lq
    lq.fill(0)
    for (let i = 0; i < s.count; i++) lq[i * 4 + 3] = 1

    const { time: t, phase, seed } = inp
    const move = inp.move
    const still = 1 - move
    const h = s.height
    const hip = s.hipY || h * 0.4

    // Attack envelope: wind-up → strike → recover.
    const a = inp.attack
    const live = a < 1 ? 1 : 0
    const wind = sstep(0, 0.35, a) * live
    const strike = sstep(0.35, 0.5, a) * live
    const rec = sstep(0.5, 1, a) * live
    const hold = wind * (1 - rec) // ≈ 1 through wind-up and strike
    const hit = inp.hit
    const dying = inp.death >= 0 ? inp.death : -1
    const fall = dying >= 0 ? sstep(0.12, 0.6, dying) : 0
    const buckle = dying >= 0 ? sstep(0, 0.3, dying) : 0
    const sink = dying >= 0 ? sstep(0.72, 1, dying) : 0
    const breath = Math.sin(t * 1.4 + seed)
    const step2 = Math.cos(phase * 2) // twice per cycle: one per footfall
    const turn = Math.max(-2.5, Math.min(2.5, inp.turn))

    // ── root: bob, weight shift, lunge, lean into turns, death ──
    const sway = Math.sin(t * 0.55 + seed) * still
    this.tx = sway * h * 0.012
    this.ty =
      -hip * 0.035 - // soft knees at rest
      hip * 0.05 * move * (0.5 + 0.5 * step2) -
      hit * hip * 0.04 -
      buckle * hip * 0.45 -
      sink * h * 0.6
    this.tz = (strike - rec * strike) * h * 0.1 - wind * (1 - strike) * h * 0.03 - hit * h * 0.04
    if (s.floating) this.ty = h * (0.03 + 0.03 * Math.sin(t * 1.7 + seed)) - sink * h * 0.6
    const deathRoll = s.wheels.length > 0 || s.floating ? fall * 1.3 : 0
    this.set(
      s.root,
      -fall * (s.quadruped || s.wheels.length > 0 ? 0 : 1.35) +
        (s.floating ? Math.sin(t + seed) * 0.05 : 0),
      0,
      -turn * 0.05 * move + deathRoll + (s.quadruped && dying >= 0 ? fall * 1.4 : 0),
    )

    // ── torso ──
    const twist = Math.sin(phase) * move
    this.set(s.pelvis, 0, twist * 0.14, Math.cos(phase) * 0.05 * move + sway * 0.04)
    const lean = 0.06 * move + 0.2 * strike * (1 - rec) - 0.12 * wind * (1 - strike) - 0.22 * hit
    this.set(s.spine, lean + breath * 0.012 * still, -twist * 0.08, 0)
    const atkTwist =
      inp.style === "swing" ? 0.45 * wind * (1 - strike) - 0.6 * strike * (1 - rec) : 0
    this.set(
      s.chest,
      lean * 0.6 + breath * 0.025 * still + 0.25 * fall,
      -twist * 0.18 + atkTwist,
      0,
    )

    // ── head: stabilised against the spine, looks into turns, idle glances, bite ──
    if (s.head >= 0) {
      const glance = still * (0.35 * Math.sin(t * 0.31 + seed) * Math.sin(t * 0.13 + seed * 2))
      const bite = inp.style === "bite" ? -0.4 * wind * (1 - strike) + 0.55 * strike * (1 - rec) : 0
      this.set(
        s.head,
        -lean * 1.4 + 0.035 * step2 * move - 0.25 * hit + bite + 0.4 * fall,
        Math.max(-0.6, Math.min(0.6, turn * 0.22)) + glance,
        0,
      )
    }

    // ── arms ──
    const legL = Math.max(1e-3, inp.stride * 0.25)
    for (const arm of s.arms) {
      const swing = this.footZ(phase, arm.group, move) / legL // −1..1, + = forward
      const weapon = arm.side < 0 // right hand carries the weapon
      const amp = arm.holds ? 0.35 : 0.6
      let pitch = -swing * amp * move + breath * 0.03 * still
      let fore = -0.18 - 0.3 * move * (0.6 + 0.4 * Math.max(0, swing)) - (arm.holds ? 0.35 : 0)
      let roll = arm.side * (0.07 + 0.05 * hit)
      if (live) {
        if (inp.style === "swing" && weapon) {
          pitch = mix3(pitch, -2.5, 0.35, wind, strike, rec)
          fore = mix3(fore, -1.3, -0.05, wind, strike, rec)
          roll += arm.side * 0.25 * hold
        } else if (inp.style === "swing") {
          pitch += -0.7 * hold // guard up
          fore += -0.4 * hold
        } else if (inp.style === "cast") {
          pitch = mix3(pitch, weapon ? -2.3 : -0.9, weapon ? -1.35 : -1.45, wind, strike, rec)
          fore = mix3(fore, -0.6, -0.15, wind, strike, rec)
        }
      }
      // Death: arms fly up and out as the body topples.
      pitch += -1.1 * fall
      roll += arm.side * 0.5 * fall
      this.set(arm.upper, pitch, 0, roll)
      this.set(arm.fore, fore, 0, 0)
      this.set(arm.hand, 0.1 * hold, 0, 0)
    }

    // ── wings: folded breathing at rest, beats when moving / attacking ──
    for (const w of s.wings) {
      const rate = 2.4 + 5 * move + 6 * hold
      const beat = Math.sin(t * rate + seed)
      const amp = 0.18 + 0.35 * move + 0.5 * hold
      this.set(w.root, 0, 0, w.side * (0.12 + amp * beat - 0.6 * fall))
      this.set(
        w.mid,
        0,
        0,
        w.side * (0.22 * Math.sin(t * rate + seed - 0.9) * (0.5 + move) + 0.25 * fall),
      )
    }

    // ── tail: whip with lag down the chain ──
    s.tail.forEach((b, k) => {
      const lag = k * 0.9
      const yaw =
        (0.22 * move * Math.sin(phase - lag) + 0.14 * still * Math.sin(t * 1.1 + seed - lag)) *
          (1 + k * 0.35) -
        turn * 0.12
      const pitch = -0.08 * move + 0.05 * Math.sin(t * 0.9 + seed - lag) + 0.15 * hit
      this.set(b, pitch, yaw, 0)
    })

    // ── cape: dragged back by speed, flutters ──
    s.cape.forEach((b, k) => {
      const flutter = Math.sin(t * (4 + 3 * move) + seed - k * 1.1)
      this.set(
        b,
        (k === 0 ? 0.08 + 0.3 * move : 0.1 + 0.25 * move) +
          flutter * (0.03 + 0.07 * move) +
          0.3 * strike * (1 - rec),
        0,
        0.05 * flutter * move,
      )
    })

    // ── siege ──
    for (const b of s.wheels) this.set(b, phase, 0, 0)
    if (s.lever >= 0)
      this.set(s.lever, live ? 0.35 * wind * (1 - strike) - 1.9 * strike * (1 - rec) : 0, 0, 0)
  }

  /** Foot forward offset in a gait cycle (stance slides back linearly, swing eases forward). */
  private footZ(phase: number, group: number, move: number): number {
    const L = this.strideLen
    const u = ((((phase + (group > 0 ? 0 : Math.PI)) % TAU) + TAU) % TAU) / TAU
    if (u < 0.5) return (L / 2 - 2 * L * u) * move
    const v = (u - 0.5) / 0.5
    return (-L / 2 + L * v * v * (3 - 2 * v)) * move
  }

  private footLift(phase: number, group: number, move: number): number {
    const u = ((((phase + (group > 0 ? 0 : Math.PI)) % TAU) + TAU) % TAU) / TAU
    return u < 0.5 ? 0 : Math.sin((u - 0.5) * 2 * Math.PI) * move
  }

  private strideLen = 0.5

  private fk(i: number): void {
    const s = this.skel
    const p = s.parent[i]!
    const r = s.rest
    if (p < 0) {
      for (let k = 0; k < 4; k++) this.wq[i * 4 + k] = this.lq[i * 4 + k]!
      // Root rotates about the ground point under the model.
      qrot(this.wq, i * 4, r[i * 3]!, r[i * 3 + 1]!, r[i * 3 + 2]!)
      this.wp[i * 3] = V[0]! + this.tx
      this.wp[i * 3 + 1] = V[1]! + this.ty
      this.wp[i * 3 + 2] = V[2]! + this.tz
      return
    }
    qmul(this.wq, p * 4, this.lq, i * 4, this.wq, i * 4)
    qrot(
      this.wq,
      p * 4,
      r[i * 3]! - r[p * 3]!,
      r[i * 3 + 1]! - r[p * 3 + 1]!,
      r[i * 3 + 2]! - r[p * 3 + 2]!,
    )
    this.wp[i * 3] = this.wp[p * 3]! + V[0]!
    this.wp[i * 3 + 1] = this.wp[p * 3 + 1]! + V[1]!
    this.wp[i * 3 + 2] = this.wp[p * 3 + 2]! + V[2]!
  }

  // eslint-disable-next-line max-statements
  private legIK(inp: PoseInput): void {
    const s = this.skel
    if (!s.legs.length) return
    this.strideLen = inp.stride * 0.5
    const r = s.rest
    const wq = this.wq
    const wp = this.wp
    const tmp = this.tmp
    const hip = s.hipY
    const a = inp.attack
    const wind = a < 1 ? sstep(0, 0.35, a) : 0
    const strike = a < 1 ? sstep(0.35, 0.5, a) : 0
    // Death: blend IK out so the legs go limp with the falling body.
    const ikW = inp.death >= 0 ? 1 - sstep(0.25, 0.65, inp.death) : 1
    s.legs.forEach((leg, li) => {
      const th = leg.thigh
      const sh = leg.shin
      const ft = leg.foot
      const l1 = this.len1[li]!
      const l2 = this.len2[li]!
      // Target ankle: rest + gait + terrain (+ rear up for bites).
      const lift = this.footLift(inp.phase, leg.group, inp.move) * hip * 0.28
      const rear = inp.style === "bite" && leg.front ? hip * 0.35 * wind * (1 - strike) : 0
      const tx = r[ft * 3]!
      const ty = r[ft * 3 + 1]! + lift + rear + (inp.feetDy?.[li] ?? 0)
      const tz = r[ft * 3 + 2]! + this.footZ(inp.phase, leg.group, inp.move) + rear * 0.4
      const hx = wp[th * 3]!
      const hy = wp[th * 3 + 1]!
      const hz = wp[th * 3 + 2]!
      let dx = tx - hx
      let dy = ty - hy
      let dz = tz - hz
      let d = Math.hypot(dx, dy, dz) || 1e-6
      const dmax = (l1 + l2) * 0.999
      const dmin = Math.abs(l1 - l2) + 1e-4
      const dc = Math.min(dmax, Math.max(dmin, d))
      dx /= d
      dy /= d
      dz /= d
      d = dc
      // Pole in the current body frame (rotates with the root during death).
      qrot(wq, s.root * 4, s.poles[li * 3]!, s.poles[li * 3 + 1]!, s.poles[li * 3 + 2]!)
      let px = V[0]!
      let py = V[1]!
      let pz = V[2]!
      const pd = px * dx + py * dy + pz * dz
      px -= dx * pd
      py -= dy * pd
      pz -= dz * pd
      const pl = Math.hypot(px, py, pz) || 1
      px /= pl
      py /= pl
      pz /= pl
      const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d)
      const k = Math.sqrt(Math.max(0, l1 * l1 - x * x))
      const kx = hx + dx * x + px * k
      const ky = hy + dy * x + py * k
      const kz = hz + dz * x + pz * k
      const ax = hx + dx * d
      const ay = hy + dy * d
      const az = hz + dz * d

      // Thigh: world rotation taking the bind hip→knee direction to hip→knee.
      const p = s.parent[th]!
      this.aim(th, sh, kx - hx, ky - hy, kz - hz, p, ikW)
      this.fk(th)
      this.aim(sh, ft, ax - kx, ay - ky, az - kz, th, ikW)
      this.fk(sh)
      // Foot: level with the body, toe lifts through the swing.
      qEuler(tmp, 0, -0.5 * this.footLift(inp.phase, leg.group, inp.move), 0, 0)
      qmul(wq, s.root * 4, tmp, 0, tmp, 4)
      qcmul(wq, sh * 4, tmp, 4, tmp, 0)
      qnlerp(this.lq, ft * 4, tmp, 0, ikW, this.lq, ft * 4)
      this.fk(ft)
    })
  }

  /**
   * Set bone `i`'s local rotation so its bind direction (head → child head) points
   * along (x, y, z) in model space, blended with its FK rotation by `w`.
   */
  private aim(
    i: number,
    child: number,
    x: number,
    y: number,
    z: number,
    parent: number,
    w: number,
  ) {
    const r = this.skel.rest
    const tmp = this.tmp
    let bx = r[child * 3]! - r[i * 3]!
    let by = r[child * 3 + 1]! - r[i * 3 + 1]!
    let bz = r[child * 3 + 2]! - r[i * 3 + 2]!
    const bl = Math.hypot(bx, by, bz) || 1
    bx /= bl
    by /= bl
    bz /= bl
    const l = Math.hypot(x, y, z) || 1
    qFromTo(tmp, 0, bx, by, bz, x / l, y / l, z / l)
    // local = conj(parentWorld) ⊗ world
    qcmul(this.wq, parent * 4, tmp, 0, tmp, 4)
    qnlerp(this.lq, i * 4, tmp, 4, w, this.lq, i * 4)
  }

  private write(out: Float32Array, offset: number): void {
    const { wq, wp } = this
    const r = this.skel.rest
    for (let i = 0; i < this.skel.count; i++) {
      const x = wq[i * 4]!
      const y = wq[i * 4 + 1]!
      const z = wq[i * 4 + 2]!
      const w = wq[i * 4 + 3]!
      const m00 = 1 - 2 * (y * y + z * z)
      const m01 = 2 * (x * y - z * w)
      const m02 = 2 * (x * z + y * w)
      const m10 = 2 * (x * y + z * w)
      const m11 = 1 - 2 * (x * x + z * z)
      const m12 = 2 * (y * z - x * w)
      const m20 = 2 * (x * z - y * w)
      const m21 = 2 * (y * z + x * w)
      const m22 = 1 - 2 * (x * x + y * y)
      const rx = r[i * 3]!
      const ry = r[i * 3 + 1]!
      const rz = r[i * 3 + 2]!
      const o = offset + i * FLOATS_PER_BONE
      out[o] = m00
      out[o + 1] = m01
      out[o + 2] = m02
      out[o + 3] = wp[i * 3]! - (m00 * rx + m01 * ry + m02 * rz)
      out[o + 4] = m10
      out[o + 5] = m11
      out[o + 6] = m12
      out[o + 7] = wp[i * 3 + 1]! - (m10 * rx + m11 * ry + m12 * rz)
      out[o + 8] = m20
      out[o + 9] = m21
      out[o + 10] = m22
      out[o + 11] = wp[i * 3 + 2]! - (m20 * rx + m21 * ry + m22 * rz)
    }
  }
}

/** base → wound → struck → back to base, driven by the three attack envelopes. */
const mix3 = (
  base: number,
  wound: number,
  struck: number,
  wind: number,
  strike: number,
  rec: number,
) => {
  const a = base + (wound - base) * wind
  const b = a + (struck - a) * strike
  return b + (base - b) * rec
}
