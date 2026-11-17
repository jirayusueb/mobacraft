/**
 * Hero Think — Layer 2, Macro Utility Scoring (spec/09). Five activities (plus the
 * support-only `save`) scored 0..~1 from awareness values, the hero's role weights and
 * strategic tags, then biased — never overridden — by coach calls, IGL calls, phase
 * plans and behaviour sliders. Pure and deterministic.
 */
import type { Role } from "../heroes.ts"
import type { Phase, Plans } from "../tactics.ts"
import { clamp01 } from "./awareness.ts"

export type MacroAction = "farm" | "gank" | "fight" | "objective" | "retreat" | "save"
export const MACRO_ACTIONS: readonly MacroAction[] = [
  "retreat",
  "save",
  "fight",
  "gank",
  "objective",
  "farm",
]
export type ObjectiveMode = "team" | "split" | "roshan" | "defend"

export interface RoleWeights {
  readonly farm: number
  readonly gank: number
  readonly fight: number
  readonly split: number
}
export const ROLE_WEIGHTS: Readonly<Record<Role, RoleWeights>> = {
  carry: { farm: 1, gank: 0.4, fight: 0.6, split: 0.8 },
  mid: { farm: 0.8, gank: 0.8, fight: 0.8, split: 0.5 },
  offlane: { farm: 0.6, gank: 0.65, fight: 0.95, split: 0.4 },
  jungle: { farm: 0.7, gank: 1, fight: 0.8, split: 0.45 },
  support: { farm: 0.25, gank: 0.7, fight: 0.85, split: 0.1 },
}

export interface HeroTraits {
  readonly role: Role
  readonly initiator: boolean
  readonly followUp: boolean
  readonly pusher: boolean
  readonly global: boolean
}

export const roleWeights = (t: HeroTraits): RoleWeights => {
  const w = ROLE_WEIGHTS[t.role]
  return {
    farm: w.farm,
    gank: w.gank * (t.initiator ? 1.2 : 1) * (t.global ? 1.2 : 1),
    fight: w.fight * (t.initiator ? 1.2 : 1) * (t.followUp ? 1.1 : 1),
    split: w.split * (t.pusher ? 1.3 : 1),
  }
}

export interface MacroInput {
  readonly traits: HeroTraits
  readonly phase: Phase
  /** Survival readiness S. */
  readonly survival: number
  readonly hpPct: number
  readonly manaPct: number
  /** Any ability castable now (cooldown + mana). */
  readonly canCast: boolean
  // farm
  /** 1 − danger at the best farm spot, already discounted by distance. */
  readonly farmSafety: number
  readonly itemCloseness: number
  /** powerAt(+10 Dota min) / powerAt(now), clamped [0.8, 1.4]. */
  readonly curveGreed: number
  // gank
  /** Best gank target: kill potential × isolation (0 when none known). */
  readonly gankValue: number
  readonly hasDisable: boolean
  readonly ultReady: boolean
  // fight
  /** Heroes of ours (incl. self) within 30 tiles with a known enemy hero within 9. */
  readonly alliesFighting: number
  /** Local odds 0..1 (our power vs theirs, aggression-adjusted). */
  readonly fightOdds: number
  readonly fightDist: number
  readonly blinkReady: boolean
  // objective
  /** min(1, attack dps × structure mul / 60). */
  readonly pushPower: number
  /** min(1, enemies last known > 35 tiles from the split lane / 4). */
  readonly farSide: number
  /** Allies already on the team objective. */
  readonly alliesOnObjective: number
  // retreat
  readonly nearEnemies: number
  /** Danger at the hero's position. */
  readonly danger: number
  // save (supports)
  readonly saveTarget: boolean
  /** Last chosen action (commitment). */
  readonly current: MacroAction | null
}

export interface Bias {
  readonly mul: Readonly<Partial<Record<MacroAction, number>>>
  readonly add: Readonly<Partial<Record<MacroAction, number>>>
  readonly mode: ObjectiveMode
}

export const COMMITMENT = 0.1

/** Tiles over which a fight's pull halves (spec/09 tuning 2026-11-17). */
export const FIGHT_DECAY = 25
const teamObjectiveBase = (phase: Phase, onObjective: number) =>
  (phase === "laning" ? 0.08 : phase === "mid" ? 0.22 : 0.36) + 0.25 * Math.min(1, onObjective / 3)

/** Raw 0..1 scores before biases. */
export const baseScores = (i: MacroInput, mode: ObjectiveMode): Record<MacroAction, number> => {
  const w = roleWeights(i.traits)
  const farm = clamp01(i.farmSafety) * (0.35 + 0.65 * clamp01(i.itemCloseness)) * w.farm
  const gank = clamp01(i.gankValue) * (i.hasDisable ? 1 : 0.55) * w.gank * (i.ultReady ? 1.4 : 1)
  const readiness =
    (1 + (i.ultReady ? 1 : 0) + (i.canCast ? 1 : 0) + (i.manaPct >= 0.4 ? 1 : 0)) / 4
  const fight =
    ((0.4 + 0.6 * Math.min(1, i.alliesFighting / 2)) *
      readiness *
      clamp01(i.fightOdds) *
      w.fight *
      (i.blinkReady ? 1.3 : 1)) /
    (1 + i.fightDist / FIGHT_DECAY)
  const objective =
    mode === "split"
      ? clamp01(i.pushPower) * clamp01(i.farSide) * w.split
      : mode === "team"
        ? teamObjectiveBase(i.phase, i.alliesOnObjective)
        : 0.55
  const regenNeed = i.hpPct < 0.25 ? 0.85 : i.manaPct < 0.15 && !i.canCast ? 0.6 : 0
  const retreat = Math.max(
    (1 - i.survival) * Math.min(1, 0.5 + i.nearEnemies / 2 + i.danger),
    regenNeed,
  )
  return {
    farm: clamp01(farm * i.curveGreed),
    gank: clamp01(gank),
    fight: clamp01(fight),
    objective: clamp01(objective),
    retreat: clamp01(retreat),
    save: i.saveTarget ? 1 : 0,
  }
}

