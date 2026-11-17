/**
 * Match — a full deterministic 5v5 auto-battle on the MobaMap.
 *
 * Interface:
 *   createMatch(map, draft, { seed, speed? }) → Match
 *     Match implements Population (advance/time/units/fx/structures) plus:
 *       call(side, CoachCall) → boolean      issue a coach call (respects cooldown)
 *       setSpeed(x) / setPaused(b)
 *       snapshot() → MatchSnapshot           scoreboard, feed, winner, objectives
 *
 * Model: fixed 0.1 s ticks. Units = heroes, lane creeps, neutrals, Roshan, towers
 * (towers are units with zero speed bound to MobaMap structure ids).
 * Heroes run a utility AI that scores {laning, farm jungle, fight, push, retreat,
 * roshan, group} each 0.5 s, biased by the side's active coach call and the
 * player's `sense`. Everything random flows through one seeded stream:
 * same seed + same calls at the same ticks → identical match.
 */
import type { LaneId, MobaMap, Structure, Team, Vec2 } from "@mobacraft/map"
import type { CreatureKind, HeroId } from "../kinds.ts"
import { NEUTRALS_BY_CAMP } from "../kinds.ts"
import type {
  CrowdDebug,
  FxEvent,
  Population,
  StructureStatus,
  SwingPhase,
  Unit,
} from "../population.ts"
import { heroSwing } from "./swing-timing.ts"
import type { DraftSide, DraftState } from "./draft.ts"
import { type Ability, type Effect, type HeroDef, type Role, heroDef } from "./heroes.ts"
import { itemById, missingComponents, recipeCost } from "./items.ts"
import { ITEM_RULES, type PurchaseView } from "./builds.ts"
import {
  NO_THREAT,
  THREAT_SCAN_S,
  type ThreatProfile,
  CONSUMABLE_BUFFS,
  type ConsumableBuff,
  chooseItem,
  comebackShare,
  goldFloor,
  lateGameAction,
  scanThreats,
} from "./item-ai.ts"
import {
  BACKPACK_SLOTS,
  MAIN_SLOTS,
  type HeroInventory,
  addItem,
  addToStash,
  allItems,
  countItems,
  effectiveItems,
  emptyInventory,
  lookupItem,
  netWorthItems,
  promoteFirstBackpack,
  pullStash,
  removeItem,
  rollNeutralDrop,
} from "./inventory.ts"
import {
  type CourierState,
  advanceCourier,
  courierBusy,
  createCourier,
  dispatchCourier,
} from "./courier.ts"
import { matchupDamageMul, synergyPowerMul, teamSynergy } from "./matrix.ts"
import {
  DynamicNav,
  FREE_PATH_T,
  GATE,
  HULL,
  MAX_SPEED,
  TURN,
  angDiff,
  moveBody,
  turnToward,
} from "./locomotion.ts"
import {
  type Swing,
  CAST_LOCK,
  beginSwing,
  cancelBackswing,
  isLocked,
  newSwing,
  swingTiming,
  tickSwing,
} from "./attack-phase.ts"
import { AttackRings, reach as hullReach } from "./attack-ring.ts"
import { type CrowdMode, type CrowdWorld, type Mover, crowdStep } from "./crowd.ts"
import { REACH_EPS, isMicro, microWaypoint, planEngage } from "./engage.ts"
import { hasTag } from "./archetypes.ts"
import { createRandom } from "./random.ts"
import {
  type MacroAction,
  type ThinkResult,
  blinkLanding,
  awayFrom,
  createBrain,
  defensivePurchase,
  defensiveTrigger,
  hasDisableEffect,
  holdDisable,
  holdPoint,
  initiatorEngage,
  kiteVector,
  BKB_DURATION,
  GLIMMER_DURATION,
  TANGO_DURATION,
  TANGO_HEAL,
  tangoTrigger,
  BLINK_RANGE,
  EUL_DURATION,
  FORCE_DISTANCE,
  LOCK_BONUS,
  LOCK_RADIUS,
} from "./think/index.ts"
import {
  type Behavior,
  type LaneSlot,
  type Phase,
  type PlayerTactics,
  type TeamTactics,
  aiTactics,
  buildById,
  defaultTactics,
  laneOfSlot,
  normalizeTactics,
} from "./tactics.ts"
import { type Player, masteryOf } from "./teams.ts"
import {
  WARD_BOUNTY,
  WARD_LIFETIME,
  WARD_MAX,
  WARD_RECHARGE,
  WARD_START,
  type WardSpot,
  createVisionGrid,
  wardSpots,
  zoneFor,
} from "./vision.ts"
import {
  ATTACK_REVEAL_RADIUS,
  ATTACK_REVEAL_TICKS,
  Bits,
  TREE_REGROW_TICKS,
  type TreeEvent,
  createStaticFog,
  createTeamFog,
  destroyTree,
  fogSnapshot,
  isVisibleToTeam,
  recomputeFog,
  regrowTrees,
  sourceRadius,
  type VisionSource,
} from "./fog.ts"
import { TeamKnowledge } from "./knowledge.ts"

/** How long before the time cap the tiebreak warning fires (game seconds). */
export const TIME_WARNING_LEAD = 120

export type CoachCall = "group" | "roshan" | "push" | "safe" | "farm"
export const CALL_COOLDOWN = 60
export const CALL_DURATION = 40
export const SWAP_COOLDOWN = 60
export const PLAN_COOLDOWN = 20
export const IGL_CALL_DURATION = 20
export const IGL_THINK = 20
export const HISTORY_EVERY = 5
/** Phase transitions (spec/06 §1), game seconds. */
export const MID_AT = 7 * 60
export const LATE_AT = 15 * 60
export const ANTI_STALL_AT = 25 * 60

export type GoldSource =
  | "passive"
  | "creeps"
  | "neutrals"
  | "kills"
  | "assists"
  | "structures"
  | "roshan"
  | "wards"
export const GOLD_SOURCES: readonly GoldSource[] = [
  "passive",
  "creeps",
  "neutrals",
  "kills",
  "assists",
  "structures",
  "roshan",
  "wards",
]
export type IglCallKind = "gank" | "defend" | "back" | "push" | "group"

const TICK = 0.1
const SIDE_TEAM: Record<DraftSide, Team> = { blue: "radiant", red: "dire" }
const TEAM_SIDE: Record<Team, DraftSide> = { radiant: "blue", dire: "red" }

// --- economy & tuning ------------------------------------------------------------
const XP_CURVE = [
  0, 200, 450, 750, 1100, 1500, 1950, 2450, 3000, 3600, 4250, 4950, 5700, 6500, 7350,
]
export const MAX_LEVEL = XP_CURVE.length
const PASSIVE_GOLD = 2.2 // per second
/** Seconds after an ally death that wards prefer the death area (spec/10 layer 4). */
const DEFENSIVE_WARD_WINDOW = 60
const CREEP_GOLD = 38
const CREEP_XP = 55
const KILL_GOLD = 220
const KILL_XP = 180
const ASSIST_GOLD = 90
const TOWER_GOLD = 160 // to every hero on the team
const NEUTRAL_GOLD = 55
const NEUTRAL_XP = 70
const ROSHAN_GOLD = 200
const XP_RANGE = 9
export const RESPAWN_BASE = 6
export const RESPAWN_PER_LEVEL = 2.2
const WAVE_INTERVAL = 30
const CAMP_RESPAWN = 60
export const ROSHAN_RESPAWN = 240

type UnitType = "hero" | "creep" | "neutral" | "roshan" | "tower" | "ancient" | "rax"

interface Status {
  stun: number
  root: number
  slow: number
  slowT: number
  shield: number
  shieldT: number
  dots: { dps: number; t: number; src: Body }[]
  hots: { hps: number; t: number; src: Body }[]
  buffs: { stat: "attack" | "speed" | "armor" | "attackSpeed"; pct: number; t: number }[]
  lifesteal: number
  lifestealT: number
  /** Spell immunity (BKB) seconds left. */
  immune: number
  /** Eul's cyclone seconds left: invulnerable, can't act. */
  cyclone: number
  /** Glimmer Cape seconds left: invisible to enemies (spec/10 S5b). */
  glimmer: number
}

interface Body {
  id: string
  type: UnitType
  team: Team | "neutral"
  kind: CreatureKind | HeroId | "structure"
  x: number
  z: number
  heading: number
  hp: number
  maxHp: number
  armor: number
  damage: number
  attackTime: number
  range: number
  speed: number
  cooldown: number
  alive: boolean
  st: Status
  /** Attacks + casts started (drives the renderer's attack swing). */
  swings?: number
  /** Cached A* waypoints for heroes. */
  path?: Vec2[]
  pathKey?: string
  /** Path following for creeps. */
  lane?: LaneId
  s?: number
  side?: number
  rank?: number
  /** Neutral home. */
  home?: { x: number; z: number; campId: string }
  /** MobaMap structure for towers etc. */
  structure?: Structure
  /** Last hero that hit this, for credit. */
  lastHit?: Body
  /** Heroes that damaged in the last 8 s, for assists. */
  contributors?: Map<string, number>
  target?: Body
  hero?: HeroState
  // --- crowd & combat (spec/09 crowd-combat) ---
  /** Three-phase attack state. */
  swing?: Swing
  /** Body as the crowd layer sees it (preferred velocity in, safe velocity out). */
  mover?: Mover
  /** Micro-steering hysteresis flag. */
  micro?: boolean
  /** Seconds spent wanting to move but not moving (forces an A* repath). */
  stuckT?: number
  /** Earliest clock time for the next stuck repath (backoff). */
  repathAt?: number
  // --- locomotion fields (spec/11; consumers: knockback free pathing, crowd layer) ---
  /** Hull radius in tiles (hero 0.375, creep 0.25). */
  radius?: number
  /** Turn rate in rad/s. */
  turnRate?: number
  /** Desired velocity for the avoidance pass (tiles/s). */
  vx?: number
  vz?: number
  /** Stun/root seconds left, mirrored for the brain's save scan (spec/10 S5b). */
  disabledFor?: number
  /** Free-path timer: re-path A* when it hits 0 (spec/09 locomotion). */
  freePath?: number
  /** Ground speed magnitude for the renderer's gait. */
  velMag?: number
  /** Remaining phase-movement seconds (unit collision off). */
  phase?: number
  /** Avoidance priority / separation mass (hero 2, others 1). */
  priority?: number
  mass?: number
}

interface HeroState {
  def: HeroDef
  player: Player
  side: DraftSide
  role: Role
  slot: LaneSlot
  /** Next index into the build preset (adaptive items don't advance it). */
  buildIdx: number
  adaptiveDone: boolean
  /** Hero damage taken, by type (adaptive itemization). */
  taken: { physical: number; magic: number }
  /** Following the side's current coach call / IGL call (rolled at relay). */
  followCoach: boolean
  followIgl: boolean
  level: number
  xp: number
  gold: number
  /** Effective items (main + neutral, unmuted) — derived from `inv` each change. */
  items: string[]
  /** Zone inventory (spec/10 layer 1). `items` is its effective projection. */
  inv: HeroInventory
  /** Items on the team courier addressed to this hero (net worth, not power). */
  inTransit: string[]
  skillCd: number
  ultCd: number
  respawn: number
  aegis: boolean
  kills: number
  deaths: number
  assists: number
  lastHits: number
  heroDamage: number
  healing: number
  goldEarned: number
  intent: Intent
  goal: Vec2 | null
  rethink: number
  mastery: number
  // --- Hero Think (spec/09) ---
  mana: number
  maxMana: number
  manaRegen: number
  /** Item active cooldowns by item id. */
  itemCd: Record<string, number>
  /** Tango charges (spec/10 S5a: slot-free starting consumable). */
  tango: number
  /** Slot-free permanent buffs eaten (spec/10 S6). */
  consumed: Set<ConsumableBuff>
  /** Defensive purchase already made (replaces one book item). */
  defensiveDone: boolean
  lastAction: MacroAction | null
  scores: Readonly<Record<MacroAction, number>> | null
  /** Clock of the last hero damage taken (Blink lockout). */
  lastHeroDamage: number
  /** Clock when this hero last had a visible enemy hero within 7 tiles. */
  lastEnemyNear: number
  /** Target for a save. */
  saveId?: string
  /** Ranged kite in progress (hysteresis). */
  kiting?: boolean
}

export type Intent =
  | "lane"
  | "jungle"
  | "fight"
  | "push"
  | "retreat"
  | "roshan"
  | "group"
  | "gank"
  | "ward"
  | "shop"
  | "save"
  | "dead"

export interface HeroLine {
  readonly id: string
  readonly heroId: string
  readonly heroName: string
  readonly playerId: string
  readonly playerName: string
  readonly side: DraftSide
  readonly role: Role
  readonly level: number
  readonly hp: number
  readonly alive: boolean
  readonly respawnIn: number
  readonly kills: number
  readonly deaths: number
  readonly assists: number
  readonly lastHits: number
  readonly gold: number
  readonly heroDamage: number
  readonly healing: number
  readonly items: readonly string[]
  readonly backpack: readonly (string | null)[]
  readonly neutral: string | null
  readonly stash: readonly (string | null)[]
  readonly intent: Intent
  readonly aegis: boolean
  readonly netWorth: number
  readonly xp: number
  readonly slot: LaneSlot
  /** Following the active call (coach or IGL); null when no call is active. */
  readonly following: boolean | null
  readonly igl: boolean
  readonly mana: number
  readonly maxMana: number
  /** Hero Think: current macro action and its scores (spec/09). */
  readonly think: {
    readonly action: MacroAction | null
    readonly scores: Readonly<Record<MacroAction, number>> | null
  }
}

export interface CommsEntry {
  readonly t: number
  readonly side: DraftSide
  readonly from: "coach" | "igl"
  /** Player relaying / making the call; null = no caller alive. */
  readonly caller: string | null
  readonly text: string
  readonly followers: number
  readonly total: number
}

export interface WardLine {
  readonly id: string
  readonly side: DraftSide
  readonly x: number
  readonly z: number
  readonly expiresIn: number
}

export interface HistorySample {
  readonly t: number
  readonly nw: Readonly<Record<DraftSide, number>>
  readonly xp: Readonly<Record<DraftSide, number>>
  readonly control: Readonly<Record<DraftSide, number>>
}

export interface Purchase {
  readonly t: number
  readonly side: DraftSide
  readonly heroId: string
  readonly playerId: string
  readonly itemId: string
  readonly adaptive: boolean
}

export interface FeedEntry {
  readonly t: number
  readonly kind:
    | "kill"
    | "tower"
    | "rax"
    | "roshan"
    | "aegis"
    | "call"
    | "first-blood"
    | "ancient"
    | "phase"
    | "ward"
    | "swap"
    | "time-warning"
    | "item"
  readonly side: DraftSide | "neutral"
  readonly text: string
}

export interface CourierLine {
  readonly side: DraftSide
  readonly x: number
  readonly z: number
  readonly cargo: readonly string[]
  readonly targetHero: string | null
}

export interface MatchSnapshot {
  readonly time: number
  readonly speed: number
  readonly paused: boolean
  readonly kills: Readonly<Record<DraftSide, number>>
  readonly towers: Readonly<Record<DraftSide, number>>
  readonly gold: Readonly<Record<DraftSide, number>>
  readonly heroes: readonly HeroLine[]
  readonly feed: readonly FeedEntry[]
  readonly calls: Readonly<
    Record<
      DraftSide,
      { readonly active: CoachCall | null; readonly remaining: number; readonly cooldown: number }
    >
  >
  readonly roshanAlive: boolean
  readonly winner: DraftSide | null
  readonly phase: Phase
  /** Game time each phase started (laning = 0). */
  readonly phaseAt: Readonly<Partial<Record<Phase, number>>>
  readonly netWorth: Readonly<Record<DraftSide, number>>
  readonly sources: Readonly<Record<DraftSide, Readonly<Record<GoldSource, number>>>>
  /** Map control 0..1 (visible walkable area). */
  readonly control: Readonly<Record<DraftSide, number>>
  readonly wards: readonly WardLine[]
  /** Team couriers (spec/10 S3). */
  readonly couriers: readonly CourierLine[]
  readonly wardStock: Readonly<
    Record<DraftSide, { readonly charges: number; readonly next: number }>
  >
  readonly comms: readonly CommsEntry[]
  readonly history: readonly HistorySample[]
  readonly purchases: readonly Purchase[]
  readonly swapCooldown: Readonly<Record<DraftSide, number>>
  readonly planCooldown: Readonly<Record<DraftSide, number>>
  readonly iglCall: Readonly<
    Record<DraftSide, { readonly kind: IglCallKind; readonly remaining: number } | null>
  >
  /** Team synergy score 0..15 from the draft. */
  readonly synergy: Readonly<Record<DraftSide, number>>
  /** Fog of war per side (spec/08 §5): 0 unexplored, 1 explored, 2 visible. */
  readonly fog: Readonly<Record<DraftSide, { readonly cols: number; readonly bytes: Uint8Array }>>
}

export interface MatchOptions {
  readonly seed: number
  /** Initial sim speed (game seconds per real second). */
  readonly speed?: number
  /** AI coach for these sides (issues calls automatically). */
  readonly aiCoach?: readonly DraftSide[]
  /** Hard cap on game time; the leader on towers/kills wins. */
  readonly maxTime?: number
  /** Coach game plans (spec/06). Missing → AI sides get `aiTactics`, others `defaultTactics`. */
  readonly tactics?: Partial<Record<DraftSide, TeamTactics>>
}

/** Round up onto the sim tick grid (phases end on the first tick with left ≤ 0). */
const onTick = (x: number) => Math.ceil(x / TICK - 1e-6) * TICK

const polyline = (path: readonly Vec2[]) => {
  const cum = [0]
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!
    const b = path[i]!
    cum.push(cum[i - 1]! + Math.hypot(b.x - a.x, b.z - a.z))
  }
  const length = cum[cum.length - 1]!
  const at = (s: number) => {
    const t = Math.min(length, Math.max(0, s))
    let i = 1
    while (i < cum.length - 1 && cum[i]! < t) i++
    const a = path[i - 1]!
    const b = path[i]!
    const seg = cum[i]! - cum[i - 1]! || 1
    const k = (t - cum[i - 1]!) / seg
    return {
      x: a.x + (b.x - a.x) * k,
      z: a.z + (b.z - a.z) * k,
      tx: (b.x - a.x) / seg,
      tz: (b.z - a.z) / seg,
    }
  }
  /** Arc length of the closest point on the path to (x,z). */
  const project = (x: number, z: number) => {
    let best = 0
    let bestD = Infinity
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]!
      const b = path[i]!
      const dx = b.x - a.x
      const dz = b.z - a.z
      const len2 = dx * dx + dz * dz || 1
      const k = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / len2))
      const px = a.x + dx * k
      const pz = a.z + dz * k
      const d = Math.hypot(x - px, z - pz)
      if (d < bestD) {
        bestD = d
        best = cum[i - 1]! + Math.sqrt(len2) * k
      }
    }
    return best
  }
  return { length, at, project }
}

