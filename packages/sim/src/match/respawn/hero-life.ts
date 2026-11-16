/**
 * Hero death & respawn pipeline — spec/12 §1.
 *
 * The hero is never destroyed: a `HeroLife` record transitions
 * alive → dead → alive so stats, item cooldowns and AI references survive.
 * Pure and deterministic; all times are Dota seconds.
 */
import type { Team, Vec2 } from "@mobacraft/map"

export const MIN_LEVEL = 1
export const MAX_HERO_LEVEL = 30
export const RESPAWN_AT_MIN = 12
export const RESPAWN_AT_MAX = 100
/** Curve exponent: >1 → convex (slow early growth, steep late). */
export const RESPAWN_CURVE = 1.5
export const MIN_RESPAWN = 3
export const REAPERS_SCYTHE_ADD = [15, 25, 35] as const
export const BUYBACK_DEATH_PENALTY = 25
/** Hard cap on fountain invulnerability so an idle hero is not immortal. */
export const SPAWN_PROTECTION_MAX = 10

/** Base respawn seconds for `level` (clamped to 1..30, fractional allowed): 12 s at 1, 100 s at 30, convex. */
export const baseRespawnTime = (level: number): number => {
  const l = Math.min(MAX_HERO_LEVEL, Math.max(MIN_LEVEL, level))
  const t = (l - MIN_LEVEL) / (MAX_HERO_LEVEL - MIN_LEVEL)
  return RESPAWN_AT_MIN + (RESPAWN_AT_MAX - RESPAWN_AT_MIN) * t ** RESPAWN_CURVE
}

/** Maps our compressed 1..`maxLevel` XP curve onto Dota's 1..30 (1 → 1, max → 30). */
export const dotaLevel = (level: number, maxLevel = 15): number =>
  1 + ((Math.min(maxLevel, Math.max(1, level)) - 1) * (MAX_HERO_LEVEL - 1)) / (maxLevel - 1)

export interface RespawnModifier {
  readonly source: string
  /** Seconds added (negative = reduction). */
  readonly add?: number
  /** Multiplier on the base timer (e.g. 0.9 talent). */
  readonly mul?: number
}

export const reapersScythe = (rank: 1 | 2 | 3): RespawnModifier => ({
  source: "reapers-scythe",
  add: REAPERS_SCYTHE_ADD[rank - 1],
})

/** `max(MIN_RESPAWN, base × Πmul + Σadd)`. */
export const respawnTime = (level: number, mods: readonly RespawnModifier[] = []): number => {
  const mul = mods.reduce((m, x) => m * (x.mul ?? 1), 1)
  const add = mods.reduce((s, x) => s + (x.add ?? 0), 0)
  return Math.max(MIN_RESPAWN, baseRespawnTime(level) * mul + add)
}

export interface LifeModifier {
  readonly id: string
  readonly remaining: number
  /** Survives death (passives, aura sources, Aegis-like). Everything else is purged. */
  readonly persistsThroughDeath?: boolean
}

export type LifeState = "alive" | "dead"
export type BrainMode = "active" | "dead"

export interface HeroLife {
  readonly heroId: string
  readonly team: Team
  state: LifeState
  render: boolean
  collide: boolean
  hp: number
  maxHp: number
  mana: number
  maxMana: number
  pos: Vec2
  /** Camera / AI focus point. */
  anchor: Vec2
  brain: BrainMode
  modifiers: LifeModifier[]
  /** Ability + item cooldowns (seconds left) — tick through death. */
  cooldowns: Record<string, number>
  /** Absolute time the hero respawns (valid while dead). */
  respawnAt: number
  diedAt: number
  /** Fountain invulnerability until the first move/cast/item. */
  spawnProtected: boolean
  /** Absolute time protection expires even without an action. */
  spawnProtectedUntil: number
  deaths: number
}

export const createHeroLife = (init: {
  heroId: string
  team: Team
  maxHp: number
  maxMana: number
  pos: Vec2
}): HeroLife => ({
  heroId: init.heroId,
  team: init.team,
  state: "alive",
  render: true,
  collide: true,
  hp: init.maxHp,
  maxHp: init.maxHp,
  mana: init.maxMana,
  maxMana: init.maxMana,
  pos: init.pos,
  anchor: init.pos,
  brain: "active",
  modifiers: [],
  cooldowns: {},
  respawnAt: 0,
  diedAt: 0,
  spawnProtected: false,
  spawnProtectedUntil: 0,
  deaths: 0,
})

/**
 * Dead-state cleanup. Returns the respawn time used. Cooldowns are untouched;
 * dispellable modifiers are purged; render/collision off; focus pinned to fountain.
 */
export const killHero = (
  life: HeroLife,
  now: number,
  level: number,
  fountain: Vec2,
  mods: readonly RespawnModifier[] = [],
): number => {
  if (life.state === "dead") return life.respawnAt - now
  const dur = respawnTime(level, mods)
  life.state = "dead"
  life.render = false
  life.collide = false
  life.hp = 0
  life.modifiers = life.modifiers.filter((m) => m.persistsThroughDeath)
  life.anchor = fountain
  life.brain = "dead"
  life.diedAt = now
  life.respawnAt = now + dur
  life.spawnProtected = false
  life.deaths++
  return dur
}

