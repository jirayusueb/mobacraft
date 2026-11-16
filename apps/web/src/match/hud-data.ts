import { ROSHAN_RESPAWN } from "@mobacraft/sim"
/**
 * Client-side derivations for the Match Day HUD — everything the snapshot
 * doesn't carry directly: feed parsing (who killed whom), announcer events
 * (multi-kills, wipes, Ancient under attack) and a sampled gold history.
 * Pure functions + one small mutable tracker; no React here.
 */
import type { DraftSide, FeedEntry, HeroLine, MatchSnapshot } from "@mobacraft/sim"
import { ANNOUNCER } from "../strings.ts"

// --- history -------------------------------------------------------------------------

export interface GoldSample {
  readonly t: number
  readonly blue: number
  readonly red: number
}

/** What the match screen records for the results screen. */
export interface MatchHistory {
  readonly gold: readonly GoldSample[]
}

/** Minimum game seconds between gold samples (keeps a 30-min match under ~2k points). */
export const SAMPLE_EVERY = 1

export const pushSample = (history: GoldSample[], snap: MatchSnapshot) => {
  const last = history.at(-1)
  if (last && snap.time - last.t < SAMPLE_EVERY) return
  history.push({ t: snap.time, blue: snap.gold.blue, red: snap.gold.red })
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
 * Roshan respawn in game seconds. Mirrors the sim's ROSHAN_RESPAWN (not exported);
 * the HUD shows it as an approximate "~" time, never as exact.
 */
export const ROSHAN_RESPAWN_APPROX = ROSHAN_RESPAWN

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

export interface AnnouncerTracker {
  seen: number
  nextId: number
  /** playerId → recent kill times (game seconds). */
  streaks: Map<string, number[]>
  wiped: Record<DraftSide, boolean>
  ancientHp: Record<DraftSide, number>
  ancientWarnedAt: Record<DraftSide, number>
}

export const createTracker = (): AnnouncerTracker => ({
  seen: 0,
  nextId: 1,
  streaks: new Map(),
  wiped: { blue: false, red: false },
  ancientHp: { blue: 1, red: 1 },
  ancientWarnedAt: { blue: -999, red: -999 },
})

const label = (h: HeroLine | undefined) => (h ? `${h.playerName} · ${h.heroName}` : "")

/**
 * Advance the tracker to `snap` and return any new banners.
 * `ancientHp` is each side's own Ancient health (0..1) from the renderer seam.
 * `teamName` names a side for copy ("Lantern Ward").
 */
export const announce = (
  tr: AnnouncerTracker,
  snap: MatchSnapshot,
  ancientHp: Readonly<Record<DraftSide, number>>,
  teamName: (s: DraftSide) => string,
): Banner[] => {
  const out: Banner[] = []
  const add = (b: Omit<Banner, "id">) => out.push({ ...b, id: tr.nextId++ })
  const fresh = snap.feed.slice(tr.seen)
  tr.seen = snap.feed.length

  for (const f of fresh) {
    const side = f.side
    switch (f.kind) {
      case "first-blood":
      case "kill": {
        const k = parseKill(f, snap.heroes)
        const killer = k?.killer
        let streak = 1
        if (killer) {
          const times = (tr.streaks.get(killer.playerId) ?? []).filter(
            (t) => f.t - t <= MULTI_WINDOW,
          )
          times.push(f.t)
          tr.streaks.set(killer.playerId, times)
          streak = times.length
        }
        if (f.kind === "first-blood") {
          add({
            kind: "first-blood",
            side,
            title: ANNOUNCER["first-blood"]!,
            detail: killer ? `${label(killer)} draws first blood` : "The first hero falls",
            heroId: killer?.heroId,
            priority: 4,
          })
        }
        if (killer && streak >= 2) {
          add({
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
        add({
          kind: "tower",
          side,
          title: ANNOUNCER["tower"]!,
          detail: side === "neutral" ? f.text : `${teamName(side)} topple a tower`,
          priority: 2,
        })
        break
      case "rax":
        add({
          kind: "rax",
          side,
          title: ANNOUNCER["rax"]!,
          detail: side === "neutral" ? f.text : `${teamName(side)} break the barracks`,
          priority: 3,
        })
        break
      case "roshan": {
        const carrier = aegisCarrier(f, snap.heroes)
        add({
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
        add({
          kind: "aegis",
          side,
          title: ANNOUNCER["aegis"]!,
          detail: h ? `${label(h)} rises with the Aegis` : "The Aegis is spent",
          heroId: h?.heroId,
          priority: 4,
        })
        break
      }
      default:
        break
    }
  }

  // Team wipe: every hero of a side dead at once (fires once per wipe).
  for (const s of ["blue", "red"] as const) {
    const team = snap.heroes.filter((h) => h.side === s)
    const allDead = team.length > 0 && team.every((h) => !h.alive)
    if (allDead && !tr.wiped[s]) {
      const other: DraftSide = s === "blue" ? "red" : "blue"
      add({
        kind: "wipe",
        side: other,
        title: ANNOUNCER["wipe"]!,
        detail: `${teamName(other)} wipe ${teamName(s)}`,
        priority: 8,
      })
    }
    tr.wiped[s] = allDead
  }

  // Ancient under attack: health dropped since the last sample; at most every 45 s.
  for (const s of ["blue", "red"] as const) {
    const hp = ancientHp[s]
    if (hp < tr.ancientHp[s] - 0.0005 && !snap.winner && snap.time - tr.ancientWarnedAt[s] > 45) {
      tr.ancientWarnedAt[s] = snap.time
      add({
        kind: "ancient",
        side: s === "blue" ? "red" : "blue",
        title: ANNOUNCER["ancient"]!,
        detail: `${teamName(s)}'s Ancient at ${Math.round(hp * 100)}%`,
        priority: 7,
      })
    }
    tr.ancientHp[s] = hp
  }

  return out
}

// --- small formatting ----------------------------------------------------------------

export const goldK = (n: number) => `${(n / 1000).toFixed(1)}k`

export const otherSide = (s: DraftSide): DraftSide => (s === "blue" ? "red" : "blue")
