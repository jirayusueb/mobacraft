/**
 * Career (spec/07 §2) — player–hero mastery over time: tiers, skill rust, weekly
 * practice (public scrims vs hidden private lobbies), scouting and pair chemistry.
 *
 * Pure and immutable: every operation returns a new Career. The match never mutates it;
 * after a match `recordMatch` folds the played heroes back in.
 */
import { HEROES } from "./heroes.ts"
import { type Player, TEAMS, type TeamDef } from "./teams.ts"

export type MasteryTier = "unfamiliar" | "playable" | "comfortable" | "signature"
export const TIERS: readonly MasteryTier[] = ["unfamiliar", "playable", "comfortable", "signature"]
export const TIER_LABEL: Readonly<Record<MasteryTier, string>> = {
  unfamiliar: "Unfamiliar",
  playable: "Playable",
  comfortable: "Comfortable",
  signature: "Signature",
}
export const TIER_FLOOR: Readonly<Record<MasteryTier, number>> = {
  unfamiliar: 0,
  playable: 0.45,
  comfortable: 0.65,
  signature: 0.85,
}

export const tierOf = (mastery: number): MasteryTier =>
  mastery >= TIER_FLOOR.signature
    ? "signature"
    : mastery >= TIER_FLOOR.comfortable
      ? "comfortable"
      : mastery >= TIER_FLOOR.playable
        ? "playable"
        : "unfamiliar"

/** Default mastery for a hero a player has never touched (matches teams.ts `masteryOf`). */
export const BASE_MASTERY = 0.35
export const RUST_GRACE_DAYS = 30
export const RUST_PER_DAY = 0.004
export const PLAY_GAIN = 0.02
export const PRACTICE_GAIN = 0.06
export const DAYS_PER_WEEK = 7
export const BONDING_GAIN = 0.15

export interface MasteryRecord {
  /** Real mastery 0..1 (what the sim uses). */
  readonly mastery: number
  /** What opponents' scouting sees: only official matches and public scrims raise it. */
  readonly publicMastery: number
  /** Last day the hero was played or practised. */
  readonly lastPlayed: number
  /** Highest tier ever reached — sets the rust floor. */
  readonly peak: number
}

export type PracticeFocus =
  | { readonly kind: "scrim"; readonly heroId: string }
  | { readonly kind: "private"; readonly heroId: string }
  | { readonly kind: "bonding"; readonly with: string }
  | { readonly kind: "rest" }

export interface Career {
  /** Calendar day (0 = season start). One match day per week. */
  readonly day: number
  readonly week: number
  /** playerId → heroId → record. */
  readonly records: Readonly<Record<string, Readonly<Record<string, MasteryRecord>>>>
  /** "a|b" (sorted ids) → chemistry −1..1. */
  readonly chemistry: Readonly<Record<string, number>>
}

/** Teamwork / communication rating (1..20) — drives combo sync (spec/07 §3c). */
const TEAMWORK: Readonly<Record<string, number>> = {
  "lnt-bram": 12,
  "lnt-osk": 14,
  "lnt-hild": 15,
  "lnt-ivo": 13,
  "lnt-mae": 17,
  "emb-kas": 9,
  "emb-rhee": 11,
  "emb-tor": 12,
  "emb-yuki": 13,
  "emb-lio": 12,
  "mir-ada": 13,
  "mir-sol": 16,
  "mir-kell": 15,
  "mir-pim": 14,
  "mir-wren": 16,
  "hvl-nox": 12,
  "hvl-sable": 10,
  "hvl-grey": 15,
  "hvl-rook": 11,
  "hvl-vey": 14,
}
export const teamworkOf = (p: Player) => TEAMWORK[p.id] ?? 12

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)

/** Starting chemistry: one feuding pair per team, one tight duo. */
const INITIAL_CHEMISTRY: Readonly<Record<string, number>> = {
  [pairKey("lnt-bram", "lnt-mae")]: 0.6,
  [pairKey("lnt-osk", "lnt-hild")]: -0.5,
  [pairKey("emb-rhee", "emb-yuki")]: 0.5,
  [pairKey("emb-kas", "emb-lio")]: -0.5,
  [pairKey("mir-sol", "mir-wren")]: 0.6,
  [pairKey("mir-ada", "mir-kell")]: -0.5,
  [pairKey("hvl-grey", "hvl-vey")]: 0.5,
  [pairKey("hvl-nox", "hvl-sable")]: -0.5,
}

