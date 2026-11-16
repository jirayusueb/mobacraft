/** Phase indicator under the scoreboard: Laning · Mid · Late, time in phase, live NW lead. */
import { type DraftSide, LATE_AT, MID_AT, type MatchSnapshot, PHASES } from "@mobacraft/sim"
import { cn, glass } from "@mobacraft/ui"
import { PHASE_LABEL } from "../../strings.ts"
import { otherSide, signedK } from "../hud-data.ts"
import { clockText } from "../ui.tsx"

const NEXT_AT: Record<string, number | null> = { laning: MID_AT, mid: LATE_AT, late: null }

export const PhaseChip = ({ snap, you }: { snap: MatchSnapshot; you: DraftSide }) => {
  const idx = PHASES.indexOf(snap.phase)
  const since = snap.phaseAt[snap.phase] ?? 0
  const next = NEXT_AT[snap.phase]
  const lead = snap.netWorth[you] - snap.netWorth[otherSide(you)]
  return (
    <div className="absolute top-[5.4rem] left-1/2 -translate-x-1/2">
      <output
        aria-label={`${PHASE_LABEL[snap.phase]} since ${clockText(since)}${next ? `, next phase by ${clockText(next)}` : ""}. Net worth lead ${signedK(lead)}`}
        className={cn("flex items-center gap-2 rounded-full px-2.5 py-1 text-[10.5px]", glass)}
      >
        <ol className="flex items-center gap-1" aria-hidden>
          {PHASES.map((p, i) => (
            <li
              key={p}
              className={cn(
                "rounded-full px-2 py-px font-semibold tracking-wider uppercase transition-colors motion-reduce:transition-none",
                i === idx
                  ? "bg-white/90 text-neutral-950"
                  : i < idx
                    ? "text-white/40"
                    : "text-white/25",
              )}
            >
              {PHASE_LABEL[p]}
            </li>
          ))}
        </ol>
        <span className="font-mono tabular-nums text-white/55" aria-hidden>
          {clockText(snap.time - since)}
          {next ? <span className="text-white/30"> / ≤{clockText(next)}</span> : null}
        </span>
        <span
          className={cn(
            "border-l border-white/10 pl-2 font-semibold tabular-nums",
            lead >= 0 ? "text-radiant" : "text-dire",
          )}
          title="Net-worth lead"
          aria-hidden
        >
          NW {signedK(lead)}
        </span>
      </output>
    </div>
  )
}
