/**
 * Results charts — sim-owned economy history (NW + XP lead, phase bands, event
 * ticks), item timeline per hero, gold sources and hero damage.
 */
import {
  type DraftSide,
  type DraftState,
  type HeroLine,
  type MatchSnapshot,
  lookupItem,
} from "@mobacraft/sim"
import { cn } from "@mobacraft/ui"
import { Sparkles } from "lucide-react"
import { useMemo } from "react"
import { leadMarkers, leadSeries, phaseBands } from "./hud-data.ts"
import { ItemSlot } from "./item-icon.tsx"
import { NetWorthBars, SourceBars } from "./live/economy-bars.tsx"
import { LeadChart } from "./live/lead-chart.tsx"
import { HeroGem, clockText } from "./ui.tsx"

/** Net-worth and XP lead from `final.history`, with phase bands and event ticks. */
export const EconomyGraphs = ({ final, you }: { final: MatchSnapshot; you: DraftSide }) => {
  const series = useMemo(() => leadSeries(final, you), [final, you])
  const bands = useMemo(() => phaseBands(final.phaseAt ?? {}, final.time), [final])
  const markers = useMemo(() => leadMarkers(final.feed, final.heroes, you), [final, you])
  if (series.length < 2) {
    return (
      <p className="rounded-xl border border-white/[0.07] p-4 text-[12px] text-white/45">
        No economy history was recorded for this match.
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-white/[0.07] bg-black/20 p-3">
      <LeadChart
        title="Net-worth lead"
        points={series.map((p) => ({ t: p.t, v: p.nw }))}
        bands={bands}
        markers={markers}
        duration={final.time}
        width={640}
        height={120}
      />
      <LeadChart
        title="XP lead"
        unit="xp"
        points={series.map((p) => ({ t: p.t, v: p.xp }))}
        bands={bands}
        duration={final.time}
        width={640}
        height={64}
      />
      <p className="flex flex-wrap gap-x-3 text-[10px] text-white/40">
        <span className="text-radiant">▲ you ahead</span>
        <span className="text-dire">▼ opponent ahead</span>
        <span>● kill · ▮ building · ◆ Roshan/Ancient · ┊ phase change</span>
        <span className="ml-auto">Hover for exact values</span>
      </p>
    </div>
  )
}

/** When each of your heroes bought each item; adaptive picks are marked. */
export const ItemTimeline = ({ final, you }: { final: MatchSnapshot; you: DraftSide }) => {
  const mine = final.heroes.filter((h) => h.side === you)
  const tMax = Math.max(60, final.time)
  const buys = final.purchases ?? []
  return (
    <section
      aria-label="Item timeline"
      className="rounded-xl border border-white/[0.07] bg-black/20 p-3"
    >
      <p className="mb-2 flex items-center gap-2 text-[11px] font-semibold tracking-[0.18em] text-white/70 uppercase">
        Item timeline
        <span className="flex items-center gap-1 font-normal tracking-normal text-white/45 normal-case">
          <Sparkles className="size-3 text-sky-200" aria-hidden /> adaptive pick
        </span>
      </p>
      <ul className="flex flex-col gap-1.5">
        {mine.map((h) => {
          const own = buys.filter((b) => b.side === you && b.playerId === h.playerId)
          return (
            <li key={h.id} className="grid grid-cols-[96px_1fr] items-center gap-2">
              <span className="flex min-w-0 items-center gap-1.5 text-[11px]">
                <HeroGem heroId={h.heroId} size={18} className="rounded-md" />
                <span className="truncate">{h.playerName}</span>
              </span>
              <ol
                className="relative h-6 rounded-md bg-white/[0.03]"
                aria-label={`${h.playerName}: ${
                  own.length
                    ? own
                        .map(
                          (b) =>
                            `${lookupItem(b.itemId).name} at ${clockText(b.t)}${b.adaptive ? " (adaptive)" : ""}`,
                        )
                        .join(", ")
                    : "no purchases"
                }`}
              >
                {own.map((b, i) => (
                  <li
                    // oxlint-disable-next-line react/no-array-index-key -- purchases are append-only
                    key={i}
                    className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
                    style={{ left: `${(b.t / tMax) * 100}%` }}
                    title={`${clockText(b.t)} · ${lookupItem(b.itemId).name}${b.adaptive ? " · adaptive" : ""}`}
                  >
                    <span
                      className={cn(
                        "block rounded-[6px]",
                        b.adaptive &&
                          "ring-2 ring-sky-300/80 ring-offset-1 ring-offset-neutral-950",
                      )}
                    >
                      <ItemSlot id={b.itemId} size={18} />
                    </span>
                  </li>
                ))}
              </ol>
            </li>
          )
        })}
      </ul>
      <p className="mt-1.5 flex justify-between pl-[104px] text-[9px] tabular-nums text-white/35">
        <span>0:00</span>
        <span>{clockText(tMax / 2)}</span>
        <span>{clockText(tMax)}</span>
      </p>
    </section>
  )
}

/** Gold by source per team + final net worth per hero. */
export const GoldBreakdown = ({
  final,
  draft,
  you,
}: {
  final: MatchSnapshot
  draft: DraftState
  you: DraftSide
}) => (
  <section
    aria-label="Gold breakdown"
    className="flex flex-col gap-3 rounded-xl border border-white/[0.07] bg-black/20 p-3"
  >
    <div>
      <p className="mb-2 text-[11px] font-semibold tracking-[0.18em] text-white/70 uppercase">
        Gold sources
      </p>
      {final.sources ? (
        <SourceBars
          sources={final.sources}
          you={you}
          names={{ blue: draft.blue.name, red: draft.red.name }}
        />
      ) : null}
    </div>
    <div>
      <p className="mb-2 text-[11px] font-semibold tracking-[0.18em] text-white/70 uppercase">
        Net worth
      </p>
      <NetWorthBars heroes={final.heroes} you={you} />
    </div>
  </section>
)

/** Horizontal hero-damage bars for all ten players, grouped by side. */
export const DamageBars = ({
  heroes,
  you,
  mvpId,
}: {
  heroes: readonly HeroLine[]
  you: DraftSide
  mvpId: string
}) => {
  const max = Math.max(1, ...heroes.map((h) => h.heroDamage))
  const sorted = [...heroes].toSorted(
    (a, b) => (a.side === you ? 0 : 1) - (b.side === you ? 0 : 1) || b.heroDamage - a.heroDamage,
  )
  return (
    <div className="rounded-xl border border-white/[0.07] bg-black/20 p-3">
      <p className="mb-2 text-[11px] font-semibold tracking-[0.18em] text-white/70 uppercase">
        Hero damage
      </p>
      <ul className="flex flex-col gap-1">
        {sorted.map((h, i) => (
          <li
            key={h.id}
            className={cn(
              "grid grid-cols-[20px_70px_1fr_44px] items-center gap-2 text-[11px]",
              i > 0 &&
                sorted[i - 1]!.side !== h.side &&
                "mt-1.5 border-t border-white/[0.06] pt-1.5",
            )}
          >
            <HeroGem heroId={h.heroId} size={20} className="rounded-md" />
            <span className={cn("truncate", h.id === mvpId && "font-semibold text-amber-200")}>
              {h.playerName}
            </span>
            <span className="h-2 overflow-hidden rounded-full bg-white/[0.06]" aria-hidden>
              <span
                className={cn(
                  "block h-full animate-in rounded-full duration-700 fade-in slide-in-from-left-6 motion-reduce:animate-none",
                  h.side === you ? "bg-radiant/80" : "bg-dire/80",
                )}
                style={{ width: `${(h.heroDamage / max) * 100}%` }}
              />
            </span>
            <span className="text-right tabular-nums text-white/70">
              {(h.heroDamage / 1000).toFixed(1)}k
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
