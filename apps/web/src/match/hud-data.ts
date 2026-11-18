/**
 * Client-side derivations for the Match Day HUD — everything the snapshot
 * doesn't carry directly: feed parsing (who killed whom), announcer events
 * (multi-kills, wipes, Ancient under attack, phase changes), lead series and
 * comms formatting. Pure functions + one small mutable tracker; no React here.
 */
import {
  type CommsEntry,
  type DraftSide,
  type FeedEntry,
  type HeroLine,
  type MatchSnapshot,
  PHASES,
  type Phase,
} from "@mobacraft/sim"
import { ANNOUNCER } from "../strings.ts"

// --- history -------------------------------------------------------------------------

export interface GoldSample {
  readonly t: number
  readonly blue: number
  readonly red: number
}

/**
 * Legacy UI-side history (spec/05). The sim now owns history (`snapshot.history`,
 * spec/06 §4); the results screen reads `final.history` and ignores this.
 */
export interface MatchHistory {
  readonly gold: readonly GoldSample[]
}

/** One point of the lead graphs: your side minus theirs. */
export interface LeadPoint {
  readonly t: number
  /** Net-worth lead. */
  readonly nw: number
  /** Total-XP lead. */
  readonly xp: number
}

const sideXp = (heroes: readonly HeroLine[], side: DraftSide) =>
  heroes.filter((h) => h.side === side).reduce((s, h) => s + h.xp, 0)

/**
 * Lead series from the sim's 5 s history, plus the live moment (so the line
 * always reaches "now" between samples).
 */
export const leadSeries = (snap: MatchSnapshot, you: DraftSide): LeadPoint[] => {
  const them = otherSide(you)
  const pts: LeadPoint[] = (snap.history ?? []).map((s) => ({
    t: s.t,
    nw: s.nw[you] - s.nw[them],
    xp: s.xp[you] - s.xp[them],
  }))
  const last = pts.at(-1)
  if (snap.netWorth && (!last || snap.time - last.t >= 0.5)) {
    pts.push({
      t: snap.time,
      nw: snap.netWorth[you] - snap.netWorth[them],
      xp: Math.round(sideXp(snap.heroes, you) - sideXp(snap.heroes, them)),
    })
  }
  return pts
}

export interface PhaseBand {
  readonly phase: Phase
  readonly from: number
  readonly to: number
}

/** Contiguous phase spans [from, to) up to `end`, from the sim's `phaseAt`. */
export const phaseBands = (
  phaseAt: Readonly<Partial<Record<Phase, number>>>,
  end: number,
): PhaseBand[] => {
  const starts = PHASES.flatMap((p) => {
    const at = p === "laning" ? (phaseAt[p] ?? 0) : phaseAt[p]
    return at === undefined ? [] : [{ phase: p, at }]
  })
  return starts.map((s, i) => ({
    phase: s.phase,
    from: s.at,
    to: Math.max(s.at, starts[i + 1]?.at ?? end),
  }))
}

export type MarkerKind = "kill" | "tower" | "rax" | "roshan" | "ancient" | "phase"

export interface Marker {
  readonly t: number
  readonly kind: MarkerKind
  /** Good news for you (true), them (false), or nobody (null). */
  readonly mine: boolean | null
  readonly label: string
}

/** Event ticks for the lead graphs, from the match feed. */
export const leadMarkers = (
  feed: readonly FeedEntry[],
  heroes: readonly HeroLine[],
  you: DraftSide,
): Marker[] =>
  feed.flatMap((f): Marker[] => {
    const mine = f.side === "neutral" ? null : f.side === you
    switch (f.kind) {
      case "kill":
      case "first-blood": {
        const k = parseKill(f, heroes)
        const text = k?.killer
          ? `${k.killer.playerName} slew ${k.victim?.playerName ?? "a hero"}`
          : f.text
        return [{ t: f.t, kind: "kill", mine, label: text }]
      }
      case "tower":
      case "rax":
      case "roshan":
      case "ancient":
      case "phase":
        return [{ t: f.t, kind: f.kind, mine, label: f.text }]
      default:
        return []
    }
  })

/** "+1.2k" / "−0.4k" / "0" — a signed lead in thousands. */
export const signedK = (n: number) =>
  Math.abs(n) < 50 ? "0" : `${n > 0 ? "+" : "−"}${goldK(Math.abs(n))}`

// --- comms ------------------------------------------------------------------------------

