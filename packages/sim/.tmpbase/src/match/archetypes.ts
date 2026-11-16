/**
 * Hero archetypes (spec/07 §1) — authored strategic data per hero: position fit
 * (Pos 1–5) and flex score, strategic tags with real sim mechanics, the power-spike
 * curve and the two facets each hero can take. Pure data + pure functions.
 *
 * spec/06's matrix tags (lockdown, aoe, …) are *derived* from ability numbers;
 * these strategic tags are *authored*. Both feed the draft analysis.
 */
import { type Role, heroDef } from "./heroes.ts"
import { matchup } from "./matrix.ts"

const heroAttack = (id: string) => {
  try {
    return heroDef(id).attack
  } catch {
    return "melee"
  }
}

/** Our match runs ~2× faster than a Dota game: "Dota minutes" = game minutes × 2. */
export const DOTA_TIME_SCALE = 2
export const dotaMinutes = (gameSeconds: number) => (gameSeconds / 60) * DOTA_TIME_SCALE

export type Position = 1 | 2 | 3 | 4 | 5
export const POSITION_ROLE: Readonly<Record<Position, Role>> = {
  1: "carry",
  2: "mid",
  3: "offlane",
  4: "jungle",
  5: "support",
}
export const ROLE_POSITION: Readonly<Record<Role, Position>> = {
  carry: 1,
  mid: 2,
  offlane: 3,
  jungle: 4,
  support: 5,
}

export type StrategicTag =
  | "burst"
  | "illusion"
  | "aoe-clear"
  | "evasion"
  | "global"
  | "bkb-piercing"
  | "wave-clear"
  | "building-damage"
  | "lane-bully"
  | "initiator"
  | "follow-up"

export const STRATEGIC_TAGS: readonly StrategicTag[] = [
  "burst",
  "illusion",
  "aoe-clear",
  "evasion",
  "global",
  "bkb-piercing",
  "wave-clear",
  "building-damage",
  "lane-bully",
  "initiator",
  "follow-up",
]

export const STRATEGIC_TAG_LABEL: Readonly<Record<StrategicTag, string>> = {
  burst: "Burst",
  illusion: "Illusion",
  "aoe-clear": "AOE Clear",
  evasion: "Evasion",
  global: "Global",
  "bkb-piercing": "BKB-Piercing Disable",
  "wave-clear": "Wave Clear",
  "building-damage": "Building Damage",
  "lane-bully": "Lane Bully",
  initiator: "Initiator",
  "follow-up": "Follow-up",
}

/** One-line player-facing explanation of each tag's mechanic. */
export const STRATEGIC_TAG_HINT: Readonly<Record<StrategicTag, string>> = {
  burst: "+10% ability damage on targets above 70% hp",
  illusion: "Single-target enemy spells sometimes hit an illusion",
  "aoe-clear": "Ignores illusions; +15% damage to Illusion heroes",
  evasion: "20% of basic attacks miss (True Strike pierces)",
  global: "+35% move speed when rotating to the team",
  "bkb-piercing": "Disables ignore Spell Immunity",
  "wave-clear": "Abilities deal ×1.4 to creeps",
  "building-damage": "+20% attack damage to structures",
  "lane-bully": "+1 lane pressure",
  initiator: "Starts combos with a disable",
  "follow-up": "Pays off an ally's disable",
}

export type PowerCurve = "snowball" | "tempo" | "hard-carry" | "late"
export const CURVE_LABEL: Readonly<Record<PowerCurve, string>> = {
  snowball: "Snowball",
  tempo: "Tempo",
  "hard-carry": "Hard Carry",
  late: "Late game",
}

export type FacetKind = "arcane" | "warlord" | "aura" | "bulwark" | "hunter"
export interface Facet {
  readonly kind: FacetKind
  readonly name: string
  readonly hint: string
  readonly abilityMul: number
  readonly attackMul: number
  readonly hpMul: number
  readonly speedMul: number
  /** Allies within 6 tiles: +armor and +hp/s. */
  readonly aura?: { readonly armor: number; readonly regen: number }
  /** Extra damage to heroes below 50 % hp. */
  readonly executeBonus?: number
}

