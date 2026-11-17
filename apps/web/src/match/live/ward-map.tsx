/**
 * Match mini map (spec/06 §3c): lanes, your wards (enemy wards are hidden),
 * your heroes, ward stock and map control %. SVG in map tile units; team
 * colours come from CSS tokens (text-/fill-radiant, -dire), never engine palettes.
 */
import type { MobaMap } from "@mobacraft/map"
import type { DraftSide, HeroLine, MatchSnapshot, Unit } from "@mobacraft/sim"
import { cn, glass } from "@mobacraft/ui"
import { Eye } from "lucide-react"
import { useEffect, useRef } from "react"
import { otherSide } from "../hud-data.ts"
import { blendFog, paintFog } from "./fog-blend.ts"

/** Fog upload cadence (spec/08 §5): 20 Hz. */
const FOG_HZ = 20

/**
 * Coach-perspective fog over the mini map. Pulls bytes from the sim at 20 Hz
 * (independent of the 6 Hz HUD refresh), eases them with a temporal lerp and
 * lets the browser scale the 64×64 canvas bilinearly so edges stay soft.
 */
const FogLayer = ({ read }: { read: () => { cols: number; bytes: Uint8Array } }) => {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext("2d")
    if (!canvas || !ctx) return
    const first = read()
    canvas.width = first.cols
    canvas.height = first.cols
    const img = ctx.createImageData(first.cols, first.cols)
    const alpha = new Float32Array(first.cols * first.cols)
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)")
    // First frame snaps so the map does not fade in from black on mount.
    blendFog(alpha, first.bytes, 1)
    paintFog(alpha, img.data)
    ctx.putImageData(img, 0, 0)
    const id = setInterval(() => {
      const moving = blendFog(alpha, read().bytes, reduce.matches ? 1 : undefined)
      if (!moving && reduce.matches) return
      paintFog(alpha, img.data)
      ctx.putImageData(img, 0, 0)
    }, 1000 / FOG_HZ)
    return () => clearInterval(id)
  }, [read])
  return (
    <canvas
      ref={ref}
      aria-hidden
      className="pointer-events-none absolute inset-0 size-full rounded-[10px] blur-[1px]"
      style={{ imageRendering: "auto" }}
    />
  )
}

const pct = (v: number) => `${Math.round(v * 100)}%`