/** "Coach → Mae (IGL): "Group up!" · 4/5 following" — one comms log line. */
export const commsText = (c: CommsEntry, heroes: readonly HeroLine[]): string => {
  const isIgl = heroes.some((h) => h.side === c.side && h.igl && h.playerName === c.caller)
  const who = c.caller ? `${c.caller} (${isIgl ? "IGL" : "backup"})` : null
  const head = c.from === "coach" ? (who ? `Coach → ${who}` : "Coach") : (who ?? "IGL")
  const tail = c.pending
    ? c.caller
      ? " · relaying…"
      : ""
    : c.caller
      ? ` · ${c.followers}/${c.total} following`
      : /no caller/i.test(c.text)
        ? ""
        : " · no caller alive"
  return `${head}: "${c.text}"${tail}`
}

/** True when every hero on `side` is dead (calls wait for the first respawn). */
export const noCallerAlive = (heroes: readonly HeroLine[], side: DraftSide) => {
  const team = heroes.filter((h) => h.side === side)
  return team.length > 0 && team.every((h) => !h.alive)
}

// --- feed parsing ----------------------------------------------------------------------

/** "Player (Hero)" as written by the sim's feed. */
const KILL_RE = /^(?:First blood! )?(?:(.+?) \((.+?)\) slew )?(.+?) \((.+?)\)(?: was slain)?$/
const AEGIS_RE = /^(.+?) \((.+?)\) reincarnates/

const findLine = (heroes: readonly HeroLine[], player: string, hero: string) =>
  heroes.find((h) => h.playerName === player && h.heroName === hero)

export interface ParsedKill {
  readonly killer: HeroLine | undefined
  readonly victim: HeroLine | undefined
}

export const parseKill = (f: FeedEntry, heroes: readonly HeroLine[]): ParsedKill | null => {
  if (f.kind !== "kill" && f.kind !== "first-blood") return null
  const m = KILL_RE.exec(f.text)
  if (!m) return null
  const [, kp, kh, vp, vh] = m
  return {
    killer: kp && kh ? findLine(heroes, kp, kh) : undefined,
    victim: vp && vh ? findLine(heroes, vp, vh) : undefined,
  }
}

export const parseAegis = (f: FeedEntry, heroes: readonly HeroLine[]) => {
  if (f.kind !== "aegis") return undefined
  const m = AEGIS_RE.exec(f.text)
  return m ? findLine(heroes, m[1]!, m[2]!) : undefined
}

/** The Aegis carrier named in a Roshan entry ("… — Aegis to Mae"). */
export const aegisCarrier = (f: FeedEntry, heroes: readonly HeroLine[]) => {
  const name = /Aegis to (.+)$/.exec(f.text)?.[1]
  return name ? heroes.find((h) => h.playerName === name && h.side === f.side) : undefined
}

// --- Roshan --------------------------------------------------------------------------

/**
 * Roshan readout from the public respawn window (spec/12 §5): the exact time is
 * hidden, so the HUD shows "8:00–11:00"-style windows and a "maybe up" state.
 */
export const roshanText = (snap: MatchSnapshot, clock: (s: number) => string): string => {
  const w = snap.roshanWindow
  if (w.state === "alive") return "Roshan up"
  if (w.state === "maybe")
    return `Roshan maybe up · by ${clock(Math.max(0, w.latest! - snap.time))}`
  return `Roshan ${clock(Math.max(0, w.earliest! - snap.time))}–${clock(Math.max(0, w.latest! - snap.time))}`
}

export const roshanDownAt = (feed: readonly FeedEntry[]) =>
  feed.findLast((f) => f.kind === "roshan")?.t ?? null

// --- announcer -----------------------------------------------------------------------

export type BannerKind =
  | "first-blood"
  | "multi"
  | "tower"
  | "rax"
  | "roshan"
  | "aegis"
  | "wipe"
  | "ancient"
  | "phase"
  | "time"

export interface Banner {
  readonly id: number
  readonly kind: BannerKind
  /** The side the banner is good news for ("neutral" → no team tint). */
  readonly side: DraftSide | "neutral"
  readonly title: string
  readonly detail: string
  readonly heroId?: string
  /** Higher survives queue trimming. */
  readonly priority: number
}

export const MULTI_WINDOW = 10
const MULTI_TITLE: Record<number, string> = {
  2: ANNOUNCER["double"]!,
  3: ANNOUNCER["triple"]!,
  4: ANNOUNCER["ultra"]!,
  5: ANNOUNCER["rampage"]!,
}

const label = (h: HeroLine | undefined) => (h ? `${h.playerName} · ${h.heroName}` : "")

const SIDES = ["blue", "red"] as const
const ANCIENT_WARN_COOLDOWN = 45

type TeamName = (s: DraftSide) => string

/**
 * Turns the match feed and side health into announcer banners.
 * Stateful: remembers which feed entries it has seen, kill streaks, wipes and
 * the last Ancient warning so each moment is announced once.
 */
