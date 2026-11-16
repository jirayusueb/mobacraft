/**
 * Buyback — spec/12 §2. Cost/cooldown/penalty bookkeeping plus a deterministic
 * utility decision. All times are Dota seconds.
 */
import { BUYBACK_DEATH_PENALTY, type RespawnModifier } from "./hero-life.ts"

export const BUYBACK_BASE = 200
export const BUYBACK_NW_DIVISOR = 13
export const BUYBACK_COOLDOWN = 480
export const BUYBACK_THRESHOLD = 0.6
/** Not worth buying back with less than this left on the timer. */
export const BUYBACK_MIN_REMAINING = 15
export const TP_CHANNEL = 3

export const buybackCost = (netWorth: number): number =>
  BUYBACK_BASE + Math.floor(Math.max(0, netWorth) / BUYBACK_NW_DIVISOR)

export interface BuybackState {
  /** Absolute time buyback is available again. */
  readyAt: number
  /** Next death gets +25 s. */
  penaltyPending: boolean
  uses: number
}

export const createBuybackState = (): BuybackState => ({
  readyAt: 0,
  penaltyPending: false,
  uses: 0,
})

export const buybackCooldownLeft = (s: BuybackState, now: number) => Math.max(0, s.readyAt - now)

export interface BuybackQuery {
  readonly dead: boolean
  readonly gold: number
  readonly netWorth: number
  readonly now: number
}

export const canBuyback = (s: BuybackState, q: BuybackQuery): boolean =>
  q.dead && q.now >= s.readyAt && q.gold >= buybackCost(q.netWorth)

/** Spends the buyback. Returns gold spent, or null when not allowed. Caller force-respawns. */
export const useBuyback = (s: BuybackState, q: BuybackQuery): number | null => {
  if (!canBuyback(s, q)) return null
  s.readyAt = q.now + BUYBACK_COOLDOWN
  s.penaltyPending = true
  s.uses++
  return buybackCost(q.netWorth)
}

/** Consumes the pending penalty on the next death; returns the modifier to apply (if any). */
export const consumeDeathPenalty = (s: BuybackState): RespawnModifier | null => {
  if (!s.penaltyPending) return null
  s.penaltyPending = false
  return { source: "buyback-penalty", add: BUYBACK_DEATH_PENALTY }
}

// --- AI decision ----------------------------------------------------------------------

export interface BuybackContext {
  readonly gold: number
  readonly netWorth: number
  readonly now: number
  readonly respawnRemaining: number
  /** Base defense: a tier-3 tower or barracks is being hit. */
  readonly highGroundUnderAttack: boolean
  readonly alliesAlive: number
  readonly enemiesAtBase: number
  /** Roshan contested or a teamfight still in progress. */
  readonly bigFightOngoing: boolean
  /** Expected seconds the fight lasts. */
  readonly fightRemaining: number
  readonly ultReady: boolean
  /** 0..1 — how fight-defining the ultimate is (Black Hole/Ravage ≈ 1). */
  readonly ultImpact: number
  readonly hasTp: boolean
  /** Team just won a fight. */
  readonly wonFight: boolean
  readonly isCoreDamage: boolean
  /** Seconds to walk/TP from fountain to the enemy Ancient. */
  readonly timeToAncient: number
  /** Shortest remaining enemy respawn timer (Infinity if none dead). */
  readonly enemyMinRespawn: number
}

export type BuybackReason = "base-defense" | "high-value-fight" | "game-ending-push" | "none"

export interface BuybackDecision {
  readonly buy: boolean
  readonly score: number
  readonly reason: BuybackReason
  /** Why a gate rejected (for the feed/HUD). */
  readonly blocked?: "cooldown" | "gold" | "short-timer"
}

export const decideBuyback = (s: BuybackState, c: BuybackContext): BuybackDecision => {
  if (c.now < s.readyAt) return { buy: false, score: 0, reason: "none", blocked: "cooldown" }
  if (c.gold < buybackCost(c.netWorth))
    return { buy: false, score: 0, reason: "none", blocked: "gold" }
  if (c.respawnRemaining < BUYBACK_MIN_REMAINING)
    return { buy: false, score: 0, reason: "none", blocked: "short-timer" }

  const options: [BuybackReason, number][] = []
  if (c.highGroundUnderAttack && c.alliesAlive >= Math.max(1, c.enemiesAtBase - 1))
    options.push(["base-defense", 1])
  if (c.bigFightOngoing && c.ultReady && c.hasTp && c.fightRemaining > TP_CHANNEL)
    options.push(["high-value-fight", 0.55 + 0.25 * Math.min(1, Math.max(0, c.ultImpact))])
  if (c.wonFight && c.isCoreDamage && c.timeToAncient < c.enemyMinRespawn)
    options.push(["game-ending-push", 0.9])

  // Fixed order + strict > → deterministic tiebreak.
  let best: [BuybackReason, number] = ["none", 0]
  for (const o of options) if (o[1] > best[1]) best = o
  return { buy: best[1] >= BUYBACK_THRESHOLD, score: best[1], reason: best[0] }
}