export const FACETS: Readonly<Record<FacetKind, Facet>> = {
  arcane: {
    kind: "arcane",
    name: "Arcane",
    hint: "Spell damage ×1.2, attacks ×0.9",
    abilityMul: 1.2,
    attackMul: 0.9,
    hpMul: 1,
    speedMul: 1,
  },
  warlord: {
    kind: "warlord",
    name: "Warlord",
    hint: "Attacks ×1.15, spell damage ×0.9",
    abilityMul: 0.9,
    attackMul: 1.15,
    hpMul: 1,
    speedMul: 1,
  },
  aura: {
    kind: "aura",
    name: "Aura",
    hint: "Allies nearby +3 armor, +3 hp/s; own spells ×0.85",
    abilityMul: 0.85,
    attackMul: 1,
    hpMul: 1,
    speedMul: 1,
    aura: { armor: 3, regen: 3 },
  },
  bulwark: {
    kind: "bulwark",
    name: "Bulwark",
    hint: "Max hp ×1.12, damage ×0.92",
    abilityMul: 0.92,
    attackMul: 0.92,
    hpMul: 1.12,
    speedMul: 1,
  },
  hunter: {
    kind: "hunter",
    name: "Hunter",
    hint: "+10% speed, +15% vs heroes below 50% hp, hp ×0.94",
    abilityMul: 1,
    attackMul: 1,
    hpMul: 0.94,
    speedMul: 1.1,
    executeBonus: 0.15,
  },
}

export interface Archetype {
  readonly heroId: string
  /** Fit 0..1 per position; absent = can't play it. */
  readonly positions: Readonly<Partial<Record<Position, number>>>
  readonly tags: readonly StrategicTag[]
  readonly curve: PowerCurve
  readonly facets: readonly [FacetKind, FacetKind]
}

const a = (
  heroId: string,
  positions: Partial<Record<Position, number>>,
  curve: PowerCurve,
  facets: [FacetKind, FacetKind],
  tags: StrategicTag[],
): Archetype => ({ heroId, positions, curve, facets, tags })

