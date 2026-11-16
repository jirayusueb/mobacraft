/**
 * Lead chart — one SVG line of "your side minus theirs" over game time, with
 * phase bands shaded behind it and event ticks underneath. Used live (economy
 * panel) and on the results screen. Team colours come from CSS tokens only.
 */
import { cn } from "@mobacraft/ui"
import { useId, useState } from "react"
import { PHASE_LABEL } from "../../strings.ts"
import { type Marker, type PhaseBand, goldK, signedK } from "../hud-data.ts"
import { clockText } from "../ui.tsx"

export interface LeadValue {
  readonly t: number
  readonly v: number
}

const PAD_L = 38
const PAD_R = 8
const PAD_Y = 8
const TICK_H = 20

const niceStep = (max: number) => {
  for (const s of [250, 500, 1000, 2000, 5000, 10000, 20000]) if (max / s <= 3) return s
  return 50000
}

const NO_MARKERS: readonly Marker[] = []

const BAND_FILL: Record<string, string> = {
  laning: "fill-white/[0.02]",
  mid: "fill-white/[0.05]",
  late: "fill-white/[0.09]",
}

export const LeadChart = ({
  title,
  points,
  bands,
  markers = NO_MARKERS,
  duration,
  width = 560,
  height = 110,
  unit = "gold",
  className,
}: {
  title: string
  points: readonly LeadValue[]
  bands: readonly PhaseBand[]
  markers?: readonly Marker[]
  duration: number
  width?: number
  height?: number
  /** Used in the accessible summary. */
  unit?: string
  className?: string
}) => {
  const uid = useId().replaceAll(":", "")
  const [hover, setHover] = useState<number | null>(null)
  const W = width
  const H = height
  const tMax = Math.max(60, duration, points.at(-1)?.t ?? 0)
  const peak = Math.max(250, ...points.map((p) => Math.abs(p.v)))
  const step = niceStep(peak)
  const yMax = Math.ceil(peak / step) * step
  const x = (t: number) => PAD_L + (t / tMax) * (W - PAD_L - PAD_R)
  const y = (v: number) => PAD_Y + ((yMax - v) / (2 * yMax)) * (H - 2 * PAD_Y)
  const line = points
    .map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`)
    .join("")
  const area =
    points.length > 1
      ? `${line}L${x(points.at(-1)!.t).toFixed(1)},${y(0)}L${x(points[0]!.t).toFixed(1)},${y(0)}Z`
      : ""
  const final = points.at(-1)?.v ?? 0
  const best = Math.max(0, ...points.map((p) => p.v))
  const worst = Math.min(0, ...points.map((p) => p.v))
  const summary = `${title}: largest lead ${goldK(best)} ${unit}, largest deficit ${goldK(-worst)} ${unit}, now ${signedK(final)}.`
  const hv = hover === null ? null : points[hover]
  const ticks = Array.from({ length: Math.floor(tMax / 300) + 1 }, (_, i) => i * 300)
  const markerY: Record<Marker["kind"], number> = {
    kill: 6,
    tower: 14,
    rax: 14,
    roshan: 14,
    ancient: 14,
    phase: 10,
  }

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const t = ((((e.clientX - r.left) / r.width) * W - PAD_L) / (W - PAD_L - PAD_R)) * tMax
    let bi = 0
    for (let i = 0; i < points.length; i++)
      if (Math.abs(points[i]!.t - t) < Math.abs(points[bi]!.t - t)) bi = i
    setHover(points.length ? bi : null)
  }

  return (
    <figure className={cn("min-w-0", className)}>
      <figcaption className="mb-0.5 flex items-center gap-2 text-[10.5px] text-white/55">
        <span className="font-semibold tracking-[0.16em] text-white/70 uppercase">{title}</span>
        <span className="ml-auto font-mono tabular-nums">
          {hv ? `${clockText(hv.t)} · ` : "now "}
          <span className={(hv?.v ?? final) >= 0 ? "text-radiant" : "text-dire"}>
            {signedK(hv?.v ?? final)}
          </span>
        </span>
      </figcaption>
      {points.length < 2 ? (
        <p className="py-4 text-center text-[11px] text-white/40">
          The graph fills in every 5 game seconds.
        </p>
      ) : (
        <svg
          viewBox={`0 0 ${W} ${H + TICK_H}`}
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
          </defs>
          {bands.map((b) => (
            <g key={b.phase}>
              <rect
                x={x(b.from)}
                y={PAD_Y}
                width={Math.max(0, x(b.to) - x(b.from))}
                height={H - 2 * PAD_Y}
                className={BAND_FILL[b.phase]}
              />
              <text
                x={x(b.from) + 3}
                y={PAD_Y + 8}
                className="fill-white/30 text-[8px] tracking-wider uppercase"
              >
                {PHASE_LABEL[b.phase]}
              </text>
            </g>
          ))}
          {[-yMax, 0, yMax].map((v) => (
            <g key={v}>
              <line
                x1={PAD_L}
                x2={W - PAD_R}
                y1={y(v)}
                y2={y(v)}
                stroke="white"
                strokeOpacity={v === 0 ? 0.25 : 0.06}
                strokeDasharray={v === 0 ? undefined : "2 4"}
              />
              <text
                x={PAD_L - 5}
                y={y(v) + 3}
                textAnchor="end"
                className="fill-white/40 text-[8.5px] tabular-nums"
              >
                {v === 0 ? "0" : signedK(v)}
              </text>
            </g>
          ))}
          <path d={area} className="fill-radiant/15" clipPath={`url(#${uid}-up)`} />
          <path d={area} className="fill-dire/15" clipPath={`url(#${uid}-down)`} />
          <path
            d={line}
            fill="none"
            className="stroke-radiant"
            strokeWidth={1.6}
            clipPath={`url(#${uid}-up)`}
            strokeLinejoin="round"
          />
          <path
            d={line}
            fill="none"
            className="stroke-dire"
            strokeWidth={1.6}
            clipPath={`url(#${uid}-down)`}
            strokeLinejoin="round"
          />
          {hv ? (
            <g>
              <line
                x1={x(hv.t)}
                x2={x(hv.t)}
                y1={PAD_Y}
                y2={H}
                stroke="white"
                strokeOpacity={0.25}
              />
              <circle
                cx={x(hv.t)}
                cy={y(hv.v)}
                r={3}
                className={hv.v >= 0 ? "fill-radiant" : "fill-dire"}
                stroke="black"
              />
            </g>
          ) : null}
          <g transform={`translate(0 ${H})`}>
            {markers.map((m, i) => {
              const cx = x(m.t)
              const cy = markerY[m.kind]
              const tone =
                m.mine === null ? "fill-neutral-team" : m.mine ? "fill-radiant" : "fill-dire"
              return (
                // oxlint-disable-next-line react/no-array-index-key -- feed order is stable
                <g key={i}>
                  <title>{`${clockText(m.t)} — ${m.label}`}</title>
                  {m.kind === "kill" ? (
                    <circle cx={cx} cy={cy} r={2} className={tone} fillOpacity={0.85} />
                  ) : m.kind === "phase" ? (
                    <line
                      x1={cx}
                      x2={cx}
                      y1={-H + PAD_Y}
                      y2={cy + 4}
                      stroke="white"
                      strokeOpacity={0.3}
                      strokeDasharray="1 2"
                    />
                  ) : m.kind === "tower" || m.kind === "rax" ? (
                    <rect x={cx - 2.5} y={cy - 3.5} width={5} height={7} rx={1} className={tone} />
                  ) : (
                    <path
                      d={`M${cx},${cy - 4}L${cx + 4},${cy}L${cx},${cy + 4}L${cx - 4},${cy}Z`}
                      className={m.kind === "ancient" ? "fill-amber-300" : tone}
                    />
                  )}
                </g>
              )
            })}
            {ticks.map((t) => (
              <text
                key={t}
                x={x(t)}
                y={TICK_H - 1}
                textAnchor="middle"
                className="fill-white/35 text-[8.5px] tabular-nums"
              >
                {clockText(t)}
              </text>
            ))}
          </g>
        </svg>
      )}
      <p className="sr-only">{summary}</p>
    </figure>
  )
}
