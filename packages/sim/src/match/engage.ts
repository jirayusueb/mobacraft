/**
 * Engage planner (spec/09 §3–§5): where should an attacker move this tick?
 *
 * Shared by match.ts and the arena tests so both run the same rules:
 * in reach ⇒ stand and swing (slots never gate attacking); melee within micro
 * range reserves a ring slot and goes to `target + offset`; preemption lets an
 * in-reach arriver take an inner slot from a holder that has not arrived.
 */
import { AttackRings, MELEE_RANGE, RELEASE_AT, RESERVE_AT, type Pos, reach } from "./attack-ring.ts"
import { type Blocker, MICRO_RANGE, contextSteer } from "./crowd.ts"

export interface EngageSelf extends Pos {
  readonly id: string
  readonly range: number
}
export interface EngageTarget extends Pos {
  readonly id: string
  readonly radius: number
}

export type EngagePlan =
  /** In reach: swing. `drift` = own slot to settle into between swings (frees the ring edge). */
  | { readonly inReach: true; readonly drift?: Pos }
  | {
      readonly inReach: false
      readonly goal: Pos
      readonly stopAt: number
      readonly slotted: boolean
    }

/** In-reach attackers farther than this from their slot drift into it between swings. */
export const DRIFT_EPS = 0.15
/** Reach tolerance (tiles) shared by planEngage and the swing start check. */
export const REACH_EPS = 0.05

export const usesRings = (range: number) => range < MELEE_RANGE

export const planEngage = (
  rings: AttackRings,
  self: EngageSelf,
  target: EngageTarget,
  now: number,
  posOf: (id: string) => Pos | undefined,
  inReachOf: (id: string) => boolean,
): EngagePlan => {
  const R = reach(self.range, target.radius)
  const d = Math.hypot(target.x - self.x, target.z - self.z)
  const ringUser = usesRings(self.range)
  // Slot-arrival tolerance: ring 1 sits at exactly reach for range-1.2 units, so a
  // body parked on its slot must count as in reach despite float noise.
  if (d <= R + REACH_EPS) {
    if (ringUser) {
      rings.request(self.id, self, target.id, target, target.radius, R)
      rings.preempt(self.id, self, target.id, target, now, posOf, inReachOf)
      const raw = rings.goalOf(self.id, target)
      const slot = raw && clampInside(raw, target, R - SLOT_MARGIN)
      if (slot && Math.hypot(slot.x - self.x, slot.z - self.z) > DRIFT_EPS)
        return { inReach: true, drift: slot }
    }
    return { inReach: true }
  }
  if (!ringUser || d > RELEASE_AT) rings.release(self.id)
  if (ringUser && d <= RESERVE_AT) {
    const slot = rings.request(self.id, self, target.id, target, target.radius, R)
    const raw = slot ? rings.goalOf(self.id, target) : undefined
    // Standing on the slot must be in reach: pull it inward when the ring sits at
    // or beyond this attacker's reach (short melee vs a big target).
    const goal = raw && clampInside(raw, target, R - SLOT_MARGIN)
    if (goal)
      return {
        inReach: false,
        goal: orbit(self, target, goal, target.radius, rings.orbitSign(self.id)),
        stopAt: 0.05,
        slotted: true,
      }
  }
  return { inReach: false, goal: target, stopAt: R * 0.9, slotted: false }
}

/** Slots are pulled to at most reach − SLOT_MARGIN from the target centre. */
export const SLOT_MARGIN = 0.15
const clampInside = (p: Pos, c: Pos, maxR: number): Pos => {
  const dx = p.x - c.x
  const dz = p.z - c.z
  const d = Math.hypot(dx, dz)
  if (d <= maxR || d < 1e-9) return p
  return { x: c.x + (dx / d) * maxR, z: c.z + (dz / d) * maxR }
}

/**
 * Flow around the ring (spec/09 §5): when the slot is more than ORBIT_STEP around the
 * target from us, head for a point on an outer orbit ORBIT_STEP closer to it instead
 * of pushing straight through the attackers already on ring 1.
 */
export const ORBIT_STEP = Math.PI / 4
export const orbit = (
  self: Pos,
  target: Pos,
  slot: Pos,
  targetRadius: number,
  sign: number,
): Pos => {
  const a = Math.atan2(self.z - target.z, self.x - target.x)
  const g = Math.atan2(slot.z - target.z, slot.x - target.x)
  let delta = g - a
  while (delta > Math.PI) delta -= Math.PI * 2
  while (delta < -Math.PI) delta += Math.PI * 2
  if (Math.abs(delta) <= ORBIT_STEP) return slot
  const r = Math.max(
    targetRadius + 1.6,
    Math.min(targetRadius + 2.2, Math.hypot(self.x - target.x, self.z - target.z)),
  )
  // Near the antipode keep the reserved direction; otherwise take the short way.
  const dir = Math.abs(delta) > (Math.PI * 3) / 4 ? sign : Math.sign(delta)
  const next = a + dir * ORBIT_STEP
  return { x: target.x + Math.cos(next) * r, z: target.z + Math.sin(next) * r }
}

/** Micro-range hysteresis (review §9): enter under MICRO_RANGE, leave above +0.5. */
export const isMicro = (wasMicro: boolean, goalDist: number) =>
  goalDist < (wasMicro ? MICRO_RANGE + 0.5 : MICRO_RANGE)

/**
 * Micro steering waypoint: a point up to 1 tile ahead along the context-steered
 * direction (or the goal itself when it is closer and the way is clear).
 * Returns undefined when boxed in (hold this tick).
 */
export const microWaypoint = (
  self: Pos,
  radius: number,
  goal: Pos,
  blockers: readonly Blocker[],
  walkable: (x: number, z: number) => boolean,
): Pos | undefined => {
  const dir = contextSteer(self, radius, goal, blockers, walkable)
  if (!dir) return undefined
  const d = Math.hypot(goal.x - self.x, goal.z - self.z)
  const ux = (goal.x - self.x) / (d || 1)
  const uz = (goal.z - self.z) / (d || 1)
  if (Math.abs(dir.x - ux) < 1e-9 && Math.abs(dir.z - uz) < 1e-9) return goal
  const k = Math.min(1, Math.max(0.4, d))
  return { x: self.x + dir.x * k, z: self.z + dir.z * k }
}
