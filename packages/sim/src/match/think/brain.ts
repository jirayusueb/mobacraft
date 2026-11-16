/**
 * Hero Think brain (spec/09) — runs the four layers for one hero against a narrow
 * context the match provides. It never sees enemy bodies: enemies come only from
 * `TeamKnowledge` (live while lit, ghosts when dark). Own-team bodies are truth
 * (a team knows itself). Pure decision code — the match applies the result.
 */
import type { LaneId, Vec2 } from "@mobacraft/map"
import { hasTag, powerAt } from "../archetypes.ts"
import type { DraftSide } from "../draft.ts"
import type { Ability, HeroDef, Role } from "../heroes.ts"
import type { Item } from "../items.ts"
import type { KnowledgeUnit, TeamKnowledge } from "../knowledge.ts"
import type { Behavior, LaneSlot, Phase, Plans } from "../tactics.ts"
import {
  type DefensiveItem,
  clamp01,
  itemTiming,
  killPotential,
  survivalReadiness,
} from "./awareness.ts"
import { Blackboard } from "./blackboard.ts"
import { type GhostThreat, ThreatMap } from "./influence.ts"
import {
  type CoachCallKind,
  type Decision,
  type IglKind,
  type MacroAction,
  computeBias,
  decide,
} from "./macro.ts"

export const DEFENSIVE_ITEMS = ["bkb", "blink", "force", "eul"] as const
/** Retreat beats an engaged fight only from this score up. */
export const RETREAT_URGENT = 0.6
/** Ghosts younger than this still count as known targets (seconds). */
export const GHOST_TARGET_AGE = 6
const TICKS_PER_S = 10

export interface BrainHeroState {
  readonly def: HeroDef
  readonly role: Role
  readonly side: DraftSide
  readonly slot: LaneSlot
  readonly level: number
  readonly items: readonly string[]
  readonly gold: number
  readonly skillCd: number
  readonly ultCd: number
  readonly mana: number
  readonly maxMana: number
  readonly intent: string
  readonly itemCd: Readonly<Record<string, number>>
  readonly lastAction: MacroAction | null
}
export interface BrainBody {
  readonly id: string
  readonly x: number
  readonly z: number
  readonly hp: number
  readonly maxHp: number
  readonly alive: boolean
  readonly damage: number
  readonly attackTime: number
  readonly hero?: BrainHeroState
}

export interface BrainCtx<B extends BrainBody> {
  readonly heroes: readonly B[]
  clock(): number
  phase(): Phase
  plans(side: DraftSide): Plans
  behavior(b: B): Behavior
  /** Effective aggression 0..100 (plan bonus included). */
  aggression(b: B): number
  knowledge(side: DraftSide): TeamKnowledge
  fountain(side: DraftSide): Vec2
  laneFront(side: DraftSide, lane: LaneId): Vec2
  slotLane(b: B): LaneId | null
  /** Own living neutral camps. */
  camps(side: DraftSide): readonly { readonly id: string; readonly position: Vec2 }[]
  /** Living enemy towers (structures are public knowledge). */
  enemyTowers(side: DraftSide): readonly { readonly x: number; readonly z: number }[]
  /** Team objective point (next vulnerable enemy structure), if any. */
  objective(side: DraftSide): Vec2 | null
  isCore(b: B): boolean
  roshanUp(): boolean
  nextItemCost(b: B): number | null
  manaCost(b: B, isUlt: boolean): number
  stall(): boolean
  item(id: string): Item
}

export interface ThinkCalls {
  readonly coach: CoachCallKind | null
  readonly igl: IglKind | null
  /** IGL gank target id (followers). */
  readonly iglTarget?: string
}

export interface ThinkResult extends Decision {
  /** Known enemy heroes within 9 tiles and odds good enough to engage on the spot. */
  readonly engage: boolean
  readonly gank?: { readonly id: string; readonly at: Vec2 }
  readonly save?: string
  readonly farm?: { readonly kind: "camp" | "lane"; readonly id: string; readonly at: Vec2 }
  readonly fightAt?: Vec2
  readonly splitAt?: Vec2
}

