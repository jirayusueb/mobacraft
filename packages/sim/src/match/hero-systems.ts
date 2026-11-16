/**
 * Hero systems runtime (spec/07) — the one object the match consults for everything
 * archetype-, mastery-, lane-, combo- and build-driven. The match keeps physics,
 * targeting and economy; this module owns the *rules*, so `match.ts` only calls hooks.
 *
 * Determinism: its own random stream (`seed ^ STREAM`), never the match's, so a match
 * with neutral hero systems draws the same main-stream numbers as before.
 *
 * Interface (all keyed by the match's hero body id):
 *   statMods(key)                         facet hp/attack/speed multipliers
 *   damageMul(q)                          combined, clamped damage multiplier
 *   attackHits(src, dst, trueStrike)      Evasion vs True Strike
 *   spellLands(src, dst, q)               "hit" | "illusion" | "clutch"
 *   disableBlocked(src, dst, t)           Spell Immunity vs BKB-Piercing
 *   castDelay(key) · mispositionShift(key, t, sense)
 *   setLanes(lanes, skill) · laneGoldMul(key, t) · zonedOut(key, t) · laneAdvantage(key)
 *   moveMul(key, intent, goalDist) · aura(key)
 *   observe(key, t, enemyNear, items)     fight-start detection → BKB
 *   blinkReach(key, t, items)             Blink Dagger engage range
 *   combo(init, follow, t, followHasDisable)
 *   purchase(view) · onDeath(key, items)
 *   events()                              drained feed lines
 */
import {
  type Facet,
  FACETS,
  type FacetKind,
  dotaMinutes,
  hasTag,
  laneScore,
  powerAt,
} from "./archetypes.ts"
import { type Purchase, type PurchaseView, choosePurchase, ruleById } from "./builds.ts"
import { type MasteryTier, tierOf } from "./career.ts"
import type { DraftSide } from "./draft.ts"
import type { Role } from "./heroes.ts"
import { itemById } from "./items.ts"
import { createRandom } from "./random.ts"

const inLaning = (t: number) => dotaMinutes(t) < 15
const STREAM = 0x9e3779b9

export interface HeroEntry {
  readonly key: string
  readonly heroId: string
  readonly playerId: string
  readonly playerName: string
  readonly side: DraftSide
  readonly role: Role
  readonly mastery: number
  /** Teamwork / communication 1..20. */
  readonly teamwork: number
  readonly facet: FacetKind
}

export interface HeroSystemsOptions {
  readonly seed: number
  readonly heroes: readonly HeroEntry[]
  /** Pair chemistry −1..1 by player ids. */
  readonly chemistry?: (a: string, b: string) => number
  /** Enabled optional item rules per side (built-in rules are always on). */
  readonly rules?: Partial<Record<DraftSide, readonly string[]>>
}

export type HeroEventKind = "clutch" | "combo" | "overlap" | "rule" | "zone" | "rapier"
export interface HeroEvent {
  readonly t: number
  readonly kind: HeroEventKind
  readonly side: DraftSide
  readonly text: string
}

export interface DamageQuery {
  readonly src: string
  /** Hero key of the target, or undefined for non-heroes. */
  readonly dst?: string
  readonly dstType: "hero" | "creep" | "neutral" | "structure" | "roshan"
  readonly dstHpPct: number
  readonly kind: "attack" | "ability"
  readonly t: number
  readonly srcCoreItems: number
  /** Set when the cast is a combo follow-up. */
  readonly combo?: boolean
}

export type SpellOutcome = "hit" | "illusion" | "clutch"

/** Per-tier sim effects (spec/07 §2). */
export const TIER_EFFECT: Readonly<
  Record<
    MasteryTier,
    {
      readonly castDelay: number
      readonly followsRules: boolean
      readonly misposition: number
      readonly bonus: number
    }
  >
> = {
  unfamiliar: { castDelay: 0.6, followsRules: false, misposition: 0.1, bonus: 0 },
  playable: { castDelay: 0.25, followsRules: true, misposition: 0, bonus: 0 },
  comfortable: { castDelay: 0, followsRules: true, misposition: 0, bonus: 0 },
  signature: { castDelay: 0, followsRules: true, misposition: 0, bonus: 0.08 },
}

