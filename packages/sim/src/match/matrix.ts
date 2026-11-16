/**
 * Synergy & Counter Matrix — hero tags are *derived from ability data* so balance
 * patches keep the matrix honest. Pure; no match state.
 */
import { type Ability, HEROES, type HeroDef, heroDef } from "./heroes.ts"

export type HeroTag =
  | "lockdown"
  | "aoe"
  | "burst"
  | "sustain"
  | "protect"
  | "dive"
  | "frontline"
  | "poke"
  | "fragile"
  | "duelist"

export const TAG_LABEL: Readonly<Record<HeroTag, string>> = {
  lockdown: "Lockdown",
  aoe: "AoE",
  burst: "Burst",
  sustain: "Sustain",
  protect: "Protect",
  dive: "Dive",
  frontline: "Frontline",
  poke: "Poke",
  fragile: "Fragile",
  duelist: "Duelist",
}

const effects = (h: HeroDef) => [...h.skill.effects, ...h.ultimate.effects]
const baseDamage = (a: Ability) =>
  a.effects.reduce((s, e) => s + (e.type === "damage" ? e.amount : 0), 0)

const allyTarget = (a: Ability) => a.target.kind === "ally" || a.target.kind === "ally-aoe"

const tagCache = new Map<string, readonly HeroTag[]>()

export const heroTags = (id: string): readonly HeroTag[] => {
  const hit = tagCache.get(id)
  if (hit) return hit
  const h = heroDef(id)
  const fx = effects(h)
  const tags: HeroTag[] = []
  if (fx.some((e) => (e.type === "stun" || e.type === "root") && e.duration >= 1.4))
    tags.push("lockdown")
  const uk = h.ultimate.target.kind
  if (
    (uk === "enemy-aoe" || uk === "self-aoe") &&
    h.ultimate.target.radius >= 3.2 &&
    h.ultimate.effects.some((e) => e.type === "damage" || e.type === "dot")
  )
    tags.push("aoe")
  if (
    baseDamage(h.skill) >= 200 ||
    baseDamage(h.ultimate) >= 200 ||
    fx.some((e) => e.type === "execute")
  )
    tags.push("burst")
  if (fx.some((e) => e.type === "heal" || e.type === "hot" || e.type === "lifesteal"))
    tags.push("sustain")
  if (
    fx.some((e) => e.type === "shield") ||
    [h.skill, h.ultimate].some((a) => allyTarget(a) && a.effects.some((e) => e.type === "buff"))
  )
    tags.push("protect")
  if (fx.some((e) => e.type === "dash")) tags.push("dive")
  if (h.attack === "melee" && h.hp >= 680) tags.push("frontline")
  if (h.attack === "ranged" && fx.some((e) => e.type === "dot" || e.type === "slow"))
    tags.push("poke")
  if (h.attack === "ranged" && h.hp <= 510) tags.push("fragile")
  if (
    fx.some((e) => e.type === "buff" && (e.stat === "attack" || e.stat === "attackSpeed")) &&
    !allyTarget(h.ultimate)
  )
    tags.push("duelist")
  tagCache.set(id, tags)
  return tags
}

interface PairRule {
  readonly a: HeroTag
  readonly b: HeroTag
  readonly score: number
  readonly reason: string
}

/** Symmetric: applies when one ally has `a` and the other has `b` (either order). */
export const SYNERGY_RULES: readonly PairRule[] = [
  { a: "lockdown", b: "aoe", score: 1, reason: "Lockdown sets up AoE" },
  { a: "lockdown", b: "burst", score: 1, reason: "Held targets eat burst" },
  { a: "dive", b: "protect", score: 1, reason: "Shields keep divers alive" },
  { a: "frontline", b: "fragile", score: 1, reason: "Front line shelters the back line" },
  { a: "sustain", b: "frontline", score: 1, reason: "Healing makes the tank last" },
  { a: "poke", b: "lockdown", score: 1, reason: "Slows feed into stuns" },
  { a: "duelist", b: "protect", score: 1, reason: "Protected duelists snowball" },
  { a: "aoe", b: "aoe", score: -1, reason: "Overlapping AoE" },
  { a: "fragile", b: "fragile", score: -1, reason: "Two fragile heroes, no front line" },
]