const emptyStatus = (): Status => ({
  stun: 0,
  root: 0,
  glimmer: 0,
  slow: 0,
  slowT: 0,
  shield: 0,
  shieldT: 0,
  dots: [],
  hots: [],
  buffs: [],
  lifesteal: 0,
  lifestealT: 0,
  immune: 0,
  cyclone: 0,
})

const dist = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z)

/** Effective multipliers from player rating and mastery. */
const otherSide = (s: DraftSide): DraftSide => (s === "blue" ? "red" : "blue")
const skillMul = (h: HeroState) => 0.8 + h.player.skill / 50 + h.mastery * 0.15
const buffStat = (h: HeroState, k: "power" | "hp" | "attackSpeed") =>
  [...h.consumed].reduce(
    (s, id) => s + ((CONSUMABLE_BUFFS[id] as Partial<Record<typeof k, number>>)[k] ?? 0),
    0,
  )
const powerOf = (h: HeroState) =>
  1 + h.items.reduce((s, id) => s + (lookupItem(id).power ?? 0), 0) + buffStat(h, "power")
const itemSum = (h: HeroState, k: "magicResist" | "armor") =>
  h.items.reduce((s, id) => s + (lookupItem(id)[k] ?? 0), 0)
const netWorthOf = (h: HeroState) =>
  Math.round(
    h.gold +
      netWorthItems(h.inv) +
      h.inTransit.reduce((s, id) => s + lookupItem(id).cost, 0) +
      [...h.consumed].reduce((s, id) => s + CONSUMABLE_BUFFS[id].cost, 0),
  )
const sideOf = (team: Team): DraftSide => TEAM_SIDE[team]
/** Item active ready (spec/10 layer 4): owned in the effective set and off cooldown. */
const ready = (h: HeroState, id: string) => h.items.includes(id) && (h.itemCd[id] ?? 0) <= 0
const emptySources = (): Record<GoldSource, number> => ({
  passive: 0,
  creeps: 0,
  neutrals: 0,
  kills: 0,
  assists: 0,
  structures: 0,
  roshan: 0,
  wards: 0,
})
const slotLane = (h: HeroState): LaneId | null => laneOfSlot(h.slot, h.side)
/** Ranged non-carries deal mostly ability (magic) damage — adaptive-item draft heuristic. */
const ALL_RULES: ReadonlySet<string> = new Set(ITEM_RULES.map((r) => r.id))
const MAGIC_HEAVY = (id: string) => {
  const d = heroDef(id)
  return d.attack === "ranged" && !d.roles.includes("carry")
}
/** Spell projectile speed, tiles/s (spec/09). */
export const PROJECTILE_SPEED = 12
/** Single-target ranged (non-dash) and line abilities travel as projectiles. */
const projectileAbility = (a: Ability) =>
  a.target.kind === "line" ||
  (a.target.kind === "enemy" && a.target.range > 2.5 && !a.effects.some((e) => e.type === "dash"))
/** Mana costs (spec/09): skill 35 + 3·cd, ult 90 + 1.2·cd. */
const manaCost = (h: HeroState, isUlt: boolean) =>
  isUlt ? Math.round(90 + 1.2 * h.def.ultimate.cooldown) : Math.round(35 + 3 * h.def.skill.cooldown)
const avgLevel = (xs: readonly Body[]) => xs.reduce((a, h) => a + h.hero!.level, 0) / xs.length

