/**
 * Tactics — the coach's game plan as pure data (spec/06): lane slots, phase plans,
 * itemization rules, vision priority, the in-game leader and per-player behaviour.
 * Every field has a draft-derived default, and `normalizeTactics` repairs anything invalid.
 */
import type { LaneId } from "@mobacraft/map"
import { type DraftSide, type DraftState } from "./draft.ts"
import type { Role } from "./heroes.ts"
import { ITEMS, type Item } from "./items.ts"
import { matchup } from "./matrix.ts"
import { type Player, type TeamDef, masteryOf } from "./teams.ts"

export type Phase = "laning" | "mid" | "late"
export const PHASES: readonly Phase[] = ["laning", "mid", "late"]

export type LaneSlot = "safe" | "mid" | "off" | "jungle" | "roam"
export const LANE_SLOTS: readonly LaneSlot[] = ["safe", "mid", "off", "jungle", "roam"]

export type LaningPlan = "standard" | "aggressive" | "roam" | "scale"
export type MidPlan = "group" | "split" | "pickoff" | "farm"
export type LatePlan = "siege" | "roshan" | "defend"

export interface Plans {
  readonly laning: LaningPlan
  readonly mid: MidPlan
  readonly late: LatePlan
}

export type TargetPriority = "weakest" | "carry" | "support" | "nearest" | "threat"
export const TARGET_PRIORITIES: readonly TargetPriority[] = [
  "weakest",
  "carry",
  "support",
  "nearest",
  "threat",
]

/** Standing orders for one player (0..100 sliders). */
export interface Behavior {
  readonly aggression: number
  readonly farm: number
  readonly ultDiscipline: number
  readonly target: TargetPriority
}

export const DEFAULT_BEHAVIOR: Behavior = {
  aggression: 50,
  farm: 50,
  ultDiscipline: 50,
  target: "weakest",
}

export type ShopTiming = "on-item" | "on-low"

export type VisionZone = "roshan" | "runes" | "own-jungle" | "enemy-jungle"
export const VISION_ZONES: readonly VisionZone[] = ["roshan", "runes", "own-jungle", "enemy-jungle"]

export interface PlayerTactics {
  readonly slot: LaneSlot
  readonly build: string
  readonly adaptive: boolean
  readonly behavior: Behavior
}

export interface TeamTactics {
  /** By player id. */
  readonly players: Readonly<Record<string, PlayerTactics>>
  readonly plans: Plans
  readonly shopTiming: ShopTiming
  /** IGL calls Group when the carry completes its 2nd item. */
  readonly spike: boolean
  /** Highest priority first; all four zones, each once. */
  readonly vision: readonly VisionZone[]
  readonly igl: string
}

// --- build presets -------------------------------------------------------------------

export interface BuildPreset {
  readonly id: string
  readonly name: string
  readonly role: Role
  readonly items: readonly string[]
  readonly blurb: string
}

export const BUILDS: readonly BuildPreset[] = [
  {
    id: "carry-dps",
    name: "Attack speed",
    role: "carry",
    items: ["boots", "bow", "blade", "fang", "blade", "heart"],
    blurb: "Fast hits, late lifesteal.",
  },
  {
    id: "carry-sustain",
    name: "Lifesteal brawler",
    role: "carry",
    items: ["boots", "fang", "plate", "blade", "bow", "heart"],
    blurb: "Survives fights early, slower peak.",
  },
  {
    id: "carry-glass",
    name: "Glass cannon",
    role: "carry",
    items: ["boots", "blade", "blade", "bow", "fang", "blade"],
    blurb: "Highest damage spike, very fragile.",
  },
  {
    id: "mid-burst",
    name: "Spell burst",
    role: "mid",
    items: ["boots", "tome", "charm", "staff", "tome", "heart"],
    blurb: "Ability damage first.",
  },
  {
    id: "mid-safe",
    name: "Durable caster",
    role: "mid",
    items: ["boots", "charm", "heart", "staff", "aegis-cloak", "tome"],
    blurb: "Hp before power — hard to pick off.",
  },
  {
    id: "off-tank",
    name: "Tank",
    role: "offlane",
    items: ["boots", "plate", "heart", "blade", "aegis-cloak", "plate"],
    blurb: "Armour and hp — the front line.",
  },
  {
    id: "off-bruiser",
    name: "Bruiser",
    role: "offlane",
    items: ["boots", "blade", "plate", "fang", "heart", "blade"],
    blurb: "Trades tankiness for damage.",
  },
  {
    id: "jungle-fang",
    name: "Fang jungler",
    role: "jungle",
    items: ["boots", "fang", "plate", "blade", "heart", "blade"],
    blurb: "Lifesteal clears camps quickly.",
  },
  {
    id: "jungle-tank",
    name: "Initiator",
    role: "jungle",
    items: ["boots", "plate", "heart", "aegis-cloak", "blade", "fang"],
    blurb: "Starts fights and survives them.",
  },
  {
    id: "support-aura",
    name: "Team support",
    role: "support",
    items: ["boots", "charm", "aegis-cloak", "tome", "heart", "staff"],
    blurb: "Hp and power for heals and shields.",
  },
  {
    id: "support-power",
    name: "Spell support",
    role: "support",
    items: ["boots", "tome", "charm", "staff", "heart", "aegis-cloak"],
    blurb: "Bigger heals and disables, fragile.",
  },
]