export const ALL_RULES_ON: readonly string[] = ["rapier", "mkb", "bkb", "pipe"]

export const MUL_MIN = 0.75
export const MUL_MAX = 1.35
const clampMul = (x: number) => Math.max(MUL_MIN, Math.min(MUL_MAX, x))

export const createHeroSystems = (o: HeroSystemsOptions) => {
  const rng = createRandom((o.seed ^ STREAM) >>> 0)
  const by = new Map(o.heroes.map((h) => [h.key, h]))
  const get = (k: string) => by.get(k)
  const chem = o.chemistry ?? (() => 0)
  const rules: Record<DraftSide, ReadonlySet<string>> = {
    blue: new Set(o.rules?.blue ?? ALL_RULES_ON),
    red: new Set(o.rules?.red ?? ALL_RULES_ON),
  }
  const events: HeroEvent[] = []
  const emit = (e: HeroEvent) => events.push(e)

  const tier = (k: string): MasteryTier => tierOf(get(k)?.mastery ?? 0.35)
  const facetOf = (k: string): Facet => FACETS[get(k)?.facet ?? "warlord"]

  // --- clutch / immunity / blink / misposition state ------------------------------------
  const lastClutch = new Map<string, number>()
  const immuneUntil = new Map<string, number>()
  const bkbReady = new Map<string, number>()
  const lastEnemyNear = new Map<string, number>()
  const blinkReady = new Map<string, number>()
  const mispos = new Map<string, { until: number; nextRoll: number }>()
  const comboPairCd = new Map<string, number>()
  const ruleLogged = new Set<string>()

  // --- lanes ----------------------------------------------------------------------------
  const laneAdv = new Map<string, number>()
  const zoneLogged = new Set<string>()

  /**
   * Fix lane matchups from the lanes actually played (called once, ~1:00 game time).
   * `lanes`: hero key → global lane id (top/mid/bot) or null for jungle/roam.
   */
  const setLanes = (
    lanes: ReadonlyMap<string, string | null>,
    skillOf: (key: string) => number,
  ) => {
    laneAdv.clear()
    const groups = new Map<string, { blue: string[]; red: string[] }>()
    for (const [k, lane] of lanes) {
      const h = get(k)
      if (!h || !lane) continue
      const g = groups.get(lane) ?? { blue: [], red: [] }
      g[h.side].push(k)
      groups.set(lane, g)
    }
    for (const g of groups.values()) {
      for (const side of ["blue", "red"] as const) {
        const us = g[side]
        const them = g[side === "blue" ? "red" : "blue"]
        if (us.length === 0) continue
        const score = laneScore(
          us.map((k) => get(k)!.heroId),
          them.map((k) => get(k)!.heroId),
          us.reduce((s, k) => s + skillOf(k), 0) / us.length -
            (them.length ? them.reduce((s, k) => s + skillOf(k), 0) / them.length : 10),
        )
        // The only defender of a lane is never zoned below −2 (spec/07 resolutions).
        for (const k of us) laneAdv.set(k, us.length === 1 ? Math.max(-2, score) : score)
      }
    }
  }

  const laneGoldMul = (k: string, t: number) => {
    const a = laneAdv.get(k) ?? 0
    if (!inLaning(t) || a > -1) return 1
    return Math.max(0.5, 1 - 0.12 * Math.abs(a))
  }

  const zonedOut = (k: string, t: number) => {
    const a = laneAdv.get(k) ?? 0
    const out = inLaning(t) && t >= 120 && a <= -2.5
    if (out && !zoneLogged.has(k)) {
      zoneLogged.add(k)
      const h = get(k)!
      emit({
        t,
        kind: "zone",
        side: h.side,
        text: `${h.playerName} is zoned out of lane and retreats to the jungle`,
      })
    }
    return out
  }

  // --- damage ---------------------------------------------------------------------------
  const damageMul = (q: DamageQuery) => {
    const src = get(q.src)
    if (!src) return 1
    const f = facetOf(q.src)
    let bonus = 0
    bonus += powerAt(src.heroId, q.t, q.srcCoreItems) - 1
    bonus += (q.kind === "ability" ? f.abilityMul : f.attackMul) - 1
    bonus += TIER_EFFECT[tier(q.src)].bonus
    if (q.combo) bonus += 0.2
    if (q.dstType === "hero" && q.dst) {
      const dst = get(q.dst)
      if (q.kind === "ability" && hasTag(src.heroId, "burst") && q.dstHpPct > 0.7) bonus += 0.1
      if (dst && hasTag(src.heroId, "aoe-clear") && hasTag(dst.heroId, "illusion")) bonus += 0.15
      if (f.executeBonus && q.dstHpPct < 0.5) bonus += f.executeBonus
    }
    let mul = clampMul(1 + bonus)
    // Situational multipliers vs non-heroes sit outside the clamp.
    if (q.kind === "ability" && (q.dstType === "creep" || q.dstType === "neutral"))
      mul *= hasTag(src.heroId, "wave-clear") ? 1.4 : 1
    if (q.kind === "attack" && q.dstType === "structure")
      mul *= hasTag(src.heroId, "building-damage") ? 1.2 : 1
    return mul
  }

  const statMods = (k: string) => {
    const f = facetOf(k)
    return { hpMul: f.hpMul, speedMul: f.speedMul }
  }

  const attackHits = (src: string | undefined, dst: string | undefined, trueStrike: boolean) => {
    if (!dst || trueStrike) return true
    const d = get(dst)
    if (!d || !hasTag(d.heroId, "evasion")) return true
    void src
    return !rng.chance(0.2)
  }

  /** Does a single-target / any spell actually land on hero `dst`? */
  const spellLands = (
    src: string,
    dst: string,
    q: { readonly singleTarget: boolean; readonly t: number; readonly threatening: boolean },
  ): SpellOutcome => {
    const s = get(src)
    const d = get(dst)
    if (!s || !d) return "hit"
    if (q.singleTarget && hasTag(d.heroId, "illusion") && !hasTag(s.heroId, "aoe-clear")) {
      if (rng.chance(0.25)) return "illusion"
    }
    if (q.threatening && tier(dst) === "signature") {
      const last = lastClutch.get(dst) ?? -99
      if (q.t - last >= 20 && rng.chance(0.3)) {
        lastClutch.set(dst, q.t)
        emit({
          t: q.t,
          kind: "clutch",
          side: d.side,
          text: `Clutch! ${d.playerName} dodges ${s.playerName}'s spell`,
        })
        return "clutch"
      }
    }
    return "hit"
  }

  /** Spell Immunity (BKB) blocks disables unless the caster's are BKB-Piercing. */
  const disableBlocked = (src: string, dst: string, t: number) => {
    const s = get(src)
    if (!s || hasTag(s.heroId, "bkb-piercing")) return false
    return (immuneUntil.get(dst) ?? -1) > t
  }
  const isImmune = (k: string, t: number) => (immuneUntil.get(k) ?? -1) > t

  /** Feed every hero's fight state (~2×/s): an enemy within 7 tiles after 10 s calm = fight start. */
  const observe = (k: string, t: number, enemyNear: boolean, items: readonly string[]) => {
    if (!enemyNear) return
    const calm = t - (lastEnemyNear.get(k) ?? -99) >= 10
    lastEnemyNear.set(k, t)
    if (calm && items.includes("bkb") && (bkbReady.get(k) ?? 0) <= t) {
      immuneUntil.set(k, t + 6)
      bkbReady.set(k, t + 60)
    }
  }

  /** Engage range from Blink Dagger: 10 tiles once per 12 s. Consumes the charge. */
  const blinkReach = (k: string, t: number, items: readonly string[], consume: boolean) => {
    if (!items.includes("blink") || (blinkReady.get(k) ?? 0) > t) return 0
    if (consume) blinkReady.set(k, t + 12)
    return 10
  }

  const castDelay = (k: string) => TIER_EFFECT[tier(k)].castDelay

  /** Lane-goal shift (tiles toward the enemy) while mispositioned; rolled every 10 s. */
  const mispositionShift = (k: string, t: number, sense: number) => {
    const chance = TIER_EFFECT[tier(k)].misposition * (1 - sense / 20)
    if (chance <= 0) return 0
    const m = mispos.get(k) ?? { until: -1, nextRoll: 0 }
    if (t >= m.nextRoll) {
      m.nextRoll = t + 10
      if (rng.chance(chance)) m.until = t + 3
      mispos.set(k, m)
    }
    return t < m.until ? 3 : 0
  }

  const moveMul = (k: string, intent: string, goalDist: number) => {
    const h = get(k)
    if (!h || !hasTag(h.heroId, "global")) return 1
    return (intent === "group" || intent === "push" || intent === "roshan" || intent === "fight") &&
      goalDist > 15
      ? 1.35
      : 1
  }

  const aura = (k: string) => facetOf(k).aura

  // --- combos ---------------------------------------------------------------------------
  const sync = (a: HeroEntry, b: HeroEntry) =>
    Math.max(
      0.05,
      Math.min(
        0.95,
        0.35 + (0.35 * (a.teamwork + b.teamwork)) / 40 + 0.3 * chem(a.playerId, b.playerId),
      ),
    )

  /**
   * An Initiator landed a disable; should Follow-up `follow` react?
   * Returns null when the pair isn't a combo pair or is on its 10 s cooldown.
   */
  const combo = (
    init: string,
    follow: string,
    t: number,
    followHasDisable: boolean,
  ): "combo" | "overlap" | "late" | null => {
    const a = get(init)
    const b = get(follow)
    if (!a || !b || a.side !== b.side || a === b) return null
    if (!hasTag(a.heroId, "initiator") || !hasTag(b.heroId, "follow-up")) return null
    const key = `${init}|${follow}`
    if ((comboPairCd.get(key) ?? -99) > t) return null
    comboPairCd.set(key, t + 10)
    const s = sync(a, b)
    if (rng.chance(s)) {
      emit({
        t,
        kind: "combo",
        side: a.side,
        text: `Combo! ${a.playerName} → ${b.playerName}`,
      })
      return "combo"
    }
    if (followHasDisable && chem(a.playerId, b.playerId) < 0 && rng.chance(0.5)) {
      emit({
        t,
        kind: "overlap",
        side: a.side,
        text: `Spells overlapped — ${a.playerName} & ${b.playerName} aren't talking`,
      })
      return "overlap"
    }
    return "late"
  }

  // --- items ----------------------------------------------------------------------------
  type PurchaseInput = Omit<PurchaseView, "followsRules" | "enabledRules" | "heroId" | "role">
  const purchase = (k: string, v: PurchaseInput, t: number): Purchase | null => {
    const h = get(k)
    if (!h) return null
    const p = choosePurchase({
      ...v,
      heroId: h.heroId,
      role: h.role,
      followsRules: TIER_EFFECT[tier(k)].followsRules,
      enabledRules: rules[h.side],
    })
    if (p?.ruleId && !ruleLogged.has(`${k}:${p.ruleId}`)) {
      ruleLogged.add(`${k}:${p.ruleId}`)
      const r = ruleById(p.ruleId)
      emit({
        t,
        kind: "rule",
        side: h.side,
        text: `${r?.label ?? "Rule"} → ${h.playerName} buys ${itemName(p.itemId)}`,
      })
    }
    return p
  }

  /** Items lost on death (Divine Rapier). */
  const onDeath = (k: string, items: readonly string[], t: number) => {
    const h = get(k)
    if (!h || !items.includes("rapier")) return []
    emit({ t, kind: "rapier", side: h.side, text: `${h.playerName} drops the Divine Rapier!` })
    return ["rapier"]
  }

  return {
    statMods,
    damageMul,
    attackHits,
    spellLands,
    disableBlocked,
    isImmune,
    observe,
    blinkReach,
    castDelay,
    mispositionShift,
    setLanes,
    laneGoldMul,
    zonedOut,
    laneAdvantage: (k: string) => laneAdv.get(k) ?? 0,
    moveMul,
    aura,
    combo,
    purchase,
    onDeath,
    tier,
    events: (): readonly HeroEvent[] => events.splice(0),
  }
}

export type HeroSystems = ReturnType<typeof createHeroSystems>

const itemName = (id: string) => itemById(id).name
