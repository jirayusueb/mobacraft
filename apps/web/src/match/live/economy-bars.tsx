/** Per-hero net-worth bars and gold-by-source stacked bars (spec/06 §4). */
import { type DraftSide, GOLD_SOURCES, type GoldSource, type HeroLine } from "@mobacraft/sim"
import { cn } from "@mobacraft/ui"
import { SOURCE_LABEL } from "../../strings.ts"
import { goldK } from "../hud-data.ts"
import { HeroGem } from "../ui.tsx"

/** Opacity ramp per source so one team colour carries the whole stack. */
const SOURCE_SHADE: Record<GoldSource, string> = {
  passive: "opacity-30",
  runes: "opacity-45",
  comeback: "opacity-50",
  creeps: "opacity-95",
  neutrals: "opacity-70",
  kills: "opacity-55",
  assists: "opacity-40",
  structures: "opacity-80",
  roshan: "opacity-60",
  wards: "opacity-25",
}

export const NetWorthBars = ({
  heroes,
  you,
  compact = false,
}: {
  heroes: readonly HeroLine[]
  you: DraftSide
  compact?: boolean
}) => {
  const max = Math.max(1, ...heroes.map((h) => h.netWorth))
  const sorted = [...heroes].toSorted(
    (a, b) => (a.side === you ? 0 : 1) - (b.side === you ? 0 : 1) || b.netWorth - a.netWorth,
  )
  return (
    <ul className="flex flex-col gap-[3px]" aria-label="Net worth per hero">
      {sorted.map((h, i) => (
        <li
          key={h.id}
          className={cn(
            "grid items-center gap-1.5 text-[10.5px]",
            compact ? "grid-cols-[16px_58px_1fr_34px]" : "grid-cols-[18px_70px_1fr_40px]",
            i > 0 && sorted[i - 1]!.side !== h.side && "mt-1 border-t border-white/[0.06] pt-1",
          )}
          aria-label={`${h.playerName}, ${h.heroName}: ${goldK(h.netWorth)} net worth`}
        >
          <HeroGem heroId={h.heroId} size={compact ? 16 : 18} className="rounded-md" />
          <span className="truncate text-white/80" aria-hidden>
            {h.playerName}
          </span>
          <span className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]" aria-hidden>
            <span
              className={cn(
                "block h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none",
                h.side === you ? "bg-radiant/80" : "bg-dire/80",
              )}
              style={{ width: `${(h.netWorth / max) * 100}%` }}
            />
          </span>
          <span className="text-right tabular-nums text-white/65" aria-hidden>
            {goldK(h.netWorth)}
          </span>
        </li>
      ))}
    </ul>
  )
}

export const SourceBars = ({
  sources,
  you,
  names,
}: {
  sources: Readonly<Record<DraftSide, Readonly<Record<GoldSource, number>>>>
  you: DraftSide
  names: Readonly<Record<DraftSide, string>>
}) => {
  const them: DraftSide = you === "blue" ? "red" : "blue"
  const total = (s: DraftSide) => GOLD_SOURCES.reduce((a, k) => a + (sources[s]?.[k] ?? 0), 0)
  const max = Math.max(1, total(you), total(them))
  return (
    <div className="flex flex-col gap-1.5">
      {[you, them].map((side) => {
        const sum = total(side)
        const parts = GOLD_SOURCES.filter((k) => (sources[side]?.[k] ?? 0) > 0)
        return (
          <div key={side} className="flex flex-col gap-0.5">
            <span className="flex text-[10px] text-white/55">
              <span className={side === you ? "text-radiant" : "text-dire"}>{names[side]}</span>
              <span className="ml-auto tabular-nums">{goldK(sum)}</span>
            </span>
            <span className="sr-only">{`${names[side]} gold by source: ${parts
              .map((k) => `${SOURCE_LABEL[k]} ${goldK(sources[side][k])}`)
              .join(", ")}`}</span>
            <span
              className="flex h-2.5 overflow-hidden rounded-full bg-white/[0.05]"
              style={{ width: `${(sum / max) * 100}%` }}
              aria-hidden
            >
              {parts.map((k) => (
                <span
                  key={k}
                  title={`${SOURCE_LABEL[k]} · ${goldK(sources[side][k])}`}
                  className={cn(
                    "h-full border-r border-black/40 last:border-r-0",
                    side === you ? "bg-radiant" : "bg-dire",
                    SOURCE_SHADE[k],
                  )}
                  style={{ width: `${(sources[side][k] / Math.max(1, sum)) * 100}%` }}
                />
              ))}
            </span>
          </div>
        )
      })}
      <ul
        className="mt-0.5 flex flex-wrap gap-x-2.5 gap-y-0.5 text-[9.5px] text-white/45"
        aria-hidden
      >
        {GOLD_SOURCES.map((k) => (
          <li key={k} className="flex items-center gap-1">
            <span className={cn("size-2 rounded-[2px] bg-white", SOURCE_SHADE[k])} />
            {SOURCE_LABEL[k]}
          </li>
        ))}
      </ul>
    </div>
  )
}