/** Ticks cooldowns and timed modifiers — called every tick, alive or dead. */
export const tickLife = (life: HeroLife, dt: number) => {
  for (const k of Object.keys(life.cooldowns))
    life.cooldowns[k] = Math.max(0, (life.cooldowns[k] ?? 0) - dt)
  life.modifiers = life.modifiers
    .map((m) => ({ ...m, remaining: m.remaining - dt }))
    .filter((m) => m.remaining > 0 || m.persistsThroughDeath)
}

export const respawnRemaining = (life: HeroLife, now: number): number =>
  life.state === "dead" ? Math.max(0, life.respawnAt - now) : 0

/** Respawn execution at `FountainSpawnPoint`. Returns true when it fired. */
export const respawnHero = (life: HeroLife, now: number, spawnPoint: Vec2): boolean => {
  if (life.state !== "dead" || now < life.respawnAt) return false
  life.state = "alive"
  life.render = true
  life.collide = true
  life.hp = life.maxHp
  life.mana = life.maxMana
  life.pos = spawnPoint
  life.anchor = spawnPoint
  life.brain = "active"
  life.spawnProtected = true
  life.spawnProtectedUntil = now + SPAWN_PROTECTION_MAX
  return true
}

/** Immediate respawn (buyback): moves the timer to `now` and executes. */
export const forceRespawn = (life: HeroLife, now: number, spawnPoint: Vec2): boolean => {
  if (life.state !== "dead") return false
  life.respawnAt = now
  return respawnHero(life, now, spawnPoint)
}

export type HeroAction = "move" | "cast" | "item" | "attacked" | "hold"

/**
 * Only voluntary actions end fountain protection; taking hits does not.
 * "item" = any item activation (incl. TP scroll, consumables); "cast" = any ability.
 */
export const breakSpawnProtection = (life: HeroLife, action: HeroAction) => {
  if (action === "move" || action === "cast" || action === "item") life.spawnProtected = false
}

export const isInvulnerable = (life: HeroLife, now: number): boolean =>
  life.state === "alive" && life.spawnProtected && now < life.spawnProtectedUntil

// --- dead brain ---------------------------------------------------------------------

export interface ShopEntry {
  readonly id: string
  readonly cost: number
}

export interface DeadBrainInput {
  readonly gold: number
  /** Gold to keep for buyback (spec/10 §4 floor). */
  readonly reserve: number
  /** Remaining build, in order. */
  readonly shoppingList: readonly ShopEntry[]
  /** Main slots (null = free). */
  readonly main: readonly (string | null)[]
  readonly backpack: readonly (string | null)[]
  /** Item value used to order the backpack sort. */
  readonly value: (id: string) => number
  readonly hasTp: boolean
  /** Where the team needs this hero after respawn (null = no plan). */
  readonly objective: Vec2 | null
  /** Friendly towers still standing (TP destinations). */
  readonly towers: readonly Vec2[]
}

export type DeadAction =
  | { readonly kind: "buy"; readonly id: string; readonly cost: number }
  | { readonly kind: "swap"; readonly backpackIdx: number; readonly mainIdx: number }
  | { readonly kind: "tp"; readonly to: Vec2 }

const d2 = (a: Vec2, b: Vec2) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2

/** Plans dead-time actions: buy (respecting buyback reserve) → backpack sort → TP plan. */
export const planDeadBrain = (input: DeadBrainInput): DeadAction[] => {
  const out: DeadAction[] = []
  let gold = input.gold
  for (const e of input.shoppingList) {
    if (gold - e.cost < input.reserve) break
    out.push({ kind: "buy", id: e.id, cost: e.cost })
    gold -= e.cost
  }

  // Backpack sort: the most valuable backpack item fills each free (or weakest) main slot.
  const main = [...input.main]
  const pack = input.backpack
    .map((id, i) => ({ id, i }))
    .filter((x): x is { id: string; i: number } => x.id !== null)
    .toSorted((a, b) => input.value(b.id) - input.value(a.id) || a.i - b.i)
  for (const p of pack) {
    let slot = main.indexOf(null)
    if (slot < 0) {
      let worst = -1
      for (let i = 0; i < main.length; i++)
        if (worst < 0 || input.value(main[i]!) < input.value(main[worst]!)) worst = i
      if (worst < 0 || input.value(main[worst]!) >= input.value(p.id)) continue
      slot = worst
    }
    out.push({ kind: "swap", backpackIdx: p.i, mainIdx: slot })
    main[slot] = p.id
  }

  if (input.hasTp && input.objective && input.towers.length > 0) {
    const obj = input.objective
    const to = input.towers.reduce((best, t) => (d2(t, obj) < d2(best, obj) ? t : best))
    out.push({ kind: "tp", to })
  }
  return out
}
