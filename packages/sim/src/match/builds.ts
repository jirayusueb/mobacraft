// oxlint-disable unicorn/no-thenable -- `then` is rule data (condition → action), not a Promise
/**
 * Builds (spec/07 §4) — conditional itemization as data. A rule is
 * `{ when: Condition[], then: Action, scope }`; `choosePurchase` evaluates the
 * enabled rules in priority order (first match wins) and falls back to the role's
 * build book. Pure: the match supplies a `PurchaseView` and applies the answer.
 */
import { type StrategicTag, hasTag } from "./archetypes.ts"
import type { Role } from "./heroes.ts"
import { lookupItem } from "./inventory.ts"
import { BUILD, MAX_ITEMS } from "./items.ts"

export type Condition =
  | { readonly kind: "enemy-magic-share-above"; readonly share: number }
  | { readonly kind: "enemy-has-tag"; readonly tag: StrategicTag }
  | { readonly kind: "losing-base" }
  | { readonly kind: "net-worth-deficit-above"; readonly gold: number }
  | { readonly kind: "hero-has-tag"; readonly tag: StrategicTag }
  | { readonly kind: "min-core-items"; readonly count: number }
  | { readonly kind: "enemy-initiators-at-least"; readonly count: number }

export type Action =
  /** Buy `item` next — and never buy `before` until `item` is owned. */
  | { readonly kind: "buy-before"; readonly item: string; readonly before: string }
  | { readonly kind: "must-buy"; readonly item: string }
  /** Gamble: buy even though it may be lost (Rapier drops on death). */
  | { readonly kind: "risk-buy"; readonly item: string }

/** Who on the team a rule applies to. `pipe-buyer` = the offlaner, else the support. */
export type Scope = "any" | "carry" | "pipe-buyer"

export interface ItemRule {
  readonly id: string
  /** Short label for the builds dialog, e.g. "Rule 1". */
  readonly label: string
  /** The rule in coach language (IF … THEN …). */
  readonly text: string
  readonly when: readonly Condition[]
  readonly then: Action
  readonly scope: Scope
  /** Built-in rules can't be switched off (e.g. initiators buying Blink). */
  readonly builtIn?: boolean
}

/** Priority order: first match wins. */
export const ITEM_RULES: readonly ItemRule[] = [
  {
    id: "rapier",
    label: "Rule 3",
    text: "IF Losing_Base AND NetWorth_Deficit > 15k THEN Carry risk-buys Divine Rapier",
    when: [{ kind: "losing-base" }, { kind: "net-worth-deficit-above", gold: 15_000 }],
    then: { kind: "risk-buy", item: "rapier" },
    scope: "carry",
  },
  {
    id: "mkb",
    label: "Rule 2",
    text: "IF Enemy_Has_Evasion THEN Carry must buy Monkey King Bar",
    when: [
      { kind: "enemy-has-tag", tag: "evasion" },
      { kind: "min-core-items", count: 1 },
    ],
    then: { kind: "must-buy", item: "mkb" },
    scope: "carry",
  },
  {
    id: "bkb",
    label: "Rule 4",
    text: "IF Enemy has 3+ Initiators THEN Carry buys Black King Bar after 2 core items",
    when: [
      { kind: "enemy-initiators-at-least", count: 3 },
      { kind: "min-core-items", count: 2 },
    ],
    then: { kind: "must-buy", item: "bkb" },
    scope: "carry",
  },
  {
    id: "pipe",
    label: "Rule 1",
    text: "IF Enemy_Magic_Damage > 60% THEN buy Pipe of Insight BEFORE Blink Dagger",
    when: [{ kind: "enemy-magic-share-above", share: 0.6 }],
    then: { kind: "buy-before", item: "pipe", before: "blink" },
    scope: "pipe-buyer",
  },
  {
    id: "blink",
    label: "Initiators",
    text: "Initiators buy Blink Dagger as their second core item",
    when: [
      { kind: "hero-has-tag", tag: "initiator" },
      { kind: "min-core-items", count: 1 },
    ],
    then: { kind: "must-buy", item: "blink" },
    scope: "any",
    builtIn: true,
  },
]

export const ruleById = (id: string) => ITEM_RULES.find((r) => r.id === id)

