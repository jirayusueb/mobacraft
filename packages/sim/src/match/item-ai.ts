/**
 * Dynamic itemization AI (spec/10 layer 3, slice S4).
 *
 * Order of authority for "what do I buy next":
 *   1. Hard rule override — spec/07 `ITEM_RULES` via `activeRule` (first match
 *      wins, unchanged semantics). If a rule fires, its item is the answer.
 *   2. Core skeleton — the first SKELETON_LEN items of the build book are
 *      bought in order (sane early game).
 *   3. Threat-response scoring — remaining candidates (rest of the book +
 *      counter items) are scored against the team's *visible* threat profile
 *      (refreshed every THREAT_SCAN_S by the match). argmax with a
 *      (score, lower cost, id) tiebreak. No RNG.
 *
 * The buyback reserve (gold floor) is a separate pure check the match applies
 * before spending.
 */
import { type StrategicTag, hasTag } from "./archetypes.ts"
import { type PurchaseView, activeRule } from "./builds.ts"
import type { Role } from "./heroes.ts"
import { type ItemTag, itemById } from "./items.ts"

export const SKELETON_LEN = 2
export const THREAT_SCAN_S = 120
/** Game minutes after which every hero keeps a buyback reserve. */
export const BUYBACK_RESERVE_MIN = 15

/** What one team can see of the other (only visible data feeds it). */
export interface ThreatProfile {
  /** Enemy heroes with evasion (tag or Butterfly-like items seen). */
  readonly evasion: number
  /** Enemy heroes with heavy disable / initiation. */
  readonly disablers: number
  /** Share 0..1 of enemy damage that is magic. */
  readonly magicShare: number
  /** Enemy divers (burst + global / gankers) that punish supports. */
  readonly divers: number
  /** Enemy item tags seen in the last scan (e.g. "spellImmunity"). */
  readonly itemTags: ReadonlySet<ItemTag>
}

export const NO_THREAT: ThreatProfile = {
  evasion: 0,
  disablers: 0,
  magicShare: 0,
  divers: 0,
  itemTags: new Set(),
}

/** Build a profile from the enemy heroes the team has seen and their seen items. */
export const scanThreats = (
  seen: readonly { readonly heroId: string; readonly items: readonly string[] }[],
  magicShare: number,
): ThreatProfile => {
  const tagged = (t: StrategicTag) => seen.filter((e) => hasTag(e.heroId, t)).length
  const itemTags = new Set<ItemTag>()
  for (const e of seen)
    for (const id of e.items) {
      if (id.startsWith("n-")) continue
      for (const t of itemById(id).tags) itemTags.add(t)
    }
  return {
    evasion: tagged("evasion") + (itemTags.has("evasion") ? 1 : 0),
    disablers: tagged("initiator") + tagged("bkb-piercing"),
    magicShare,
    // Divers punish supports (Riki/Slark-style): burst or global pickoff heroes.
    divers: seen.filter((e) => hasTag(e.heroId, "burst") || hasTag(e.heroId, "global")).length,
    itemTags,
  }
}

/** Counter items the scorer may add on top of the book. */
export const COUNTER_ITEMS: readonly string[] = [
  "mkb",
  "bkb",
  "force",
  "eul",
  "manta",
  "glimmer",
  "nullstone",
  "pipe",
]

const ROLE_WEIGHT: Readonly<Record<Role, Partial<Record<string, number>>>> = {
  carry: { mkb: 1, bkb: 1, eul: 0.2, force: 0.1, manta: 0.8, nullstone: 0.4, pipe: 0 },
  mid: { mkb: 0.3, bkb: 0.8, eul: 1, force: 0.4, nullstone: 0.6, pipe: 0.1 },
  offlane: { mkb: 0.2, bkb: 0.7, eul: 0.3, force: 0.4, nullstone: 0.8, pipe: 1 },
  jungle: { mkb: 0.6, bkb: 0.8, eul: 0.3, force: 0.3, manta: 0.5, nullstone: 0.6, pipe: 0.4 },
  support: { mkb: 0, bkb: 0.2, eul: 0.6, force: 1, glimmer: 0.9, nullstone: 0.5, pipe: 0.6 },
}

/** Threat-response term for one candidate item (spec/10 layer 3 examples). */
export const threatScore = (itemId: string, role: Role, th: ThreatProfile): number => {
  const w = ROLE_WEIGHT[role][itemId] ?? 0
  switch (itemId) {
    case "mkb":
      return w * th.evasion * 60
    case "bkb":
      return w * (th.disablers * 25 + th.magicShare * 60)
    case "force":
    case "glimmer":
    case "eul":
      return w * th.divers * 45
    case "manta":
      // Dispels roots/silences: wanted vs disablers, ranked below BKB.
      return w * th.disablers * 18
    case "nullstone":
      return w * th.magicShare * 50
    case "pipe":
      return w * th.magicShare * 70
    default:
      return 0
  }
}

export interface ItemChoice {
  readonly id: string
  /** Why: "rule:<id>" | "skeleton" | "book" | "threat". */
  readonly reason: string
  readonly fromBook: boolean
}

/**
 * Decide the next item. `book` is the hero's build preset; `owned` every item
 * across zones (components count toward nothing here — the match buys pieces).
 */
