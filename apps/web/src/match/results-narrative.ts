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

/** Biggest single-sample change in the blue−red net-worth gap (gold toward the winner). */
export const narrative = (
  final: NarrativeInput,
  names: Readonly<Record<DraftSide, string>>,
): readonly NarrativeLine[] => {
  const lines: NarrativeLine[] = []
  // Gold swing: largest step change of the blue−red gap across history samples.
  let swingT = -1
  let swingSide: DraftSide | null = null
  let swingD = 0
  for (let i = 1; i < final.history.length; i++) {
    const a = final.history[i - 1]!
    const b = final.history[i]!
    const d = b.nw.blue - b.nw.red - (a.nw.blue - a.nw.red)
    if (Math.abs(d) > Math.abs(swingD)) {
      swingD = d
      swingSide = d > 0 ? "blue" : "red"
      swingT = b.t
    }
  }
  if (swingSide && swingT >= 0)
    lines.push({
      kind: "swing",
      text: `At ${mmss(swingT)} ${names[swingSide]} swung the gold lead by ${k(swingD)}`,
    })
  // Last 3 objective events (towers, Roshan/Aegis, Ancient) as one line each.
  for (const e of final.feed.filter((f) => OBJECTIVE_KINDS.has(f.kind)).slice(-3))
    lines.push({ kind: "event", text: `${mmss(e.t)} · ${e.text}` })
  // Closing line: winner + largest deficit they overcame (min of their gap).
  if (final.winner) {
    const gap = final.history.map((h) =>
      final.winner === "blue" ? h.nw.blue - h.nw.red : h.nw.red - h.nw.blue,
    )
    const worst = gap.length ? Math.min(...gap) : 0
    lines.push({
      kind: "closing",
      text:
        worst < 0
          ? `${names[final.winner]} won — comeback from −${k(worst)}`
          : `${names[final.winner]} won without ever trailing on gold`,
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
