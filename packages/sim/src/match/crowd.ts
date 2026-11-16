/**
 * Crowd locomotion (spec/09): ORCA local avoidance with avoidance priority,
 * 16-ray context steering for micro range, and StarCraft-style yielding.
 *
 * Pure and deterministic: no RNG, no world access. The match feeds agents in and
 * reads safe velocities out; this module never writes positions.
 */

export interface V2 {
  x: number
  z: number
}

/** ORCA time horizon (s): how far ahead agents promise not to collide. */
export const ORCA_TAU = 0.4
/** Neighbour radius (tiles) and cap for ORCA and steering queries. */
export const NEIGHBOR_RADIUS = 3
export const MAX_NEIGHBORS = 10
/** Goals closer than this (tiles; 300 Dota units) use context steering, not A*. */
export const MICRO_RANGE = 3
export const STEER_RAYS = 16
/** Yielding (§6). */
export const YIELD_LOOKAHEAD = 1
export const YIELD_TIME = 0.35
export const YIELD_SPEED = 0.7
export const YIELD_COOLDOWN = 0.6

/** Avoidance priority (§2): 1.0 is a wall, 0.5 moving, 0.1 idle. */
export const PRIORITY = { locked: 1, moving: 0.5, idle: 0.1 } as const

export interface CrowdAgent {
  readonly x: number
  readonly z: number
  /** Current (last tick's) velocity. */
  readonly vx: number
  readonly vz: number
  readonly radius: number
  /** 0..1 — see PRIORITY. */
  readonly priority: number
}

interface Line {
  px: number
  pz: number
  dx: number
  dz: number
}

const EPS = 1e-5
const det = (ax: number, az: number, bx: number, bz: number) => ax * bz - az * bx

/** RVO2 linearProgram1: optimise along line `no` subject to lines [0, no). */
const lp1 = (
  lines: readonly Line[],
  no: number,
  radius: number,
  optX: number,
  optZ: number,
  dirOpt: boolean,
  out: V2,
): boolean => {
  const L = lines[no]!
  const dot = L.px * L.dx + L.pz * L.dz
  const disc = dot * dot + radius * radius - (L.px * L.px + L.pz * L.pz)
  if (disc < 0) return false
  const s = Math.sqrt(disc)
  let tLeft = -dot - s
  let tRight = -dot + s
  for (let i = 0; i < no; i++) {
    const M = lines[i]!
    const denom = det(L.dx, L.dz, M.dx, M.dz)
    const numer = det(M.dx, M.dz, L.px - M.px, L.pz - M.pz)
    if (Math.abs(denom) <= EPS) {
      if (numer < 0) return false
      continue
    }
    const t = numer / denom
    if (denom >= 0) tRight = Math.min(tRight, t)
    else tLeft = Math.max(tLeft, t)
    if (tLeft > tRight) return false
  }
  let t: number
  if (dirOpt) t = optX * L.dx + optZ * L.dz > 0 ? tRight : tLeft
  else {
    t = L.dx * (optX - L.px) + L.dz * (optZ - L.pz)
    t = Math.max(tLeft, Math.min(tRight, t))
  }
  out.x = L.px + t * L.dx
  out.z = L.pz + t * L.dz
  return true
}

/** RVO2 linearProgram2: returns the index of the first failing line (or lines.length). */
const lp2 = (
  lines: readonly Line[],
  radius: number,
  optX: number,
  optZ: number,
  dirOpt: boolean,
  out: V2,
): number => {
  const optSq = optX * optX + optZ * optZ
  if (dirOpt) {
    out.x = optX * radius
    out.z = optZ * radius
  } else if (optSq > radius * radius) {
    const l = Math.sqrt(optSq)
    out.x = (optX / l) * radius
    out.z = (optZ / l) * radius
  } else {
    out.x = optX
    out.z = optZ
  }
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i]!
    if (det(L.dx, L.dz, L.px - out.x, L.pz - out.z) > 0) {
      const tx = out.x
      const tz = out.z
      if (!lp1(lines, i, radius, optX, optZ, dirOpt, out)) {
        out.x = tx
        out.z = tz
        return i
      }
    }
  }
  return lines.length
}

