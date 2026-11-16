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
  | { readonly inReach: true }
  | {
      readonly inReach: false
      readonly goal: Pos
      readonly stopAt: number
      readonly slotted: boolean
    }

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
  if (d <= R) {
    if (ringUser) {
      rings.request(self.id, self, target.id, target, target.radius, R)
      rings.preempt(self.id, self, target.id, target, now, posOf, inReachOf)
    }
    return { inReach: true }
  }
  if (!ringUser || d > RELEASE_AT) rings.release(self.id)
  if (ringUser && d <= RESERVE_AT) {
    const slot = rings.request(self.id, self, target.id, target, target.radius, R)
    const goal = slot ? rings.goalOf(self.id, target) : undefined
    if (goal) return { inReach: false, goal, stopAt: 0.05, slotted: true }
  }
  return { inReach: false, goal: target, stopAt: R * 0.9, slotted: false }
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