export interface Decision {
  readonly action: MacroAction
  readonly mode: ObjectiveMode
  readonly scores: Readonly<Record<MacroAction, number>>
}

/** Biased argmax; ties resolve in MACRO_ACTIONS order (retreat first). */
export const decide = (i: MacroInput, bias: Bias): Decision => {
  const base = baseScores(i, bias.mode)
  const scores = {} as Record<MacroAction, number>
  let best: MacroAction = "farm"
  let bestScore = -Infinity
  for (const a of MACRO_ACTIONS) {
    // Emergencies are exempt from multiplier biases: save always, retreat below 25 % hp.
    const exempt = a === "save" || (a === "retreat" && i.hpPct < 0.25)
    let s =
      a === "save" ? base[a] : base[a] * (exempt ? 1 : (bias.mul[a] ?? 1)) + (bias.add[a] ?? 0)
    if (a === i.current && s > 0) s += COMMITMENT
    scores[a] = Math.round(s * 1000) / 1000
    if (scores[a] > bestScore) {
      bestScore = scores[a]
      best = a
    }
  }
  // A save (1.0) outranks everything except a hero that must flee itself.
  if (i.saveTarget && best !== "retreat") best = "save"
  return { action: best, mode: bias.mode, scores }
}

// --- biases ---------------------------------------------------------------------------

export type CoachCallKind = "group" | "roshan" | "push" | "safe" | "farm"
export type IglKind = "gank" | "defend" | "back" | "push" | "group"

export interface BiasInput {
  readonly phase: Phase
  readonly plans: Plans
  /** The coach call this hero follows, if any. */
  readonly coach: CoachCallKind | null
  /** The IGL call this hero follows, if any. */
  readonly igl: IglKind | null
  readonly aggression: number
  readonly farmPriority: number
  readonly slot: string
  /** Highest-net-worth core of the team (split pusher). */
  readonly isCore: boolean
  readonly roshanUp: boolean
  readonly alliesAlive: number
  readonly enemiesDead: number
  /** Past the anti-stall time (defend/farm behave as siege). */
  readonly stall: boolean
}

export const computeBias = (b: BiasInput): Bias => {
  const mul: Partial<Record<MacroAction, number>> = {}
  const add: Partial<Record<MacroAction, number>> = {}
  const m = (a: MacroAction, x: number) => (mul[a] = (mul[a] ?? 1) * x)
  const p = (a: MacroAction, x: number) => (add[a] = (add[a] ?? 0) + x)
  let mode: ObjectiveMode = "team"

  // Sliders.
  const a = b.aggression / 100
  m("gank", 0.7 + 0.6 * a)
  m("fight", 0.7 + 0.6 * a)
  m("retreat", 1.3 - 0.6 * a)
  m("farm", 0.7 + 0.6 * (b.farmPriority / 100))

  // Phase plans.
  if (b.phase === "laning") {
    if (b.plans.laning === "aggressive") m("gank", 1.2)
    if (b.plans.laning === "roam" && (b.slot === "roam" || b.slot === "jungle")) m("gank", 1.4)
    if (b.plans.laning === "scale") {
      m("farm", 1.3)
      p("retreat", 0.05)
    }
    if (b.slot === "roam") {
      m("farm", 0.3)
      m("gank", 1.3)
    }
  } else {
    const plan =
      b.phase === "mid"
        ? b.stall && b.plans.mid === "farm"
          ? "group"
          : b.plans.mid
        : b.stall && b.plans.late === "defend"
          ? "siege"
          : b.plans.late
    switch (plan) {
      case "group":
        m("objective", 1.25)
        break
      case "split":
        if (b.isCore) {
          mode = "split"
          m("objective", 1.6)
        } else m("objective", 1.3)
        break
      case "pickoff":
        m("gank", 1.5)
        break
      case "farm":
        m("farm", 1.5)
        break
      case "siege":
        m("objective", 1.6)
        break
      case "roshan":
        if (b.roshanUp && b.alliesAlive >= 4) {
          mode = "roshan"
          m("objective", 1.6)
        } else m("objective", 1.6)
        break
      case "defend":
        if (b.enemiesDead >= 2) m("objective", 1.8)
        else {
          mode = "defend"
          m("objective", 1.4)
        }
        break
    }
  }

  // IGL call (followers only).
  switch (b.igl) {
    case "gank":
      m("gank", 1.6)
      p("gank", 0.2)
      break
    case "defend":
      mode = "defend"
      m("objective", 1.6)
      p("objective", 0.35)
      break
    case "back":
      p("retreat", 0.4)
      break
    case "push":
    case "group":
      if (mode === "defend" || mode === "split") mode = "team"
      m("objective", 1.6)
      p("objective", 0.35)
      break
  }

  // Coach call (followers only) — strongest bias, still not an override.
  switch (b.coach) {
    case "group":
    case "push":
      mode = "team"
      m("objective", 1.5)
      p("objective", 0.5)
      m("farm", 0.5)
      m("fight", 1.2)
      break
    case "safe":
      p("retreat", 0.25)
      m("gank", 0.5)
      m("fight", 0.8)
      break
    case "farm":
      m("farm", 1.8)
      p("farm", 0.3)
      break
    case "roshan":
      if (b.roshanUp) {
        mode = "roshan"
        m("objective", 2)
        p("objective", 0.5)
      }
      break
  }
  return { mul, add, mode }
}
