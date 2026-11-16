/**
 * World event timers — spec/12 §5: power/bounty/wisdom runes, Roshan's hidden
 * respawn window, tree regrowth. Randomness only via the caller's `Random`.
 */
import type { Random } from "../random.ts"

// --- runes ---------------------------------------------------------------------------

export const POWER_RUNE_START = 360
export const POWER_RUNE_PERIOD = 120
export const BOUNTY_RUNE_START = 0
export const BOUNTY_RUNE_PERIOD = 180
export const WISDOM_RUNE_START = 420
export const WISDOM_RUNE_PERIOD = 420
export const RUNE_ALARM_LEAD = 15

export const POWER_RUNES = [
  "haste",
  "double-damage",
  "arcane",
  "invisibility",
  "regeneration",
  "shield",
] as const
export type PowerRuneType = (typeof POWER_RUNES)[number]
export type RuneSpot = "top" | "bottom"
export type RuneKind = "power" | "bounty" | "wisdom"

const cadence: Record<RuneKind, { start: number; period: number }> = {
  power: { start: POWER_RUNE_START, period: POWER_RUNE_PERIOD },
  bounty: { start: BOUNTY_RUNE_START, period: BOUNTY_RUNE_PERIOD },
  wisdom: { start: WISDOM_RUNE_START, period: WISDOM_RUNE_PERIOD },
}

/** Spawn times of `kind` in (prev, now] (start time included when prev < start). */
export const runeTimesDue = (kind: RuneKind, prev: number, now: number): number[] => {
  const { start, period } = cadence[kind]
  const out: number[] = []
  const k0 = prev < start ? 0 : Math.floor((prev - start) / period) + 1
  for (let k = k0; start + k * period <= now; k++) out.push(start + k * period)
  return out
}

export interface UpcomingRune {
  readonly kind: RuneKind
  readonly at: number
}

/** Rune spawns within [now, now + lead] — the support AI's alarm clock. */
export const upcomingRunes = (now: number, lead = RUNE_ALARM_LEAD): UpcomingRune[] => {
  const out: UpcomingRune[] = []
  for (const kind of ["power", "bounty", "wisdom"] as const) {
    const { start, period } = cadence[kind]
    const k = Math.max(0, Math.ceil((now - start) / period))
    const at = start + k * period
    if (at >= now && at <= now + lead) out.push({ kind, at })
  }
  return out.toSorted((a, b) => a.at - b.at || a.kind.localeCompare(b.kind))
}

export interface PowerRune {
  readonly at: number
  readonly type: PowerRuneType
  readonly spot: RuneSpot
}

/** Rolls power runes, never repeating the previous type. */
export class PowerRuneRoller {
  last: PowerRuneType | null = null
  constructor(private readonly rng: Random) {}
  roll(at: number): PowerRune {
    const pool = POWER_RUNES.filter((t) => t !== this.last)
    const type = pool[Math.min(pool.length - 1, Math.floor(this.rng.next() * pool.length))]!
    const spot: RuneSpot = this.rng.next() < 0.5 ? "top" : "bottom"
    this.last = type
    return { at, type, spot }
  }
}

// --- Roshan --------------------------------------------------------------------------

export const ROSHAN_MIN_RESPAWN = 480
export const ROSHAN_MAX_RESPAWN = 660

export type RoshanPublicState = "alive" | "dead" | "maybe"

/** What players/AI may know. Deliberately has no exact respawn time. */
export interface RoshanPublic {
  readonly state: RoshanPublicState
  readonly earliest: number | null
  readonly latest: number | null
}

export class RoshanTimer {
  #alive = true
  #diedAt = 0
  #respawnAt = 0
  constructor(private readonly rng: Random) {}

  get alive() {
    return this.#alive
  }

  killed(t: number) {
    if (!this.#alive) return
    this.#alive = false
    this.#diedAt = t
    // Integer seconds, inclusive on both ends: 480..660.
    const span = ROSHAN_MAX_RESPAWN - ROSHAN_MIN_RESPAWN + 1
    this.#respawnAt =
      t + ROSHAN_MIN_RESPAWN + Math.min(span - 1, Math.floor(this.rng.next() * span))
  }

  /** Authoritative tick. Returns true on the tick Roshan respawns. */
  tick(now: number): boolean {
    if (this.#alive || now < this.#respawnAt) return false
    this.#alive = true
    return true
  }

  /** Fog-safe view: only the possible window. */
  public(now: number): RoshanPublic {
    if (this.#alive && this.#diedAt === 0) return { state: "alive", earliest: null, latest: null }
    const earliest = this.#diedAt + ROSHAN_MIN_RESPAWN
    const latest = this.#diedAt + ROSHAN_MAX_RESPAWN
    // Once the window has closed he is certainly alive; inside it nobody knows.
    if (now > latest) return { state: "alive", earliest, latest }
    if (now >= earliest) return { state: "maybe", earliest, latest }
    return { state: "dead", earliest, latest }
  }

  /** Uniform-CDF belief that Roshan is up — for scheduling pit checks/wards. */
  aliveProbability(now: number): number {
    const p = this.public(now)
    if (p.state === "alive") return 1
    if (p.state === "dead") return 0
    return (now - p.earliest!) / (p.latest! - p.earliest!)
  }

  /** Test/debug only: true respawn time. Never route to AI or HUD. */
  debugRespawnAt() {
    return this.#respawnAt
  }
}

// --- tree regrowth -------------------------------------------------------------------

export const TREE_REGROW_SECONDS = 180
export const TREE_REGROW_RETRY = 10

export interface TreeHooks {
  readonly isOccupied: (cellId: number) => boolean
  readonly restoreFogBlocker: (cellId: number) => void
  readonly restoreNav: (cellId: number) => void
}

export class TreeRegrowth {
  /** cellId → DestroyedTimestamp. */
  readonly destroyedAt = new Map<number, number>()
  readonly #due = new Map<number, number>()

  destroy(cellId: number, t: number) {
    if (this.destroyedAt.has(cellId)) return
    this.destroyedAt.set(cellId, t)
    this.#due.set(cellId, t + TREE_REGROW_SECONDS)
  }

  isCut(cellId: number) {
    return this.destroyedAt.has(cellId)
  }

  /** Regrows due trees (ascending cellId order). Returns regrown cells. */
  tick(now: number, hooks: TreeHooks): number[] {
    const out: number[] = []
    const ids = [...this.#due.keys()].toSorted((a, b) => a - b)
    for (const id of ids) {
      if (now < this.#due.get(id)!) continue
      if (hooks.isOccupied(id)) {
        this.#due.set(id, now + TREE_REGROW_RETRY)
        continue
      }
      this.#due.delete(id)
      this.destroyedAt.delete(id)
      hooks.restoreFogBlocker(id)
      hooks.restoreNav(id)
      out.push(id)
    }
    return out
  }
}