export const ARCHETYPES: readonly Archetype[] = [
  a("ironwarden", { 3: 1, 5: 0.8, 4: 0.4 }, "tempo", ["bulwark", "aura"], ["initiator"]),
  a(
    "ashbringer",
    { 3: 1, 1: 0.7, 2: 0.4 },
    "tempo",
    ["warlord", "arcane"],
    ["initiator", "aoe-clear", "building-damage", "burst"],
  ),
  a(
    "gravejaw",
    { 3: 1, 5: 0.4 },
    "tempo",
    ["bulwark", "warlord"],
    ["initiator", "bkb-piercing", "lane-bully"],
  ),
  a("thornmaw", { 4: 1, 3: 0.8 }, "tempo", ["bulwark", "aura"], ["initiator", "aoe-clear"]),
  a(
    "hollowfang",
    { 4: 1, 1: 0.8, 3: 0.3 },
    "snowball",
    ["hunter", "warlord"],
    ["evasion", "global"],
  ),
  a(
    "duskblade",
    { 2: 1, 1: 0.7, 4: 0.5 },
    "snowball",
    ["hunter", "arcane"],
    ["burst", "illusion", "follow-up"],
  ),
  a(
    "vexlash",
    { 1: 1, 2: 0.3 },
    "hard-carry",
    ["warlord", "hunter"],
    ["illusion", "building-damage"],
  ),
  a(
    "grimfeather",
    { 1: 1, 2: 0.4 },
    "hard-carry",
    ["warlord", "arcane"],
    ["evasion", "building-damage", "follow-up"],
  ),
  a(
    "ivyshade",
    { 1: 0.9, 5: 0.6, 2: 0.6 },
    "hard-carry",
    ["warlord", "aura"],
    ["wave-clear", "lane-bully", "follow-up"],
  ),
  a(
    "bonecaller",
    { 2: 1, 5: 0.3 },
    "late",
    ["arcane", "bulwark"],
    ["burst", "aoe-clear", "wave-clear", "follow-up"],
  ),
  a(
    "embercall",
    { 2: 1, 5: 0.4 },
    "tempo",
    ["arcane", "hunter"],
    ["burst", "aoe-clear", "wave-clear", "lane-bully", "follow-up"],
  ),
  a(
    "frostveil",
    { 2: 0.9, 5: 0.8, 4: 0.6 },
    "tempo",
    ["arcane", "aura"],
    ["initiator", "wave-clear"],
  ),
  a(
    "stormcaller",
    { 2: 1, 3: 0.7, 5: 0.6 },
    "tempo",
    ["arcane", "bulwark"],
    ["aoe-clear", "wave-clear", "follow-up"],
  ),
  a(
    "voidmother",
    { 2: 0.9, 5: 0.8, 3: 0.6 },
    "tempo",
    ["arcane", "aura"],
    ["initiator", "global", "bkb-piercing"],
  ),
  a("lumenmaid", { 5: 1, 4: 0.3 }, "late", ["aura", "arcane"], ["global"]),
  a("mossmother", { 5: 1, 4: 0.5 }, "late", ["aura", "bulwark"], ["initiator"]),
  a(
    "chainwarden",
    { 5: 1, 3: 0.8, 4: 0.6 },
    "snowball",
    ["bulwark", "hunter"],
    ["initiator", "bkb-piercing", "lane-bully"],
  ),
  a(
    "hexweaver",
    { 5: 1, 2: 0.7, 3: 0.3 },
    "tempo",
    ["arcane", "aura"],
    ["initiator", "lane-bully"],
  ),
  a(
    "rootfather",
    { 4: 1, 5: 0.8, 3: 0.6 },
    "late",
    ["bulwark", "aura"],
    ["initiator", "global", "building-damage"],
  ),
  a(
    "goreclaw",
    { 4: 1, 3: 0.8, 1: 0.4 },
    "snowball",
    ["hunter", "warlord"],
    ["global", "building-damage"],
  ),
]

const NEUTRAL: Omit<Archetype, "heroId"> = {
  positions: {},
  tags: [],
  curve: "tempo",
  facets: ["warlord", "arcane"],
}

const BY_ID: ReadonlyMap<string, Archetype> = new Map(ARCHETYPES.map((x) => [x.heroId, x]))

/** Archetype for a hero; unknown heroes get a neutral archetype (never throws). */
export const archetypeOf = (heroId: string): Archetype =>
  BY_ID.get(heroId) ?? { heroId, ...NEUTRAL }

export const hasTag = (heroId: string, tag: StrategicTag) => archetypeOf(heroId).tags.includes(tag)

/** Positions this hero plays at ≥ 0.6 fit. */
export const flexPositions = (heroId: string): readonly Position[] =>
  ([1, 2, 3, 4, 5] as const).filter((p) => (archetypeOf(heroId).positions[p] ?? 0) >= 0.6)

/** Flex score = number of positions played at ≥ 0.6 fit (1..5). */
export const flexScore = (heroId: string) => flexPositions(heroId).length

export const positionFit = (heroId: string, role: Role) =>
  archetypeOf(heroId).positions[ROLE_POSITION[role]] ?? 0

/** Items costing at least this much count as "core" for the power curve (i.e. not boots). */
export const CORE_ITEM_COST = 1100

const CURVE_TABLE: Readonly<Record<PowerCurve, readonly [number, number, number]>> = {
  snowball: [1.15, 1, 0.85],
  tempo: [1.05, 1.05, 0.95],
  "hard-carry": [0.82, 0.95, 1],
  late: [0.92, 1, 1.1],
}

/**
 * Damage / ability-power multiplier from the hero's power curve at `gameSeconds`,
 * given the number of finished core items. Bands are in Dota minutes: 0–15, 15–35, 35+.
 */
