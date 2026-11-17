/** Top-centre scoreboard: crests, kills, clock, tower pips, gold lead, Roshan. */
import type { DraftSide, DraftState, MatchSnapshot, Unit } from "@mobacraft/sim"
import { Panel, cn } from "@mobacraft/ui"
import { Skull, TrendingUp } from "lucide-react"
import { goldK, otherSide, roshanHp, roshanText, roshanUnderAttack } from "./hud-data.ts"
import { TeamCrest, clockText } from "./ui.tsx"

const TOWERS_PER_SIDE = 11

/** Stable default for `units` (array literal defaults re-render forever). */
const EMPTY_UNITS: readonly Unit[] = []

/** 11 pips; `down` of them filled = enemy towers this side has destroyed. */
const TowerPips = ({ down, tone }: { down: number; tone: "ally" | "enemy" }) => (
  <span className="flex gap-[2px]" aria-hidden>
    {Array.from({ length: TOWERS_PER_SIDE }, (_, i) => (
      <span
        // oxlint-disable-next-line react/no-array-index-key -- fixed pip strip
        key={i}
        className={cn(
          "h-2 w-1 rounded-[1.5px] transition-colors duration-300 motion-reduce:transition-none",
          i < down ? (tone === "ally" ? "bg-radiant" : "bg-dire") : "bg-white/12",
        )}
      />
    ))}
  </span>
)

export const Scoreboard = ({
  snap,
  draft,
  you,
  units = EMPTY_UNITS,
}: {
  snap: MatchSnapshot
  draft: DraftState
  you: DraftSide
  /** Live unit list — drives the "Roshan 64%" under-attack readout. */
  units?: readonly Unit[]
}) => {
  const them = otherSide(you)
  const yourTeam = you === "blue" ? draft.blue : draft.red
  const theirTeam = you === "blue" ? draft.red : draft.blue
  const lead = snap.gold[you] - snap.gold[them]
  const leader = Math.abs(lead) < 100 ? null : lead > 0 ? you : them
  const hp = roshanHp(units)
  const fighting = roshanUnderAttack(hp)

  return (
    <div className="absolute top-4 left-1/2 flex -translate-x-1/2 items-stretch gap-2">
      <Panel className="flex items-center gap-3 px-3.5 py-2">
        <span className="flex flex-col items-center gap-1">
          <TeamCrest team={yourTeam} size={26} />
        </span>
        <span className="flex flex-col items-end gap-1">
          <span
            className="text-3xl leading-none font-bold tabular-nums text-radiant"
            aria-label={`${yourTeam.name} ${snap.kills[you]} kills`}
          >
            {snap.kills[you]}
          </span>
          <TowerPips down={snap.towers[you]} tone="ally" />
        </span>
        <span className="flex min-w-[64px] flex-col items-center px-1">
          <span
            className="font-mono text-base leading-tight tabular-nums text-white/90"
            aria-label={`Game clock ${clockText(snap.time)}`}
          >
            {clockText(snap.time)}
          </span>
          <span
            className="text-[10px] tabular-nums text-white/45"
            aria-label={`Towers destroyed ${snap.towers[you]} to ${snap.towers[them]}`}
          >
            Towers {snap.towers[you]}–{snap.towers[them]}
          </span>
        </span>
        <span className="flex flex-col items-start gap-1">
          <span
            className="text-3xl leading-none font-bold tabular-nums text-dire"
            aria-label={`${theirTeam.name} ${snap.kills[them]} kills`}
          >
            {snap.kills[them]}
          </span>
          <TowerPips down={snap.towers[them]} tone="enemy" />
        </span>
        <TeamCrest team={theirTeam} size={26} />
      </Panel>
      <Panel className="flex min-w-[118px] flex-col justify-center gap-0.5 px-3 py-1.5 text-[11px] text-white/60 max-md:hidden">
        <span
          className="flex items-center gap-1.5"
          aria-label={
            leader
              ? `${leader === you ? yourTeam.name : theirTeam.name} lead by ${goldK(Math.abs(lead))} gold`
              : "Gold even"
          }
        >
          <TrendingUp
            className={cn(
              "size-3.5",
              leader === you
                ? "text-radiant"
                : leader === them
                  ? "-scale-y-100 text-dire"
                  : "text-white/35",
            )}
            aria-hidden
          />
          {leader ? (
            <span
              className={cn(
                "font-semibold tabular-nums",
                leader === you ? "text-radiant" : "text-dire",
              )}
            >
              +{goldK(Math.abs(lead))}
              <span className="ml-1 font-normal text-white/45">
                {leader === you ? yourTeam.tag : theirTeam.tag}
              </span>
            </span>
          ) : (
            <span className="text-white/50">Gold even</span>
          )}
        </span>
        <span
          className={cn(
            "flex items-center gap-1.5",
            fighting
              ? "text-amber-200"
              : snap.roshanWindow.state === "alive"
                ? "text-violet-300"
                : snap.roshanWindow.state === "maybe"
                  ? "text-violet-200/70"
                  : "text-white/40",
          )}
          aria-live="polite"
        >
          <Skull className="size-3.5" aria-hidden />
          {fighting ? `Roshan ${Math.round((hp ?? 0) * 100)}%` : roshanText(snap, clockText)}
        </span>
      </Panel>
    </div>
  )
}