export const createMatch = (map: MobaMap, draft: DraftState, options: MatchOptions) => {
  const rng = createRandom(options.seed)
  const lanes = new Map(map.lanes.map((l) => [l.id, polyline(l.path)]))
  const aiSides = new Set(options.aiCoach ?? [])
  const maxTime = options.maxTime ?? 40 * 60
  let speed = options.speed ?? 4
  let paused = false
  let clock = 0
  let acc = 0
  let nextWave = 1
  let waveNo = 0
  let uid = 1
  let winner: DraftSide | null = null
  /** The 2-minute tiebreak warning fires once per match. */
  let timeWarned = false
  const feed: FeedEntry[] = []
  let fxQueue: FxEvent[] = []
  let firstBlood = false
  const kills = { blue: 0, red: 0 }
  const towersDown = { blue: 0, red: 0 } // towers *destroyed by* side
  /** Side has lost a Tier-3 tower (buyback reserve trigger, spec/10 layer 3). */
  const lostT3 = { blue: false, red: false }
  /** Visible threat profile per team, rescanned every THREAT_SCAN_S (spec/10 layer 3). */
  const threats: Record<DraftSide, ThreatProfile> = { blue: NO_THREAT, red: NO_THREAT }
  let nextThreatScan = 0
  const calls = {
    blue: { active: null as CoachCall | null, remaining: 0, cooldown: 0 },
    red: { active: null as CoachCall | null, remaining: 0, cooldown: 0 },
  }
  /** Barracks destroyed per (attacking side, lane) → that side's creeps in that lane are empowered. */
  const empowered = new Set<string>()
  const campTimers = new Map<string, number>()
  let roshanTimer = 0

  // --- tactics state (spec/06) ------------------------------------------------------
  const tac: Record<DraftSide, TeamTactics> = {
    blue: normalizeTactics(
      draft,
      "blue",
      options.tactics?.blue ??
        (aiSides.has("blue") ? aiTactics(draft, "blue") : defaultTactics(draft, "blue")),
    ),
    red: normalizeTactics(
      draft,
      "red",
      options.tactics?.red ??
        (aiSides.has("red") ? aiTactics(draft, "red") : defaultTactics(draft, "red")),
    ),
  }
  let phase: Phase = "laning"
  const phaseAt: Partial<Record<Phase, number>> = { laning: 0 }
  let tier1Down = 0
  let tier3Down = false
  const sources: Record<DraftSide, Record<GoldSource, number>> = {
    blue: emptySources(),
    red: emptySources(),
  }
  const synergyScore: Record<DraftSide, number> = {
    blue: teamSynergy(draft.picks.blue.map((p) => p.heroId)),
    red: teamSynergy(draft.picks.red.map((p) => p.heroId)),
  }
  const synergyMul: Record<DraftSide, number> = {
    blue: synergyPowerMul(draft.picks.blue.map((p) => p.heroId)),
    red: synergyPowerMul(draft.picks.red.map((p) => p.heroId)),
  }
  const matchupCache = new Map<string, number>()
  const matchupMul = (a: string, b: string) => {
    const key = `${a}|${b}`
    let v = matchupCache.get(key)
    if (v === undefined) {
      v = matchupDamageMul(a, b)
      matchupCache.set(key, v)
    }
    return v
  }
  const comms: CommsEntry[] = []
  const history: HistorySample[] = []
  const purchases: Purchase[] = []
  let nextSample = 0
  const swapCd = { blue: 0, red: 0 }
  const planCd = { blue: 0, red: 0 }
  const pendingPlans: { side: DraftSide; at: number; apply: () => void; text: string }[] = []
  /** Coach call relay: null = relayed (or no call); number = game time it will be relayed. */
  const relayAt: Record<DraftSide, number | null> = { blue: null, red: null }
  interface IglCall {
    kind: IglCallKind
    remaining: number
    at?: Vec2
    target?: Body
  }
  const iglCall: Record<DraftSide, IglCall | null> = { blue: null, red: null }
  let iglThink = IGL_THINK
  /** Carry item count when the spike call last fired (fires once at 2 items). */
  const spikeFired = { blue: false, red: false }
  // Vision (spec/08): fog-of-war grids keyed by DraftSide; TeamKnowledge is
  // the only sanctioned AI view of the enemy.
  const staticFog = createStaticFog(map)
  const visionGrid = {
    blue: createTeamFog(staticFog.cols),
    red: createTeamFog(staticFog.cols),
  }
  const walkable = createVisionGrid(map)
  const knowledge = {
    blue: new TeamKnowledge(SIDE_TEAM.blue, visionGrid.blue, staticFog),
    red: new TeamKnowledge(SIDE_TEAM.red, visionGrid.red, staticFog),
  }
  /** Enemy attack-reveal bubbles per side (granted by the other side's attacks). */
  let reveals: { side: DraftSide; x: number; z: number; until: number }[] = []
  const cutTrees: TreeEvent[] = []
  const control = { blue: 0, red: 0 }
  let visionTimer = 0
  const spots: readonly WardSpot[] = wardSpots(map)
  interface Ward {
    id: string
    side: DraftSide
    x: number
    z: number
    expires: number
    spotId: string
  }
  let wards: Ward[] = []
  /** Where each side last lost a hero (defensive ward target, spec/10 layer 4). */
  const lastDeathAt: Record<DraftSide, { x: number; z: number; t: number } | null> = {
    blue: null,
    red: null,
  }
  const wardStock = {
    blue: { charges: WARD_START, next: WARD_RECHARGE },
    red: { charges: WARD_START, next: WARD_RECHARGE },
  }

  // Couriers (spec/10 S3): one per team, created after fountains are known.
  let couriers: Record<DraftSide, CourierState> | null = null
  const courierOf = (side: DraftSide): CourierState => {
    couriers ??= {
      blue: createCourier("blue", fountain(SIDE_TEAM.blue)),
      red: createCourier("red", fountain(SIDE_TEAM.red)),
    }
    return couriers[side]
  }
  /** Fly stash items out; deliver into the hero's inventory on arrival. */
  const tickCouriers = (dt: number) => {
    for (const side of ["blue", "red"] as const) {
      const c = courierOf(side)
      const home = fountain(SIDE_TEAM[side])
      if (!courierBusy(c)) {
        // First hero (by id) with stash items who is away from base.
        const b = heroes.find(
          (x) =>
            x.hero!.side === side &&
            x.alive &&
            x.hero!.inv.stash.some((i) => i !== null) &&
            dist(x, home) >= 14,
        )
        if (b) {
          const h = b.hero!
          const load = h.inv.stash.filter((i): i is string => i !== null)
          if (dispatchCourier(c, b.id, b, load)) {
            for (const id of load) removeItem(h.inv, id)
            h.inTransit = [...load]
          }
        }
      }
      const target = c.targetHero ? heroes.find((x) => x.id === c.targetHero) : undefined
      const delivered = advanceCourier(c, target?.alive ? target : null, home, dt)
      if (target && delivered.length > 0) {
        const h = target.hero!
        h.inTransit = []
        for (const id of delivered) if (!addItem(h.inv, id)) addToStash(h.inv, id)
        h.items = effectiveItems(h.inv, clock)
        recomputeStats(target)
      }
    }
  }

  const bodies: Body[] = []
  interface Projectile {
    caster: Body
    ability: Ability
    line: boolean
    target?: Body
    x: number
    z: number
    dx: number
    dz: number
    left: number
    width: number
    hit: Set<string>
  }
  const projectiles: Projectile[] = []
  const lockCasts = { total: 0, onLock: 0 }
  /** Ability usage counters (balance reports / tests). */
  const casts = new Map<string, number>()
  /** Crowd radii (spec/09 §2), keyed on unit class; structures are static. */
  const crowdRadius = (b: Body) =>
    b.type === "roshan"
      ? 0.9
      : b.kind.toString().includes("siege")
        ? 0.45
        : b.type === "hero"
          ? 0.4
          : 0.35
  const newMover = (b: Body): Mover => {
    const m: Mover = {
      id: b.id,
      team: b.team,
      x: b.x,
      z: b.z,
      vx: 0,
      vz: 0,
      pvx: 0,
      pvz: 0,
      radius: crowdRadius(b),
      maxSpeed: b.speed,
      mode: "free",
      yieldT: 0,
      yieldCd: 0,
      yx: 0,
      yz: 0,
    }
    return m
  }
  const add = (b: Omit<Body, "st" | "alive" | "cooldown"> & Partial<Pick<Body, "cooldown">>) => {
    const full: Body = { cooldown: 0, alive: true, st: emptyStatus(), ...b }
    // Locomotion defaults (spec/11).
    full.radius ??=
      full.type === "hero" ? HULL.hero : full.type === "creep" ? HULL.creep : HULL.neutral
    full.turnRate ??= full.type === "hero" ? TURN.fast : TURN.mid
    full.velMag ??= 0
    full.swing = newSwing()
    if (full.speed > 0) full.mover = newMover(full)
    bodies.push(full)
    return full
  }

  // --- structures --------------------------------------------------------------
  const structureBodies = new Map<string, Body>()
  for (const s of map.structures) {
    if (s.team === "neutral") continue
    const type: UnitType | null =
      s.kind === "tower"
        ? "tower"
        : s.kind === "ancient"
          ? "ancient"
          : s.kind.startsWith("barracks")
            ? "rax"
            : null
    if (!type) continue
    const tier = s.tier ?? 1
    const b = add({
      id: s.id,
      type,
      team: s.team,
      kind: "structure",
      x: s.position.x,
      z: s.position.z,
      heading: 0,
      hp: type === "ancient" ? 4200 : type === "rax" ? 1600 : 1300 + tier * 350,
      maxHp: type === "ancient" ? 4200 : type === "rax" ? 1600 : 1300 + tier * 350,
      armor: type === "tower" ? 10 + tier * 2 : 12,
      damage: type === "tower" ? 85 + tier * 18 : 0,
      attackTime: 1,
      range: type === "tower" ? 6.5 : 0,
      speed: 0,
      structure: s,
    })
    structureBodies.set(s.id, b)
  }

  /** A structure is attackable once everything in front of it on its lane (or all T3s for T4/ancient) is down. */
  const vulnerable = (b: Body): boolean => {
    const s = b.structure
    if (!s) return true
    const team = s.team as Team
    const alive = (pred: (x: Structure) => boolean) =>
      [...structureBodies.values()].some(
        (o) => o.alive && o.structure && o.structure.team === team && pred(o.structure),
      )
    if (b.type === "tower") {
      const tier = s.tier ?? 1
      if (tier === 1) return true
      if (tier <= 3)
        return !alive((x) => x.kind === "tower" && x.lane === s.lane && (x.tier ?? 1) < tier)
      return !alive((x) => x.kind === "tower" && (x.tier ?? 1) === 3)
    }
    if (b.type === "rax")
      return !alive((x) => x.kind === "tower" && x.lane === s.lane && (x.tier ?? 1) === 3)
    // ancient
    return !alive((x) => x.kind === "tower" && (x.tier ?? 1) === 4)
  }

  // --- heroes --------------------------------------------------------------------
  const fountain = (team: Team) => {
    const f = map.structures.find((s) => s.kind === "fountain" && s.team === team)!.position
    return { x: f.x, z: f.z }
  }
  const heroes: Body[] = []
  for (const side of ["blue", "red"] as const) {
    const team = SIDE_TEAM[side]
    const teamDef = side === "blue" ? draft.blue : draft.red
    draft.picks[side].forEach((pick, i) => {
      const def = heroDef(pick.heroId)
      const player = teamDef.players.find((p) => p.id === pick.playerId)!
      const f = fountain(team)
      const role = player.role
      const b = add({
        id: `hero-${side}-${i}`,
        type: "hero",
        team,
        kind: def.id as HeroId,
        x: f.x + (i - 2) * 0.8,
        z: f.z,
        heading: 0,
        hp: def.hp,
        maxHp: def.hp,
        armor: def.armor,
        damage: def.damage,
        attackTime: def.attackTime,
        range: def.range,
        speed: def.speed,
        contributors: new Map(),
        hero: {
          def,
          player,
          side,
          role,
          slot: tac[side].players[player.id]!.slot,
          buildIdx: 0,
          adaptiveDone: false,
          taken: { physical: 0, magic: 0 },
          followCoach: false,
          followIgl: false,
          level: 1,
          xp: 0,
          gold: 600,
          items: [],
          inv: emptyInventory(),
          inTransit: [],
          skillCd: 0,
          ultCd: 0,
          respawn: 0,
          aegis: false,
          kills: 0,
          deaths: 0,
          assists: 0,
          lastHits: 0,
          heroDamage: 0,
          healing: 0,
          goldEarned: 0,
          intent: "lane",
          goal: null,
          rethink: 0,
          mastery: masteryOf(player, def.id),
          mana: 0,
          maxMana: 0,
          manaRegen: 0,
          itemCd: {},
          tango: 3,
          consumed: new Set(),
          defensiveDone: false,
          lastAction: null,
          scores: null,
          lastHeroDamage: -99,
          lastEnemyNear: -99,
        },
      })
      heroes.push(b)
    })
  }

  const recomputeStats = (b: Body) => {
    const h = b.hero!
    const lv = h.level - 1
    const items = h.items.map(lookupItem)
    const sum = (k: "hp" | "damage" | "armor" | "attackSpeed" | "speed" | "lifesteal") =>
      items.reduce((s, it) => s + (it[k] ?? 0), 0)
    const ratio = b.hp / b.maxHp
    // Melee heroes trade range for staying power and hit harder up close.
    const melee = h.def.attack === "melee"
    b.maxHp =
      (h.def.hp + h.def.hpPerLevel * lv + sum("hp") + buffStat(h, "hp")) * (melee ? 1.08 : 1)
    b.hp = Math.max(1, ratio * b.maxHp)
    b.damage =
      (h.def.damage + h.def.damagePerLevel * lv + sum("damage")) * skillMul(h) * (melee ? 1.08 : 1)
    b.armor = h.def.armor + lv * 0.4 + sum("armor") + (melee ? 1 : 0)
    b.attackTime =
      h.def.attackTime / (1 + sum("attackSpeed") + buffStat(h, "attackSpeed") + lv * 0.02)
    b.speed = h.def.speed + sum("speed")
    const manaRatio = h.maxMana > 0 ? h.mana / h.maxMana : 1
    h.maxMana = 220 + 32 * lv + items.reduce((s, it) => s + (it.mana ?? 0), 0)
    h.mana = manaRatio * h.maxMana
    h.manaRegen = 2.5 + 0.25 * h.level + items.reduce((s, it) => s + (it.manaRegen ?? 0), 0)
  }
  for (const h of heroes) {
    recomputeStats(h)
    h.hero!.mana = h.hero!.maxMana
  }

  // --- spawning --------------------------------------------------------------------
  const spawnWave = () => {
    waveNo++
    const roles: ("melee" | "ranged" | "siege")[] = ["melee", "melee", "melee", "ranged"]
    if (waveNo % 5 === 0) roles.push("siege")
    for (const team of ["radiant", "dire"] as const) {
      for (const [laneId, lane] of lanes) {
        const strong = empowered.has(`${TEAM_SIDE[team]}:${laneId}`)
        roles.forEach((role, i) => {
          const melee = role === "melee"
          const hp =
            (role === "siege" ? 750 : melee ? 520 : 330) * (strong ? 1.5 : 1) * (1 + waveNo * 0.012)
          const s0 = -(melee ? 0 : role === "ranged" ? 1.2 : 2.4)
          const side = melee ? (i - 1) * 0.5 : 0
          const start = lane.at(team === "radiant" ? s0 : lane.length - s0)
          const dir = team === "radiant" ? 1 : -1
          add({
            id: `creep-${uid++}`,
            type: "creep",
            team,
            kind: `${team}-${role}` as CreatureKind,
            x: start.x - start.tz * dir * side,
            z: start.z + start.tx * dir * side,
            heading: Math.atan2(start.tx * dir, start.tz * dir),
            hp,
            maxHp: hp,
            armor: melee ? 2 : 0,
            damage:
              (role === "siege" ? 55 : melee ? 22 : 26) * (strong ? 1.4 : 1) * (1 + waveNo * 0.01),
            attackTime: role === "siege" ? 2.2 : 1,
            range: role === "siege" ? 6 : melee ? 1.2 : 4.5,
            speed: 2.4,
            lane: laneId,
            s: s0,
            side,
            rank: 0,
          })
        })
      }
    }
  }

  const spawnCamp = (camp: MobaMap["camps"][number]) => {
    const roster = NEUTRALS_BY_CAMP[camp.kind]
    const h = [...camp.id].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7)
    const pair = (h % 2) * 2
    const count = camp.kind === "small" ? 3 : camp.kind === "ancient" ? 3 : 2
    const tierMul = { small: 1, medium: 1.35, large: 1.8, ancient: 2.6 }[camp.kind]
    for (let i = 0; i < count; i++) {
      const kind = (i === 0 ? roster[pair] : roster[pair + 1])! as CreatureKind
      const a = (i / count) * Math.PI * 2 + (h % 628) / 100
      const r = i === 0 ? 0.9 : 1.4
      const hp = 380 * tierMul * (i === 0 ? 1.3 : 1)
      add({
        id: `neutral-${uid++}`,
        type: "neutral",
        team: "neutral",
        kind,
        x: camp.position.x + Math.cos(a) * r,
        z: camp.position.z + Math.sin(a) * r,
        heading: a + Math.PI,
        hp,
        maxHp: hp,
        armor: 2 * tierMul,
        damage: 18 * tierMul,
        attackTime: 1.2,
        range: 1.4,
        speed: 2.6,
        home: { x: camp.position.x, z: camp.position.z, campId: camp.id },
      })
    }
  }
  for (const c of map.camps) spawnCamp(c)

  const roshanPos = (() => {
    const r = map.landmarks.find((l) => l.kind === "roshan")!.position
    const dx = map.size / 2 - r.x
    const dz = map.size / 2 - r.z
    const len = Math.hypot(dx, dz) || 1
    return { x: r.x + (dx / len) * 2.3, z: r.z + (dz / len) * 2.3, heading: Math.atan2(dx, dz) }
  })()
  const spawnRoshan = () =>
    add({
      id: `roshan-${uid++}`,
      type: "roshan",
      team: "neutral",
      kind: "roshan",
      x: roshanPos.x,
      z: roshanPos.z,
      heading: roshanPos.heading,
      hp: 5200 + clock * 1.5,
      maxHp: 5200 + clock * 1.5,
      armor: 14,
      damage: 85 + clock * 0.04,
      attackTime: 1.4,
      range: 2.2,
      speed: 2,
      home: { x: roshanPos.x, z: roshanPos.z, campId: "roshan" },
      contributors: new Map(),
    })
  spawnRoshan()

  // --- helpers ---------------------------------------------------------------------
  const isEnemy = (a: Body, o: Body) => {
    if (!o.alive || o === a || o.team === a.team) return false
    // Neutrals only fight heroes that engage them (and vice versa); creeps ignore neutrals.
    if (a.team === "neutral" || o.team === "neutral") return a.type === "hero" || o.type === "hero"
    return true
  }

  const statMul = (b: Body, stat: "attack" | "speed" | "armor" | "attackSpeed") =>
    1 + b.st.buffs.filter((x) => x.stat === stat).reduce((s, x) => s + x.pct, 0)

  const effectiveArmor = (b: Body) => b.armor * statMul(b, "armor")
  const mitigation = (b: Body) => {
    const a = effectiveArmor(b)
    return a >= 0 ? 1 - (0.06 * a) / (1 + 0.06 * a) : 1
  }

  const credit = (src: Body | undefined, dmg: number, target: Body) => {
    if (!src?.hero) return
    if (target.type === "hero") src.hero.heroDamage += dmg
    target.lastHit = src
    target.contributors?.set(src.id, clock)
  }

  const deal = (src: Body | undefined, target: Body, raw: number, kind: "physical" | "magic") => {
    if (!target.alive) return
    // Eul's cyclone: invulnerable. BKB: immune to magic damage (spec/09).
    if (target.st.cyclone > 0) return
    if (
      kind === "magic" &&
      target.st.immune > 0 &&
      src?.hero &&
      !hasTag(src.hero.def.id, "bkb-piercing")
    )
      return
    if (src?.hero && target.hero) {
      target.hero.lastHeroDamage = clock
      // Focus metric (spec/09 C8): hero damage dealt within a live lock by heroes
      // near the locked target — what share lands on the locked hero.
      const lock = brain.board(src.hero.side).lock(clock)
      const locked = lock ? heroes.find((x) => x.id === lock.target) : undefined
      if (locked?.alive && dist(src, locked) <= LOCK_RADIUS) {
        lockCasts.total += raw
        if (target === locked) lockCasts.onLock += raw
      }
    }
    if (target.structure && !vulnerable(target)) return
    let dmg = raw * (kind === "physical" ? mitigation(target) : 0.85)
    if (kind === "magic" && target.hero)
      dmg *=
        1 - Math.min(0.6, itemSum(target.hero, "magicResist") + (target.st.glimmer > 0 ? 0.25 : 0))
    if (src?.hero && target.hero) {
      const m = matchupMul(src.hero.def.id, target.hero.def.id)
      dmg *= phase === "laning" ? 1 + (m - 1) * 0.5 : m
      target.hero.taken[kind] += dmg
    }
    if (phase === "laning" && target.type === "tower" && (target.structure?.tier ?? 1) === 1)
      dmg *= 0.75
    if (target.st.shield > 0) {
      const absorbed = Math.min(target.st.shield, dmg)
      target.st.shield -= absorbed
      dmg -= absorbed
    }
    target.hp -= dmg
    credit(src, dmg, target)
    if (src && src.st.lifestealT > 0 && src.st.lifesteal > 0) heal(src, src, dmg * src.st.lifesteal)
    if (src?.hero) {
      const ls = src.hero.items.reduce((s, id) => s + (lookupItem(id).lifesteal ?? 0), 0)
      if (ls > 0 && kind === "physical") heal(src, src, dmg * ls)
    }
    if (target.hp <= 0) kill(target, src)
  }

  const heal = (src: Body, target: Body, amount: number) => {
    if (!target.alive) return
    const before = target.hp
    target.hp = Math.min(target.maxHp, target.hp + amount)
    if (src.hero && src !== target) src.hero.healing += target.hp - before
  }

  const fx = (e: FxEvent) => fxQueue.push(e)

  const grant = (h: Body, gold: number, xp: number, source: GoldSource) => {
    const s = h.hero!
    s.gold += gold
    s.goldEarned += gold
    sources[s.side][source] += gold
    s.xp += xp
    while (s.level < MAX_LEVEL && s.xp >= XP_CURVE[s.level]!) {
      s.level++
      recomputeStats(h)
      h.hp = Math.min(h.maxHp, h.hp + h.maxHp * 0.15)
      fx({ t: clock, kind: "levelup", at: { x: h.x, z: h.z }, team: h.team })
    }
  }

  const heroLabel = (b: Body) => `${b.hero!.player.name} (${b.hero!.def.name})`

  const kill = (target: Body, src: Body | undefined) => {
    if (!target.alive) return
    // Aegis: revive in place once.
    if (target.hero?.aegis) {
      target.hero.aegis = false
      target.hp = target.maxHp
      target.st = emptyStatus()
      fx({ t: clock, kind: "heal", at: { x: target.x, z: target.z }, team: target.team })
      feed.push({
        t: clock,
        kind: "aegis",
        side: sideOf(target.team as Team),
        text: `${heroLabel(target)} reincarnates with the Aegis`,
      })
      return
    }
    target.alive = false
    target.hp = 0
    rings.dropTarget(target.id)
    rings.release(target.id)
    if (target.swing) target.swing = newSwing()
    fx({ t: clock, kind: "death", at: { x: target.x, z: target.z }, team: target.team })
    if (target.hero) lastDeathAt[target.hero.side] = { x: target.x, z: target.z, t: clock }
    const killer = src?.hero ? src : target.lastHit?.hero ? target.lastHit : undefined

    if (target.type === "hero") {
      const h = target.hero!
      h.deaths++
      h.respawn = (RESPAWN_BASE + h.level * RESPAWN_PER_LEVEL) * (phase === "late" ? 1.3 : 1)
      h.intent = "dead"
      const lost = Math.min(h.gold, 60 + h.level * 15)
      h.gold -= lost
      const enemyTeam = target.team === "radiant" ? "dire" : "radiant"
      kills[sideOf(enemyTeam)]++
      const assisters = heroes.filter(
        (o) =>
          o.team === enemyTeam &&
          o !== killer &&
          (target.contributors?.get(o.id) ?? -99) > clock - 8,
      )
      if (killer) {
        killer.hero!.kills++
        grant(
          killer,
          KILL_GOLD + h.level * 12 + (firstBlood ? 0 : 150),
          KILL_XP + h.level * 20,
          "kills",
        )
      }
      for (const a of assisters) {
        a.hero!.assists++
        grant(a, ASSIST_GOLD, KILL_XP * 0.6, "assists")
      }
      // Comeback bounty (spec/10 layer 5): killing the richer team pays extra.
      const winSide = sideOf(enemyTeam)
      const share = comebackShare(
        sideSum(winSide, netWorthOf),
        sideSum(h.side, netWorthOf),
        (killer ? 1 : 0) + assisters.length,
      )
      if (share > 0)
        for (const x of killer ? [killer, ...assisters] : assisters) grant(x, share, 0, "kills")
      const text = killer
        ? `${heroLabel(killer)} slew ${heroLabel(target)}`
        : `${heroLabel(target)} was slain`
      feed.push({
        t: clock,
        kind: firstBlood ? "kill" : "first-blood",
        side: sideOf(enemyTeam),
        text: firstBlood ? text : `First blood! ${text}`,
      })
      firstBlood = true
      target.contributors?.clear()
      return
    }

    if (target.type === "creep" || target.type === "neutral") {
      const gold = target.type === "creep" ? CREEP_GOLD : NEUTRAL_GOLD
      const xp = target.type === "creep" ? CREEP_XP : NEUTRAL_XP
      if (killer) {
        killer.hero!.lastHits++
        grant(killer, gold, xp * 0.5, target.type === "creep" ? "creeps" : "neutrals")
      }
      const sharers = heroes.filter(
        (h) =>
          h.alive && h.team !== target.team && h.team !== "neutral" && dist(h, target) < XP_RANGE,
      )
      // Shared XP decays with sqrt so duo lanes aren't starved.
      for (const h of sharers)
        grant(h, 0, (xp * 0.8) / Math.sqrt(Math.max(1, sharers.length)), "creeps")
      if (target.type === "neutral" && target.home) {
        const campId = target.home.campId
        const remaining = bodies.some(
          (b) => b.alive && b.type === "neutral" && b.home?.campId === campId,
        )
        if (!remaining) {
          campTimers.set(campId, CAMP_RESPAWN)
          const kh = killer?.hero
          if (kh) {
            const idx = map.camps.findIndex((c) => c.id === campId)
            const drop = rollNeutralDrop(clock / 60, Math.max(0, idx), kh.inv.neutral)
            if (drop) {
              kh.inv.neutral = drop
              kh.items = effectiveItems(kh.inv, clock)
              recomputeStats(killer!)
              feed.push({
                t: clock,
                kind: "item",
                side: kh.side,
                text: `${kh.player.name} found ${lookupItem(drop).name} (neutral tier)`,
              })
            }
          }
        }
      }
      return
    }

    if (target.type === "roshan") {
      const team = (killer?.team ?? target.lastHit?.team) as Team | undefined
      roshanTimer = ROSHAN_RESPAWN
      if (team) {
        for (const h of heroes.filter((x) => x.team === team)) grant(h, ROSHAN_GOLD, 300, "roshan")
        const carrier =
          heroes
            .filter((x) => x.team === team && x.alive)
            .toSorted(
              (a, b) =>
                (b.hero!.role === "carry" ? 1 : 0) - (a.hero!.role === "carry" ? 1 : 0) ||
                b.hero!.level - a.hero!.level,
            )[0] ?? killer
        if (carrier?.hero) carrier.hero.aegis = true
        feed.push({
          t: clock,
          kind: "roshan",
          side: sideOf(team),
          text: `${team === "radiant" ? draft.blue.name : draft.red.name} slew Roshan${carrier?.hero ? ` — Aegis to ${carrier.hero.player.name}` : ""}`,
        })
      }
      return
    }

    // Structures
    const s = target.structure!
    const attackers = (s.team === "radiant" ? "dire" : "radiant") as Team
    const atkSide = sideOf(attackers)
    if (target.type === "tower") {
      towersDown[atkSide]++
      if (s.tier === 3) lostT3[otherSide(atkSide)] = true
      if ((s.tier ?? 1) === 1) tier1Down++
      if ((s.tier ?? 1) === 3) tier3Down = true
      for (const h of heroes.filter((x) => x.team === attackers))
        grant(h, TOWER_GOLD, 120, "structures")
      feed.push({
        t: clock,
        kind: "tower",
        side: atkSide,
        text: `${atkSide === "blue" ? draft.blue.name : draft.red.name} destroyed a tier ${s.tier} tower${s.lane ? ` (${s.lane})` : ""}`,
      })
    } else if (target.type === "rax") {
      if (s.lane) empowered.add(`${atkSide}:${s.lane}`)
      tier3Down = true
      feed.push({
        t: clock,
        kind: "rax",
        side: atkSide,
        text: `${atkSide === "blue" ? draft.blue.name : draft.red.name} destroyed ${s.kind === "barracks-melee" ? "melee" : "ranged"} barracks (${s.lane})`,
      })
    } else if (target.type === "ancient") {
      winner = atkSide
      feed.push({
        t: clock,
        kind: "ancient",
        side: atkSide,
        text: `${atkSide === "blue" ? draft.blue.name : draft.red.name} destroyed the Ancient!`,
      })
    }
  }

  // --- abilities ---------------------------------------------------------------------
  const applyEffects = (caster: Body, targets: readonly Body[], ability: Ability) => {
    const h = caster.hero!
    const power = powerOf(h) * skillMul(h) * synergyMul[h.side]
    const piercing = hasTag(h.def.id, "bkb-piercing")
    for (const t of targets) {
      const hostile = t.team !== caster.team
      if (hostile && t.st.cyclone > 0) continue
      for (const e of ability.effects) {
        if (
          hostile &&
          t.st.immune > 0 &&
          !piercing &&
          (e.type === "stun" || e.type === "root" || e.type === "slow" || e.type === "dot")
        )
          continue
        applyEffect(caster, t, e, power, h.level)
        if (hostile && t.hero && (e.type === "stun" || e.type === "root"))
          brain.board(h.side).noteDisable(t.id, clock + e.duration)
      }
      // Blackboard target lock: an initiator (or any disabler) holding a hero.
      if (hostile && t.hero && hasDisableEffect(ability))
        brain.board(h.side).setLock(t.id, caster.id, clock)
    }
  }

  const applyEffect = (caster: Body, t: Body, e: Effect, power: number, level: number) => {
    switch (e.type) {
      case "damage":
        deal(caster, t, (e.amount + (e.scale ?? 0) * level) * power, "magic")
        break
      case "dot":
        t.st.dots.push({ dps: e.dps * power, t: e.duration, src: caster })
        break
      case "heal": {
        const amt = (e.amount + (e.scale ?? 0) * level) * power
        heal(caster, t, amt)
        fx({ t: clock, kind: "heal", at: { x: t.x, z: t.z }, team: t.team })
        break
      }
      case "hot":
        t.st.hots.push({ hps: e.hps * power, t: e.duration, src: caster })
        break
      case "stun":
        if (t.structure) break
        t.st.stun = Math.max(t.st.stun, e.duration * (t.type === "roshan" ? 0.5 : 1))
        fx({ t: clock, kind: "stun", at: { x: t.x, z: t.z }, team: t.team })
        break
      case "root":
        if (t.structure) break
        t.st.root = Math.max(t.st.root, e.duration)
        break
      case "slow":
        if (t.structure) break
        t.st.slow = Math.max(t.st.slow, e.pct)
        t.st.slowT = Math.max(t.st.slowT, e.duration)
        break
      case "shield":
        t.st.shield += e.amount * power
        t.st.shieldT = Math.max(t.st.shieldT, e.duration)
        fx({ t: clock, kind: "shield", at: { x: t.x, z: t.z }, team: t.team })
        break
      case "buff":
        t.st.buffs.push({ stat: e.stat, pct: e.pct, t: e.duration })
        break
      case "lifesteal":
        t.st.lifesteal = Math.max(t.st.lifesteal, e.pct)
        t.st.lifestealT = Math.max(t.st.lifestealT, e.duration)
        break
      case "execute":
        if (t.alive && t.hp / t.maxHp < e.threshold && !t.structure)
          deal(caster, t, t.hp + 9999, "magic")
        break
      case "dash":
        break
    }
  }

  /** Try to cast `ability`; returns true if cast. */
  const tryCast = (b: Body, ability: Ability, isUlt: boolean): boolean => {
    const h = b.hero!
    if (isUlt && (h.level < 6 || h.ultCd > 0)) return false
    if (!isUlt && h.skillCd > 0) return false
    const cost = manaCost(h, isUlt)
    if (h.mana < cost) return false
    const tg = ability.target
    const board = brain.board(h.side)
    const lock = board.lock(clock)
    const disabler = hasDisableEffect(ability)
    const reach =
      "range" in tg ? tg.range + ("radius" in tg ? tg.radius : 0) : "radius" in tg ? tg.radius : 8
    const foes = [...near(b, reach + 1)].filter((o) => isEnemy(b, o) && !o.structure && seen(b, o))
    const friends = heroes.filter((o) => o.alive && o.team === b.team)
    let targets: Body[] = []
    let at: { x: number; z: number } = b
    let radius = 0
    // Ult discipline: AoE/line ults wait for 1..3 heroes; single-target ults wait for a weak target.
    const disc = behaviorOf(h).ultDiscipline
    const aoeLike = tg.kind === "enemy-aoe" || tg.kind === "self-aoe" || tg.kind === "line"
    const minT =
      isUlt && aoeLike
        ? Math.max(ability.minTargets ?? 1, 1 + Math.round((2 * disc) / 100))
        : (ability.minTargets ?? 1)
    const heroFoes = foes.filter((f) => f.type === "hero")
    const pickFoes = heroFoes.length ? heroFoes : foes

    switch (tg.kind) {
      case "enemy": {
        const travel = (f: Body) => (projectileAbility(ability) ? dist(b, f) / PROJECTILE_SPEED : 0)
        const inRange = pickFoes
          .filter((f) => dist(b, f) <= tg.range)
          .filter((f) => !(isUlt && disc >= 70 && f.type === "hero" && f.hp / f.maxHp > 0.5))
          // Chain-stun: don't overlap our own disable still running on this hero.
          .filter(
            (f) =>
              !(
                disabler &&
                f.type === "hero" &&
                holdDisable(board.disableLeft(f.id, clock), travel(f))
              ),
          )
          // Blackboard focus: the locked target first, then the weakest.
          .toSorted(
            (x, y) =>
              (lock?.target === y.id ? 1 : 0) - (lock?.target === x.id ? 1 : 0) ||
              x.hp / x.maxHp - y.hp / y.maxHp,
          )
        if (inRange[0]) targets = [inRange[0]]
        at = targets[0] ?? b
        break
      }
      case "enemy-aoe": {
        // Centre on the spot that catches the most heroes (creeps break ties).
        let best: Body[] = []
        let bestScore = -1
        let center: Body | null = null
        for (const c of pickFoes) {
          if (dist(b, c) > tg.range) continue
          const group = foes.filter((f) => dist(f, c) <= tg.radius)
          const score = group.filter((x) => x.type === "hero").length * 10 + group.length
          if (score > bestScore) {
            best = group
            bestScore = score
            center = c
          }
        }
        const heroCount = best.filter((x) => x.type === "hero").length
        // A lone-hero ult is still worth it on a low target or in a real fight.
        const finisher =
          isUlt &&
          heroCount >= 1 &&
          (best.some((x) => x.type === "hero" && x.hp / x.maxHp < 0.45) || heroFoes.length >= 3)
        if (center && (heroCount >= minT || finisher || (isUlt ? false : best.length >= 2))) {
          targets = best
          at = center
          radius = tg.radius
        }
        break
      }
      case "self-aoe": {
        const group = foes.filter((f) => dist(f, b) <= tg.radius)
        const heroCount = group.filter((x) => x.type === "hero").length
        const finisher =
          isUlt && heroCount >= 1 && group.some((x) => x.type === "hero" && x.hp / x.maxHp < 0.45)
        if (heroCount >= minT || finisher || (!isUlt && group.length >= 3)) {
          targets = group
          radius = tg.radius
        }
        break
      }
      case "line": {
        const t0 = pickFoes
          .filter((f) => dist(b, f) <= tg.range)
          .toSorted((x, y) => dist(b, x) - dist(b, y))[0]
        if (t0) {
          const dx = (t0.x - b.x) / (dist(b, t0) || 1)
          const dz = (t0.z - b.z) / (dist(b, t0) || 1)
          targets = foes.filter((f) => {
            const px = f.x - b.x
            const pz = f.z - b.z
            const along = px * dx + pz * dz
            return along >= 0 && along <= tg.range && Math.abs(px * dz - pz * dx) <= tg.width
          })
          at = t0
        }
        break
      }
      case "self":
        if (heroFoes.some((f) => dist(f, b) < 5) || (b.target && b.target.type === "roshan"))
          targets = [b]
        break
      case "ally": {
        const hurt = friends
          .filter((f) => dist(f, b) <= tg.range && f.hp / f.maxHp < 0.88)
          .toSorted((x, y) => x.hp / x.maxHp - y.hp / y.maxHp)[0]
        if (hurt) {
          targets = [hurt]
          at = hurt
        }
        break
      }
      case "ally-aoe": {
        const group = friends.filter((f) => dist(f, b) <= tg.radius)
        const hurt = group.filter((f) => f.hp / f.maxHp < 0.7).length
        if (group.length >= minT && (hurt >= 1 || heroFoes.some((f) => dist(f, b) < 6))) {
          targets = group
          radius = tg.radius
        }
        break
      }
    }
    if (targets.length === 0) return false
    // Chain-stun for area disables: wait while every hero caught is still held by us.
    if (
      disabler &&
      radius > 0 &&
      targets.some((x) => x.type === "hero") &&
      targets
        .filter((x) => x.type === "hero")
        .every((x) => holdDisable(board.disableLeft(x.id, clock), 0))
    )
      return false
    h.mana -= cost

    // Dash first (moves caster toward the target); forced displacement
    // grants free pathing (spec/11 layer 4).
    const dash = ability.effects.find((e) => e.type === "dash")
    if (dash && dash.type === "dash" && at !== b) {
      const d = dist(b, at)
      const k = Math.max(0, Math.min(1, (d - 1) / d))
      b.x += (at.x - b.x) * k
      b.z += (at.z - b.z) * k
      b.freePath = FREE_PATH_T
      b.velMag = 0
    }
    const style = ability.fx
    if (projectileAbility(ability) && at !== b) {
      // Travelling spell (spec/09): homing for single target, sweeping for lines.
      const line = tg.kind === "line"
      const d = dist(b, at) || 1
      projectiles.push({
        caster: b,
        ability,
        line,
        target: line ? undefined : targets[0],
        x: b.x,
        z: b.z,
        dx: (at.x - b.x) / d,
        dz: (at.z - b.z) / d,
        left: line && "range" in tg ? tg.range : 99,
        width: line && "width" in tg ? tg.width : 0,
        hit: new Set(),
      })
      fx({
        t: clock,
        kind: "projectile",
        from: { x: b.x, z: b.z },
        to: { x: at.x, z: at.z },
        duration: d / PROJECTILE_SPEED,
        team: b.team,
        style,
      })
    } else applyEffects(b, targets, ability)
    if (projectileAbility(ability) && at !== b) {
      // fx already emitted
    } else if (radius > 0)
      fx({ t: clock, kind: "aoe", at: { x: at.x, z: at.z }, radius, team: b.team, style })
    else if (at !== b)
      fx({
        t: clock,
        kind: "projectile",
        from: { x: b.x, z: b.z },
        to: { x: at.x, z: at.z },
        duration: 0.25,
        team: b.team,
        style,
      })
    else fx({ t: clock, kind: "aoe", at: { x: b.x, z: b.z }, radius: 1.4, team: b.team, style })
    if (isUlt) h.ultCd = ability.cooldown
    else h.skillCd = ability.cooldown
    b.swings = (b.swings ?? 0) + 1
    casts.set(
      `${h.def.id}:${isUlt ? "ult" : "skill"}`,
      (casts.get(`${h.def.id}:${isUlt ? "ult" : "skill"}`) ?? 0) + 1,
    )
    b.cooldown = Math.max(b.cooldown, 0.4)
    // Cast lock (spec/09 §4): planted like an attack point.
    if (b.swing) {
      cancelBackswing(b.swing)
      b.swing.castLock = CAST_LOCK
    }
    return true
  }

  // --- movement (spec/11 locomotion: turn-rate gate, clearance nav, wall slide) ----
  const nav = new DynamicNav(map)
  const rings = new AttackRings()
  const ownerOf = new WeakMap<Mover, Body>()
  /** Debug overlay capture (only while someone reads crowdDebug). */
  let debugOn = false
  const lastPref = new WeakMap<Mover, { x: number; z: number }>()
  const lastMode = new WeakMap<Mover, CrowdMode>()
  const crowdWorld: CrowdWorld<Mover> = {
    neighbors: (m, r, out) => {
      for (const o of near(m, r)) if (o.alive && o.mover && o.phase! <= 0) out.push(o.mover)
    },
    walkable: (x, z, m) => {
      const b = ownerOf.get(m)
      // Free pathing, or already wedged inside forest (escape any way out).
      return (b?.freePath ?? 0) > 0 || !nav.blocked({ x, z }) || nav.blocked(m)
    },
    canYield: (m, dx, dz) => {
      const b = ownerOf.get(m)
      if (!b || b.st.stun > 0 || b.st.root > 0) return false
      const t = b.target
      if (m.mode !== "engaged" || !t || !t.alive) return true
      return Math.hypot(b.x + dx - t.x, b.z + dz - t.z) <= reachOf(b, t)
    },
  }
  /** Engage: in reach ⇒ swing; else move to the ring slot / target (spec/09 §3). */
  const engageTarget = (b: Body, t: Body, dt: number) => {
    b.target = t
    const tr = t.mover?.radius ?? (t.structure ? (t.type === "tower" ? 0.8 : 1.2) : 0.4)
    const plan = planEngage(
      rings,
      { id: b.id, x: b.x, z: b.z, range: b.range },
      { id: t.id, x: t.x, z: t.z, radius: tr },
      clock,
      (id) => bodyById.get(id),
      (id) => {
        const o = bodyById.get(id)
        return !!o && o.alive && dist(o, t) <= reachOf(o, t)
      },
    )
    if (plan.inReach) {
      if (b.mover) b.mover.mode = "engaged"
      attack(b, t)
      // Settle into the reserved slot between swings (frees the ring edge for others).
      if (
        plan.drift &&
        b.mover &&
        b.swing &&
        !isLocked(b.swing) &&
        b.st.root <= 0 &&
        b.st.stun <= 0
      ) {
        cancelBackswing(b.swing)
        const d = dist(b, plan.drift)
        const v = Math.min(b.speed * statMul(b, "speed"), d / dt)
        b.mover.pvx = ((plan.drift.x - b.x) / d) * v
        b.mover.pvz = ((plan.drift.z - b.z) / d) * v
        b.mover.maxSpeed = Math.max(b.mover.maxSpeed, v)
      }
      return
    }
    if (plan.slotted || dist(b, plan.goal) < 6 || b.type !== "hero")
      stepToward(b, plan.goal, plan.stopAt, dt)
    else travel(b, plan.goal, plan.stopAt, dt)
  }

  /**
   * Turn-gated step toward a point: rotate toward the goal; accelerate
   * along the heading only inside the 0.2 rad gate; slide along walls.
   */
  const stepToward = (b: Body, goal: { x: number; z: number }, stopAt: number, dt: number) => {
    if (b.st.stun > 0 || b.st.root > 0) return
    const chasing =
      b.hero?.def.attack === "melee" && b.target?.type === "hero" && b.hero.intent === "fight"
    const spd =
      b.speed * statMul(b, "speed") * (1 - (b.st.slowT > 0 ? b.st.slow : 0)) * (chasing ? 1.12 : 1)
    if (b.swing && isLocked(b.swing)) return
    if (b.swing) cancelBackswing(b.swing) // a move order cancels backswing (orb-walk)
    if (!b.mover) {
      const save = b.speed
      b.speed = spd
      moveBody(b, nav, goal, stopAt, dt)
      b.speed = save
      return
    }
    // Micro range (spec/09 §5): context steering around bodies, no A*.
    let wp: Vec2 = goal
    const gd = dist(b, goal)
    b.micro = isMicro(b.micro ?? false, gd)
    if (b.micro && gd > stopAt + 0.05) {
      const blockers: Body[] = []
      for (const o of near(b, 2)) {
        if (o === b || !o.alive || dist(o, b) >= 2) continue
        // Idle teammates are not obstacles: walk at them and they yield (spec/09 §6).
        const idle =
          o.team === b.team && o.mover && !o.target && Math.hypot(o.mover.vx, o.mover.vz) < 0.05
        if (!idle) blockers.push(o)
      }
      const r = b.mover.radius
      const w = microWaypoint(
        b,
        r,
        goal,
        blockers.map((o) => ({ x: o.x, z: o.z, radius: o.mover?.radius ?? crowdRadius(o) })),
        (x, z) => !nav.blocked({ x, z }),
      )
      if (!w) return
      wp = w
    }
    // Stop distance is measured to the real goal, not the steering waypoint.
    steer(b, wp, gd - stopAt, spd, dt)
  }

  /**
   * Preferred velocity toward `wp` (spec/09 §1): the only movement output of decision
   * code. Turn rate still gates acceleration (spec/11); crowdStep integrates.
   */
  const steer = (b: Body, wp: Vec2, left: number, spd: number, dt: number) => {
    const m = b.mover!
    const dx = wp.x - b.x
    const dz = wp.z - b.z
    const d = Math.hypot(dx, dz)
    if (left <= 0.01 || d < 1e-6) return
    const desired = Math.atan2(dx, dz)
    b.heading = turnToward(b.heading, desired, b.turnRate ?? TURN.mid, dt)
    if (Math.abs(angDiff(desired, b.heading)) >= GATE * 4) return // turn in place first
    const v = Math.min(spd, MAX_SPEED, left / dt)
    m.pvx = (dx / d) * v
    m.pvz = (dz / d) * v
    m.maxSpeed = Math.min(MAX_SPEED, Math.max(spd, 0.1))
  }

  /** Travel to a far goal along a clearance-aware A* path (cached per body+goal). */
  const travel = (b: Body, goal: Vec2, stopAt: number, dt: number) => {
    if (dist(b, goal) <= stopAt) return
    const r = b.radius ?? HULL.creep
    const free = (b.freePath ?? 0) > 0
    const key = `${Math.floor(goal.x)},${Math.floor(goal.z)}:${r}:${free ? 1 : 0}`
    if (b.pathKey !== key || !b.path || b.path.length === 0) {
      b.path = [...nav.path(b, goal, r, { ignoreForest: free })]
      b.pathKey = key
    }
    const accept = r + 0.1
    let wp = b.path[0]!
    while (b.path.length > 1 && dist(b, wp) < accept) {
      b.path.shift()
      wp = b.path[0]!
    }
    stepToward(b, wp, b.path.length === 1 ? stopAt : 0, dt)
  }
  /** Chase a moving target: direct if close, otherwise path. */
  const moveToward = (b: Body, goal: { x: number; z: number }, stopAt: number, dt: number) => {
    if (dist(b, goal) < 6 || b.type !== "hero") stepToward(b, goal, stopAt, dt)
    else travel(b, goal, stopAt, dt)
  }

  // --- AI --------------------------------------------------------------------------
  const laneFront = (team: Team, laneId: LaneId) => {
    const lane = lanes.get(laneId)!
    const mine = bodies.filter(
      (b) => b.alive && b.type === "creep" && b.team === team && b.lane === laneId,
    )
    if (mine.length) {
      // `s` is distance travelled from the creep's own base for both teams.
      const s = Math.max(...mine.map((c) => c.s ?? 0))
      const p = lane.at(team === "radiant" ? s - 1.5 : lane.length - s + 1.5)
      return { x: p.x, z: p.z }
    }
    // No creeps: hold near own outermost standing tower.
    const towers = [...structureBodies.values()]
      .filter(
        (t) => t.alive && t.type === "tower" && t.team === team && t.structure!.lane === laneId,
      )
      .toSorted((a, b) => (a.structure!.tier ?? 1) - (b.structure!.tier ?? 1))
    const t = towers[0]
    if (t) return { x: t.x, z: t.z }
    const f = fountain(team)
    return f
  }

  const alliesNear = (b: Body, r: number) =>
    heroes.filter((h) => h.alive && h.team === b.team && dist(h, b) <= r)
  const enemyTowerNear = (b: Body, r: number) =>
    [...structureBodies.values()].find(
      (t) => t.alive && t.type === "tower" && t.team !== b.team && dist(t, b) <= r,
    )

  const objectiveFor = (team: Team): Body | null => {
    // Next vulnerable enemy structure, nearest to the team's centre of mass.
    const mine = heroes.filter((h) => h.alive && h.team === team)
    if (!mine.length) return null
    const cx = mine.reduce((s, h) => s + h.x, 0) / mine.length
    const cz = mine.reduce((s, h) => s + h.z, 0) / mine.length
    const targets = [...structureBodies.values()].filter(
      (t) => t.alive && t.team !== team && vulnerable(t),
    )
    return (
      targets.toSorted(
        (a, b) => Math.hypot(a.x - cx, a.z - cz) - Math.hypot(b.x - cx, b.z - cz),
      )[0] ?? null
    )
  }

  // --- tactics helpers ----------------------------------------------------------------
  const ptac = (h: HeroState): PlayerTactics => tac[h.side].players[h.player.id]!
  /** Effective aggression 0..100 (laning `aggressive` plan adds 15). */
  const aggressionOf = (h: HeroState) =>
    Math.min(
      100,
      ptac(h).behavior.aggression +
        (phase === "laning" && tac[h.side].plans.laning === "aggressive" ? 15 : 0),
    )
  const behaviorOf = (h: HeroState): Behavior => ptac(h).behavior
  /** Targeting: fight what you collide with; knowledge reads go through the fog (spec/08 §3). */
  const seen = (viewer: Body, o: Body) =>
    o.type !== "hero" ||
    (o.st.glimmer > 0 && o.team !== viewer.team ? dist(viewer, o) <= 1 : false) ||
    dist(viewer, o) <= 3 ||
    isVisibleToTeam(visionGrid[sideOf(viewer.team as Team)], staticFog, o)
  const visibleEnemyHeroes = (side: DraftSide) =>
    heroes.filter(
      (e) => e.alive && e.hero!.side !== side && knowledge[side].visible(e.id) !== undefined,
    )

  const coreOf = (side: DraftSide) =>
    heroes
      .filter((x) => x.hero!.side === side && x.alive && x.hero!.role !== "support")
      .toSorted(
        (a, b) =>
          (b.hero!.role === "carry" ? 1 : 0) - (a.hero!.role === "carry" ? 1 : 0) ||
          netWorthOf(b.hero!) - netWorthOf(a.hero!),
      )[0]
  const warderOf = (side: DraftSide) => {
    const alive = heroes.filter((x) => x.hero!.side === side && x.alive)
    return (
      alive.find((x) => x.hero!.slot === "roam") ??
      alive.find((x) => x.hero!.role === "support") ??
      alive.toSorted((a, b) => netWorthOf(a.hero!) - netWorthOf(b.hero!))[0]
    )
  }
  const wardTarget = (side: DraftSide): WardSpot | undefined => {
    const team = SIDE_TEAM[side]
    // Defensive vision (spec/10 layer 4): an ally died recently → ward the
    // nearest open spot within 12 tiles of the death first.
    const death = lastDeathAt[side]
    if (death && clock - death.t <= DEFENSIVE_WARD_WINDOW) {
      const near = spots
        .filter(
          (sp) =>
            dist(sp.at, death) <= 12 && !wards.some((w) => w.side === side && w.spotId === sp.id),
        )
        .toSorted((a, b) => dist(a.at, death) - dist(b.at, death) || (a.id < b.id ? -1 : 1))[0]
      if (near) return near
    }
    for (const zone of tac[side].vision) {
      if (zone === "enemy-jungle" && phase === "laning") continue
      const spot = spots.find(
        (sp) =>
          zoneFor(sp, team) === zone && !wards.some((w) => w.side === side && w.spotId === sp.id),
      )
      if (spot) return spot
    }
    return undefined
  }

  // --- next purchase (build preset + adaptive rule) ---------------------------------------
  const nextItemOf = (
    h: HeroState,
  ): { id: string; adaptive: boolean; fromBook?: boolean; reason?: string } | null => {
    if (countItems(h.inv) >= MAIN_SLOTS + BACKPACK_SLOTS) return null
    const pt = ptac(h)
    if (pt.adaptive && !h.adaptiveDone && countItems(h.inv) >= 1) {
      const total = h.taken.magic + h.taken.physical
      const enemyIds = draft.picks[otherSide(h.side)].map((p) => p.heroId)
      const magicShare =
        total >= 800
          ? h.taken.magic / total
          : enemyIds.filter(MAGIC_HEAVY).length / Math.max(1, enemyIds.length)
      if (magicShare >= 0.65 && itemSum(h, "magicResist") === 0)
        return { id: "nullstone", adaptive: true }
      if (1 - magicShare >= 0.65 && itemSum(h, "armor") === 0)
        return { id: "plate", adaptive: true }
    }
    const def = h.defensiveDone
      ? null
      : defensivePurchase(
          h.role,
          hasTag(h.def.id, "initiator") && h.def.attack === "melee",
          h.buildIdx,
          h.items,
        )
    if (def) return { id: def, adaptive: false }
    const book = buildById(pt.build).items
    const choice = chooseItem(purchaseView(h), book, threats[h.side])
    if (!choice) return null
    // Book cursor only advances for book items; rule/threat items are extras.
    return { id: choice.id, adaptive: false, fromBook: choice.fromBook, reason: choice.reason }
  }
  /** Inputs for the item AI (spec/10 layer 3) — only data the team can know. */
  const purchaseView = (h: HeroState): PurchaseView => {
    const enemy = otherSide(h.side)
    const total = h.taken.magic + h.taken.physical
    const enemyIds = draft.picks[enemy].map((p) => p.heroId)
    return {
      heroId: h.def.id,
      role: h.role,
      isCarry: h.role === "carry",
      isPipeBuyer: h.role === "offlane",
      gold: h.gold,
      items: allItems(h.inv),
      bookIndex: h.buildIdx,
      enemyHeroIds: enemyIds,
      enemyMagicShare:
        total >= 800
          ? h.taken.magic / total
          : enemyIds.filter(MAGIC_HEAVY).length / Math.max(1, enemyIds.length),
      losingBase: lostT3[h.side],
      netWorthDeficit: sideSum(enemy, netWorthOf) - sideSum(h.side, netWorthOf),
      teamHasPipe: heroes.some(
        (x) => x.hero!.side === h.side && allItems(x.hero!.inv).includes("pipe"),
      ),
      followsRules: true,
      enabledRules: ALL_RULES,
    }
  }
  /** Rescan what each team has *seen* of the enemy (fog-respecting). */
  const scanTeamThreats = () => {
    for (const side of ["blue", "red"] as const) {
      const spotted: { heroId: string; items: readonly string[] }[] = []
      for (const e of heroes) {
        if (e.hero!.side === side) continue
        const live = knowledge[side].visible(e.id)
        const ghost = knowledge[side].ghost(e.id)
        if (live) spotted.push({ heroId: e.hero!.def.id, items: live.items })
        else if (ghost) spotted.push({ heroId: e.hero!.def.id, items: ghost.itemsAtSeen })
      }
      const mine = heroes.filter((x) => x.hero!.side === side)
      const mag = mine.reduce((a, x) => a + x.hero!.taken.magic, 0)
      const all = mine.reduce((a, x) => a + x.hero!.taken.magic + x.hero!.taken.physical, 0)
      threats[side] = scanThreats(spotted, all > 0 ? mag / all : 0)
    }
  }
  /** Late-game slot management (spec/10 layer 5): sell small → luxury, or eat a buff. */
  const lateGame = (b: Body) => {
    const h = b.hero!
    const act = lateGameAction({
      gameMinutes: clock / 60,
      main: h.inv.main,
      gold: h.gold,
      floor: goldFloor(h.level, clock / 60, lostT3[h.side], false),
      consumed: h.consumed,
    })
    if (!act) return
    if (act.kind === "consume") {
      h.gold -= CONSUMABLE_BUFFS[act.buff].cost
      h.consumed.add(act.buff)
    } else {
      h.gold += Math.floor(itemById(act.sell).cost / 2)
      removeItem(h.inv, act.sell)
      h.gold -= itemById(act.buy).cost
      addItem(h.inv, act.buy)
    }
    purchases.push({
      t: clock,
      side: h.side,
      heroId: h.def.id,
      playerId: h.player.id,
      itemId: act.kind === "consume" ? act.buff : act.buy,
      adaptive: false,
    })
    h.items = effectiveItems(h.inv, clock)
    recomputeStats(b)
  }
  /** Buyback reserve (spec/10 layer 3); rule items ignore it. */
  const floorFor = (h: HeroState, reason: string | undefined) =>
    goldFloor(h.level, clock / 60, lostT3[h.side], reason?.startsWith("rule:") ?? false)
  /**
   * Buy toward the next item. At base items land in the inventory; away from
   * base they land in the stash and the courier delivers them (spec/10 S3).
   */
  const buy = (b: Body, atBase: boolean) => {
    const h = b.hero!
    const place = (id: string) => (atBase ? addItem(h.inv, id) : addToStash(h.inv, id))
    if (atBase && pullStash(h.inv).length > 0) {
      h.items = effectiveItems(h.inv, clock)
      recomputeStats(b)
    }
    if (atBase) lateGame(b)
    // Component-first (spec/10 layer 2): buy pieces as they become affordable,
    // then pay the recipe to combine. Net spend equals the full item cost.
    for (let guard = 0; guard < 8; guard++) {
      const next = nextItemOf(h)
      if (!next) return
      const missing = missingComponents(allItems(h.inv), next.id)
      if (missing.length > 0) {
        const piece = missing[0]!
        const pieceCost = itemById(piece).cost
        if (h.gold - floorFor(h, next.reason) < pieceCost) return
        if (!atBase && !h.inv.stash.includes(null)) return
        h.gold -= pieceCost
        place(piece)
        h.items = effectiveItems(h.inv, clock)
        recomputeStats(b)
        continue // same target next guard iteration
      }
      const recipe = recipeCost(next.id)
      if (h.gold - floorFor(h, next.reason) < recipe) return
      h.gold -= recipe
      for (const c of itemById(next.id).components) removeItem(h.inv, c)
      place(next.id)
      h.items = effectiveItems(h.inv, clock)
      if (next.adaptive) h.adaptiveDone = true
      else if (next.fromBook !== false) h.buildIdx++
      if (["bkb", "blink", "force", "eul"].includes(next.id)) h.defensiveDone = true
      purchases.push({
        t: clock,
        side: h.side,
        heroId: h.def.id,
        playerId: h.player.id,
        itemId: next.id,
        adaptive: next.adaptive,
      })
      recomputeStats(b)
    }
  }

  /** Go to the team objective, gathering on the lead first. */
  const goGroup = (b: Body, h: HeroState, intent: "group" | "push", need: number): boolean => {
    const obj = objectiveFor(b.team as Team)
    if (!obj) return false
    const lead = coreOf(h.side) ?? b
    const gathered = alliesNear(lead, 8).length >= need
    h.intent = intent
    h.goal = gathered || b === lead ? { x: obj.x, z: obj.z } : { x: lead.x, z: lead.z }
    return true
  }
  const goLane = (b: Body, h: HeroState, laneId: LaneId) => {
    h.intent = "lane"
    h.goal = laneFront(b.team as Team, laneId)
  }
  const defendSpot = (team: Team) => {
    const own = [...structureBodies.values()].filter(
      (t) => t.alive && t.team === team && (t.type === "tower" || t.type === "rax"),
    )
    const anc = [...structureBodies.values()].find((t) => t.type === "ancient" && t.team === team)!
    return (
      own
        .filter((t) => (t.structure!.tier ?? 1) >= 3 || t.type === "rax")
        .toSorted((a, c) => dist(c, anc) - dist(a, anc))[0] ?? anc
    )
  }
  const enemiesDead = (side: DraftSide) =>
    heroes.filter((x) => x.hero!.side !== side && !x.alive).length

  // --- Hero Think (spec/09) -----------------------------------------------------------
  const brain = createBrain<Body>({
    heroes,
    clock: () => clock,
    phase: () => phase,
    plans: (side) => tac[side].plans,
    behavior: (b) => behaviorOf(b.hero!),
    aggression: (b) => aggressionOf(b.hero!),
    knowledge: (side) => knowledge[side],
    fountain: (side) => fountain(SIDE_TEAM[side]),
    laneFront: (side, lane) => laneFront(SIDE_TEAM[side], lane),
    slotLane: (b) => slotLane(b.hero!),
    camps: (side) =>
      map.camps.filter(
        (c) =>
          c.team === SIDE_TEAM[side] &&
          bodies.some((x) => x.alive && x.type === "neutral" && x.home?.campId === c.id),
      ),
    enemyTowers: (side) =>
      [...structureBodies.values()].filter(
        (t) => t.alive && t.type === "tower" && t.team !== SIDE_TEAM[side],
      ),
    objective: (side) => {
      const o = objectiveFor(SIDE_TEAM[side])
      return o ? { x: o.x, z: o.z } : null
    },
    isCore: (b) => coreOf(b.hero!.side) === b,
    roshanUp: () => bodies.some((x) => x.alive && x.type === "roshan"),
    nextItemCost: (b) => {
      const n = nextItemOf(b.hero!)
      return n ? itemById(n.id).cost : null
    },
    manaCost: (b, isUlt) => manaCost(b.hero!, isUlt),
    stall: () => clock >= ANTI_STALL_AT,
    item: lookupItem,
  })

  /** Apply one macro decision to the hero's intent/goal. */
  const applyDecision = (b: Body, h: HeroState, r: ThinkResult, igl: IglCall | null) => {
    switch (r.action) {
      case "retreat":
        h.intent = "retreat"
        h.goal = fountain(b.team as Team)
        return
      case "save": {
        const ally = heroes.find((x) => x.id === r.save)
        h.saveId = r.save
        h.intent = "save"
        h.goal = ally ? { x: ally.x, z: ally.z } : null
        return
      }
      case "fight":
        h.intent = "fight"
        h.goal = r.fightAt ?? null
        return
      case "gank":
        h.intent = "gank"
        h.goal = r.gank?.at ?? null
        return
      case "objective": {
        if (r.mode === "roshan") {
          h.intent = "roshan"
          h.goal = roshanPos
          return
        }
        if (r.mode === "defend") {
          const spot = igl?.kind === "defend" && igl.at ? igl.at : defendSpot(b.team as Team)
          h.intent = "group"
          h.goal = { x: spot.x, z: spot.z }
          return
        }
        if (r.mode === "split" && r.splitAt) {
          h.intent = "push"
          h.goal = r.splitAt
          return
        }
        const pushing = calls[h.side].active === "push" || igl?.kind === "push"
        if (goGroup(b, h, pushing ? "push" : "group", phase === "late" ? 4 : pushing ? 2 : 3))
          return
        goLane(b, h, slotLane(h) ?? "mid")
        return
      }
      case "farm":
        if (r.farm?.kind === "camp") {
          h.intent = "jungle"
          h.goal = r.farm.at
          return
        }
        goLane(b, h, (r.farm?.id as LaneId | undefined) ?? slotLane(h) ?? "mid")
        return
    }
  }

  const think = (b: Body) => {
    const h = b.hero!
    const side = h.side
    const coach =
      calls[side].active && relayAt[side] === null && h.followCoach ? calls[side].active : null
    const igl = iglCall[side] && h.followIgl ? iglCall[side] : null
    const r = brain.think(b, {
      coach,
      igl: igl?.kind ?? null,
      iglTarget: igl?.kind === "gank" ? igl.target?.id : undefined,
    })
    h.lastAction = r.action
    h.scores = r.scores
    if (r.action === "retreat" || r.action === "save" || r.engage) {
      applyDecision(b, h, r, igl)
      return
    }

    // Shopping (spec/06): always at base; `on-item` walks home for an affordable item.
    const atBase = dist(b, fountain(b.team as Team)) < 14
    buy(b, atBase)
    const next = nextItemOf(h)
    if (
      !atBase &&
      next &&
      tac[side].shopTiming === "on-item" &&
      h.gold >= itemById(next.id).cost + 300 + behaviorOf(h).farm * 4 &&
      brain.known(side, 0).every((e) => dist(e.pos, b) >= 9)
    ) {
      h.intent = "shop"
      h.goal = fountain(b.team as Team)
      return
    }
    if (h.intent === "shop" && !atBase && next && h.gold >= itemById(next.id).cost) return
    // Warding (spec/06): the team's warder spends charges on the best open spot.
    if (wardStock[side].charges > 0 && warderOf(side) === b && !coach) {
      const spot = wardTarget(side)
      if (spot) {
        h.intent = "ward"
        h.goal = spot.at
        return
      }
    }
    applyDecision(b, h, r, igl)
  }

  // --- item actives & spell projectiles (spec/09) --------------------------------------
  const activeUses: Record<string, number> = {
    bkb: 0,
    blink: 0,
    force: 0,
    eul: 0,
    manta: 0,
    glimmer: 0,
    tango: 0,
  }
  let fizzled = 0
  const useActive = (b: Body, id: string, cd: number, text: string) => {
    b.hero!.itemCd[id] = cd
    activeUses[id] = (activeUses[id] ?? 0) + 1
    fx({
      t: clock,
      kind: "aoe",
      at: { x: b.x, z: b.z },
      radius: 1.2,
      team: b.team,
      style: "shield",
    })
    feed.push({ t: clock, kind: "item", side: b.hero!.side, text: `${heroLabel(b)} ${text}` })
  }
  /** Move a body up to `to`, stopping at the last walkable point on the way. */
  const displace = (b: Body, to: Vec2) => {
    const steps = 12
    let px = b.x
    let pz = b.z
    for (let i = 1; i <= steps; i++) {
      const x = b.x + ((to.x - b.x) * i) / steps
      const z = b.z + ((to.z - b.z) * i) / steps
      if (!map.isWalkable(x, z)) break
      px = x
      pz = z
    }
    b.x = px
    b.z = pz
    b.path = undefined
    b.freePath = FREE_PATH_T
    b.velMag = 0
  }
  const closestKnownEnemy = (b: Body) =>
    brain
      .known(b.hero!.side, 0)
      .filter((e) => e.visible)
      .toSorted((x, y) => dist(x.pos, b) - dist(y.pos, b) || (x.id < y.id ? -1 : 1))[0]
  /** Distance to the nearest lit enemy spell projectile heading for this hero. */
  const incomingProjectile = (b: Body) => {
    const side = b.hero!.side
    let best = Infinity
    for (const p of projectiles) {
      if (p.caster.team === b.team) continue
      if (!isVisibleToTeam(visionGrid[side], staticFog, p)) continue
      const d = dist(p, b)
      const aimed = p.line
        ? (b.x - p.x) * p.dx + (b.z - p.z) * p.dz > 0 &&
          Math.abs((b.x - p.x) * p.dz - (b.z - p.z) * p.dx) <= p.width + 0.5
        : p.target === b
      if (aimed && d < best) best = d
    }
    return best
  }

  /** Layer 3 item triggers; returns true if the hero spent its tick on an active. */
  const microItems = (b: Body): boolean => {
    const h = b.hero!
    if (b.st.stun > 0 || b.st.cyclone > 0) return false
    const enemies = brain.known(h.side, 0).filter((e) => e.visible)
    const near7 = enemies.filter((e) => dist(e.pos, b) <= 7).length
    const fightStart = near7 > 0 && clock - h.lastEnemyNear >= 10
    if (near7 > 0) h.lastEnemyNear = clock
    const readySet = new Set(
      (["bkb", "blink", "force", "eul", "manta", "glimmer"] as const).filter((id) => ready(h, id)),
    )
    if (readySet.size === 0) return false
    const use = defensiveTrigger({
      hpPct: b.hp / b.maxHp,
      stunned: false,
      ready: readySet,
      sinceHeroDamage: clock - h.lastHeroDamage,
      incomingProjectile: incomingProjectile(b),
      enemiesClose: enemies.filter((e) => dist(e.pos, b) <= 4).length,
      enemiesNear: near7,
      role: h.role,
      fightStart,
      rooted: b.st.root > 0,
    })
    const threat = closestKnownEnemy(b)
    if (use?.item === "bkb") {
      b.st.immune = BKB_DURATION
      b.st.root = 0
      b.st.slow = 0
      b.st.dots = []
      useActive(b, "bkb", lookupItem("bkb").active!.cooldown, "activates Black King Bar")
      return false
    }
    if (use?.item === "manta") {
      // Basic dispel: clears root, slow and DoTs; no invulnerability.
      b.st.root = 0
      b.st.slow = 0
      b.st.slowT = 0
      b.st.dots = []
      useActive(b, "manta", lookupItem("manta").active!.cooldown, "dispels with Manta Style")
      return false
    }
    if (use?.item === "eul") {
      b.st.root = 0
      b.st.cyclone = EUL_DURATION
      b.st.dots = []
      useActive(b, "eul", lookupItem("eul").active!.cooldown, "cyclones out with Eul's Scepter")
      return true
    }
    if (use?.item === "force" && threat) {
      displace(b, awayFrom(b, threat.pos, FORCE_DISTANCE))
      useActive(b, "force", lookupItem("force").active!.cooldown, "forces out of danger")
      return true
    }
    if (use?.item === "blink") {
      const home = fountain(b.team as Team)
      const d = dist(b, home) || 1
      const k = Math.min(1, 8 / d)
      displace(b, { x: b.x + (home.x - b.x) * k, z: b.z + (home.z - b.z) * k })
      useActive(b, "blink", lookupItem("blink").active!.cooldown, "blinks away")
      h.intent = "retreat"
      h.goal = home
      return true
    }
    // Support save with Force Staff: push the endangered ally away from its attacker.
    if (h.intent === "save" && readySet.has("glimmer") && h.saveId) {
      const ally = heroes.find((x) => x.id === h.saveId)
      // Glimmer works on stunned allies (Force can't move them out of a lock).
      if (ally?.alive && dist(ally, b) <= 7 && ally.st.glimmer <= 0) {
        ally.st.glimmer = GLIMMER_DURATION
        for (const o of bodies) if (o.target === ally && o.team !== ally.team) o.target = undefined
        useActive(
          b,
          "glimmer",
          lookupItem("glimmer").active!.cooldown,
          `glimmers ${heroLabel(ally)}`,
        )
        return true
      }
    }
    if (h.intent === "save" && readySet.has("force") && h.saveId) {
      const ally = heroes.find((x) => x.id === h.saveId)
      if (ally?.alive && dist(ally, b) <= 6 && ally.st.stun <= 0) {
        const foe = brain
          .known(h.side, 0)
          .filter((e) => e.visible)
          .toSorted((x, y) => dist(x.pos, ally) - dist(y.pos, ally))[0]
        if (foe && dist(foe.pos, ally) <= 8) {
          displace(ally, awayFrom(ally, foe.pos, FORCE_DISTANCE))
          useActive(b, "force", lookupItem("force").active!.cooldown, `saves ${heroLabel(ally)}`)
          return true
        }
      }
    }
    // Initiator engage: Blink onto a fight target, then the disable chains this tick.
    if (
      readySet.has("blink") &&
      clock - h.lastHeroDamage >= 3 &&
      (h.intent === "fight" || h.intent === "gank") &&
      hasTag(h.def.id, "initiator")
    ) {
      const lock = brain.board(h.side).lock(clock)
      const target =
        enemies.find((e) => e.id === lock?.target && dist(e.pos, b) <= BLINK_RANGE) ??
        enemies
          .filter((e) => dist(e.pos, b) <= BLINK_RANGE && dist(e.pos, b) > 3)
          .toSorted((x, y) => x.hpFrac - y.hpFrac || (x.id < y.id ? -1 : 1))[0]
      const disableReady =
        (h.skillCd <= 0 && hasDisableEffect(h.def.skill)) ||
        (h.level >= 6 && h.ultCd <= 0 && hasDisableEffect(h.def.ultimate))
      if (
        target &&
        initiatorEngage({
          blinkReady: true,
          disableReady,
          alliesNear: alliesNear(b, 10).length - 1,
          ganking: h.intent === "gank",
          targetDist: dist(target.pos, b),
        })
      ) {
        displace(b, blinkLanding(b, target.pos))
        brain.board(h.side).setLock(target.id, b.id, clock)
        useActive(b, "blink", lookupItem("blink").active!.cooldown, "blinks in")
        return false
      }
    }
    return false
  }

  /** Positioning ring: initiator holds outside vision; ranged heroes kite melee. */
  const microMove = (b: Body, dt: number): boolean => {
    const h = b.hero!
    if (h.intent !== "fight" && h.intent !== "gank") return false
    if (b.st.stun > 0 || b.st.root > 0) return false
    const enemies = brain.known(h.side, 0).filter((e) => e.visible)
    if (!enemies.length) return false
    if (h.def.attack === "ranged") {
      const v = kiteVector(
        b,
        b.range,
        enemies.map((e) => ({
          x: e.pos.x,
          z: e.pos.z,
          melee: heroes.find((x) => x.id === e.id)!.hero!.def.attack === "melee",
        })),
      )
      // Hysteresis (spec/09 L3): once a melee threat triggers a kite, keep backing off
      // until the closest melee is at 95 % range, instead of stepping on every swing.
      const meleeGap = Math.min(
        ...enemies
          .filter((e) => heroes.find((x) => x.id === e.id)!.hero!.def.attack === "melee")
          .map((e) => dist(e.pos, b)),
      )
      if (v) h.kiting = true
      if (h.kiting && meleeGap >= b.range * 0.95) h.kiting = false
      if (h.kiting && b.cooldown > 0.1) {
        const dir = v ?? {
          x: (b.x - closestKnownEnemy(b)!.pos.x) / (meleeGap || 1),
          z: (b.z - closestKnownEnemy(b)!.pos.z) / (meleeGap || 1),
        }
        stepToward(b, { x: b.x + dir.x * 2, z: b.z + dir.z * 2 }, 0, dt)
        return true
      }
      return false
    }
    if (hasTag(h.def.id, "initiator") && ready(h, "blink") && h.intent === "fight") {
      const nearest = closestKnownEnemy(b)!
      const allies = alliesNear(b, 10).length - 1
      if (allies === 0) {
        const hold = holdPoint(b, nearest.pos)
        if (hold) {
          stepToward(b, hold, 0.3, dt)
          return true
        }
        return true
      }
    }
    return false
  }

  const tickProjectiles = (dt: number) => {
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const p = projectiles[i]!
      const step = PROJECTILE_SPEED * dt
      if (!p.line) {
        const t = p.target!
        if (!t.alive || t.st.cyclone > 0) {
          fizzled++
          projectiles.splice(i, 1)
          continue
        }
        const d = dist(p, t)
        if (d <= step + 0.4) {
          applyEffects(p.caster, [t], p.ability)
          projectiles.splice(i, 1)
          continue
        }
        p.x += ((t.x - p.x) / d) * step
        p.z += ((t.z - p.z) / d) * step
        continue
      }
      p.x += p.dx * step
      p.z += p.dz * step
      p.left -= step
      const hits: Body[] = []
      for (const o of near(p, p.width + 1)) {
        if (p.hit.has(o.id) || o.structure || !isEnemy(p.caster, o)) continue
        if (dist(o, p) <= p.width + 0.4) {
          p.hit.add(o.id)
          hits.push(o)
        }
      }
      if (hits.length) applyEffects(p.caster, hits, p.ability)
      if (p.left <= 0) projectiles.splice(i, 1)
    }
  }

  // Spatial hash (4×4 tile cells), rebuilt once per tick: target queries stay O(nearby).
  const CELL = 4
  const COLS = Math.ceil(map.size / CELL)
  const grid: Body[][] = Array.from({ length: COLS * COLS }, () => [])
  const rebuildGrid = () => {
    for (const c of grid) c.length = 0
    for (const b of bodies) {
      if (!b.alive) continue
      const cx = Math.max(0, Math.min(COLS - 1, Math.floor(b.x / CELL)))
      const cz = Math.max(0, Math.min(COLS - 1, Math.floor(b.z / CELL)))
      grid[cz * COLS + cx]!.push(b)
    }
  }
  const near = function* (at: { x: number; z: number }, r: number) {
    const x0 = Math.max(0, Math.floor((at.x - r) / CELL))
    const x1 = Math.min(COLS - 1, Math.floor((at.x + r) / CELL))
    const z0 = Math.max(0, Math.floor((at.z - r) / CELL))
    const z1 = Math.min(COLS - 1, Math.floor((at.z + r) / CELL))
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) yield* grid[z * COLS + x]!
  }

  /** Target-priority slider: 0..10 bonus for hero `o` as seen by `h`. */
  const heroPriority = (h: HeroState, o: Body) => {
    const oh = o.hero!
    const low = (1 - o.hp / o.maxHp) * 10
    switch (behaviorOf(h).target) {
      case "weakest":
        return low
      case "carry":
        return (oh.role === "carry" || oh.role === "mid" ? 7 : 0) + low * 0.3
      case "support":
        return (oh.role === "support" ? 7 : 0) + low * 0.3
      case "nearest":
        return low * 0.2
      case "threat":
        return Math.min(7, oh.heroDamage / Math.max(1, clock * 2)) + low * 0.3
    }
  }

  /** Pick the best attack target in range for any unit. */
  const chooseTarget = (b: Body, radius: number): Body | undefined => {
    let best: Body | undefined
    let bestScore = -Infinity
    for (const o of near(b, radius)) {
      if (!isEnemy(b, o)) continue
      const d = dist(b, o)
      if (d > radius) continue
      if (o.structure && !vulnerable(o)) continue
      let score = -d
      if (b.type === "hero") {
        const sense = b.hero!.player.sense / 20
        if (o.type === "hero" && !seen(b, o)) continue
        if (o.type === "hero") {
          score += 8 + heroPriority(b.hero!, o) * sense
          // Blackboard focus: +50 % hero score on the initiator's locked target.
          const lock = brain.board(b.hero!.side).lock(clock)
          if (lock?.target === o.id && dist(b, o) <= LOCK_RADIUS)
            score += (8 + heroPriority(b.hero!, o) * sense) * LOCK_BONUS
        }
        // Last-hit creeps: prefer low hp ones the hero can kill.
        if (o.type === "creep") score += o.hp < b.damage * 1.2 ? 6 * sense + 2 : 0
        if (o.structure) score += b.hero!.intent === "push" || b.hero!.intent === "group" ? 6 : 2
        if (o.type === "roshan") score += b.hero!.intent === "roshan" ? 12 : -20
        if (o.type === "neutral") score += b.hero!.intent === "jungle" ? 5 : -6
      } else if (b.type === "tower") {
        // Towers prefer creeps, but heroes attacking their heroes get punished.
        score +=
          o.type === "creep" ? 4 : o.type === "hero" ? (o.target?.type === "hero" ? 10 : 1) : 0
      } else if (b.type === "creep") {
        score += o.type === "creep" ? 3 : o.structure ? 1 : 0
      }
      if (score > bestScore) {
        bestScore = score
        best = o
      }
    }
    return best
  }

  /** Hull-adjusted reach of `b` against `t` (spec/09 §3). */
  const reachOf = (b: Body, t: Body) =>
    hullReach(b.range, t.structure ? (t.type === "tower" ? 0.8 : 1.2) : (t.mover?.radius ?? 0.4)) +
    REACH_EPS
  const swingClass = (b: Body) =>
    b.type === "hero" ||
    b.type === "creep" ||
    b.type === "neutral" ||
    b.type === "roshan" ||
    b.type === "tower"
      ? b.type
      : "other"

  /**
   * Request an attack (spec/09 §4): starts the attack point when in reach and off
   * cooldown. Damage lands later, in tickSwings, on the damage frame.
   */
  const attack = (b: Body, t: Body) => {
    if (b.cooldown > 0 || b.st.stun > 0) return
    const sw = b.swing
    if (sw && (sw.phase === "point" || sw.castLock > 0)) return
    if (dist(b, t) > reachOf(b, t)) return
    b.heading = Math.atan2(t.x - b.x, t.z - b.z)
    b.target = t
    const asMul = statMul(b, "attackSpeed")
    b.cooldown = b.attackTime / asMul
    if (!sw) return strike(b, t)
    beginSwing(
      sw,
      t.id,
      swingTiming(swingClass(b), b.attackTime, asMul, b.hero ? heroSwing(b.hero.def) : undefined),
      b.cooldown,
    )
    b.swings = (b.swings ?? 0) + 1
    if (b.mover) {
      b.mover.pvx = 0
      b.mover.pvz = 0
    }
  }

  const bodyById = new Map<string, Body>()
  /** Advance every swing; deliver damage on the damage frame (spec/09 §4). */
  const tickSwings = (dt: number) => {
    for (const b of bodies) {
      const sw = b.swing
      if (!b.alive || !sw || (sw.phase === "idle" && sw.castLock === 0)) continue
      const t = sw.targetId ? bodyById.get(sw.targetId) : undefined
      const valid = !!t && t.alive && b.st.stun <= 0 && (t.st.cyclone ?? 0) <= 0
      const ev = tickSwing(sw, dt, valid, t ? dist(b, t) : Infinity, t ? reachOf(b, t) : 0)
      if (ev === "damage" && t) {
        b.heading = Math.atan2(t.x - b.x, t.z - b.z)
        strike(b, t)
        swingStats.landed++
      } else if (ev === "cancel") {
        b.cooldown = Math.max(0, b.cooldown - sw.charged) // refund (§4)
        swingStats.cancelled++
      }
    }
  }
  const swingStats = { landed: 0, cancelled: 0 }

  /** Damage frame: the old instant attack body. */
  const strike = (b: Body, t: Body) => {
    let dmg = b.damage * statMul(b, "attack")
    if (b.hero) dmg *= rng.range(0.9, 1.1)
    deal(b, t, dmg, "physical")
    if (b.type === "roshan") {
      // Roshan cleaves on the damage frame (review §6).
      for (const o of heroes)
        if (o !== t && o.alive && dist(o, t) < 2) deal(b, o, b.damage * 0.5, "physical")
    }
    // Attack reveal (spec/08 §4a): firing from fog exposes the attacker to
    // the victim's team for 2.0 s (non-stacking bubbles are fine — same window).
    if (b.type === "hero")
      reveals.push({
        side: sideOf(b.team as Team),
        x: b.x,
        z: b.z,
        until: clock + ATTACK_REVEAL_TICKS / 10,
      })
    if (b.range > 2.5) {
      const style =
        b.type === "tower"
          ? "bolt"
          : b.kind.toString().includes("siege")
            ? "siege"
            : b.type === "hero"
              ? "arrow"
              : "arrow"
      fx({
        t: clock,
        kind: "projectile",
        from: { x: b.x, z: b.z },
        to: { x: t.x, z: t.z },
        duration: Math.min(0.35, dist(b, t) / 18),
        team: b.team,
        style,
      })
    } else if (b.type === "hero" || b.type === "roshan") {
      fx({ t: clock, kind: "hit", at: { x: t.x, z: t.z }, team: b.team })
    }
  }

  // --- tick --------------------------------------------------------------------------
  const tickStatus = (b: Body, dt: number) => {
    const s = b.st
    s.stun = Math.max(0, s.stun - dt)
    s.immune = Math.max(0, s.immune - dt)
    s.cyclone = Math.max(0, s.cyclone - dt)
    s.glimmer = Math.max(0, s.glimmer - dt)
    b.disabledFor = Math.max(s.stun, s.root)
    s.root = Math.max(0, s.root - dt)
    s.slowT = Math.max(0, s.slowT - dt)
    if (s.slowT === 0) s.slow = 0
    s.shieldT = Math.max(0, s.shieldT - dt)
    if (s.shieldT === 0) s.shield = 0
    s.lifestealT = Math.max(0, s.lifestealT - dt)
    for (const d of s.dots) {
      deal(d.src, b, d.dps * dt, "magic")
      d.t -= dt
    }
    s.dots = s.dots.filter((d) => d.t > 0)
    for (const hh of s.hots) {
      heal(hh.src, b, hh.hps * dt)
      hh.t -= dt
    }
    s.hots = s.hots.filter((x) => x.t > 0)
    for (const bf of s.buffs) bf.t -= dt
    s.buffs = s.buffs.filter((x) => x.t > 0)
  }

  // --- phases, vision, wards, IGL, history (spec/06) --------------------------------------
  const setPhase = (p: Phase) => {
    if (p === phase) return
    phase = p
    phaseAt[p] = clock
    feed.push({
      t: clock,
      kind: "phase",
      side: "neutral",
      text:
        p === "mid" ? "Mid game — the laning phase is over" : "Late game — high ground is in play",
    })
    for (const hb of heroes) hb.hero!.rethink = 0
  }
  const updatePhase = () => {
    if (phase === "laning" && (clock >= MID_AT || tier1Down >= 2)) setPhase("mid")
    if (
      phase === "mid" &&
      (clock >= LATE_AT ||
        tier3Down ||
        avgLevel(heroes.filter((x) => x.team === "radiant")) >= 12 ||
        avgLevel(heroes.filter((x) => x.team === "dire")) >= 12)
    )
      setPhase("late")
  }

  const updateVision = () => {
    const tick = Math.round(clock * 10)
    reveals = reveals.filter((r) => r.until > clock)
    for (const side of ["blue", "red"] as const) {
      const team = SIDE_TEAM[side]
      const lights: VisionSource[] = []
      for (const b of bodies) {
        if (!b.alive || b.team !== team) continue
        const kind =
          b.type === "hero"
            ? "hero"
            : b.type === "creep"
              ? "creep"
              : b.type === "tower"
                ? "tower"
                : b.structure
                  ? "structure"
                  : null
        if (!kind) continue
        lights.push({
          x: b.x,
          z: b.z,
          radius: sourceRadius(kind, tick),
        })
      }
      for (const w of wards)
        if (w.side === side) lights.push({ x: w.x, z: w.z, radius: sourceRadius("ward", tick) })
      const enemyReveals = reveals
        .filter((r) => r.side !== side)
        .map((r) => ({ x: r.x, z: r.z, radius: ATTACK_REVEAL_RADIUS }))
      recomputeFog({
        staticFog,
        fog: visionGrid[side],
        tick,
        sources: lights,
        reveals: enemyReveals,
      })
      // TeamKnowledge snapshot: the only AI-readable view of the enemy (spec/08 §3).
      knowledge[side].clearTick()
      for (const e of heroes) {
        if (!e.alive || e.hero!.side === side) continue
        knowledge[side].observe(
          {
            id: e.id,
            pos: { x: e.x, z: e.z },
            // heading = atan2(dx, dz) → direction of travel for "guess where he went".
            vel: { x: Math.sin(e.heading) * e.speed, z: Math.cos(e.heading) * e.speed },
            hpFrac: e.hp / Math.max(1, e.maxHp),
            level: e.hero!.level,
            items: e.hero!.items,
            alive: e.alive,
          },
          tick,
        )
      }
      // Map control counts raw lit walkable cells (own-light metric, spec/08 §3).
      let n = 0
      for (let i = 0; i < visionGrid[side].bits.length; i++)
        if (visionGrid[side].bits[i]! & Bits.Visible && walkable.walkable[i]) n++
      control[side] = n / walkable.walkableCount
    }
  }

  /** Tree destruction (spec/08 §4c): opens vision and paths immediately. */
  const cutTree = (x: number, z: number): boolean => {
    const ok = destroyTree(staticFog, { x, z })
    if (ok) {
      cutTrees.push({ x, z, regrowAt: clock * 10 + TREE_REGROW_TICKS })
      nav.cutTree({ x, z }) // spec/11: dynamic nav dirty update
      visionTimer = 0 // dirty: recompute on the next tick
    }
    return ok
  }

  const tickWards = (dt: number) => {
    for (const side of ["blue", "red"] as const) {
      const st = wardStock[side]
      if (st.charges >= WARD_MAX) st.next = WARD_RECHARGE
      else {
        st.next -= dt
        if (st.next <= 0) {
          st.charges++
          st.next = WARD_RECHARGE
        }
      }
    }
    wards = wards.filter((w) => w.expires > clock)
    for (const b of heroes) {
      if (!b.alive) continue
      const h = b.hero!
      // Plant.
      if (h.intent === "ward" && h.goal && dist(b, h.goal) < 1.5 && wardStock[h.side].charges > 0) {
        const spot = spots.find((sp) => dist(sp.at, h.goal!) < 0.5)
        if (spot && !wards.some((w) => w.side === h.side && w.spotId === spot.id)) {
          wardStock[h.side].charges--
          wards.push({
            id: `ward-${uid++}`,
            side: h.side,
            x: spot.at.x,
            z: spot.at.z,
            expires: clock + WARD_LIFETIME,
            spotId: spot.id,
          })
        }
        h.rethink = 0
      }
      // Deward: supports/roamers spot enemy wards within 4 tiles.
      if (h.role === "support" || h.slot === "roam") {
        const w = wards.find((x) => x.side !== h.side && dist(x, b) <= 4)
        if (w) {
          wards = wards.filter((x) => x !== w)
          grant(b, WARD_BOUNTY, 0, "wards")
          feed.push({
            t: clock,
            kind: "ward",
            side: h.side,
            text: `${heroLabel(b)} destroyed an enemy ward`,
          })
        }
      }
    }
  }

  /** Who relays calls now: IGL, else the best-leadership living backup, else nobody. */
  const callerOf = (side: DraftSide) => {
    const team = heroes.filter((x) => x.hero!.side === side)
    const igl = team.find((x) => x.hero!.player.id === tac[side].igl)!
    if (igl.alive) return { body: igl, backup: false }
    const backup = team
      .filter((x) => x.alive)
      .toSorted((a, b) => b.hero!.player.leadership - a.hero!.player.leadership)[0]
    return backup ? { body: backup, backup: true } : null
  }
  const relayDelay = (side: DraftSide) => {
    const c = callerOf(side)
    if (!c) return null
    return 3 - (2.5 * c.body.hero!.player.leadership) / 20 + (c.backup ? 1.5 : 0)
  }
  /** One seeded roll per player per relayed call. Returns followers. */
  const rollFollow = (side: DraftSide, kind: string, which: "coach" | "igl") => {
    const c = callerOf(side)
    const lead = c ? c.body.hero!.player.leadership : 0
    let n = 0
    for (const b of heroes) {
      const h = b.hero!
      if (h.side !== side) continue
      const aggr = aggressionOf(h)
      const cautious = kind === "safe" || kind === "back" || kind === "farm"
      const bold = kind === "push" || kind === "gank" || kind === "roshan" || kind === "group"
      const fit = cautious ? (50 - aggr) / 50 : bold ? (aggr - 50) / 50 : 0
      const p = Math.max(
        0.3,
        Math.min(0.98, 0.55 + (0.45 * lead) / 20 + 0.15 * fit - (c?.backup ? 0.15 : 0)),
      )
      const follows = rng.chance(p)
      if (which === "coach") h.followCoach = follows
      else h.followIgl = follows
      if (follows) n++
      h.rethink = 0
    }
    return n
  }
  const logComms = (side: DraftSide, from: "coach" | "igl", text: string, followers: number) => {
    const c = callerOf(side)
    comms.push({
      t: clock,
      side,
      from,
      caller: c ? c.body.hero!.player.name : null,
      text,
      followers,
      total: 5,
    })
    if (comms.length > 200) comms.splice(0, comms.length - 200)
  }

  const IGL_TEXT: Record<IglCallKind, string> = {
    gank: "Gank",
    defend: "Defend base",
    back: "Back, reset",
    push: "They're down — push!",
    group: "Spike! Group up",
  }
  const issueIgl = (side: DraftSide, call: IglCall, label: string) => {
    if (!callerOf(side)) return
    iglCall[side] = call
    const n = rollFollow(side, call.kind, "igl")
    logComms(side, "igl", label, n)
  }
  const iglDecide = (side: DraftSide) => {
    if (calls[side].active || iglCall[side]) return
    const team = SIDE_TEAM[side]
    const mine = heroes.filter((x) => x.team === team)
    const alive = mine.filter((x) => x.alive)
    // Spike: carry finished its 2nd item.
    const core = coreOf(side)
    if (tac[side].spike && !spikeFired[side] && core && countItems(core.hero!.inv) >= 2) {
      spikeFired[side] = true
      if (phase !== "laning") {
        issueIgl(side, { kind: "group", remaining: IGL_CALL_DURATION }, IGL_TEXT.group)
        return
      }
    }
    // Defend: an own structure is being hit by enemy heroes.
    const sieged = [...structureBodies.values()].find(
      (t) =>
        t.alive &&
        t.team === team &&
        t.hp < t.maxHp * 0.8 &&
        heroes.some((e) => e.alive && e.team !== team && dist(e, t) < 8),
    )
    if (sieged && phase !== "laning") {
      issueIgl(
        side,
        { kind: "defend", remaining: IGL_CALL_DURATION, at: { x: sieged.x, z: sieged.z } },
        IGL_TEXT.defend,
      )
      return
    }
    const avgHp = alive.reduce((s, x) => s + x.hp / x.maxHp, 0) / Math.max(1, alive.length)
    if (avgHp < 0.4 || mine.length - alive.length >= 2) {
      issueIgl(side, { kind: "back", remaining: 10 }, IGL_TEXT.back)
      return
    }
    if (enemiesDead(side) >= 2 && alive.length >= 4 && phase !== "laning") {
      issueIgl(side, { kind: "push", remaining: IGL_CALL_DURATION }, IGL_TEXT.push)
      return
    }
    const prey = visibleEnemyHeroes(side).find(
      (e) => e.hp / e.maxHp <= 0.6 && alive.filter((a) => dist(a, e) < 25).length >= 2,
    )
    if (prey) {
      issueIgl(
        side,
        { kind: "gank", remaining: IGL_CALL_DURATION, target: prey },
        `${IGL_TEXT.gank} ${prey.hero!.def.name}`,
      )
    }
  }

  const sampleHistory = () => {
    const sum = sideSum
    history.push({
      t: Math.round(clock),
      nw: { blue: sum("blue", netWorthOf), red: sum("red", netWorthOf) },
      xp: { blue: Math.round(sum("blue", (h) => h.xp)), red: Math.round(sum("red", (h) => h.xp)) },
      control: {
        blue: Math.round(control.blue * 1000) / 1000,
        red: Math.round(control.red * 1000) / 1000,
      },
    })
  }

  const tickTactics = (dt: number) => {
    updatePhase()
    visionTimer -= dt
    if (visionTimer <= 0) {
      updateVision()
      brain.updateThreat()
      visionTimer = 0.5
    }
    // Tree regrowth (spec/08 §4c): retry while occupied.
    if (cutTrees.length > 0) {
      const before = cutTrees.length
      const regrown: Vec2[] = []
      regrowTrees(staticFog, cutTrees, clock * 10, (p) => {
        const occ = bodies.some(
          (b) => b.alive && Math.abs(b.x - p.x) < 1 && Math.abs(b.z - p.z) < 1,
        )
        if (!occ) regrown.push(p)
        return occ
      })
      if (regrown.length) for (const p of regrown) nav.regrowTree(p) // spec/11
      if (cutTrees.length < before) visionTimer = 0
    }
    tickWards(dt)
    for (const side of ["blue", "red"] as const) {
      swapCd[side] = Math.max(0, swapCd[side] - dt)
      planCd[side] = Math.max(0, planCd[side] - dt)
      const ic = iglCall[side]
      if (ic) {
        ic.remaining -= dt
        if (ic.remaining <= 0 || (ic.kind === "gank" && !ic.target?.alive)) {
          iglCall[side] = null
          for (const b of heroes) if (b.hero!.side === side) b.hero!.followIgl = false
        }
      }
      // Relay a pending coach call once its latency elapses and a caller is alive.
      const at = relayAt[side]
      if (at !== null && calls[side].active) {
        if (at <= clock) {
          if (callerOf(side)) {
            relayAt[side] = null
            iglCall[side] = null
            const n = rollFollow(side, calls[side].active!, "coach")
            logComms(side, "coach", CALL_TEXT[calls[side].active!], n)
          }
        }
      } else if (!calls[side].active) {
        relayAt[side] = null
        for (const b of heroes) if (b.hero!.side === side) b.hero!.followCoach = false
      }
    }
    for (let i = pendingPlans.length - 1; i >= 0; i--) {
      const pp = pendingPlans[i]!
      if (pp.at <= clock && callerOf(pp.side)) {
        pp.apply()
        logComms(pp.side, "coach", pp.text, 5)
        for (const b of heroes) if (b.hero!.side === pp.side) b.hero!.rethink = 0
        pendingPlans.splice(i, 1)
      }
    }
    iglThink -= dt
    if (iglThink <= 0) {
      iglThink = IGL_THINK
      iglDecide("blue")
      iglDecide("red")
    }
    if (clock >= nextSample) {
      sampleHistory()
      nextSample += HISTORY_EVERY
    }
  }

  /** Crowd pass (spec/09 §1–§2, §6): the only integrator of mover positions. */
  const movers: Mover[] = []
  const touching = (b: Body) => {
    const r = b.mover!.radius + 0.6
    for (const o of near(b, r + 1))
      if (o !== b && o.alive && dist(o, b) < r + (o.mover?.radius ?? 0.8)) return true
    return false
  }
  const crowdTick = (dt: number) => {
    movers.length = 0
    for (const b of bodies) {
      const m = b.mover
      if (!b.alive || !m) continue
      // Teleports (respawn, dash, displace) since last tick: resync and drop velocity.
      if (Math.abs(m.x - b.x) > 1e-9 || Math.abs(m.z - b.z) > 1e-9) {
        m.x = b.x
        m.z = b.z
        m.vx = 0
        m.vz = 0
      }
      if (b.st.stun > 0 || b.st.root > 0) {
        m.pvx = 0
        m.pvz = 0
      }
      m.mode = b.swing && isLocked(b.swing) ? "locked" : m.mode
      ownerOf.set(m, b)
      movers.push(m)
    }
    const wanted = movers.map((m) => Math.hypot(m.pvx, m.pvz))
    crowdStep(movers, dt, crowdWorld)
    for (let i = 0; i < movers.length; i++) {
      const m = movers[i]!
      const b = ownerOf.get(m)!
      // Wedged on terrain (a straight path segment clipping forest): repath from here.
      const moved = Math.hypot(m.x - b.x, m.z - b.z)
      // Crowd-blocked bodies wait for ORCA/yield; only terrain-wedged ones repath.
      if (b.path && wanted[i]! > 0.5 && moved < wanted[i]! * dt * 0.15 && !touching(b)) {
        b.stuckT = (b.stuckT ?? 0) + dt
        // First repath after 0.5 s; while still wedged, retry at most every 2 s.
        if (b.stuckT >= 0.5 && clock >= (b.repathAt ?? 0)) {
          b.repathAt = clock + 2
          b.pathKey = undefined
          b.stuckT = 0
        }
      } else b.stuckT = 0
      b.x = m.x
      b.z = m.z
      b.velMag = Math.hypot(m.vx, m.vz)
      if (b.velMag > 0.2 && !(b.swing && isLocked(b.swing))) b.heading = Math.atan2(m.vx, m.vz)
      // Keep this tick's inputs for the debug overlay, then reset them.
      if (debugOn) {
        lastPref.set(m, { x: m.pvx, z: m.pvz })
        lastMode.set(m, m.mode)
      }
      m.pvx = 0
      m.pvz = 0
      m.mode = "free" satisfies CrowdMode
    }
  }

  const step = (dt: number) => {
    if (winner) return
    clock += dt

    if (clock >= nextWave) {
      spawnWave()
      nextWave += WAVE_INTERVAL
    }
    for (const [id, t] of campTimers) {
      const left = t - dt
      if (left <= 0) {
        campTimers.delete(id)
        const camp = map.camps.find((c) => c.id === id)
        if (camp) spawnCamp(camp)
      } else campTimers.set(id, left)
    }
    if (roshanTimer > 0) {
      roshanTimer -= dt
      if (roshanTimer <= 0) spawnRoshan()
    }
    for (const side of ["blue", "red"] as const) {
      const c = calls[side]
      c.cooldown = Math.max(0, c.cooldown - dt)
      c.remaining = Math.max(0, c.remaining - dt)
      if (c.remaining === 0) c.active = null
    }
    tickTactics(dt)

    rebuildGrid()
    for (const b of bodies) {
      if (!b.alive) continue
      tickStatus(b, dt)
      if (!b.alive) continue
      b.cooldown = Math.max(0, b.cooldown - dt)
      // Locomotion timers (spec/11): phase + free-pathing decay.
      if (b.phase! > 0) b.phase = Math.max(0, b.phase! - dt)
      if (b.freePath! > 0) b.freePath = Math.max(0, b.freePath! - dt)
    }
    bodyById.clear()
    for (const b of bodies) if (b.alive) bodyById.set(b.id, b)
    // Attack phases (spec/09 §4): damage frames land before new decisions.
    tickSwings(dt)
    // Spell projectiles move and resolve after status, before hero actions (spec/09).
    tickProjectiles(dt)

    // Heroes
    for (const b of heroes) {
      const h = b.hero!
      if (!b.alive) {
        h.respawn -= dt
        if (h.respawn <= 0) {
          const f = fountain(b.team as Team)
          b.alive = true
          b.hp = b.maxHp
          b.x = f.x + rng.range(-1, 1)
          b.z = f.z + rng.range(-1, 1)
          b.st = emptyStatus()
          h.intent = "lane"
          h.rethink = 0
        }
        brain.release(h.side, b.id)
        continue
      }
      h.gold += PASSIVE_GOLD * dt
      h.goldEarned += PASSIVE_GOLD * dt
      // Inventory upkeep (spec/10 layer 1): promote backpack items into free
      // main slots (muted 6 s) and expire mutes into the effective set.
      while (promoteFirstBackpack(h.inv, clock));
      const eff = effectiveItems(h.inv, clock)
      if (eff.length !== h.items.length || eff.some((id, i) => id !== h.items[i])) {
        h.items = eff
        recomputeStats(b)
      }
      sources[h.side].passive += PASSIVE_GOLD * dt
      h.skillCd = Math.max(0, h.skillCd - dt)
      h.ultCd = Math.max(0, h.ultCd - dt)
      h.mana = Math.min(h.maxMana, h.mana + h.manaRegen * dt)
      // Tango (spec/10 S5a): eat a tree when the heal would not be wasted.
      const regenLeft = b.st.hots.reduce((m, x) => (x.src === b ? Math.max(m, x.t) : m), 0)
      if (tangoTrigger({ hp: b.hp, maxHp: b.maxHp, charges: h.tango, regenLeft })) {
        h.tango--
        b.st.hots.push({ hps: TANGO_HEAL / TANGO_DURATION, t: TANGO_DURATION, src: b })
        activeUses.tango = (activeUses.tango ?? 0) + 1
      }
      for (const id in h.itemCd) h.itemCd[id] = Math.max(0, h.itemCd[id]! - dt)
      // Fountain regen.
      if (dist(b, fountain(b.team as Team)) < 6) {
        b.hp = Math.min(b.maxHp, b.hp + b.maxHp * 0.12 * dt)
        h.mana = Math.min(h.maxMana, h.mana + h.maxMana * 0.12 * dt)
      } else b.hp = Math.min(b.maxHp, b.hp + (2 + h.level * 0.4) * dt)

      h.rethink -= dt
      if (h.rethink <= 0) {
        think(b)
        // Reaction time from player sense: 0.3 s (sharp) .. 0.8 s (slow).
        h.rethink = 0.8 - (h.player.sense / 20) * 0.5
      }
      if (b.st.stun > 0 || b.st.cyclone > 0) continue
      // Layer 3 micro-combat: defensive / engage item triggers, then positioning ring.
      if (microItems(b)) continue

      // Save: walk to the endangered ally; ally-targeted spells fire via tryCast.
      if (h.intent === "save") {
        const ally = heroes.find((x) => x.id === h.saveId)
        if (ally?.alive) {
          if (h.def.skill.target.kind === "ally" || h.def.skill.target.kind === "ally-aoe")
            tryCast(b, h.def.skill, false)
          if (h.def.ultimate.target.kind === "ally" || h.def.ultimate.target.kind === "ally-aoe")
            tryCast(b, h.def.ultimate, true)
          if (dist(b, ally) > 3) {
            travel(b, { x: ally.x, z: ally.z }, 2.5, dt)
            continue
          }
        }
      }

      // Abilities first.
      if (h.intent !== "retreat" || b.hp / b.maxHp > 0.15) {
        if (!tryCast(b, h.def.ultimate, true)) tryCast(b, h.def.skill, false)
      } else if (h.def.skill.target.kind === "self" || h.def.skill.target.kind === "ally") {
        tryCast(b, h.def.skill, false)
      }

      if (h.intent === "retreat") {
        travel(b, h.goal!, 1, dt)
        // Still swing at things in range while fleeing.
        const t = chooseTarget(b, b.range)
        if (t && t.type === "hero") attack(b, t)
        continue
      }
      if (microMove(b, dt)) continue
      const engage =
        h.intent === "fight" ? 9 : h.intent === "jungle" || h.intent === "roshan" ? 4 : 6
      const target = chooseTarget(b, Math.max(engage, b.range))
      // Don't dive under an enemy tower early unless pushing/grouping or the target is nearly dead.
      const tower = target && enemyTowerNear(target, 6.5)
      const dive =
        !tower ||
        h.intent === "push" ||
        h.intent === "group" ||
        (target!.type === "hero" &&
          target!.hp / target!.maxHp < 0.1 + (aggressionOf(h) / 100) * 0.3) ||
        alliesNear(b, 8).length >= 3 ||
        bodies.some(
          (c) => c.alive && c.type === "creep" && c.team === b.team && dist(c, tower) < 6.5,
        )
      const leash = h.intent === "lane" ? 7 : h.intent === "ward" || h.intent === "shop" ? 3 : 99
      if (target && dive && dist(b, target) < leash) {
        engageTarget(b, target, dt)
      } else if (h.goal) {
        b.target = undefined
        travel(b, h.goal, 1.2, dt)
      }
    }

    // Creeps
    for (const b of bodies) {
      if (!b.alive || b.type !== "creep") continue
      const lane = lanes.get(b.lane!)!
      const target = chooseTarget(b, 5)
      if (target) {
        engageTarget(b, target, dt)
        b.s = b.team === "radiant" ? lane.project(b.x, b.z) : lane.length - lane.project(b.x, b.z)
      } else if (b.st.stun <= 0 && b.st.root <= 0) {
        b.s = (b.s ?? 0) + b.speed * (1 - (b.st.slowT > 0 ? b.st.slow : 0)) * dt
        const s = b.team === "radiant" ? b.s : lane.length - b.s
        const p = lane.at(s)
        const dir = b.team === "radiant" ? 1 : -1
        const tx = p.tx * dir
        const tz = p.tz * dir
        const nx = p.x - tz * (b.side ?? 0)
        const nz = p.z + tx * (b.side ?? 0)
        // Lane following as a preferred velocity (review §7); ORCA integrates.
        const m = b.mover!
        const ex = nx - b.x
        const ez = nz - b.z
        const el = Math.hypot(ex, ez)
        const v = Math.min(MAX_SPEED, el / dt, b.speed * 1.6)
        if (el > 1e-6) {
          m.pvx = (ex / el) * v
          m.pvz = (ez / el) * v
          m.maxSpeed = Math.max(v, b.speed)
          b.heading = Math.atan2(ex, ez)
        }
        if ((b.s ?? 0) > lane.length + 2) b.alive = false
      }
    }

    // Neutrals & Roshan: fight back when attacked, leash to home.
    for (const b of bodies) {
      if (!b.alive || (b.type !== "neutral" && b.type !== "roshan")) continue
      const home = b.home!
      const aggro =
        b.lastHit && b.lastHit.alive && dist(b.lastHit, home) < (b.type === "roshan" ? 7 : 5)
          ? b.lastHit
          : undefined
      if (aggro) {
        engageTarget(b, aggro, dt)
      } else {
        b.lastHit = undefined
        if (dist(b, home) > 0.8) moveToward(b, home, 0.5, dt)
        else b.hp = Math.min(b.maxHp, b.hp + b.maxHp * 0.05 * dt)
      }
    }

    // Towers
    for (const b of structureBodies.values()) {
      if (!b.alive || b.type !== "tower") continue
      const t = chooseTarget(b, b.range)
      if (t) attack(b, t)
    }

    crowdTick(dt)

    tickCouriers(dt)
    if (clock >= nextThreatScan) {
      scanTeamThreats()
      nextThreatScan = clock + THREAT_SCAN_S
    }

    // AI coaches
    for (const side of aiSides) aiCoach(side)

    // Prune dead non-heroes occasionally.
    if (Math.round(clock / TICK) % 50 === 0) {
      for (let i = bodies.length - 1; i >= 0; i--) {
        const b = bodies[i]!
        if (!b.alive && (b.type === "creep" || b.type === "neutral" || b.type === "roshan"))
          bodies.splice(i, 1)
      }
    }

    if (!timeWarned && !winner && clock >= maxTime - TIME_WARNING_LEAD) {
      timeWarned = true
      const leader =
        towersDown.blue !== towersDown.red
          ? towersDown.blue > towersDown.red
            ? "blue"
            : "red"
          : kills.blue !== kills.red
            ? kills.blue > kills.red
              ? "blue"
              : "red"
            : null
      feed.push({
        t: clock,
        kind: "time-warning",
        side: leader ?? "neutral",
        text: leader
          ? `2 minutes left — ${leader === "blue" ? draft.blue.name : draft.red.name} lead on objectives`
          : "2 minutes left — objectives are level",
      })
    }
    if (clock >= maxTime && !winner) {
      winner =
        towersDown.blue !== towersDown.red
          ? towersDown.blue > towersDown.red
            ? "blue"
            : "red"
          : kills.blue >= kills.red
            ? "blue"
            : "red"
      feed.push({
        t: clock,
        kind: "ancient",
        side: winner,
        text: `Time! ${winner === "blue" ? draft.blue.name : draft.red.name} win on objectives`,
      })
    }
  }

  // --- coach calls -------------------------------------------------------------------
  const CALL_TEXT: Record<CoachCall, string> = {
    group: "Group up!",
    roshan: "Take Roshan!",
    push: "Push the lanes!",
    safe: "Play safe.",
    farm: "Farm up.",
  }

  const call = (side: DraftSide, c: CoachCall): boolean => {
    const s = calls[side]
    if (s.cooldown > 0 || winner) return false
    if (c === "roshan" && !bodies.some((x) => x.alive && x.type === "roshan")) return false
    s.active = c
    s.remaining = CALL_DURATION
    s.cooldown = CALL_COOLDOWN
    relayAt[side] = clock + (relayDelay(side) ?? 0)
    feed.push({
      t: clock,
      kind: "call",
      side,
      text: `${side === "blue" ? draft.blue.tag : draft.red.tag} coach: ${CALL_TEXT[c]}`,
    })
    for (const h of heroes) if (h.hero!.side === side) h.hero!.followCoach = false
    if (!callerOf(side))
      comms.push({
        t: clock,
        side,
        from: "coach",
        caller: null,
        text: `${CALL_TEXT[c]} — no caller alive, waiting`,
        followers: 0,
        total: 5,
      })
    return true
  }

  // --- live tactics commands ------------------------------------------------------------
  /** Swap two players' lane slots (laning phase only, own 60 s cooldown). */
  const swapLanes = (side: DraftSide, a: string, b: string): boolean => {
    if (phase !== "laning" || swapCd[side] > 0 || winner || a === b) return false
    const ha = heroes.find((x) => x.hero!.side === side && x.hero!.player.id === a)?.hero
    const hb = heroes.find((x) => x.hero!.side === side && x.hero!.player.id === b)?.hero
    if (!ha || !hb) return false
    const t = tac[side]
    tac[side] = {
      ...t,
      players: {
        ...t.players,
        [a]: { ...t.players[a]!, slot: hb.slot },
        [b]: { ...t.players[b]!, slot: ha.slot },
      },
    }
    ;[ha.slot, hb.slot] = [hb.slot, ha.slot]
    ha.rethink = 0
    hb.rethink = 0
    swapCd[side] = SWAP_COOLDOWN
    feed.push({
      t: clock,
      kind: "swap",
      side,
      text: `${side === "blue" ? draft.blue.tag : draft.red.tag} swap lanes: ${ha.player.name} ↔ ${hb.player.name}`,
    })
    return true
  }

  const PLAN_LABEL: Record<string, string> = {
    standard: "Standard lanes",
    aggressive: "Aggressive lanes",
    roam: "Roam & gank",
    scale: "Scale",
    group: "Group & push",
    split: "Split push",
    pickoff: "Pick-offs",
    farm: "Farm",
    siege: "Siege",
    roshan: "Roshan first",
    defend: "Defend",
  }
  /** Change a phase plan: relayed by the IGL; once per 20 s per team. */
  const setPlan = (side: DraftSide, which: Phase, plan: string): boolean => {
    if (planCd[side] > 0 || winner) return false
    const valid: Record<Phase, readonly string[]> = {
      laning: ["standard", "aggressive", "roam", "scale"],
      mid: ["group", "split", "pickoff", "farm"],
      late: ["siege", "roshan", "defend"],
    }
    if (!valid[which].includes(plan)) return false
    planCd[side] = PLAN_COOLDOWN
    pendingPlans.push({
      side,
      at: clock + (relayDelay(side) ?? 0),
      text: `${which[0]!.toUpperCase()}${which.slice(1)} plan: ${PLAN_LABEL[plan]}`,
      apply: () => {
        tac[side] = { ...tac[side], plans: { ...tac[side].plans, [which]: plan } }
      },
    })
    return true
  }
  /** Standing orders — free, read at the player's next rethink. */
  const setBehavior = (side: DraftSide, playerId: string, patch: Partial<Behavior>): boolean => {
    const cur = tac[side].players[playerId]
    if (!cur) return false
    const next = normalizeTactics(draft, side, {
      ...tac[side],
      players: {
        ...tac[side].players,
        [playerId]: { ...cur, behavior: { ...cur.behavior, ...patch } },
      },
    })
    tac[side] = next
    return true
  }
  const setTeamTactics = (
    side: DraftSide,
    patch: Partial<Pick<TeamTactics, "shopTiming" | "spike" | "vision" | "igl">>,
  ): boolean => {
    tac[side] = normalizeTactics(draft, side, { ...tac[side], ...patch })
    return true
  }

  const aiCoach = (side: DraftSide) => {
    const s = calls[side]
    if (s.cooldown > 0) return
    const team = SIDE_TEAM[side]
    const mine = heroes.filter((h) => h.team === team)
    const theirs = heroes.filter((h) => h.team !== team)
    const aliveMine = mine.filter((h) => h.alive).length
    const aliveTheirs = theirs.filter((h) => h.alive).length
    const style = (side === "blue" ? draft.blue : draft.red).style
    // Adapt the late plan to the economy: behind → defend, ahead → siege.
    if (phase !== "laning" && planCd[side] === 0) {
      const lead = sideSum(side, netWorthOf) - sideSum(otherSide(side), netWorthOf)
      const late = tac[side].plans.late
      if (lead < -4000 && late !== "defend") setPlan(side, "late", "defend")
      else if (lead > 3000 && late === "defend") setPlan(side, "late", "siege")
    }
    if (clock < 4 * 60) return
    if (aliveTheirs <= 2 && aliveMine >= 4) call(side, "push")
    else if (aliveMine <= 2) call(side, "safe")
    else if (
      clock > 12 * 60 &&
      avgLevel(mine) >= avgLevel(theirs) &&
      bodies.some((x) => x.alive && x.type === "roshan") &&
      (style === "macro" || rng.chance(0.3))
    )
      call(side, "roshan")
    else if (avgLevel(mine) + 1 < avgLevel(theirs)) call(side, "farm")
    else if (clock > 7 * 60 && (style === "teamfight" || style === "aggressive" || rng.chance(0.4)))
      call(side, "group")
  }

  // --- Population + API -------------------------------------------------------------
  const heroName = (b: Body) => `${b.hero!.def.name} · ${b.hero!.player.name}`

  /** Renderer-facing swing phase (spec/13 §2). */
  const phaseOf = (b: Body): SwingPhase | null => {
    const sw = b.swing
    if (!sw || !b.alive) return null
    if (sw.phase === "point") return "point"
    if (sw.phase === "backswing") return "backswing"
    return sw.castLock > 0 ? "cast" : null
  }
  const swingOf = (b: Body): Pick<Unit, "swing" | "swingT" | "swingDur"> => {
    const cur = phaseOf(b)
    if (!b.swing) return {}
    if (cur === null) return { swing: null }
    const sw = b.swing
    // Phases end on the 0.1 s tick grid (review §3): report the real, quantised length.
    const dur = onTick(cur === "cast" ? CAST_LOCK : sw.dur)
    const left = onTick(Math.max(0, cur === "cast" ? sw.castLock : sw.left))
    return {
      swing: cur,
      swingT: dur > 0 ? Math.min(1, Math.max(0, 1 - left / dur)) : 1,
      swingDur: dur,
    }
  }

  /** Debug overlay snapshot (spec/13 §4). Allocates; call only while the overlay is on. */
  const crowdDebug = (): CrowdDebug => {
    const rs: CrowdDebug["rings"][number][] = []
    for (const e of rings.entries()) {
      const t = bodyById.get(e.targetId)
      if (!t || !t.alive) continue
      rs.push({
        targetId: e.targetId,
        x: t.x,
        z: t.z,
        r1: e.geo.r1,
        r2: e.geo.r2,
        slots: e.slots.map((sl) => {
          const h = sl.holder ? bodyById.get(sl.holder) : undefined
          return {
            x: t.x + sl.offset.x,
            z: t.z + sl.offset.z,
            ring: sl.ring,
            ...(h && h.alive ? { holder: { x: h.x, z: h.z } } : {}),
          }
        }),
      })
    }
    const us: CrowdDebug["units"][number][] = []
    for (const b of bodies) {
      const m = b.mover
      if (!b.alive || !m) continue
      us.push({
        x: b.x,
        z: b.z,
        radius: m.radius,
        vx: m.vx,
        vz: m.vz,
        pvx: lastPref.get(m)?.x ?? 0,
        pvz: lastPref.get(m)?.z ?? 0,
        mode: b.swing && isLocked(b.swing) ? "locked" : (lastMode.get(m) ?? "free"),
        swing: phaseOf(b),
        yielding: m.yieldT > 0,
      })
    }
    return { rings: rs, units: us }
  }

  const units = (): readonly Unit[] => {
    const out: Unit[] = []
    for (const b of bodies) {
      if (b.structure) continue
      if (!b.alive && b.type !== "hero") continue
      out.push({
        id: b.id,
        kind: b.kind as Unit["kind"],
        team: b.team,
        x: b.x,
        z: b.z,
        heading: b.heading,
        hp: b.hp / b.maxHp,
        alive: b.alive,
        attacks: b.swings ?? 0,
        ...swingOf(b),
        ...(b.hero ? { label: heroName(b), hero: true } : {}),
      })
    }
    return out
  }

  const structures = (): readonly StructureStatus[] =>
    [...structureBodies.values()].map((b) => ({
      id: b.id,
      hp: Math.max(0, b.hp / b.maxHp),
      alive: b.alive,
    }))

  const line = (b: Body): HeroLine => {
    const h = b.hero!
    return {
      id: b.id,
      heroId: h.def.id,
      heroName: h.def.name,
      playerId: h.player.id,
      playerName: h.player.name,
      side: h.side,
      role: h.role,
      level: h.level,
      hp: b.hp / b.maxHp,
      alive: b.alive,
      respawnIn: b.alive ? 0 : Math.max(0, h.respawn),
      kills: h.kills,
      deaths: h.deaths,
      assists: h.assists,
      lastHits: h.lastHits,
      gold: Math.round(h.goldEarned),
      heroDamage: Math.round(h.heroDamage),
      healing: Math.round(h.healing),
      items: [...h.items],
      backpack: [...h.inv.backpack],
      neutral: h.inv.neutral,
      stash: [...h.inv.stash],
      intent: h.intent,
      aegis: h.aegis,
      netWorth: netWorthOf(h),
      xp: Math.round(h.xp),
      slot: h.slot,
      following:
        calls[h.side].active && relayAt[h.side] === null
          ? h.followCoach
          : iglCall[h.side]
            ? h.followIgl
            : null,
      igl: tac[h.side].igl === h.player.id,
      mana: Math.round(h.mana),
      maxMana: Math.round(h.maxMana),
      think: { action: h.lastAction, scores: h.scores },
    }
  }
  const sideSum = (side: DraftSide, f: (h: HeroState) => number) =>
    heroes.filter((x) => x.hero!.side === side).reduce((s, x) => s + f(x.hero!), 0)
  const roundSources = (r: Record<GoldSource, number>) =>
    Object.fromEntries(GOLD_SOURCES.map((k) => [k, Math.round(r[k])])) as Record<GoldSource, number>

  const snapshot = (): MatchSnapshot => ({
    time: clock,
    speed,
    paused,
    kills: { ...kills },
    towers: { ...towersDown },
    gold: {
      blue: Math.round(
        heroes.filter((h) => h.hero!.side === "blue").reduce((s, h) => s + h.hero!.goldEarned, 0),
      ),
      red: Math.round(
        heroes.filter((h) => h.hero!.side === "red").reduce((s, h) => s + h.hero!.goldEarned, 0),
      ),
    },
    heroes: heroes.map(line),
    feed: [...feed],
    calls: { blue: { ...calls.blue }, red: { ...calls.red } },
    roshanAlive: bodies.some((b) => b.alive && b.type === "roshan"),
    winner,
    phase,
    phaseAt: { ...phaseAt },
    netWorth: { blue: sideSum("blue", netWorthOf), red: sideSum("red", netWorthOf) },
    sources: { blue: roundSources(sources.blue), red: roundSources(sources.red) },
    control: { ...control },
    couriers: (["blue", "red"] as const).map((side) => {
      const c = courierOf(side)
      return { side, x: c.x, z: c.z, cargo: [...c.cargo], targetHero: c.targetHero }
    }),
    wards: wards.map((w) => ({
      id: w.id,
      side: w.side,
      x: w.x,
      z: w.z,
      expiresIn: Math.max(0, w.expires - clock),
    })),
    wardStock: {
      blue: { charges: wardStock.blue.charges, next: wardStock.blue.next },
      red: { charges: wardStock.red.charges, next: wardStock.red.next },
    },
    comms: [...comms],
    history: [...history],
    purchases: [...purchases],
    swapCooldown: { ...swapCd },
    planCooldown: { ...planCd },
    iglCall: {
      blue: iglCall.blue ? { kind: iglCall.blue.kind, remaining: iglCall.blue.remaining } : null,
      red: iglCall.red ? { kind: iglCall.red.kind, remaining: iglCall.red.remaining } : null,
    },
    synergy: { ...synergyScore },
    fog: {
      blue: fogSnapshot(visionGrid.blue, staticFog),
      red: fogSnapshot(visionGrid.red, staticFog),
    },
  })

  const advance = (realDt: number) => {
    if (paused || winner) return
    acc += Math.min(realDt, 0.25) * speed
    let n = 0
    while (acc >= TICK && n < 400) {
      step(TICK)
      acc -= TICK
      n++
    }
  }

  const match = {
    advance,
    /** Attack-phase counters (spec/09 acceptance): landed vs cancelled swings. */
    swingStats: () => ({ ...swingStats }),
    /** Game seconds per real second right now (spec/13 review §2): 0 when paused/over. */
    timeScale: () => (paused || winner ? 0 : speed),
    /** Crowd/combat debug overlay (spec/13 §4); the first call turns capture on. */
    debug: (): CrowdDebug => {
      debugOn = true
      return crowdDebug()
    },
    time: () => clock,
    units,
    /** Destroy a tree at world (x, z); opens vision (spec/08 §4c). */
    cutTree,
    /** Fog render bytes for one side (spec/08 §5) — cheap 20 Hz path, no full snapshot. */
    fog: (side: DraftSide) => fogSnapshot(visionGrid[side], staticFog),
    /** Read-only AI knowledge per side (spec/08 §3) — tests and debug overlays. */
    knowledgeOf: (side: DraftSide): TeamKnowledge => knowledge[side],
    fx: () => {
      const out = fxQueue
      fxQueue = []
      return out
    },
    structures,
    call,
    setSpeed: (x: number) => {
      speed = Math.max(0.25, Math.min(32, x))
    },
    setPaused: (p: boolean) => {
      paused = p
    },
    snapshot,
    swapLanes,
    setPlan,
    setBehavior,
    setTeamTactics,
    tactics: (side: DraftSide): TeamTactics => tac[side],
    /** Raw sources (unrounded) — Σ equals Σ goldEarned (tests). */
    goldAudit: () => ({
      sources: { blue: { ...sources.blue }, red: { ...sources.red } },
      earned: {
        blue: sideSum("blue", (h) => h.goldEarned),
        red: sideSum("red", (h) => h.goldEarned),
      },
    }),
    /** Hero lane at this moment (tests). */
    visibleTo: (side: DraftSide, x: number, z: number) =>
      isVisibleToTeam(visionGrid[side], staticFog, { x, z }),
    castCounts: (): ReadonlyMap<string, number> => casts,
    /** Hero Think counters (spec/09 acceptance): item actives fired, projectiles fizzled. */
    thinkStats: () => ({ actives: { ...activeUses }, fizzled, lockCasts: { ...lockCasts } }),
    /** Run to completion headlessly (tests, balance reports). */
    runToEnd: (limitSeconds = maxTime + 1) => {
      for (let guard = 0; guard < (limitSeconds / TICK) * 2; guard++) {
        if (winner || clock >= limitSeconds) break
        step(TICK)
      }
      return snapshot()
    },
  } satisfies Population & Record<string, unknown>
  return match
}

export type Match = ReturnType<typeof createMatch>