/** RVO2 linearProgram3: least-violating velocity when the program is infeasible. */
const lp3 = (lines: readonly Line[], begin: number, radius: number, out: V2) => {
  let distance = 0
  for (let i = begin; i < lines.length; i++) {
    const L = lines[i]!
    if (det(L.dx, L.dz, L.px - out.x, L.pz - out.z) <= distance) continue
    const proj: Line[] = []
    for (let j = 0; j < i; j++) {
      const M = lines[j]!
      const d = det(L.dx, L.dz, M.dx, M.dz)
      let px: number
      let pz: number
      if (Math.abs(d) <= EPS) {
        if (L.dx * M.dx + L.dz * M.dz > 0) continue
        px = 0.5 * (L.px + M.px)
        pz = 0.5 * (L.pz + M.pz)
      } else {
        const k = det(M.dx, M.dz, L.px - M.px, L.pz - M.pz) / d
        px = L.px + k * L.dx
        pz = L.pz + k * L.dz
      }
      let dx = M.dx - L.dx
      let dz = M.dz - L.dz
      const len = Math.hypot(dx, dz) || 1
      dx /= len
      dz /= len
      proj.push({ px, pz, dx, dz })
    }
    const tx = out.x
    const tz = out.z
    if (lp2(proj, radius, -L.dz, L.dx, true, out) < proj.length) {
      out.x = tx
      out.z = tz
    }
    distance = det(L.dx, L.dz, L.px - out.x, L.pz - out.z)
  }
}

/**
 * ORCA (RVO2 `computeNewVelocity`, agent half-planes only) with avoidance priority:
 * `self` takes share `pOther / (pSelf + pOther)` of each pairwise correction; a
 * priority-1.0 neighbour is a static wall (its velocity is ignored, self takes it all).
 * A priority-1.0 `self` does not avoid at all and keeps its preferred velocity.
 */
export const orcaVelocity = (
  self: CrowdAgent,
  prefX: number,
  prefZ: number,
  maxSpeed: number,
  neighbors: readonly CrowdAgent[],
  dt: number,
  tau = ORCA_TAU,
): V2 => {
  if (self.priority >= PRIORITY.locked) return { x: prefX, z: prefZ }
  const lines: Line[] = []
  const invTau = 1 / tau
  for (const o of neighbors) {
    const wall = o.priority >= PRIORITY.locked
    const share = wall ? 1 : o.priority / (self.priority + o.priority)
    const ovx = wall ? 0 : o.vx
    const ovz = wall ? 0 : o.vz
    const rpx = o.x - self.x
    const rpz = o.z - self.z
    const rvx = self.vx - ovx
    const rvz = self.vz - ovz
    const distSq = rpx * rpx + rpz * rpz
    const R = self.radius + o.radius
    const RSq = R * R
    let dx: number
    let dz: number
    let ux: number
    let uz: number
    if (distSq > RSq) {
      const wx = rvx - invTau * rpx
      const wz = rvz - invTau * rpz
      const wSq = wx * wx + wz * wz
      const dot1 = wx * rpx + wz * rpz
      if (dot1 < 0 && dot1 * dot1 > RSq * wSq) {
        // Project on the cut-off circle.
        const wl = Math.sqrt(wSq)
        const nx = wx / wl
        const nz = wz / wl
        dx = nz
        dz = -nx
        ux = (R * invTau - wl) * nx
        uz = (R * invTau - wl) * nz
      } else {
        // Project on a leg of the cone.
        const leg = Math.sqrt(distSq - RSq)
        if (det(rpx, rpz, wx, wz) > 0) {
          dx = (rpx * leg - rpz * R) / distSq
          dz = (rpx * R + rpz * leg) / distSq
        } else {
          dx = -(rpx * leg + rpz * R) / distSq
          dz = -(-rpx * R + rpz * leg) / distSq
        }
        const d2 = rvx * dx + rvz * dz
        ux = d2 * dx - rvx
        uz = d2 * dz - rvz
      }
    } else {
      // Already overlapping: resolve within one step.
      const invDt = 1 / dt
      const wx = rvx - invDt * rpx
      const wz = rvz - invDt * rpz
      const wl = Math.hypot(wx, wz)
      if (wl < EPS) {
        // Perfectly coincident: separate along a deterministic axis.
        lines.push({ px: self.vx, pz: self.vz + share * R * invDt, dx: 1, dz: 0 })
        continue
      }
      const nx = wx / wl
      const nz = wz / wl
      dx = nz
      dz = -nx
      ux = (R * invDt - wl) * nx
      uz = (R * invDt - wl) * nz
    }
    lines.push({ px: self.vx + share * ux, pz: self.vz + share * uz, dx, dz })
  }
  const out = { x: 0, z: 0 }
  const fail = lp2(lines, maxSpeed, prefX, prefZ, false, out)
  if (fail < lines.length) lp3(lines, fail, maxSpeed, out)
  return out
}

/** A circle that blocks steering rays (another body). */
export interface Blocker {
  readonly x: number
  readonly z: number
  readonly radius: number
}

