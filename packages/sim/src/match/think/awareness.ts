/**
 * Hero Think — Layer 1, Self & World Awareness (spec/09). Pure formulas over plain
 * views, every output 0..1. The match builds the views from its own hero and from
 * `TeamKnowledge` (never from live enemy bodies).
 */

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)

/** One owned escape/defence active (BKB, Blink, Force Staff, Eul's). */
export interface DefensiveItem {
  readonly id: string
  readonly ready: boolean
}

export interface SelfView {
  readonly hpPct: number
  readonly manaPct: number
  readonly defensives: readonly DefensiveItem[]
}

/** Readiness when a hero owns no defensive active at all. */
export const NO_DEFENSIVE_READINESS = 0.3

/** S = 0.55·hp + 0.2·mana + 0.25·D (D = ready share of defensive actives). */
export const survivalReadiness = (s: SelfView): number => {
  const d = s.defensives.length
    ? s.defensives.filter((x) => x.ready).length / s.defensives.length
    : NO_DEFENSIVE_READINESS
  return clamp01(0.55 * clamp01(s.hpPct) + 0.2 * clamp01(s.manaPct) + 0.25 * d)
}

/** Damage this hero can put out right now (ready, affordable spells + 3 s of attacks). */
export interface BurstView {
  /** Ability damage of the ultimate if castable now (level, cooldown, mana), else 0. */
  readonly ultDamage: number
  /** Ability damage of the skill if castable now, else 0. */
  readonly skillDamage: number
  /** Basic-attack damage per second. */
  readonly attackDps: number
}

export interface TargetView {
  /** Last-known current hp. */
  readonly hp: number
  /** Fraction of physical damage taken (armour). */
  readonly physicalTaken: number
  /** Fraction of magic damage taken (magic resist). */
  readonly magicTaken: number
}

export const BURST_WINDOW = 3

/** Kill Potential K = burst ÷ effective hp, clamped to 0..1. */
export const killPotential = (me: BurstView, t: TargetView): number => {
  if (t.hp <= 0) return 1
  const magic = (me.ultDamage + me.skillDamage) * t.magicTaken
  const physical = me.attackDps * BURST_WINDOW * t.physicalTaken
  return clamp01((magic + physical) / t.hp)
}

/** Item Timing Delta: gold still missing for the next core item, and how close it is. */
export const itemTiming = (gold: number, nextCost: number | null) => {
  if (nextCost === null || nextCost <= 0) return { delta: 0, closeness: 0 }
  const delta = Math.max(0, nextCost - gold)
  return { delta, closeness: 1 - clamp01(delta / nextCost) }
}
