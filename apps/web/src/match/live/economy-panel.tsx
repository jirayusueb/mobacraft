/** In-match Economy panel (toggle G): NW/XP lead lines, hero NW bars, gold sources. */
import type { DraftSide, DraftState, MatchSnapshot } from "@mobacraft/sim"
import { Button, cn, glass } from "@mobacraft/ui"
import { X } from "lucide-react"
import { useMemo } from "react"
import { leadMarkers, leadSeries, otherSide, phaseBands, signedK } from "../hud-data.ts"
import { NetWorthBars, SourceBars } from "./economy-bars.tsx"
import { LeadChart } from "./lead-chart.tsx"

export const EconomyPanel = ({
  snap,
  draft,
  you,
  onClose,
}: {
  snap: MatchSnapshot
  draft: DraftState
  you: DraftSide
  onClose: () => void
}) => {
  const them = otherSide(you)
  const series = useMemo(() => leadSeries(snap, you), [snap, you])
  const bands = useMemo(() => phaseBands(snap.phaseAt, snap.time), [snap.phaseAt, snap.time])
  const markers = useMemo(
    () => leadMarkers(snap.feed, snap.heroes, you),
    [snap.feed, snap.heroes, you],
  )
  const lead = snap.netWorth[you] - snap.netWorth[them]
  const names = { blue: draft.blue.tag, red: draft.red.tag }
  return (
    <section
      aria-label="Economy"
      className={cn(
        "pointer-events-auto rounded-2xl",
        glass,
        "flex w-[min(38rem,calc(100vw-2rem))] flex-col gap-2 p-3",
      )}
    >
      <header className="flex items-center gap-2">
        <h2 className="text-[12px] font-semibold tracking-[0.18em] text-white/80 uppercase">
          Economy
        </h2>
        <span className="text-[11px] text-white/55" aria-label={`Net worth lead ${signedK(lead)}`}>
          NW lead{" "}
          <span className={lead >= 0 ? "font-semibold text-radiant" : "font-semibold text-dire"}>
            {signedK(lead)}
          </span>
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto"
          aria-label="Close economy panel"
          aria-keyshortcuts="G"
          onPress={onClose}
        >
          <X />
        </Button>
      </header>
      <LeadChart
        title="Net-worth lead"
        points={series.map((p) => ({ t: p.t, v: p.nw }))}
        bands={bands}
        markers={markers}
        duration={snap.time}
        height={96}
      />
      <LeadChart
        title="XP lead"
        unit="xp"
        points={series.map((p) => ({ t: p.t, v: p.xp }))}
        bands={bands}
        duration={snap.time}
        height={60}
      />
      <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
        <section aria-label="Net worth per hero">
          <h3 className="mb-1 text-[10px] font-semibold tracking-[0.16em] text-white/55 uppercase">
            Net worth
          </h3>
          <NetWorthBars heroes={snap.heroes} you={you} compact />
        </section>
        <section aria-label="Gold by source">
          <h3 className="mb-1 text-[10px] font-semibold tracking-[0.16em] text-white/55 uppercase">
            Gold by source
          </h3>
          <SourceBars sources={snap.sources} you={you} names={names} />
        </section>
      </div>
    </section>
  )
}
