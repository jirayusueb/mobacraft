import { TEAMS, type TeamDef, createDraft } from "@mobacraft/sim"
import { Button, Panel } from "@mobacraft/ui"
import { ArrowLeft, ArrowRight } from "lucide-react"
import { useState } from "react"
import type { FlowEvent } from "./flow.ts"
import { ROLE_ICON, ROLE_LABEL, Rating, TeamCrest, hex } from "./ui.tsx"

const STYLE_LABEL: Record<TeamDef["style"], string> = {
  aggressive: "Aggressive — early fights, fast heroes",
  macro: "Macro — towers, Roshan, patience",
  teamfight: "Teamfight — big ultimates, grouped play",
  pick: "Pick-off — lockdown and catches",
}

/** Choose your team; the opponent is the next team in the league table. */
export const PickTeam = ({ dispatch }: { dispatch: (e: FlowEvent) => void }) => {
  const [chosen, setChosen] = useState<TeamDef>(TEAMS[0]!)
  const opponent = TEAMS[(TEAMS.indexOf(chosen) + 1) % TEAMS.length]!
  return (
    <div className="pointer-events-auto absolute inset-0 grid animate-in place-items-center bg-black/45 p-6 backdrop-blur-[2px] duration-300 fade-in">
      <Panel className="w-full max-w-3xl p-6 max-md:p-4">
        <p className="text-[11px] font-semibold tracking-[0.25em] text-white/45 uppercase">
          Match Day
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">Choose your team</h1>
        <div
          role="radiogroup"
          aria-label="Team"
          className="mt-5 grid grid-cols-4 gap-2.5 max-md:grid-cols-2"
        >
          {TEAMS.map((team) => {
            const on = team === chosen
            return (
              <button
                key={team.id}
                type="button"
                aria-pressed={on}
                onClick={() => setChosen(team)}
                className={`rounded-xl border p-3 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-sky-300/90 ${on ? "border-white/40 bg-white/10" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.07]"}`}
                style={on ? { boxShadow: `inset 0 0 0 1px ${hex(team.color)}55` } : undefined}
              >
                <TeamCrest team={team} />
                <p className="mt-2 text-sm font-semibold text-white">{team.name}</p>
                <p className="mt-0.5 text-[11px] leading-snug text-white/55">
                  {STYLE_LABEL[team.style].split(" — ")[0]}
                </p>
              </button>
            )
          })}
        </div>

        <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-start gap-4 max-md:grid-cols-1">
          <Roster team={chosen} title="Your roster" />
          <div className="self-center text-center text-xs font-bold tracking-widest text-white/35 max-md:hidden">
            VS
          </div>
          <Roster team={opponent} title="Opponent" dim />
        </div>

        <div className="mt-6 flex items-center justify-between gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="h-9 px-3 text-white/70"
            onPress={() => dispatch({ _tag: "exit" })}
          >
            <ArrowLeft className="size-3.5!" aria-hidden /> Back to island
          </Button>
          <Button
            size="sm"
            className="h-10 px-5"
            onPress={() =>
              dispatch({ _tag: "chosen", draft: createDraft(chosen, opponent), you: "blue" })
            }
          >
            Start draft <ArrowRight className="size-3.5!" aria-hidden />
          </Button>
        </div>
      </Panel>
    </div>
  )
}

const Roster = ({ team, title, dim }: { team: TeamDef; title: string; dim?: boolean }) => (
  <section aria-label={title} className={dim ? "opacity-80" : ""}>
    <div className="flex items-center gap-2">
      <TeamCrest team={team} size={22} />
      <h2 className="text-xs font-semibold tracking-wide text-white/80">
        {title} · <span className="text-white">{team.name}</span>
      </h2>
    </div>
    <p className="mt-1 text-[11px] text-white/45">{STYLE_LABEL[team.style]}</p>
    <ul className="mt-2 divide-y divide-white/[0.06] rounded-xl border border-white/[0.07] bg-black/20">
      {team.players.map((p) => {
        const Icon = ROLE_ICON[p.role]
        return (
          <li key={p.id} className="flex items-center gap-2.5 px-3 py-2">
            <Icon className="size-3.5 text-white/50" aria-hidden />
            <span className="w-14 text-sm font-medium text-white">{p.name}</span>
            <span className="w-14 text-[11px] text-white/45">{ROLE_LABEL[p.role]}</span>
            <span className="ml-auto flex flex-col gap-0.5">
              <Rating value={p.skill} label="Skill" />
              <Rating value={p.sense} label="Sense" />
            </span>
          </li>
        )
      })}
    </ul>
  </section>
)
