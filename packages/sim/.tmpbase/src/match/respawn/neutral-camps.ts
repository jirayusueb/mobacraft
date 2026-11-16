/**
 * Neutral camps — spec/12 §4: spawn boxes checked at every :00 from 1:00,
 * stacking, stack-pull planning and sentry-ward block detection.
 */
import type { Vec2 } from "@mobacraft/map"

export const CAMP_FIRST_SPAWN = 60
export const CAMP_PERIOD = 60
export const STACK_WINDOW: readonly [number, number] = [53, 55]
export const DEFAULT_PULL_SECOND = 53.5

export interface SpawnBox {
  readonly minX: number
  readonly minZ: number
  readonly maxX: number
  readonly maxZ: number
}

export const boxAround = (c: Vec2, halfW: number, halfD = halfW): SpawnBox => ({
  minX: c.x - halfW,
  minZ: c.z - halfD,
  maxX: c.x + halfW,
  maxZ: c.z + halfD,
})

export const inBox = (b: SpawnBox, p: Vec2) =>
  p.x >= b.minX && p.x <= b.maxX && p.z >= b.minZ && p.z <= b.maxZ

/** Spawn-check times t = 60k (k ≥ 1) within (prev, now]. */
export const campTicksDue = (prev: number, now: number): number[] => {
  const out: number[] = []
  const first = Math.max(1, Math.floor((prev + 1e-6) / CAMP_PERIOD) + 1)
  for (let k = first; k * CAMP_PERIOD <= now + 1e-6; k++) out.push(k * CAMP_PERIOD)
  return out
}

export type BlockerKind = "hero" | "neutral" | "creep" | "ward"

export interface BoxOccupant {
  readonly id: string
  readonly kind: BlockerKind
  readonly pos: Vec2
}

export interface CampState {
  readonly id: string
  readonly box: SpawnBox
  /** Number of stacked spawns currently alive (0 = empty). */
  stacks: number
  spawnsAttempted: number
  blockedCount: number
}

export const createCamp = (id: string, box: SpawnBox): CampState => ({
  id,
  box,
  stacks: 0,
  spawnsAttempted: 0,
  blockedCount: 0,
})

export interface SpawnResult {
  readonly spawned: boolean
  readonly blockedBy: BlockerKind | null
  readonly blockers: readonly string[]
}

const PRIORITY: readonly BlockerKind[] = ["ward", "hero", "creep", "neutral"]

/** One spawn-box check. Any occupant blocks; reports the most "actionable" blocker kind. */
export const trySpawnCamp = (camp: CampState, occupants: readonly BoxOccupant[]): SpawnResult => {
  camp.spawnsAttempted++
  const inside = occupants.filter((o) => inBox(camp.box, o.pos))
  if (inside.length === 0) {
    camp.stacks++
    return { spawned: true, blockedBy: null, blockers: [] }
  }
  camp.blockedCount++
  const kinds = new Set(inside.map((o) => o.kind))
  return {
    spawned: false,
    blockedBy: PRIORITY.find((k) => kinds.has(k)) ?? null,
    blockers: inside.map((o) => o.id),
  }
}

/** Camp cleared (all neutrals died). */
export const clearCamp = (camp: CampState) => {
  camp.stacks = 0
}

// --- stacking planner ----------------------------------------------------------------

export interface StackPlanInput {
  /** Hero distance to the aggro point (tiles). */
  readonly heroDistance: number
  readonly heroSpeed: number
  /** Distance the creeps must run to clear the box after aggro (tiles). */
  readonly exitDistance: number
  readonly creepSpeed: number
  /** Second in the minute to hit the camp (default 53.5). */
  readonly pullSecond?: number
  /** Ranged attack wind-up before aggro registers. */
  readonly attackPoint?: number
}

export interface StackPlan {
  /** Second in the minute to start walking toward the camp. */
  readonly leaveAt: number
  /** Second the camp is aggroed. */
  readonly aggroAt: number
  /** Second the last creep leaves the box. */
  readonly clearAt: number
  readonly feasible: boolean
}

export const planStack = (p: StackPlanInput): StackPlan => {
  const aggroAt = p.pullSecond ?? DEFAULT_PULL_SECOND
  const windup = p.attackPoint ?? 0.3
  const leaveAt = aggroAt - windup - p.heroDistance / Math.max(0.01, p.heroSpeed)
  const clearAt = aggroAt + p.exitDistance / Math.max(0.01, p.creepSpeed)
  const feasible =
    aggroAt >= STACK_WINDOW[0] && aggroAt <= STACK_WINDOW[1] && clearAt < 60 && leaveAt >= 0
  return { leaveAt, aggroAt, clearAt, feasible }
}

// --- ward block detection ------------------------------------------------------------

export type CampAction =
  | { readonly kind: "deward"; readonly campId: string; readonly buy: "sentry" }
  | { readonly kind: "none" }

export interface CampObservation {
  /** We had vision of the camp box at the :00 check. */
  readonly hadVision: boolean
  /** A fresh spawn (or stack) appeared. */
  readonly campAppeared: boolean
  /** Blockers we could actually see inside the box (our heroes, visible enemies, our wards). */
  readonly visibleBlockers: number
}

/**
 * Fog-safe ward-block inference: the camp failed to spawn at :00 while we
 * watched it and saw nothing in the box → an invisible enemy (sentry) ward is
 * the likely cause → buy a sentry and deward. Never reads authoritative state.
 */
export const suspectBlock = (campId: string, obs: CampObservation): CampAction =>
  obs.hadVision && !obs.campAppeared && obs.visibleBlockers === 0
    ? { kind: "deward", campId, buy: "sentry" }
    : { kind: "none" }