/** Distance along unit ray (ox,oz)+t(dx,dz) to the first hit with an inflated circle, or Infinity. */
export const rayCircle = (
  ox: number,
  oz: number,
  dx: number,
  dz: number,
  c: Blocker,
  pad: number,
): number => {
  const fx = ox - c.x
  const fz = oz - c.z
  const r = c.radius + pad
  const b = fx * dx + fz * dz
  const cc = fx * fx + fz * fz - r * r
  if (cc <= 0) return b < 0 ? 0 : Infinity // inside: blocked only when heading inward
  const disc = b * b - cc
  if (disc < 0) return Infinity
  const t = -b - Math.sqrt(disc)
  return t >= 0 ? t : Infinity
}

/**
 * Context steering (§5): 16 rays; interest toward the goal, danger from bodies
 * and unwalkable ground. Returns a unit direction, or null when boxed in.
 */
export const contextSteer = (
  from: V2,
  radius: number,
  goal: V2,
  blockers: readonly Blocker[],
  walkable: (x: number, z: number) => boolean,
): V2 | null => {
  const gx = goal.x - from.x
  const gz = goal.z - from.z
  const gd = Math.hypot(gx, gz)
  if (gd < EPS) return null
  const ux = gx / gd
  const uz = gz / gd
  const L = Math.max(0.3, Math.min(1.5, gd))
  const danger = (dx: number, dz: number) => {
    let hit = L
    for (const c of blockers) hit = Math.min(hit, rayCircle(from.x, from.z, dx, dz, c, radius))
    // Ground: sample the ray at half and full length.
    for (const k of [0.5, 1]) {
      if (hit <= L * k) break
      if (!walkable(from.x + dx * L * k, from.z + dz * L * k)) hit = Math.min(hit, L * k * 0.5)
    }
    return 1 - hit / L
  }
  if (danger(ux, uz) < 0.05) return { x: ux, z: uz }
  let best: V2 | null = null
  let bestScore = 0.02
  const a0 = Math.atan2(uz, ux)
  for (let i = 0; i < STEER_RAYS; i++) {
    const a = a0 + (i / STEER_RAYS) * Math.PI * 2
    const dx = Math.cos(a)
    const dz = Math.sin(a)
    const interest = (1 + (dx * ux + dz * uz)) / 2
    const score = interest * (1 - danger(dx, dz))
    if (score > bestScore) {
      bestScore = score
      best = { x: dx, z: dz }
    }
  }
  return best
}

/**
 * Yield step (§6): unit vector perpendicular to the requester's direction `dir`,
 * on the side of the requester's ray the yielder already lies on.
 * `tieLeft` breaks exact-on-ray ties deterministically.
 */
export const yieldDirection = (requester: V2, dir: V2, yielder: V2, tieLeft: boolean): V2 => {
  const side = det(dir.x, dir.z, yielder.x - requester.x, yielder.z - requester.z)
  const left = side > EPS ? true : side < -EPS ? false : tieLeft
  // Left of dir (counter-clockwise in x/z) is (-dz, dx).
  return left ? { x: -dir.z, z: dir.x } : { x: dir.z, z: -dir.x }
}

/** Avoidance mode set by the combat layer each tick (§2 + review §1). */
export type CrowdMode = "locked" | "engaged" | "free"

/** A body as the crowd layer sees it. Decision code writes only `pvx/pvz`. */
export interface Mover {
  readonly id: string
  readonly team: string
  x: number
  z: number
  vx: number
  vz: number
  /** Preferred velocity for this tick (written by navigation/steering). */
  pvx: number
  pvz: number
  readonly radius: number
  maxSpeed: number
  mode: CrowdMode
  /** Yield state (§6). */
  yieldT: number
  yieldCd: number
  yx: number
  yz: number
}

export const newMoverState = () => ({
  vx: 0,
  vz: 0,
  pvx: 0,
  pvz: 0,
  yieldT: 0,
  yieldCd: 0,
  yx: 0,
  yz: 0,
})

export const priorityOf = (m: Mover): number =>
  m.mode === "locked"
    ? PRIORITY.locked
    : m.mode === "engaged" || m.pvx * m.pvx + m.pvz * m.pvz > 1e-4
      ? PRIORITY.moving
      : PRIORITY.idle

export interface CrowdWorld<M extends Mover> {
  /** Fill `out` with candidate neighbours of `m` within `r` (may include m). */
  neighbors(m: M, r: number, out: M[]): void
  /** Is (x, z) open ground for mover `m`? (free-pathing movers may ignore forest) */
  walkable(x: number, z: number, m: M): boolean
  /** May `b` take a yield step of (dx, dz)? (in-range guard, stun, structures…) */
  canYield(b: M, dx: number, dz: number): boolean
}

const scratch: Mover[] = []
const agents: CrowdAgent[] = []

/**
 * One crowd tick (review §8 determinism): yield requests → ORCA for every mover from
 * last tick's velocities → integrate all together in array order with a walkability slide.
 */