export const WardMap = ({
  map,
  snap,
  units,
  you,
  fog,
  onFocus,
}: {
  map: MobaMap
  /** Fog bytes for `you` (spec/08 §5); omitted → no fog layer. */
  fog?: () => { cols: number; bytes: Uint8Array }
  snap: MatchSnapshot
  /** Live unit positions (match.units()), read at HUD refresh. */
  units: readonly Unit[]
  you: DraftSide
  onFocus: (x: number, z: number) => void
}) => {
  const them = otherSide(you)
  const S = map.size
  const wards = snap.wards.filter((w) => w.side === you)
  const mine = snap.heroes.filter((h) => h.side === you)
  const pos = new Map(units.map((u) => [u.id, u]))
  const stock = snap.wardStock[you]
  // Own courier only (spec/10 S3): drawn while it is out of the fountain or loaded.
  const courier = (snap.couriers ?? []).find((c) => c.side === you)
  const courierOut =
    courier && (courier.cargo.length > 0 || courier.targetHero !== null) ? courier : null
  const courierFor = courierOut
    ? snap.heroes.find((h) => h.id === courierOut.targetHero)?.playerName
    : undefined
  const ownTeam = you === "blue" ? "radiant" : "dire"
  // Your team is drawn in "radiant" tone (ally) like the rest of the HUD.
  const dot = (h: HeroLine) => {
    const u = pos.get(h.id)
    if (!u || !h.alive) return null
    return (
      <g key={h.id}>
        <title>{`${h.playerName} · ${h.heroName}`}</title>
        <circle
          cx={u.x}
          cy={u.z}
          r={S / 55}
          className="fill-radiant"
          stroke="black"
          strokeWidth={S / 220}
        />
      </g>
    )
  }
  return (
    <section
      aria-label={`Mini map: ${wards.length} of your wards placed, ${stock.charges} in stock. Map control ${pct(snap.control[you])} versus ${pct(snap.control[them])}.${courierOut ? ` Courier out with ${courierOut.cargo.length} items.` : ""}`}
      className={cn("pointer-events-auto rounded-2xl", glass, "flex flex-col gap-1 p-1.5")}
    >
      <div
        className="relative size-40 cursor-crosshair max-lg:size-32"
        onPointerDown={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          onFocus(((e.clientX - r.left) / r.width) * S, ((e.clientY - r.top) / r.height) * S)
        }}
      >
        <svg
          viewBox={`0 0 ${S} ${S}`}
          className="absolute inset-0 block size-full rounded-[10px] bg-[#3d4a36]"
          aria-hidden
        >
          {map.river.length > 1 ? (
            <polyline
              points={map.river.map((p) => `${p.x},${p.z}`).join(" ")}
              fill="none"
              stroke="white"
              strokeOpacity={0.08}
              strokeWidth={S / 30}
              strokeLinecap="round"
            />
          ) : null}
          {map.lanes.map((l) => (
            <polyline
              key={l.id}
              points={l.path.map((p) => `${p.x},${p.z}`).join(" ")}
              fill="none"
              stroke="white"
              strokeOpacity={0.22}
              strokeWidth={S / 110}
              strokeLinejoin="round"
            />
          ))}
          {map.structures
            .filter((s) => s.kind === "ancient")
            .map((s) => (
              <rect
                key={s.id}
                x={s.position.x - S / 50}
                y={s.position.z - S / 50}
                width={S / 25}
                height={S / 25}
                className={s.team === ownTeam ? "fill-radiant/70" : "fill-dire/70"}
              />
            ))}
        </svg>
        {fog ? <FogLayer read={fog} /> : null}
        <svg
          viewBox={`0 0 ${S} ${S}`}
          className="pointer-events-none absolute inset-0 block size-full"
          aria-hidden
        >
          {wards.map((w) => (
            <g key={w.id}>
              <title>{`${w.kind === "sentry" ? "Sentry" : "Ward"} · ${Math.ceil(w.expiresIn)} s left`}</title>
              <circle cx={w.x} cy={w.z} r={9} className="fill-radiant/10" />
              <path
                d={`M${w.x},${w.z - S / 40}L${w.x + S / 55},${w.z}L${w.x},${w.z + S / 40}L${w.x - S / 55},${w.z}Z`}
                className={w.kind === "sentry" ? "fill-sky-300" : "fill-amber-200"}
                stroke="black"
                strokeWidth={S / 260}
              />
            </g>
          ))}
          {snap.runes.map((r) => (
            <g key={r.id}>
              <title>{r.type ? `${r.type.replace("-", " ")} rune` : `${r.kind} rune`}</title>
              <circle
                cx={r.x}
                cy={r.z}
                r={S / 70}
                className={
                  r.kind === "power"
                    ? "fill-fuchsia-300"
                    : r.kind === "bounty"
                      ? "fill-yellow-300"
                      : "fill-teal-200"
                }
                stroke="black"
                strokeWidth={S / 260}
              />
            </g>
          ))}
          {mine.map(dot)}
          {courierOut ? (
            <g>
              <title>
                {`Courier · ${courierOut.cargo.length} item${courierOut.cargo.length === 1 ? "" : "s"}${courierFor ? ` for ${courierFor}` : ""}`}
              </title>
              <path
                d={`M${courierOut.x},${courierOut.z - S / 45}L${courierOut.x + S / 50},${courierOut.z + S / 70}L${courierOut.x - S / 50},${courierOut.z + S / 70}Z`}
                className="fill-cyan-200"
                stroke="black"
                strokeWidth={S / 260}
              />
            </g>
          ) : null}
        </svg>
      </div>
      <div className="flex items-center gap-2 px-0.5 text-[10px] tabular-nums">
        <span
          className="flex items-center gap-1 text-amber-200"
          title={`Ward stock (max 3); next in ${Math.ceil(stock.next)} s`}
        >
          <Eye className="size-3" aria-hidden />
          {stock.charges}
          {stock.charges < 3 ? (
            <span className="text-white/35">+{Math.ceil(stock.next)}s</span>
          ) : null}
        </span>
        <span className="ml-auto text-white/45" title="Map control (visible area)">
          <span className="text-radiant">{pct(snap.control[you])}</span>
          {" · "}
          <span className="text-dire">{pct(snap.control[them])}</span>
        </span>
      </div>
      <span className="mx-0.5 flex h-1 overflow-hidden rounded-full bg-white/5" aria-hidden>
        <span className="bg-radiant/80" style={{ width: pct(snap.control[you]) }} />
        <span className="ml-auto bg-dire/80" style={{ width: pct(snap.control[them]) }} />
      </span>
    </section>
  )
}