const LANES: readonly LaneId[] = ["top", "mid", "bot"]
const d2 = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z)

/** Burst damage of an ability (damage + dots), before power. */
export const abilityDamage = (a: Ability, level: number) =>
  a.effects.reduce(
    (s, e) =>
      s +
      (e.type === "damage"
        ? e.amount + (e.scale ?? 0) * level
        : e.type === "dot"
          ? e.dps * e.duration
          : 0),
    0,
  )
export const hasDisableEffect = (a: Ability) =>
  a.effects.some((e) => e.type === "stun" || e.type === "root")

/** Defensive actives this hero owns, with readiness. */
export const defensivesOf = (h: BrainHeroState): DefensiveItem[] =>
  DEFENSIVE_ITEMS.filter((id) => h.items.includes(id)).map((id) => ({
    id,
    ready: (h.itemCd[id] ?? 0) <= 0,
  }))

/**
 * Hero Think defensive purchase (spec/09): replaces the next book item once.
 * Initiator melee → Blink as 2nd item; carry → BKB after 2 core; support → Force
 * Staff 3rd; mid → Eul's 3rd.
 */
export const defensivePurchase = (
  role: Role,
  initiatorMelee: boolean,
  bookIndex: number,
  owned: readonly string[],
): string | null => {
  const want = initiatorMelee
    ? { id: "blink", at: 1 }
    : role === "carry"
      ? { id: "bkb", at: 3 }
      : role === "support"
        ? { id: "force", at: 2 }
        : role === "mid"
          ? { id: "eul", at: 2 }
          : null
  if (!want || bookIndex !== want.at || owned.includes(want.id)) return null
  return want.id
}