/** Everything a purchase decision may look at. */
export interface PurchaseView {
  readonly heroId: string
  readonly role: Role
  readonly isCarry: boolean
  readonly isPipeBuyer: boolean
  readonly gold: number
  readonly items: readonly string[]
  /** Cursor into the role's build book (independent of inventory size). */
  readonly bookIndex: number
  readonly enemyHeroIds: readonly string[]
  /** Share (0..1) of the enemy's hero damage that is magic. */
  readonly enemyMagicShare: number
  readonly losingBase: boolean
  /** Enemy team net worth − ours. */
  readonly netWorthDeficit: number
  /** Someone on the team already owns a Pipe (one aura per team counts). */
  readonly teamHasPipe: boolean
  /** Unfamiliar heroes play "by the book": no rules. */
  readonly followsRules: boolean
  readonly enabledRules: ReadonlySet<string>
}

export interface Purchase {
  readonly itemId: string
  /** Item sold first to make room (inventory full). */
  readonly sell?: string
  /** Advance the book cursor (book purchases only). */
  readonly fromBook: boolean
  readonly ruleId?: string
}

const isCore = (id: string) => lookupItem(id).cost >= 1100

const holds = (c: Condition, v: PurchaseView): boolean => {
  switch (c.kind) {
    case "enemy-magic-share-above":
      return v.enemyMagicShare > c.share
    case "enemy-has-tag":
      return v.enemyHeroIds.some((h) => hasTag(h, c.tag))
    case "losing-base":
      return v.losingBase
    case "net-worth-deficit-above":
      return v.netWorthDeficit > c.gold
    case "hero-has-tag":
      return hasTag(v.heroId, c.tag)
    case "min-core-items":
      return v.items.filter(isCore).length >= c.count
    case "enemy-initiators-at-least":
      return v.enemyHeroIds.filter((h) => hasTag(h, "initiator")).length >= c.count
  }
}

const inScope = (r: ItemRule, v: PurchaseView) =>
  r.scope === "any" || (r.scope === "carry" ? v.isCarry : v.isPipeBuyer)

/** The rule that currently wants an item for this hero (ignores gold), if any. */
export const activeRule = (v: PurchaseView): ItemRule | undefined => {
  if (!v.followsRules) return undefined
  for (const r of ITEM_RULES) {
    if (!r.builtIn && !v.enabledRules.has(r.id)) continue
    if (!inScope(r, v)) continue
    if (v.items.includes(r.then.item)) continue
    if (r.then.item === "pipe" && v.teamHasPipe) continue
    if (r.when.every((c) => holds(c, v))) return r
  }
  return undefined
}

/** Items the hero must not buy yet because a buy-before rule is pending. */
const blocked = (v: PurchaseView): ReadonlySet<string> => {
  const r = activeRule(v)
  return r?.then.kind === "buy-before" ? new Set([r.then.before]) : new Set()
}

const makeRoom = (v: PurchaseView): string | undefined | null => {
  if (v.items.length < MAX_ITEMS) return undefined
  // Sell the cheapest item that no rule bought (never sell the rule items themselves).
  const ruleItems = new Set(ITEM_RULES.map((r) => r.then.item))
  const sellable = v.items
    .filter((i) => !ruleItems.has(i))
    .toSorted((a, b) => lookupItem(a).cost - lookupItem(b).cost)
  return sellable[0] ?? null
}

/**
 * Decide the next purchase. Returns null when the hero should keep saving
 * (can't afford the wanted item) or has nothing left to buy.
 */
export const choosePurchase = (v: PurchaseView): Purchase | null => {
  const rule = activeRule(v)
  if (rule) {
    const item = lookupItem(rule.then.item)
    const sell = makeRoom(v)
    if (sell === null) return null
    const refund = sell ? lookupItem(sell).cost / 2 : 0
    if (v.gold + refund < item.cost) return null // save up — the rule outranks the book
    return { itemId: item.id, fromBook: false, ruleId: rule.id, ...(sell ? { sell } : {}) }
  }
  const book = BUILD[v.role]
  const skip = blocked(v)
  const next = book[v.bookIndex]
  if (!next || skip.has(next) || v.items.length >= MAX_ITEMS) return null
  if (v.gold < lookupItem(next).cost) return null
  return { itemId: next, fromBook: true }
}

/** Draft-time estimate of a lineup's magic-damage share (before fight data exists). */
export const draftMagicShare = (heroIds: readonly string[], roleOf: (id: string) => Role) => {
  if (heroIds.length === 0) return 0
  const casters = heroIds.filter((h) => {
    const r = roleOf(h)
    return r === "mid" || r === "support" || hasTag(h, "burst")
  })
  return casters.length / heroIds.length
}