export class AnnouncerTracker {
  #seen = 0
  #nextId = 1
  /** playerId → recent kill times (game seconds). */
  readonly #streaks = new Map<string, number[]>()
  readonly #wiped: Record<DraftSide, boolean> = { blue: false, red: false }
  readonly #ancientHp: Record<DraftSide, number> = { blue: 1, red: 1 }
  readonly #ancientWarnedAt: Record<DraftSide, number> = { blue: -999, red: -999 }
  #out: Banner[] = []

  /**
   * Advance to `snap` and return any new banners.
   * `ancientHp` is each side's own Ancient health (0..1) from the renderer seam.
   * `teamName` names a side for copy ("Lantern Ward").
   */
  announce(
    snap: MatchSnapshot,
    ancientHp: Readonly<Record<DraftSide, number>>,
    teamName: TeamName,
  ): Banner[] {
    this.#out = []
    const fresh = snap.feed.slice(this.#seen)
    this.#seen = snap.feed.length
    for (const f of fresh) this.#feedEntry(f, snap, teamName)
    this.#checkWipes(snap, teamName)
    this.#checkAncients(snap, ancientHp, teamName)
    return this.#out
  }

  #add(b: Omit<Banner, "id">): void {
    this.#out.push({ ...b, id: this.#nextId++ })
  }

  /** Records a kill for `playerId` at time `t`; returns the current multi-kill streak. */
  #streak(playerId: string, t: number): number {
    const times = (this.#streaks.get(playerId) ?? []).filter((x) => t - x <= MULTI_WINDOW)
    times.push(t)
    this.#streaks.set(playerId, times)
    return times.length
  }

  #feedEntry(f: FeedEntry, snap: MatchSnapshot, teamName: TeamName): void {
    const side = f.side
    switch (f.kind) {
      case "first-blood":
      case "kill": {
        const killer = parseKill(f, snap.heroes)?.killer
        const streak = killer ? this.#streak(killer.playerId, f.t) : 1
        if (f.kind === "first-blood") {
          this.#add({
            kind: "first-blood",
            side,
            title: ANNOUNCER["first-blood"]!,
            detail: killer ? `${label(killer)} draws first blood` : "The first hero falls",
            heroId: killer?.heroId,
            priority: 4,
          })
        }
        if (killer && streak >= 2) {
          this.#add({
            kind: "multi",
            side,
            title: MULTI_TITLE[Math.min(streak, 5)]!,
            detail: label(killer),
            heroId: killer.heroId,
            priority: 3 + Math.min(streak, 5),
          })
        }
        break
      }
      case "tower":
        this.#add({
          kind: "tower",
          side,
          title: ANNOUNCER["tower"]!,
          detail: side === "neutral" ? f.text : `${teamName(side)} topple a tower`,
          priority: 2,
        })
        break
      case "rax":
        this.#add({
          kind: "rax",
          side,
          title: ANNOUNCER["rax"]!,
          detail: side === "neutral" ? f.text : `${teamName(side)} break the barracks`,
          priority: 3,
        })
        break
      case "roshan": {
        const carrier = aegisCarrier(f, snap.heroes)
        this.#add({
          kind: "roshan",
          side,
          title: ANNOUNCER["roshan"]!,
          detail: carrier
            ? `Aegis of the Immortal → ${label(carrier)}`
            : side === "neutral"
              ? "The pit falls quiet"
              : `${teamName(side)} take the Aegis`,
          heroId: carrier?.heroId,
          priority: 5,
        })
        break
      }
      case "aegis": {
        const h = parseAegis(f, snap.heroes)
        this.#add({
          kind: "aegis",
          side,
          title: ANNOUNCER["aegis"]!,
          detail: h ? `${label(h)} rises with the Aegis` : "The Aegis is spent",
          heroId: h?.heroId,
          priority: 4,
        })
        break
      }
      case "time-warning":
        this.#add({
          kind: "time",
          side,
          title: ANNOUNCER["time-warning"]!,
          detail: f.text.split(" — ")[1] ?? f.text,
          priority: 7,
        })
        break
      case "phase": {
        const late = f.text.startsWith("Late")
        this.#add({
          kind: "phase",
          side: "neutral",
          title: ANNOUNCER[late ? "phase-late" : "phase-mid"]!,
          detail: f.text.split(" — ")[1] ?? f.text,
          priority: 6,
        })
        break
      }
      default:
        break
    }
  }

  /** Team wipe: every hero of a side dead at once (fires once per wipe). */
  #checkWipes(snap: MatchSnapshot, teamName: TeamName): void {
    for (const s of SIDES) {
      const team = snap.heroes.filter((h) => h.side === s)
      const allDead = team.length > 0 && team.every((h) => !h.alive)
      if (allDead && !this.#wiped[s]) {
        const other = otherSide(s)
        this.#add({
          kind: "wipe",
          side: other,
          title: ANNOUNCER["wipe"]!,
          detail: `${teamName(other)} wipe ${teamName(s)}`,
          priority: 8,
        })
      }
      this.#wiped[s] = allDead
    }
  }

  /** Ancient under attack: health dropped since the last sample; rate-limited per side. */
  #checkAncients(
    snap: MatchSnapshot,
    ancientHp: Readonly<Record<DraftSide, number>>,
    teamName: TeamName,
  ): void {
    for (const s of SIDES) {
      const hp = ancientHp[s]
      const dropped = hp < this.#ancientHp[s] - 0.0005
      const cooled = snap.time - this.#ancientWarnedAt[s] > ANCIENT_WARN_COOLDOWN
      if (dropped && !snap.winner && cooled) {
        this.#ancientWarnedAt[s] = snap.time
        this.#add({
          kind: "ancient",
          side: otherSide(s),
          title: ANNOUNCER["ancient"]!,
          detail: `${teamName(s)}'s Ancient at ${Math.round(hp * 100)}%`,
          priority: 7,
        })
      }
      this.#ancientHp[s] = hp
    }
  }
}