export const createBrain = <B extends BrainBody>(ctx: BrainCtx<B>) => {
  const boards: Record<DraftSide, Blackboard> = { blue: new Blackboard(), red: new Blackboard() }
  const threat: Record<DraftSide, ThreatMap> = {
    blue: new ThreatMap(128),
    red: new ThreatMap(128),
  }
  const enemiesOf = (side: DraftSide) => ctx.heroes.filter((x) => x.hero!.side !== side)
  const alliesOf = (side: DraftSide) => ctx.heroes.filter((x) => x.hero!.side === side)
  const tick = () => Math.round(ctx.clock() * TICKS_PER_S)

  /** Enemy max hp / mitigation from public data: def + level + items last seen. */
  const enemyProfile = (heroId: string, u: { level: number; items: readonly string[] }) => {
    const def = ctx.heroes.find((x) => x.hero!.def.id === heroId)!.hero!.def
    const lv = u.level - 1
    const items = u.items.map(ctx.item)
    const sum = (k: "hp" | "armor" | "magicResist") => items.reduce((s, i) => s + (i[k] ?? 0), 0)
    const melee = def.attack === "melee"
    const maxHp = (def.hp + def.hpPerLevel * lv + sum("hp")) * (melee ? 1.08 : 1)
    const armor = def.armor + lv * 0.4 + sum("armor") + (melee ? 1 : 0)
    return {
      maxHp,
      physicalTaken: 1 - (0.06 * armor) / (1 + 0.06 * armor),
      magicTaken: 0.85 * (1 - Math.min(0.6, sum("magicResist"))),
      speed: def.speed,
      melee,
    }
  }

  interface Known {
    readonly id: string
    readonly heroId: string
    readonly pos: Vec2
    readonly hpFrac: number
    readonly level: number
    readonly items: readonly string[]
    readonly visible: boolean
    readonly age: number
  }
  /** Every enemy hero the team knows about now: visible, or a ghost ≤ maxAge s old. */
  const known = (side: DraftSide, maxAge: number): Known[] => {
    const k = ctx.knowledge(side)
    const out: Known[] = []
    const now = tick()
    for (const e of enemiesOf(side)) {
      const v: KnowledgeUnit | undefined = k.visible(e.id)
      if (v) {
        out.push({
          id: e.id,
          heroId: e.hero!.def.id,
          pos: v.pos,
          hpFrac: v.hpFrac,
          level: v.level,
          items: v.items,
          visible: true,
          age: 0,
        })
        continue
      }
      const g = k.ghost(e.id)
      if (!g) continue
      const age = (now - g.lastSeenTick) / TICKS_PER_S
      if (age > maxAge) continue
      out.push({
        id: e.id,
        heroId: e.hero!.def.id,
        pos: g.pos,
        hpFrac: g.hpFrac,
        level: g.level,
        items: g.itemsAtSeen,
        visible: false,
        age,
      })
    }
    return out
  }

  /** Layer 1 threat maps — call with the fog cadence. */
  const updateThreat = () => {
    for (const side of ["blue", "red"] as const) {
      const vis = known(side, 0).filter((x) => x.visible)
      const ghosts: GhostThreat[] = known(side, 20)
        .filter((x) => !x.visible)
        .map((g) => ({
          x: g.pos.x,
          z: g.pos.z,
          level: g.level,
          age: g.age,
          speed: enemyProfile(g.heroId, g).speed,
        }))
      threat[side].update({
        towers: ctx.enemyTowers(side).map((t) => ({ x: t.x, z: t.z, range: 6.5 })),
        visible: vis.map((v) => ({ x: v.pos.x, z: v.pos.z, level: v.level })),
        ghosts,
      })
    }
  }

  const burstOf = (b: B) => {
    const h = b.hero!
    const ultOk = h.level >= 6 && h.ultCd <= 0 && h.mana >= ctx.manaCost(b, true)
    const skillOk = h.skillCd <= 0 && h.mana >= ctx.manaCost(b, false)
    const power = 1 + h.items.reduce((s, id) => s + (ctx.item(id).power ?? 0), 0)
    return {
      ultOk,
      skillOk,
      burst: {
        ultDamage: ultOk ? abilityDamage(h.def.ultimate, h.level) * power : 0,
        skillDamage: skillOk ? abilityDamage(h.def.skill, h.level) * power : 0,
        attackDps: b.damage / Math.max(0.3, b.attackTime),
      },
    }
  }

  const think = (b: B, calls: ThinkCalls): ThinkResult => {
    const h = b.hero!
    const side = h.side
    const t = ctx.clock()
    const bb = boards[side]
    const phase = ctx.phase()
    const hpPct = b.hp / b.maxHp
    const manaPct = h.maxMana > 0 ? h.mana / h.maxMana : 1
    const me: Vec2 = { x: b.x, z: b.z }
    const allies = alliesOf(side).filter((x) => x.alive)
    const enemies = known(side, GHOST_TARGET_AGE)
    const visibleNear = (p: Vec2, r: number) =>
      enemies.filter((e) => e.visible && d2(e.pos, p) <= r)

    // --- Layer 1 -------------------------------------------------------------
    const survival = survivalReadiness({ hpPct, manaPct, defensives: defensivesOf(h) })
    const { ultOk, skillOk, burst } = burstOf(b)
    const timing = itemTiming(h.gold, ctx.nextItemCost(b))
    const danger = threat[side].danger(me)
    const nearFoes = visibleNear(me, 9)

    // Gank target: best K × isolation among known enemies within 30 tiles.
    let gank: { id: string; at: Vec2; value: number } | undefined
    for (const e of enemies) {
      if (d2(e.pos, me) > 30) continue
      if (!bb.isFree(`gank:${e.id}`, b.id, t) && calls.iglTarget !== e.id) continue
      const prof = enemyProfile(e.heroId, e)
      const k = killPotential(burst, {
        hp: e.hpFrac * prof.maxHp,
        physicalTaken: prof.physicalTaken,
        magicTaken: prof.magicTaken,
      })
      const friends = enemies.filter((o) => o.id !== e.id && d2(o.pos, e.pos) <= 10).length
      const isolation = 1 - Math.min(1, friends / 2)
      const value = k * isolation * (calls.iglTarget === e.id ? 1.3 : 1)
      if (!gank || value > gank.value) gank = { id: e.id, at: e.pos, value }
    }

    // Fight: allies (incl. self) within 30 tiles who have a visible enemy within 9.
    const fighting = allies.filter(
      (a) => d2(a, me) <= 30 && visibleNear({ x: a.x, z: a.z }, 9).length > 0,
    )
    const fightAt = fighting
      .map((a) => visibleNear({ x: a.x, z: a.z }, 9)[0]!.pos)
      .toSorted((p, q) => d2(p, me) - d2(q, me))[0]
    const powerOfAlly = (a: B) => (a.hp / a.maxHp) * (1 + a.hero!.level * 0.15)
    const localMine = allies
      .filter((a) => d2(a, fightAt ?? me) <= 12)
      .reduce((s, a) => s + powerOfAlly(a), 0)
    const localTheirs = visibleNear(fightAt ?? me, 12).reduce(
      (s, e) => s + e.hpFrac * (1 + e.level * 0.15),
      0,
    )
    const aggr = ctx.aggression(b)
    const ratio = aggr <= 50 ? 1.2 - 0.008 * aggr : 0.8 - 0.002 * (aggr - 50)
    const fightOdds = localTheirs > 0 ? clamp01((0.5 * localMine) / (localTheirs * ratio)) : 0

    // Engage on the spot (micro-combat entry): visible enemies close, odds acceptable.
    const myPower = allies.filter((a) => d2(a, me) <= 9).reduce((s, a) => s + powerOfAlly(a), 0)
    const theirPower = nearFoes.reduce((s, e) => s + e.hpFrac * (1 + e.level * 0.15), 0)
    const engage = nearFoes.length > 0 && myPower >= theirPower * ratio

    // Save (supports): an ally core < 25 % hp with a visible enemy within 8.
    const canSave =
      h.role === "support" ||
      h.def.skill.target.kind === "ally" ||
      h.def.ultimate.target.kind === "ally" ||
      h.def.ultimate.target.kind === "ally-aoe"
    const cores = allies.filter((a) => a.hero!.role === "carry" || a.hero!.role === "mid")
    const saveTarget = canSave
      ? (cores.length ? cores : allies)
          .filter(
            (a) =>
              a !== b &&
              a.hp / a.maxHp < 0.25 &&
              visibleNear({ x: a.x, z: a.z }, 8).length > 0 &&
              d2(a, me) <= 20 &&
              bb.isFree(`save:${a.id}`, b.id, t),
          )
          .toSorted((x, y) => x.hp / x.maxHp - y.hp / y.maxHp || (x.id < y.id ? -1 : 1))[0]
      : undefined

    // Farm spot: laning = own lane; afterwards best unclaimed camp/lane by safety/distance.
    const laneOf = ctx.slotLane(b)
    const spots: { kind: "camp" | "lane"; id: string; at: Vec2 }[] = []
    if (phase === "laning" && h.slot !== "jungle" && h.slot !== "roam" && laneOf)
      spots.push({ kind: "lane", id: laneOf, at: ctx.laneFront(side, laneOf) })
    else {
      if (h.role !== "support" || h.slot === "jungle")
        for (const c of ctx.camps(side)) spots.push({ kind: "camp", id: c.id, at: c.position })
      if (phase !== "laning" || h.slot === "roam")
        for (const l of LANES) spots.push({ kind: "lane", id: l, at: ctx.laneFront(side, l) })
    }
    let farm: { kind: "camp" | "lane"; id: string; at: Vec2; value: number } | undefined
    for (const s of spots) {
      const key = `${s.kind}:${s.id}`
      const mine = s.kind === "lane" && phase === "laning"
      if (!mine && !bb.isFree(key, b.id, t)) continue
      const value = (1 - threat[side].danger(s.at)) / (1 + d2(s.at, me) / 60)
      if (!farm || value > farm.value + 1e-9) farm = { ...s, value }
    }

    // Split: lane farthest from known enemies.
    let split: { at: Vec2; far: number } | undefined
    for (const l of LANES) {
      const at = ctx.laneFront(side, l)
      const far = enemies.filter((e) => d2(e.pos, at) > 35).length
      if (!split || far > split.far) split = { at, far }
    }
    const pusher = hasTag(h.def.id, "building-damage")
    const pushPower = clamp01(((b.damage / b.attackTime) * (pusher ? 1.2 : 1)) / 60)
    const obj = ctx.objective(side)
    const onObjective = obj ? allies.filter((a) => a !== b && d2(a, obj) < 12).length : 0

    // --- Layer 2 -------------------------------------------------------------
    const nowP = powerAt(h.def.id, t, 0)
    const laterP = powerAt(h.def.id, t + 300, Math.min(3, h.items.length))
    const curveGreed = Math.max(0.8, Math.min(1.4, laterP / nowP))
    const beh = ctx.behavior(b)
    const bias = computeBias({
      phase,
      plans: ctx.plans(side),
      coach: calls.coach,
      igl: calls.igl,
      aggression: aggr,
      farmPriority: beh.farm,
      slot: h.slot,
      isCore: ctx.isCore(b),
      roshanUp: ctx.roshanUp(),
      alliesAlive: allies.length,
      enemiesDead: enemiesOf(side).filter((e) => !e.alive).length,
      stall: ctx.stall(),
    })
    const decision = decide(
      {
        traits: {
          role: h.role,
          initiator: hasTag(h.def.id, "initiator"),
          followUp: hasTag(h.def.id, "follow-up"),
          pusher,
          global: hasTag(h.def.id, "global"),
        },
        phase,
        survival,
        hpPct,
        manaPct,
        canCast: ultOk || skillOk,
        farmSafety: farm?.value ?? 0,
        itemCloseness: timing.closeness,
        curveGreed,
        gankValue: gank?.value ?? 0,
        hasDisable:
          hasDisableEffect(h.def.skill) || (h.level >= 6 && hasDisableEffect(h.def.ultimate)),
        ultReady: ultOk,
        alliesFighting: fighting.length,
        fightOdds,
        fightDist: fightAt ? d2(fightAt, me) : 99,
        blinkReady: h.items.includes("blink") && (h.itemCd.blink ?? 0) <= 0,
        pushPower,
        farSide: split ? Math.min(1, split.far / 4) : 0,
        alliesOnObjective: onObjective,
        nearEnemies: nearFoes.length,
        danger,
        saveTarget: saveTarget !== undefined,
        current: h.lastAction,
      },
      bias,
    )
    let action = decision.action
    // Retreat hold: once fleeing, keep going until healthy (spec/09 resolutions).
    if (h.lastAction === "retreat" && action !== "save" && hpPct < 0.8 && h.intent === "retreat")
      action = "retreat"
    // Encounter → micro-combat unless the hero must flee or is saving.
    const urgent = decision.scores.retreat >= RETREAT_URGENT
    const fightNow = engage && action !== "save" && !(action === "retreat" && urgent)
    if (fightNow) action = "fight"
    else if (action === "retreat" && !urgent && nearFoes.length === 0 && hpPct >= 0.45)
      action = decision.scores.farm >= decision.scores.objective ? "farm" : "objective"

    // --- Layer 4: reservations -------------------------------------------------
    if (action === "gank" && gank) bb.claim(`gank:${gank.id}`, b.id, t)
    else bb.release(b.id, "gank:")
    if (action === "save" && saveTarget) bb.claim(`save:${saveTarget.id}`, b.id, t)
    else bb.release(b.id, "save:")
    if (action === "farm" && farm) bb.claim(`${farm.kind}:${farm.id}`, b.id, t)
    else {
      bb.release(b.id, "camp:")
      bb.release(b.id, "lane:")
    }
    if (action === "gank" && !gank) action = "farm"
    if (action === "fight" && !fightAt && !engage) action = "farm"

    return {
      ...decision,
      action,
      engage: fightNow,
      gank: gank ? { id: gank.id, at: gank.at } : undefined,
      save: saveTarget?.id,
      farm: farm ? { kind: farm.kind, id: farm.id, at: farm.at } : undefined,
      fightAt: fightAt ?? nearFoes[0]?.pos,
      splitAt: split?.at,
    }
  }

  return {
    think,
    updateThreat,
    board: (side: DraftSide) => boards[side],
    threat: (side: DraftSide) => threat[side],
    /** Enemy heroes the team knows (visible or ghosts ≤ maxAge). */
    known,
    release: (side: DraftSide, id: string) => boards[side].release(id),
  }
}
export type Brain = ReturnType<typeof createBrain>