export const powerAt = (heroId: string, gameSeconds: number, coreItems: number) => {
  const curve = archetypeOf(heroId).curve
  const m = dotaMinutes(gameSeconds)
  const row = CURVE_TABLE[curve]
  const base = m < 15 ? row[0] : m < 35 ? row[1] : row[2]
  if (curve !== "hard-carry") return base
  return base * (coreItems >= 3 ? 1.3 : coreItems >= 2 ? 1.1 : 1)
}

/** Sampled curve for sparklines: power at 0..maxDotaMin (core items assumed by time). */
export const curveSamples = (heroId: string, steps = 12, maxDotaMin = 50) =>
  Array.from({ length: steps + 1 }, (_, i) => {
    const dm = (i / steps) * maxDotaMin
    const items = dm < 18 ? 0 : dm < 26 ? 1 : dm < 34 ? 2 : 3
    return { dotaMin: dm, power: powerAt(heroId, (dm / DOTA_TIME_SCALE) * 60, items) }
  })

// --- tag counters (spec/07 §3a) -------------------------------------------------------

interface TagRule {
  readonly a: StrategicTag
  readonly b: StrategicTag
  readonly score: number
  readonly reason: string
}

export const TAG_COUNTER_RULES: readonly TagRule[] = [
  { a: "aoe-clear", b: "illusion", score: 2, reason: "AoE clears illusions" },
  { a: "wave-clear", b: "building-damage", score: 1, reason: "Wave clear stalls pushes" },
  { a: "global", b: "lane-bully", score: 1, reason: "Rotations punish greedy lanes" },
  { a: "burst", b: "evasion", score: 1, reason: "Spells ignore evasion" },
]

/** Directional strategic-tag counter of `a` over `b` (with reasons). */
export const tagCounterOf = (hero: string, foe: string) => {
  const ta = archetypeOf(hero).tags
  const tb = archetypeOf(foe).tags
  let score = 0
  const reasons: string[] = []
  for (const r of TAG_COUNTER_RULES)
    if (ta.includes(r.a) && tb.includes(r.b)) {
      score += r.score
      reasons.push(r.reason)
    }
  return { score, reasons }
}

/** Net strategic-tag edge of `a` over `b`. */
export const tagMatchup = (hero: string, foe: string) =>
  tagCounterOf(hero, foe).score - tagCounterOf(foe, hero).score

/** Team-level teamfight bonus: enemy has ≥2 Illusion heroes and we have AOE Clear → +5 %. */
export const illusionAnswerMul = (ours: readonly string[], theirs: readonly string[]) =>
  theirs.filter((h) => hasTag(h, "illusion")).length >= 2 &&
  ours.some((h) => hasTag(h, "aoe-clear"))
    ? 1.05
    : 1

// --- lane matchup (spec/07 §3b) --------------------------------------------------------

const laneUnit = (heroId: string, foes: readonly string[]) => {
  const ranged = heroAttack(heroId) === "ranged" ? 1 : 0
  const bully = hasTag(heroId, "lane-bully") ? 1 : 0
  const vs = foes.length ? foes.reduce((s, f) => s + matchup(heroId, f), 0) / foes.length : 0
  return ranged + bully + vs / 2
}

/**
 * Lane advantage of `us` over `them` in one lane, clamped to [−3, 3]. Uses per-hero
 * averages so a duo lane doesn't win on headcount alone; `skillDiff` = avg player skill
 * difference (ours − theirs). An empty enemy lane is a free farm lane (+1).
 */
const avgVs = (xs: readonly string[], foes: readonly string[]) =>
  xs.reduce((s, h) => s + laneUnit(h, foes), 0) / xs.length

export const laneScore = (us: readonly string[], them: readonly string[], skillDiff = 0) => {
  if (us.length === 0) return 0
  if (them.length === 0) return 1
  const raw = avgVs(us, them) - avgVs(them, us) + skillDiff / 5
  return Math.max(-3, Math.min(3, Math.round(raw * 10) / 10))
}

export const LANE_LABEL = (score: number) =>
  score >= 1 ? "Favoured" : score <= -1 ? "Unfavoured" : "Even"
