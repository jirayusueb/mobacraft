/**
 * Results narrative (playtest #2) — a 3–5 line "How it went" story built purely
 * from the final snapshot: the biggest gold-swing moment, the last objective
 * events, and the winner's comeback (or lead held). Pure so the .tsx stays thin.
 */
import type { DraftSide, MatchSnapshot } from "@mobacraft/sim"

export interface NarrativeLine {
  readonly kind: "swing" | "event" | "closing"
  readonly text: string
}

export interface NarrativeInput {
  readonly winner: DraftSide | null
  readonly time: number
  readonly history: readonly {
    readonly t: number
    readonly nw: Readonly<Record<DraftSide, number>>
  }[]
  readonly feed: readonly {
    readonly t: number
    readonly kind: string
    readonly side: DraftSide | "neutral"
    readonly text: string
  }[]
}

const OBJECTIVE_KINDS = new Set(["tower", "roshan", "aegis", "ancient"])

export const mmss = (t: number) => {
  const m = Math.floor(t / 60)
  return `${m}:${String(Math.floor(t % 60)).padStart(2, "0")}`
}

const k = (gold: number) => `${(Math.abs(gold) / 1000).toFixed(1)}k`

/** A deficit smaller than this is noise (one wave, one kill), not a game state. */
export const COMEBACK_MIN = 3000
/** Gold swings in the last 30 s are the Ancient falling, not a turning point. */
const ENDGAME_WINDOW = 30

/**
 * "How it went" — only claims what the gold record supports:
 *  - swing: the biggest gold-gap change toward the WINNER before the final 30 s
 *    (the turning point), never the loser's noise or the endgame collapse;
 *  - closing: "comeback" only when the winner trailed by ≥ COMEBACK_MIN and then
 *    reached ≥ 0 again; "won while behind on gold" when they never recovered the
 *    lead (objectives beat gold); otherwise "led from …" with the peak lead.
 */
export const narrative = (
  final: NarrativeInput,
  names: Readonly<Record<DraftSide, string>>,
): readonly NarrativeLine[] => {
  const lines: NarrativeLine[] = []
  const w = final.winner
  const gapOf = (h: NarrativeInput["history"][number]) =>
    w === "red" ? h.nw.red - h.nw.blue : h.nw.blue - h.nw.red
  // Turning point: largest step toward the winner (or toward blue when no winner yet).
  const cutoff = final.time - ENDGAME_WINDOW
  let swingT = -1
  let swingD = 0
  for (let i = 1; i < final.history.length; i++) {
    const b = final.history[i]!
    if (b.t > cutoff) break
    const d = gapOf(b) - gapOf(final.history[i - 1]!)
    if (d > swingD) {
      swingD = d
      swingT = b.t
    }
  }
  const swingSide: DraftSide = w ?? "blue"
  if (swingT >= 0 && swingD >= 500)
    lines.push({
      kind: "swing",
      text: `Turning point ${mmss(swingT)}: ${names[swingSide]} swung the gold lead by ${k(swingD)}`,
    })
  // Last 3 objective events (towers, Roshan/Aegis, Ancient) as one line each.
  for (const e of final.feed.filter((f) => OBJECTIVE_KINDS.has(f.kind)).slice(-3))
    lines.push({ kind: "event", text: `${mmss(e.t)} · ${e.text}` })
  if (w) {
    const gaps = final.history.map(gapOf)
    const worst = gaps.length ? Math.min(...gaps) : 0
    const best = gaps.length ? Math.max(...gaps) : 0
    const worstAt = gaps.indexOf(worst)
    const recovered = worstAt >= 0 && gaps.slice(worstAt).some((g) => g >= 0)
    const end = gaps.at(-1) ?? 0
    lines.push({
      kind: "closing",
      text:
        worst <= -COMEBACK_MIN && recovered
          ? `${names[w]} won — comeback from −${k(worst)}`
          : end < 0
            ? `${names[w]} won while still −${k(end)} on gold — objectives beat gold`
            : best > 0
              ? `${names[w]} led by up to +${k(best)} and closed it out`
              : `${names[w]} won an even game`,
    })
  }
  return lines
}

/** Convenience wrapper for the component: pick only what narrative() needs from the snapshot. */
export const narrativeOf = (
  final: MatchSnapshot,
  names: Readonly<Record<DraftSide, string>>,
): readonly NarrativeLine[] =>
  narrative(
    {
      winner: final.winner,
      time: final.time,
      history: final.history,
      feed: final.feed,
    },
    names,
  )