/** Directional: hero with `a` counters hero with `b`. */
export const COUNTER_RULES: readonly PairRule[] = [
  { a: "lockdown", b: "dive", score: 2, reason: "Stuns stop dives mid-air" },
  { a: "burst", b: "fragile", score: 2, reason: "Burst deletes fragile heroes" },
  { a: "sustain", b: "poke", score: 1, reason: "Healing outlasts poke" },
  { a: "protect", b: "burst", score: 1, reason: "Shields absorb burst" },
  { a: "frontline", b: "dive", score: 1, reason: "Tanks body-block divers" },
  { a: "poke", b: "frontline", score: 1, reason: "Poke whittles the tank" },
  { a: "dive", b: "fragile", score: 1, reason: "Divers reach the back line" },
  { a: "aoe", b: "sustain", score: 1, reason: "AoE overwhelms healing" },
  { a: "duelist", b: "frontline", score: 1, reason: "Duelists shred tanks" },
  { a: "lockdown", b: "duelist", score: 1, reason: "Stuns stop a duelist's rampage" },
]

export interface Reasoned {
  readonly score: number
  readonly reasons: readonly string[]
}

const clamp3 = (n: number) => Math.max(-3, Math.min(3, n))

export const synergyOf = (a: string, b: string): Reasoned => {
  if (a === b) return { score: 0, reasons: [] }
  const ta = heroTags(a)
  const tb = heroTags(b)
  let score = 0
  const reasons: string[] = []
  for (const r of SYNERGY_RULES) {
    const hit =
      (ta.includes(r.a) && tb.includes(r.b)) ||
      (r.a !== r.b && ta.includes(r.b) && tb.includes(r.a))
    if (hit) {
      score += r.score
      reasons.push(r.reason)
    }
  }
  return { score: clamp3(score), reasons }
}

export const counterOf = (a: string, b: string): Reasoned => {
  if (a === b) return { score: 0, reasons: [] }
  const ta = heroTags(a)
  const tb = heroTags(b)
  let score = 0
  const reasons: string[] = []
  for (const r of COUNTER_RULES) {
    if (ta.includes(r.a) && tb.includes(r.b)) {
      score += r.score
      reasons.push(r.reason)
    }
  }
  return { score: clamp3(score), reasons }
}

export const synergy = (a: string, b: string) => synergyOf(a, b).score
export const counter = (a: string, b: string) => counterOf(a, b).score
/** Net edge of `a` over `b`, in [−6, 6]. */
export const matchup = (a: string, b: string) => counter(a, b) - counter(b, a)

/** Σ pair synergy over a team, clamped to [0, 15]. */
export const teamSynergy = (ids: readonly string[]) => {
  let s = 0
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) s += synergy(ids[i]!, ids[j]!)
  return Math.max(0, Math.min(15, s))
}

/** Damage multiplier for hero `a` hitting hero `b`: ±8 % at most. */
export const matchupDamageMul = (a: string, b: string) =>
  1 + 0.04 * Math.max(-2, Math.min(2, matchup(a, b)))

/** Ability power multiplier from team synergy: at most +6 %. */
export const synergyPowerMul = (ids: readonly string[]) => 1 + 0.004 * teamSynergy(ids)

/** Draft helper: how a candidate fits with `allies` and fares against `enemies`. */
export const draftFit = (
  candidate: string,
  allies: readonly string[],
  enemies: readonly string[],
) => {
  const syn = allies.reduce((s, a) => s + synergy(candidate, a), 0)
  const vs = enemies.reduce((s, e) => s + matchup(candidate, e), 0)
  return { synergy: syn, matchup: vs, total: syn + vs }
}

export const ALL_HERO_IDS: readonly string[] = HEROES.map((h) => h.id)
