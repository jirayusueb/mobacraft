import type { DraftSide, DraftState, HeroLine, MatchSnapshot } from "@mobacraft/sim"
import { Button, Panel, cn } from "@mobacraft/ui"
import { Crown, Map as MapIcon, RotateCcw, Star } from "lucide-react"
import type { FlowEvent } from "./flow.ts"
import { HeroGem, TeamCrest, clockText } from "./ui.tsx"

/** MVP: kills+assists weighted by damage and healing, deaths penalised. */
const mvpScore = (h: HeroLine) =>
  h.kills * 3 +
  h.assists * 1.5 -
  h.deaths * 1.2 +
  h.heroDamage / 1500 +
  h.healing / 1200 +
  h.lastHits / 25

export const ResultsScreen = ({
  draft,
  you,
  final,
  dispatch,
}: {
  draft: DraftState
  you: DraftSide
  final: MatchSnapshot
  dispatch: (e: FlowEvent) => void
}) => {
  const won = final.winner === you
  const mvp = [...final.heroes].toSorted((a, b) => mvpScore(b) - mvpScore(a))[0]!
  const sides: DraftSide[] = [you, you === "blue" ? "red" : "blue"]
  return (
    <div className="pointer-events-auto absolute inset-0 grid animate-in place-items-center overflow-y-auto bg-black/55 p-6 backdrop-blur-[3px] duration-300 fade-in max-md:p-2">
      <Panel className="w-full max-w-4xl p-6 max-md:p-3">
        <div className="flex items-center gap-4">
          <Crown className={cn("size-9", won ? "text-amber-300" : "text-white/30")} aria-hidden />
          <div>
            <h1 className="text-3xl font-black tracking-tight">{won ? "Victory" : "Defeat"}</h1>
            <p className="text-sm text-white/60">
              {(final.winner === "blue" ? draft.blue : draft.red).name} won in{" "}
              {clockText(final.time)} · kills {final.kills[you]}–
              {final.kills[you === "blue" ? "red" : "blue"]} · towers {final.towers[you]}–
              {final.towers[you === "blue" ? "red" : "blue"]}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2.5 rounded-xl border border-amber-300/25 bg-amber-300/[0.07] px-3 py-2 max-md:hidden">
            <HeroGem heroId={mvp.heroId} size={40} />
            <div>
              <p className="flex items-center gap-1 text-[10px] font-bold tracking-[0.2em] text-amber-200 uppercase">
                <Star className="size-3" aria-hidden /> MVP
              </p>
              <p className="text-sm font-semibold">
                {mvp.playerName} <span className="font-normal text-white/55">· {mvp.heroName}</span>
              </p>
            </div>
          </div>
        </div>

        {sides.map((side) => {
          const team = side === "blue" ? draft.blue : draft.red
          const rows = final.heroes.filter((h) => h.side === side)
          return (
            <section key={side} className="mt-5" aria-label={team.name}>
              <div className="flex items-center gap-2">
                <TeamCrest team={team} size={22} />
                <h2 className="text-sm font-semibold">{team.name}</h2>
                {final.winner === side ? (
                  <span className="text-[10px] font-bold tracking-widest text-amber-300 uppercase">
                    Winner
                  </span>
                ) : null}
              </div>
              <div className="mt-2 overflow-x-auto rounded-xl border border-white/[0.07]">
                <table className="w-full text-left text-[12px]">
                  <thead className="bg-white/[0.04] text-[10px] tracking-wider text-white/45 uppercase">
                    <tr>
                      <th className="px-3 py-2 font-medium">Player</th>
                      <th className="px-2 py-2 text-right font-medium">Lvl</th>
                      <th className="px-2 py-2 text-right font-medium">K / D / A</th>
                      <th className="px-2 py-2 text-right font-medium">LH</th>
                      <th className="px-2 py-2 text-right font-medium">Gold</th>
                      <th className="px-2 py-2 text-right font-medium">Hero dmg</th>
                      <th className="px-3 py-2 text-right font-medium">Healing</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.05]">
                    {rows.map((h) => (
                      <tr key={h.id} className={h === mvp ? "bg-amber-300/[0.05]" : ""}>
                        <td className="px-3 py-1.5">
                          <span className="flex items-center gap-2">
                            <HeroGem heroId={h.heroId} size={26} />
                            <span>
                              <span className="font-semibold">{h.playerName}</span>
                              <span className="ml-1.5 text-white/50">{h.heroName}</span>
                            </span>
                          </span>
                        </td>
                        <td className="px-2 text-right tabular-nums">{h.level}</td>
                        <td className="px-2 text-right font-mono tabular-nums">
                          {h.kills} / {h.deaths} / {h.assists}
                        </td>
                        <td className="px-2 text-right tabular-nums">{h.lastHits}</td>
                        <td className="px-2 text-right tabular-nums">
                          {(h.gold / 1000).toFixed(1)}k
                        </td>
                        <td className="px-2 text-right tabular-nums">
                          {h.heroDamage.toLocaleString()}
                        </td>
                        <td className="px-3 text-right tabular-nums">
                          {h.healing.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )
        })}

        <div className="mt-6 flex justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-10 px-4"
            onPress={() => dispatch({ _tag: "exit" })}
          >
            <MapIcon className="size-4!" aria-hidden /> Explore island
          </Button>
          <Button size="sm" className="h-10 px-5" onPress={() => dispatch({ _tag: "start" })}>
            <RotateCcw className="size-4!" aria-hidden /> Play another
          </Button>
        </div>
      </Panel>
    </div>
  )
}