export const buildById = (id: string): BuildPreset => BUILDS.find((b) => b.id === id) ?? BUILDS[0]!
export const buildsFor = (role: Role) => BUILDS.filter((b) => b.role === role)

export const MR_ITEM = "nullstone"
export const isMrItem = (it: Item) => (it.magicResist ?? 0) > 0
export const isArmorItem = (it: Item) => (it.armor ?? 0) > 0
export { ITEMS }

// --- defaults ----------------------------------------------------------------------------

export const defaultSlot = (role: Role): LaneSlot =>
  role === "mid" ? "mid" : role === "offlane" ? "off" : role === "jungle" ? "jungle" : "safe"

/** Map-global lane for a slot on a team. Radiant safe = bot; Dire safe = top. */
export const laneOfSlot = (slot: LaneSlot, side: DraftSide): LaneId | null => {
  if (slot === "mid") return "mid"
  if (slot === "safe") return side === "blue" ? "bot" : "top"
  if (slot === "off") return side === "blue" ? "top" : "bot"
  return null
}

const teamOf = (d: DraftState, side: DraftSide): TeamDef => (side === "blue" ? d.blue : d.red)

const STYLE_BEHAVIOR: Record<TeamDef["style"], Behavior> = {
  aggressive: { aggression: 75, farm: 40, ultDiscipline: 35, target: "weakest" },
  macro: { aggression: 45, farm: 60, ultDiscipline: 55, target: "carry" },
  teamfight: { aggression: 55, farm: 45, ultDiscipline: 80, target: "nearest" },
  pick: { aggression: 60, farm: 45, ultDiscipline: 50, target: "weakest" },
}

const STYLE_PLANS: Record<TeamDef["style"], Plans> = {
  aggressive: { laning: "aggressive", mid: "pickoff", late: "siege" },
  macro: { laning: "standard", mid: "split", late: "roshan" },
  teamfight: { laning: "scale", mid: "group", late: "siege" },
  pick: { laning: "roam", mid: "pickoff", late: "roshan" },
}

const bestLeader = (players: readonly Player[]) =>
  [...players].toSorted((a, b) => b.leadership - a.leadership)[0]!.id

/** Neutral defaults from roles only (what a human coach starts from). */
export const defaultTactics = (d: DraftState, side: DraftSide): TeamTactics => {
  const team = teamOf(d, side)
  const players: Record<string, PlayerTactics> = {}
  for (const p of team.players) {
    players[p.id] = {
      slot: defaultSlot(p.role),
      build: buildsFor(p.role)[0]!.id,
      adaptive: true,
      behavior: DEFAULT_BEHAVIOR,
    }
  }
  return {
    players,
    plans: { laning: "standard", mid: "group", late: "siege" },
    shopTiming: "on-low",
    spike: false,
    vision: ["runes", "roshan", "own-jungle", "enemy-jungle"],
    igl: bestLeader(team.players),
  }
}

/** AI coach: style-flavoured plan + behaviour, and a safe/off swap for a bad safe lane. */
export const aiTactics = (d: DraftState, side: DraftSide): TeamTactics => {
  const base = defaultTactics(d, side)
  const team = teamOf(d, side)
  const players: Record<string, PlayerTactics> = {}
  for (const p of team.players) {
    const cur = base.players[p.id]!
    const presets = buildsFor(p.role)
    const build =
      team.style === "aggressive" && p.role === "carry"
        ? "carry-glass"
        : team.style === "macro" && presets[1]
          ? presets[1].id
          : cur.build
    players[p.id] = { ...cur, build, behavior: STYLE_BEHAVIOR[team.style] }
  }
  let t: TeamTactics = {
    ...base,
    players,
    plans: STYLE_PLANS[team.style],
    shopTiming: team.style === "macro" ? "on-item" : "on-low",
    spike: team.style !== "aggressive",
    vision:
      team.style === "aggressive" || team.style === "pick"
        ? ["enemy-jungle", "runes", "roshan", "own-jungle"]
        : ["roshan", "runes", "own-jungle", "enemy-jungle"],
  }
  // Swap safe/off lanes when the safe lane is clearly lost.
  const preview = lanePreview(d, side, t, defaultTactics(d, side === "blue" ? "red" : "blue"))
  if ((preview.find((l) => l.slot === "safe")?.score ?? 0) <= -3) t = swapSides(t)
  return t
}

