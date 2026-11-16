/**
 * Match mini map (spec/06 §3c): lanes, your wards (enemy wards are hidden),
 * your heroes, ward stock and map control %. SVG in map tile units; team
 * colours come from CSS tokens (text-/fill-radiant, -dire), never engine palettes.
 */
import type { MobaMap } from "@mobacraft/map"
import type { DraftSide, HeroLine, MatchSnapshot, Unit } from "@mobacraft/sim"
import { cn, glass } from "@mobacraft/ui"
import { Eye } from "lucide-react"
import { otherSide } from "../hud-data.ts"

const pct = (v: number) => `${Math.round(v * 100)}%`

export const WardMap = ({
  map,
  snap,
  units,
  you,
  onFocus,
}: {
  map: MobaMap
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
      aria-label={`Mini map: ${wards.length} of your wards placed, ${stock.charges} in stock. Map control ${pct(snap.control[you])} versus ${pct(snap.control[them])}.`}
      className={cn("pointer-events-auto rounded-2xl", glass, "flex flex-col gap-1 p-1.5")}
    >
      <svg
        viewBox={`0 0 ${S} ${S}`}
        className="block size-40 cursor-crosshair rounded-[10px] bg-neutral-950/70 max-lg:size-32"
        aria-hidden
        onPointerDown={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          onFocus(((e.clientX - r.left) / r.width) * S, ((e.clientY - r.top) / r.height) * S)
        }}
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
        {wards.map((w) => (
          <g key={w.id}>
            <title>{`Ward · ${Math.ceil(w.expiresIn)} s left`}</title>
            <circle cx={w.x} cy={w.z} r={9} className="fill-radiant/10" />
            <path
              d={`M${w.x},${w.z - S / 40}L${w.x + S / 55},${w.z}L${w.x},${w.z + S / 40}L${w.x - S / 55},${w.z}Z`}
              className="fill-amber-200"
              stroke="black"
              strokeWidth={S / 260}
            />
          </g>
        ))}
        {mine.map(dot)}
      </svg>
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