export const chemistryOf = (c: Career, a: string, b: string) =>
  c.chemistry[pairKey(a, b)] ?? INITIAL_CHEMISTRY[pairKey(a, b)] ?? 0

/**
 * Season start: every listed mastery is known publicly, last played a few days ago.
 * A couple of AI players start with a hidden pocket hero so scouting can be fooled both ways.
 */
export const createCareer = (teams: readonly TeamDef[] = TEAMS): Career => {
  const records: Record<string, Record<string, MasteryRecord>> = {}
  for (const t of teams)
    for (const p of t.players) {
      const r: Record<string, MasteryRecord> = {}
      for (const [heroId, m] of Object.entries(p.mastery))
        r[heroId] = { mastery: m, publicMastery: m, lastPlayed: -3, peak: m }
      records[p.id] = r
    }
  const pocket = (pid: string, heroId: string, m: number) => {
    const r = records[pid]
    if (r) r[heroId] = { mastery: m, publicMastery: BASE_MASTERY, lastPlayed: -2, peak: m }
  }
  pocket("emb-rhee", "stormcaller", 0.88)
  pocket("hvl-sable", "frostveil", 0.86)
  return { day: 0, week: 1, records, chemistry: { ...INITIAL_CHEMISTRY } }
}

const recordOf = (c: Career, playerId: string, heroId: string): MasteryRecord =>
  c.records[playerId]?.[heroId] ?? {
    mastery: BASE_MASTERY,
    publicMastery: BASE_MASTERY,
    lastPlayed: -999,
    peak: BASE_MASTERY,
  }

/** Real mastery (used by the sim). */
export const careerMastery = (c: Career, playerId: string, heroId: string) =>
  recordOf(c, playerId, heroId).mastery

/** Scouted mastery (what an opponent sees). */
export const scoutedMastery = (c: Career, playerId: string, heroId: string) =>
  recordOf(c, playerId, heroId).publicMastery

/** Days since the hero was last played or practised. */
export const idleDays = (c: Career, playerId: string, heroId: string) =>
  c.day - recordOf(c, playerId, heroId).lastPlayed

/** A hero is "rusting" once it passes the grace period. */
export const isRusting = (c: Career, playerId: string, heroId: string) =>
  c.records[playerId]?.[heroId] !== undefined && idleDays(c, playerId, heroId) > RUST_GRACE_DAYS

/** Hidden-signature heroes: real tier above the scouted tier and at least Comfortable. */
export const pocketHeroes = (c: Career, playerId: string): readonly string[] =>
  Object.entries(c.records[playerId] ?? {})
    .filter(
      ([, r]) =>
        TIERS.indexOf(tierOf(r.mastery)) > TIERS.indexOf(tierOf(r.publicMastery)) &&
        r.mastery >= TIER_FLOOR.comfortable,
    )
    .map(([id]) => id)

const rustFloor = (r: MasteryRecord) =>
  r.peak >= TIER_FLOOR.comfortable ? TIER_FLOOR.playable : BASE_MASTERY

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

const setRecord = (
  records: Career["records"],
  playerId: string,
  heroId: string,
  r: MasteryRecord,
): Career["records"] => ({ ...records, [playerId]: { ...records[playerId], [heroId]: r } })

/** Rust for one day: every hero past the grace period loses RUST_PER_DAY, down to its floor. */
const rustDay = (c: Career, day: number): Career["records"] => {
  const out: Record<string, Record<string, MasteryRecord>> = {}
  for (const [pid, heroes] of Object.entries(c.records)) {
    const r2: Record<string, MasteryRecord> = {}
    for (const [hid, r] of Object.entries(heroes)) {
      const floor = rustFloor(r)
      const rusting = day - r.lastPlayed > RUST_GRACE_DAYS && r.mastery > floor
      r2[hid] = rusting
        ? {
            ...r,
            mastery: Math.max(floor, r.mastery - RUST_PER_DAY),
            publicMastery: Math.max(
              Math.min(floor, r.publicMastery),
              r.publicMastery - RUST_PER_DAY,
            ),
          }
        : r
    }
    out[pid] = r2
  }
  return out
}