/** Exchange safe ↔ off for every player in those slots. */
export const swapSides = (t: TeamTactics): TeamTactics => {
  const players: Record<string, PlayerTactics> = {}
  for (const [id, p] of Object.entries(t.players))
    players[id] = {
      ...p,
      slot: p.slot === "safe" ? "off" : p.slot === "off" ? "safe" : p.slot,
    }
  return { ...t, players }
}

/** Exchange the slots of two players. */
export const swapPlayers = (t: TeamTactics, a: string, b: string): TeamTactics => {
  const pa = t.players[a]
  const pb = t.players[b]
  if (!pa || !pb || a === b) return t
  return {
    ...t,
    players: { ...t.players, [a]: { ...pa, slot: pb.slot }, [b]: { ...pb, slot: pa.slot } },
  }
}

const clamp100 = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 50)

/** Repair anything invalid against the draft (never throws). */
export const normalizeTactics = (
  d: DraftState,
  side: DraftSide,
  t: TeamTactics | undefined,
): TeamTactics => {
  const base = defaultTactics(d, side)
  if (!t) return base
  const team = teamOf(d, side)
  const players: Record<string, PlayerTactics> = {}
  for (const p of team.players) {
    const got = t.players[p.id]
    const def = base.players[p.id]!
    players[p.id] = got
      ? {
          slot: LANE_SLOTS.includes(got.slot) ? got.slot : def.slot,
          build: BUILDS.some((b) => b.id === got.build) ? got.build : def.build,
          adaptive: got.adaptive,
          behavior: {
            aggression: clamp100(got.behavior.aggression),
            farm: clamp100(got.behavior.farm),
            ultDiscipline: clamp100(got.behavior.ultDiscipline),
            target: TARGET_PRIORITIES.includes(got.behavior.target)
              ? got.behavior.target
              : "weakest",
          },
        }
      : def
  }
  const vision = [...new Set(t.vision.filter((z) => VISION_ZONES.includes(z)))]
  for (const z of VISION_ZONES) if (!vision.includes(z)) vision.push(z)
  return {
    players,
    plans: t.plans ?? base.plans,
    shopTiming: t.shopTiming ?? base.shopTiming,
    spike: t.spike ?? base.spike,
    vision,
    igl: team.players.some((p) => p.id === t.igl) ? t.igl : base.igl,
  }
}

// --- lane matchup preview ---------------------------------------------------------------

export interface LanePreview {
  readonly slot: "safe" | "mid" | "off"
  readonly lane: LaneId
  /** Our hero ids in this lane. */
  readonly ours: readonly string[]
  /** Enemy hero ids predicted to face them. */
  readonly theirs: readonly string[]
  readonly score: number
  readonly verdict: "favoured" | "even" | "unfavoured"
}

const heroOfPlayer = (d: DraftState, side: DraftSide, playerId: string) =>
  d.picks[side].find((p) => p.playerId === playerId)?.heroId

const meanSkill = (ps: readonly Player[], ids: readonly string[]) =>
  ps.length
    ? ps.reduce((s, p, i) => s + p.skill + masteryOf(p, ids[i] ?? "") * 4, 0) / ps.length
    : 0

/** Our safe lane faces their off lane (same map lane), and vice versa. */
export const lanePreview = (
  d: DraftState,
  side: DraftSide,
  ours: TeamTactics,
  theirs: TeamTactics,
): readonly LanePreview[] => {
  const enemy: DraftSide = side === "blue" ? "red" : "blue"
  const us = teamOf(d, side)
  const them = teamOf(d, enemy)
  const out: LanePreview[] = []
  for (const slot of ["safe", "mid", "off"] as const) {
    const lane = laneOfSlot(slot, side)!
    const mine = us.players.filter((p) => ours.players[p.id]?.slot === slot)
    const foes = them.players.filter((p) => {
      const s = theirs.players[p.id]?.slot
      return s && s !== "jungle" && s !== "roam" && laneOfSlot(s, enemy) === lane
    })
    const ourHeroes = mine.map((p) => heroOfPlayer(d, side, p.id)).filter(Boolean) as string[]
    const theirHeroes = foes.map((p) => heroOfPlayer(d, enemy, p.id)).filter(Boolean) as string[]
    let m = 0
    for (const a of ourHeroes) for (const b of theirHeroes) m += matchup(a, b)
    const skill = (meanSkill(mine, ourHeroes) - meanSkill(foes, theirHeroes)) / 4
    // Numbers advantage (2v1, 1v2) matters more than anything else in a lane.
    const numbers = (ourHeroes.length - theirHeroes.length) * 2
    const score = Math.round((m + skill + numbers) * 10) / 10
    out.push({
      slot,
      lane,
      ours: ourHeroes,
      theirs: theirHeroes,
      score,
      verdict: score >= 1.5 ? "favoured" : score <= -1.5 ? "unfavoured" : "even",
    })
  }
  return out
}