export const chooseItem = (
  v: PurchaseView,
  book: readonly string[],
  th: ThreatProfile,
): ItemChoice | null => {
  // 1. Hard override: spec/07 rules, first match wins.
  const rule = activeRule(v)
  if (rule) return { id: rule.then.item, reason: `rule:${rule.id}`, fromBook: false }
  // 2. Skeleton.
  const next = book[v.bookIndex]
  if (v.bookIndex < SKELETON_LEN)
    return next ? { id: next, reason: "skeleton", fromBook: true } : null
  // 3. Scoring: the next book item vs counters not yet owned.
  const cands: { id: string; score: number; fromBook: boolean }[] = []
  if (next) cands.push({ id: next, score: 40, fromBook: true })
  for (const id of COUNTER_ITEMS) {
    if (v.items.includes(id)) continue
    if (id === "pipe" && v.teamHasPipe) continue
    const s = threatScore(id, v.role, th)
    if (s > 0) cands.push({ id, score: s, fromBook: false })
  }
  if (cands.length === 0) return null
  const best = cands.toSorted(
    (a, b) =>
      b.score - a.score || itemById(a.id).cost - itemById(b.id).cost || (a.id < b.id ? -1 : 1),
  )[0]!
  return { id: best.id, reason: best.fromBook ? "book" : "threat", fromBook: best.fromBook }
}

/** Simplified buyback cost (spec/10 layer 3): 150 + 25·level gold. */
export const buybackCost = (level: number): number => 150 + 25 * level

/**
 * Gold that must stay unspent. Zero until 15 game-min or a Tier-3 tower of
 * ours has fallen; rule items (hard override) ignore the floor.
 */
export const goldFloor = (
  level: number,
  gameMinutes: number,
  lostTier3: boolean,
  ruleItem: boolean,
): number =>
  ruleItem || (gameMinutes < BUYBACK_RESERVE_MIN && !lostTier3) ? 0 : buybackCost(level)

// --- spec/10 layer 5: comeback gold + late-game slot management (S6) -------------

/** Comeback bounty cap per kill (gold, split among killer + assists). */
export const COMEBACK_CAP = 150
/** Net-worth gap below which no comeback bounty is paid. */
export const COMEBACK_MIN_GAP = 5000
export const COMEBACK_RATE = 0.05

/**
 * Bonus for killing a hero of the richer team (spec/10 layer 5, tuned by the
 * S6 balance re-gate): `clamp(0.05 × gap, 0, 150)` once the gap is ≥ 5k,
 * split evenly among the killer and assisters (floored, deterministic).
 */
export const comebackShare = (killerSideNW: number, victimSideNW: number, shares: number) => {
  const gap = victimSideNW - killerSideNW
  const pot = gap < COMEBACK_MIN_GAP ? 0 : Math.min(COMEBACK_CAP, COMEBACK_RATE * gap)
  return shares > 0 ? Math.floor(pot / shares) : 0
}

/** Luxury upgrades once the six slots are full (t ≥ LATE_GAME_MIN). */
export const LATE_GAME_MIN = 20
export const LUXURY_ITEMS: readonly string[] = ["rapier", "mkb", "bkb", "heart"]
/** Slot-free permanent buffs (consumed on purchase; stats live on the hero). */
export const CONSUMABLE_BUFFS = {
  "aghs-blessing": { cost: 4200, power: 0.2, hp: 200 },
  "moon-shard": { cost: 4000, attackSpeed: 0.3 },
} as const
export type ConsumableBuff = keyof typeof CONSUMABLE_BUFFS

export type LateAction =
  | { readonly kind: "sell-and-buy"; readonly sell: string; readonly buy: string }
  | { readonly kind: "consume"; readonly buff: ConsumableBuff }

/**
 * Late-game slot decision (spec/10 layer 5). Only when main is full and the
 * hero is rich: sell the weakest item (unified sell order) for half price to
 * fund a luxury item it doesn't own; else eat a slot-free buff it hasn't had.
 * `floor` is the buyback reserve that must survive the purchase.
 */
export const lateGameAction = (o: {
  readonly gameMinutes: number
  readonly main: readonly (string | null)[]
  readonly gold: number
  readonly floor: number
  readonly consumed: ReadonlySet<ConsumableBuff>
}): LateAction | null => {
  if (o.gameMinutes < LATE_GAME_MIN || o.main.includes(null)) return null
  const owned = o.main.filter((x): x is string => x !== null && !x.startsWith("n-"))
  const sellOrder = owned.toSorted(
    (a, b) => sellRank(a) - sellRank(b) || itemById(a).cost - itemById(b).cost || (a < b ? -1 : 1),
  )
  const weakest = sellOrder[0]
  if (weakest && itemById(weakest).tier <= 2) {
    const refund = Math.floor(itemById(weakest).cost / 2)
    for (const lux of LUXURY_ITEMS) {
      if (owned.includes(lux)) continue
      if (o.gold + refund - itemById(lux).cost >= o.floor)
        return { kind: "sell-and-buy", sell: weakest, buy: lux }
    }
  }
  for (const buff of Object.keys(CONSUMABLE_BUFFS) as ConsumableBuff[]) {
    if (o.consumed.has(buff)) continue
    if (o.gold - CONSUMABLE_BUFFS[buff].cost >= o.floor) return { kind: "consume", buff }
  }
  return null
}

const sellRank = (id: string) => {
  const it = itemById(id)
  return it.tags.includes("consumable") ? 0 : it.tier
}