/** Advance the calendar by `days`, applying rust each day. */
export const advanceDays = (c: Career, days: number): Career => {
  let cur = c
  for (let i = 0; i < days; i++) {
    const day = cur.day + 1
    cur = { ...cur, day, records: rustDay(cur, day) }
  }
  return { ...cur, week: Math.floor(cur.day / DAYS_PER_WEEK) + 1 }
}

const gain = (r: MasteryRecord, amount: number, day: number, isPublic: boolean): MasteryRecord => {
  const mastery = clamp01(r.mastery + amount)
  return {
    mastery,
    publicMastery: isPublic ? Math.max(r.publicMastery, mastery) : r.publicMastery,
    lastPlayed: day,
    peak: Math.max(r.peak, mastery),
  }
}

/** Apply one week of practice focus per player, then advance 7 days (rust included). */
export const practiceWeek = (c: Career, focus: Readonly<Record<string, PracticeFocus>>): Career => {
  let records = c.records
  const chemistry = { ...c.chemistry }
  for (const [pid, f] of Object.entries(focus)) {
    if (f.kind === "scrim" || f.kind === "private") {
      const r = recordOf({ ...c, records }, pid, f.heroId)
      records = setRecord(
        records,
        pid,
        f.heroId,
        gain(r, PRACTICE_GAIN, c.day + 1, f.kind === "scrim"),
      )
    } else if (f.kind === "bonding") {
      const k = pairKey(pid, f.with)
      chemistry[k] = Math.max(
        -1,
        Math.min(1, (chemistry[k] ?? INITIAL_CHEMISTRY[k] ?? 0) + BONDING_GAIN),
      )
    }
  }
  return advanceDays({ ...c, records, chemistry }, DAYS_PER_WEEK)
}

/** Fold a played match back in: each pick gains PLAY_GAIN publicly and resets its rust clock. */
export const recordMatch = (
  c: Career,
  picks: readonly { readonly playerId: string; readonly heroId: string }[],
): Career => {
  let records = c.records
  for (const p of picks) {
    const r = recordOf({ ...c, records }, p.playerId, p.heroId)
    records = setRecord(records, p.playerId, p.heroId, gain(r, PLAY_GAIN, c.day, true))
  }
  return { ...c, records }
}

/**
 * AI teams' weekly practice: their three best heroes; the best one privately when
 * the team plays a pick/aggressive style (they like surprises).
 */
export const aiPracticeFocus = (team: TeamDef, c: Career): Record<string, PracticeFocus> => {
  const out: Record<string, PracticeFocus> = {}
  team.players.forEach((p, i) => {
    const best = Object.entries(c.records[p.id] ?? {})
      .toSorted(([, x], [, y]) => y.mastery - x.mastery)
      .map(([id]) => id)
    const stale = best.find((h) => idleDays(c, p.id, h) > RUST_GRACE_DAYS - DAYS_PER_WEEK)
    const heroId = stale ?? best[i % Math.max(1, Math.min(3, best.length))] ?? HEROES[0]!.id
    out[p.id] =
      i === 0 && (team.style === "pick" || team.style === "aggressive")
        ? { kind: "private", heroId }
        : { kind: "scrim", heroId }
  })
  return out
}

/** A team with mastery replaced by a view of the career (`real` for the sim, `scouted` for rivals). */
export const teamView = (team: TeamDef, c: Career, view: "real" | "scouted"): TeamDef => ({
  ...team,
  players: team.players.map((p) => {
    const ids = new Set([...Object.keys(p.mastery), ...Object.keys(c.records[p.id] ?? {})])
    const mastery: Record<string, number> = {}
    for (const id of ids)
      mastery[id] = view === "real" ? careerMastery(c, p.id, id) : scoutedMastery(c, p.id, id)
    return { ...p, mastery }
  }) as unknown as TeamDef["players"],
})
