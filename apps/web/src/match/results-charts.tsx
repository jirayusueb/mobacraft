/** Results charts — gold-lead line over time with an objective timeline underneath. */
import type { DraftSide, FeedEntry, HeroLine } from "@mobacraft/sim"
import { cn } from "@mobacraft/ui"
import { useId, useMemo, useState } from "react"
import { type GoldSample, goldK, parseKill } from "./hud-data.ts"
import { HeroGem, clockText } from "./ui.tsx"

const W = 640
const H = 128
const PAD_L = 40
const PAD_R = 10
const PAD_Y = 12
const TL_H = 56

type Marker = {
  readonly t: number
  readonly kind: "kill" | "tower" | "rax" | "roshan" | "ancient"
  readonly mine: boolean | null
  readonly label: string
}

const MARK_LABEL: Record<Marker["kind"], string> = {
  kill: "Kills",
  tower: "Towers",
  rax: "Barracks",
  roshan: "Roshan",
  ancient: "Ancient",
}

const niceStep = (max: number) => {
  for (const s of [500, 1000, 2000, 5000, 10000, 20000]) if (max / s <= 3) return s
  return 50000
}

export const GoldGraph = ({
  samples,
  feed,
  heroes,
  you,
  duration,
}: {
  samples: readonly GoldSample[]
  feed: readonly FeedEntry[]
  heroes: readonly HeroLine[]
  you: DraftSide
  duration: number
}) => {
  const uid = useId().replaceAll(":", "")
  const [hover, setHover] = useState<number | null>(null)
  const them: DraftSide = you === "blue" ? "red" : "blue"
  const pts = useMemo(
    () => samples.map((s) => ({ t: s.t, lead: s[you] - s[them] })),
    [samples, you, them],
  )
  const tMax = Math.max(1, duration, pts.at(-1)?.t ?? 0)
  const peak = Math.max(500, ...pts.map((p) => Math.abs(p.lead)))
  const step = niceStep(peak)
  const yMax = Math.ceil(peak / step) * step
  const x = (t: number) => PAD_L + (t / tMax) * (W - PAD_L - PAD_R)
  const y = (v: number) => PAD_Y + ((yMax - v) / (2 * yMax)) * (H - 2 * PAD_Y)
  const line = pts
    .map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.lead).toFixed(1)}`)
    .join("")
  const area =
    pts.length > 1
      ? `${line}L${x(pts.at(-1)!.t).toFixed(1)},${y(0)}L${x(pts[0]!.t).toFixed(1)},${y(0)}Z`
      : ""

  const markers = useMemo<Marker[]>(
    () =>
      feed.flatMap((f): Marker[] => {
        const mine = f.side === "neutral" ? null : f.side === you
        switch (f.kind) {
          case "kill":
          case "first-blood": {
            const k = parseKill(f, heroes)
            const text = k?.killer
              ? `${k.killer.playerName} slew ${k.victim?.playerName ?? "a hero"}`
              : f.text
            return [{ t: f.t, kind: "kill", mine, label: text }]
          }
          case "tower":
          case "rax":
          case "roshan":
          case "ancient":
            return [{ t: f.t, kind: f.kind, mine, label: f.text }]
          default:
            return []
        }
      }),
    [feed, heroes, you],
  )

  const ticks = Array.from({ length: Math.floor(tMax / 300) + 1 }, (_, i) => i * 300)
  const final = pts.at(-1)?.lead ?? 0
  const maxLead = Math.max(0, ...pts.map((p) => p.lead))
  const maxDeficit = Math.min(0, ...pts.map((p) => p.lead))
  const summary = `Gold lead over time. Your largest lead ${goldK(maxLead)}, largest deficit ${goldK(-maxDeficit)}, final ${final >= 0 ? "+" : "−"}${goldK(Math.abs(final))}.`
  const hv = hover === null ? null : pts[hover]

  const rowY: Record<Marker["kind"], number> = {
    kill: 10,
    tower: 22,
    rax: 22,
    roshan: 34,
    ancient: 34,
  }

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const t = ((((e.clientX - r.left) / r.width) * W - PAD_L) / (W - PAD_L - PAD_R)) * tMax
    let best = 0
    for (let i = 0; i < pts.length; i++)
      if (Math.abs(pts[i]!.t - t) < Math.abs(pts[best]!.t - t)) best = i
    setHover(pts.length ? best : null)
  }

  if (pts.length < 2) {
    return (
      <p className="rounded-xl border border-white/[0.07] p-4 text-[12px] text-white/45">
        No gold history was recorded for this match.
      </p>
    )
  }

  return (
    <figure className="rounded-xl border border-white/[0.07] bg-black/20 p-3">
      <figcaption className="mb-1 flex items-center gap-3 text-[11px] text-white/55">
        <span className="font-semibold tracking-[0.18em] text-white/70 uppercase">Gold lead</span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-3 rounded-sm bg-radiant/60" aria-hidden /> You ahead
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-3 rounded-sm bg-dire/60" aria-hidden /> Opponent ahead
        </span>
        <span className="ml-auto font-mono tabular-nums">
          {hv ? (
            <>
              {clockText(hv.t)} ·{" "}
              <span className={hv.lead >= 0 ? "text-radiant" : "text-dire"}>
                {hv.lead >= 0 ? "+" : "−"}
                {goldK(Math.abs(hv.lead))}
              </span>
            </>
          ) : (
            <>
              final{" "}
              <span className={final >= 0 ? "text-radiant" : "text-dire"}>
                {final >= 0 ? "+" : "−"}
                {goldK(Math.abs(final))}
              </span>
            </>
          )}
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H + TL_H}`}
        className="block h-auto w-full touch-none"
        aria-hidden
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <clipPath id={`${uid}-up`}>
            <rect x={0} y={0} width={W} height={y(0)} />
          </clipPath>
          <clipPath id={`${uid}-down`}>
            <rect x={0} y={y(0)} width={W} height={H} />
          </clipPath>
          <linearGradient id={`${uid}-g`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--color-radiant)" stopOpacity={0.45} />
            <stop offset="50%" stopColor="var(--color-radiant)" stopOpacity={0.05} />
            <stop offset="50%" stopColor="var(--color-dire)" stopOpacity={0.05} />
            <stop offset="100%" stopColor="var(--color-dire)" stopOpacity={0.45} />
          </linearGradient>
        </defs>
        {/* grid */}
        {[-yMax, -yMax / 2, 0, yMax / 2, yMax].map((v) => (
          <g key={v}>
            <line
              x1={PAD_L}
              x2={W - PAD_R}
              y1={y(v)}
              y2={y(v)}
              stroke="white"
              strokeOpacity={v === 0 ? 0.28 : 0.06}
              strokeDasharray={v === 0 ? undefined : "2 4"}
            />
            <text
              x={PAD_L - 6}
              y={y(v) + 3}
              textAnchor="end"
              className="fill-white/40 text-[9px] tabular-nums"
            >
              {v === 0 ? "0" : `${v > 0 ? "+" : "−"}${goldK(Math.abs(v))}`}
            </text>
          </g>
        ))}
        {ticks.map((t) => (
          <text
            key={t}
            x={x(t)}
            y={H + TL_H - 2}
            textAnchor="middle"
            className="fill-white/35 text-[9px] tabular-nums"
          >
            {clockText(t)}
          </text>
        ))}
        <path d={area} fill={`url(#${uid}-g)`} />
        <path
          d={line}
          fill="none"
          stroke="var(--color-radiant)"
          strokeWidth={1.8}
          clipPath={`url(#${uid}-up)`}
          strokeLinejoin="round"
        />
        <path
          d={line}
          fill="none"
          stroke="var(--color-dire)"
          strokeWidth={1.8}
          clipPath={`url(#${uid}-down)`}
          strokeLinejoin="round"
        />
        {hv ? (
          <g>
            <line
              x1={x(hv.t)}
              x2={x(hv.t)}
              y1={PAD_Y}
              y2={H + TL_H - 12}
              stroke="white"
              strokeOpacity={0.25}
            />
            <circle
              cx={x(hv.t)}
              cy={y(hv.lead)}
              r={3.5}
              fill={hv.lead >= 0 ? "var(--color-radiant)" : "var(--color-dire)"}
              stroke="black"
            />
          </g>
        ) : null}

        {/* objective timeline */}
        <g transform={`translate(0 ${H})`}>
          {(["kill", "tower", "roshan"] as const).map((k) => (
            <text
              key={k}
              x={PAD_L - 6}
              y={rowY[k] + 3}
              textAnchor="end"
              className="fill-white/40 text-[8.5px]"
            >
              {k === "tower" ? "Bldg" : MARK_LABEL[k]}
            </text>
          ))}
          <line
            x1={PAD_L}
            x2={W - PAD_R}
            y1={rowY.kill}
            y2={rowY.kill}
            stroke="white"
            strokeOpacity={0.05}
          />
          <line
            x1={PAD_L}
            x2={W - PAD_R}
            y1={rowY.tower}
            y2={rowY.tower}
            stroke="white"
            strokeOpacity={0.05}
          />
          <line
            x1={PAD_L}
            x2={W - PAD_R}
            y1={rowY.roshan}
            y2={rowY.roshan}
            stroke="white"
            strokeOpacity={0.05}
          />
          {markers.map((m, i) => {
            const cx = x(m.t)
            const cy = rowY[m.kind]
            const fill =
              m.mine === null ? "#b794ff" : m.mine ? "var(--color-radiant)" : "var(--color-dire)"
            return (
              // oxlint-disable-next-line react/no-array-index-key -- feed order is stable
              <g key={i}>
                <title>{`${clockText(m.t)} — ${m.label}`}</title>
                {m.kind === "kill" ? (
                  <circle cx={cx} cy={cy} r={2.4} fill={fill} fillOpacity={0.85} />
                ) : m.kind === "tower" || m.kind === "rax" ? (
                  <rect
                    x={cx - 3}
                    y={cy - 4}
                    width={6}
                    height={8}
                    rx={1}
                    fill={fill}
                    stroke="black"
                    strokeOpacity={0.5}
                  />
                ) : (
                  <path
                    d={`M${cx},${cy - 5}L${cx + 5},${cy}L${cx},${cy + 5}L${cx - 5},${cy}Z`}
                    fill={m.kind === "ancient" ? "#fcd34d" : fill}
                    stroke="black"
                    strokeOpacity={0.5}
                  />
                )}
              </g>
            )
          })}
        </g>
      </svg>
      <p className="sr-only">{summary}</p>
      <p className="mt-1 flex flex-wrap gap-x-3 text-[10px] text-white/40">
        <span>● kill</span>
        <span>▮ tower / barracks</span>
        <span>◆ Roshan · Ancient</span>
        <span className="ml-auto">Hover the chart for exact values</span>
      </p>
    </figure>
  )
}

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
