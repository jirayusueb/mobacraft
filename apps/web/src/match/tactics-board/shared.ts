/** Shared types/helpers for the tactics-board sections. */
import {
  type DraftSide,
  type DraftState,
  HERO_BY_ID,
  type Player,
  type PlayerTactics,
  type TeamTactics,
} from "@mobacraft/sim"

export type Update = (f: (t: TeamTactics) => TeamTactics) => void

export interface SectionProps {
  readonly draft: DraftState
  readonly you: DraftSide
  readonly tactics: TeamTactics
  readonly update: Update
  /** Polite screen-reader announcement. */
  readonly announce: (msg: string) => void
}

export const teamOf = (d: DraftState, side: DraftSide) => (side === "blue" ? d.blue : d.red)

export const heroIdOf = (d: DraftState, side: DraftSide, playerId: string) =>
  d.picks[side].find((p) => p.playerId === playerId)?.heroId

export const heroName = (heroId: string | undefined) =>
  (heroId && HERO_BY_ID.get(heroId)?.name) || "—"

export const setPlayer = (
  t: TeamTactics,
  p: Player,
  f: (pt: PlayerTactics) => PlayerTactics,
): TeamTactics => {
  const cur = t.players[p.id]
  return cur ? { ...t, players: { ...t.players, [p.id]: f(cur) } } : t
}

/** spec/06 §5: relay latency and follow chance for an IGL leadership rating. */
export const relayDelay = (leadership: number) => 3 - (2.5 * leadership) / 20
export const followChance = (leadership: number) => 0.55 + (0.45 * leadership) / 20