// --- small formatting ----------------------------------------------------------------

export const goldK = (n: number) => `${(n / 1000).toFixed(1)}k`

export const otherSide = (s: DraftSide): DraftSide => (s === "blue" ? "red" : "blue")

// --- Roshan HUD ----------------------------------------------------------------------

/**
 * Roshan's HP fraction from the live unit list — `null` when he is dead or
 * not spawned, `1` at full health. Drives the scoreboard's "Roshan 64%"
 * readout so a pit attempt is visible even when no banner is on screen.
 */
export const roshanHp = <U extends { kind: string; hp?: number }>(
  units: readonly U[],
): number | null => {
  for (const u of units) if (u.kind === "roshan") return u.hp ?? 1
  return null
}

/** True while the pit is being fought (alive and below ~full health). */
export const roshanUnderAttack = (hp: number | null): boolean => hp !== null && hp < 0.995

// --- inventory zones (spec/10) -------------------------------------------------------

const filled = (xs: readonly (string | null)[] | undefined): string[] =>
  (xs ?? []).filter((x): x is string => x !== null)

export interface InventoryZones {
  /** Backpack items (inert). */
  readonly backpack: readonly string[]
  readonly neutral: string | null
  readonly stash: readonly string[]
  readonly inTransit: readonly string[]
  readonly buffs: readonly string[]
  readonly tango: number
  /** Anything beyond the six main slots worth a second row. */
  readonly any: boolean
}

/** Secondary inventory zones for a hero frame; tolerant of older snapshots. */
export const inventoryZones = (h: HeroLine): InventoryZones => {
  const backpack = filled(h.backpack)
  const stash = filled(h.stash)
  const inTransit = [...(h.inTransit ?? [])]
  const buffs = [...(h.buffs ?? [])]
  const tango = h.tango ?? 0
  return {
    backpack,
    neutral: h.neutral ?? null,
    stash,
    inTransit,
    buffs,
    tango,
    any: backpack.length + stash.length + inTransit.length + buffs.length > 0 || tango > 0,
  }
}

/** Screen-reader inventory text, zone by zone (names via `nameOf`). */
export const inventorySummary = (
  h: HeroLine,
  nameOf: (id: string) => string = (id) => id,
): string => {
  const z = inventoryZones(h)
  const main = filled(h.main ?? h.items)
  const muted = (h.main ?? []).filter((id, i) => id !== null && (h.mainMute?.[i] ?? 0) > 0)
  const parts = [
    main.length ? `items: ${main.map(nameOf).join(", ")}` : "no items",
    muted.length ? `muted: ${muted.map((id) => nameOf(id!)).join(", ")}` : "",
    z.neutral ? `neutral: ${nameOf(z.neutral)}` : "",
    z.backpack.length ? `backpack: ${z.backpack.map(nameOf).join(", ")}` : "",
    z.stash.length ? `stash: ${z.stash.map(nameOf).join(", ")}` : "",
    z.inTransit.length ? `on courier: ${z.inTransit.map(nameOf).join(", ")}` : "",
    z.buffs.length ? `buffs: ${z.buffs.map(nameOf).join(", ")}` : "",
    z.tango ? `${z.tango} tango` : "",
  ]
  return parts.filter(Boolean).join("; ")
}