export const crowdStep = <M extends Mover>(
  movers: readonly M[],
  dt: number,
  world: CrowdWorld<M>,
) => {
  const near = scratch as M[]
  // 1. Yield requests: moving agents ask idle/engaged teammates ahead to step aside.
  for (const a of movers) {
    a.yieldCd = Math.max(0, a.yieldCd - dt)
    a.yieldT = Math.max(0, a.yieldT - dt)
  }
  for (const a of movers) {
    if (a.mode === "locked") continue
    const sp = Math.hypot(a.pvx, a.pvz)
    if (sp < 0.05) continue
    const dx = a.pvx / sp
    const dz = a.pvz / sp
    near.length = 0
    world.neighbors(a, YIELD_LOOKAHEAD + 1.5, near)
    let hit: M | undefined
    let hitT = YIELD_LOOKAHEAD
    for (const b of near) {
      if (b === a || b.team !== a.team || b.mode === "locked") continue
      if (b.pvx * b.pvx + b.pvz * b.pvz > 1e-4 || b.yieldCd > 0) continue
      const t = rayCircle(a.x, a.z, dx, dz, b, a.radius)
      if (t < hitT || (t === hitT && hit && b.id < hit.id)) {
        hitT = t
        hit = b
      }
    }
    if (!hit) continue
    const dir = yieldDirection(a, { x: dx, z: dz }, hit, hit.id > a.id)
    const v = hit.maxSpeed * YIELD_SPEED
    const sx = dir.x * v * YIELD_TIME
    const sz = dir.z * v * YIELD_TIME
    if (!world.walkable(hit.x + sx, hit.z + sz, hit) || !world.canYield(hit, sx, sz)) continue
    hit.yieldT = YIELD_TIME
    hit.yieldCd = YIELD_COOLDOWN
    hit.yx = dir.x * v
    hit.yz = dir.z * v
  }
  for (const b of movers) {
    if (b.yieldT > 0 && b.mode !== "locked" && b.pvx * b.pvx + b.pvz * b.pvz <= 1e-4) {
      b.pvx = b.yx
      b.pvz = b.yz
    }
  }
  // 2. ORCA from last tick's velocities (results buffered, then integrated).
  const nvx = new Float64Array(movers.length)
  const nvz = new Float64Array(movers.length)
  for (let i = 0; i < movers.length; i++) {
    const m = movers[i]!
    const pri = priorityOf(m)
    if (pri >= PRIORITY.locked || m.maxSpeed <= 0) {
      nvx[i] = 0
      nvz[i] = 0
      continue
    }
    near.length = 0
    world.neighbors(m, NEIGHBOR_RADIUS, near)
    const self = { x: m.x, z: m.z, vx: m.vx, vz: m.vz, radius: m.radius, priority: pri }
    // Collect, cull and sort by (distance, id); cap at MAX_NEIGHBORS.
    const cands: { o: M; d: number }[] = []
    const mySpeed = Math.hypot(m.pvx, m.pvz) + Math.hypot(m.vx, m.vz)
    for (const o of near) {
      if (o === m) continue
      const d = Math.hypot(o.x - m.x, o.z - m.z)
      // Can these two meet within the horizon at all?
      const reachT = (mySpeed + Math.hypot(o.vx, o.vz)) * ORCA_TAU + m.radius + o.radius
      if (d > NEIGHBOR_RADIUS || d > reachT) continue
      cands.push({ o, d })
    }
    if (cands.length === 0) {
      nvx[i] = m.pvx
      nvz[i] = m.pvz
      continue
    }
    cands.sort((p, q) => p.d - q.d || (p.o.id < q.o.id ? -1 : 1))
    agents.length = 0
    for (let k = 0; k < cands.length && k < MAX_NEIGHBORS; k++) {
      const o = cands[k]!.o
      agents.push({ x: o.x, z: o.z, vx: o.vx, vz: o.vz, radius: o.radius, priority: priorityOf(o) })
    }
    const v = orcaVelocity(self, m.pvx, m.pvz, m.maxSpeed, agents, dt)
    nvx[i] = v.x
    nvz[i] = v.z
  }
  // 3. Integrate with walkability slide.
  for (let i = 0; i < movers.length; i++) {
    const m = movers[i]!
    let vx = nvx[i]!
    let vz = nvz[i]!
    if (vx === 0 && vz === 0) {
      m.vx = 0
      m.vz = 0
      continue
    }
    let nx = m.x + vx * dt
    let nz = m.z + vz * dt
    if (!world.walkable(nx, nz, m)) {
      if (world.walkable(nx, m.z, m)) {
        nz = m.z
        vz = 0
      } else if (world.walkable(m.x, nz, m)) {
        nx = m.x
        vx = 0
      } else {
        nx = m.x
        nz = m.z
        vx = 0
        vz = 0
      }
    }
    m.x = nx
    m.z = nz
    m.vx = vx
    m.vz = vz
  }
}
