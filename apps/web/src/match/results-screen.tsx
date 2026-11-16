import type { DraftSide, DraftState, HeroLine, MatchSnapshot } from "@mobacraft/sim"
import { Button, Panel, cn } from "@mobacraft/ui"
import { Coins, Crown, HeartPulse, Map as MapIcon, RotateCcw, Star, Swords } from "lucide-react"
import type { FlowEvent } from "./flow.ts"
import type { MatchHistory } from "./hud-data.ts"
import { ItemSlot } from "./item-icon.tsx"
import { DamageBars, GoldGraph } from "./results-charts.tsx"
import { HeroGem, ROLE_LABEL, TeamCrest, clockText } from "./ui.tsx"

/** MVP: kills+assists weighted by damage and healing, deaths penalised. */
const mvpScore = (h: HeroLine) =>
  h.kills * 3 +
  h.assists * 1.5 -
  h.deaths * 1.2 +
  h.heroDamage / 1500 +
  h.healing / 1200 +
  h.lastHits / 25

const Stat = ({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Swords
  label: string
  value: string
}) => (
  <span className="flex flex-col">
    <span className="flex items-center gap-1 text-[9.5px] tracking-wider text-white/45 uppercase">
      <Icon className="size-3" aria-hidden />
      {label}
    </span>
    <span className="text-sm font-semibold tabular-nums">{value}</span>
  </span>
)

const MvpCard = ({ mvp, winnerSide }: { mvp: HeroLine; winnerSide: DraftSide | null }) => (
  <section
    aria-label="Most valuable player"
    className="relative flex animate-in flex-col gap-3 overflow-hidden rounded-xl border border-amber-300/30 bg-[linear-gradient(150deg,rgba(252,211,77,0.14),rgba(252,211,77,0.02)_60%)] p-3.5 duration-500 fade-in slide-in-from-bottom-2 motion-reduce:animate-none"
  >
    <p className="flex items-center gap-1 text-[10px] font-bold tracking-[0.24em] text-amber-200 uppercase">
      <Star className="size-3 fill-amber-200" aria-hidden /> MVP
    </p>
    <div className="flex items-center gap-3">
      <HeroGem heroId={mvp.heroId} size={56} />
      <div className="min-w-0">
        <p className="truncate text-lg leading-tight font-bold">{mvp.playerName}</p>
        <p className="truncate text-[12px] text-white/55">
          {mvp.heroName} · {ROLE_LABEL[mvp.role]}
          {mvp.side === winnerSide ? " · winner" : ""}
        </p>
      </div>
    </div>
    <div className="grid grid-cols-2 gap-x-3 gap-y-2">
      <Stat
        icon={Swords}
        label="K / D / A"
        value={`${mvp.kills} / ${mvp.deaths} / ${mvp.assists}`}
      />
      <Stat icon={Coins} label="Gold" value={`${(mvp.gold / 1000).toFixed(1)}k`} />
      <Stat icon={Crown} label="Hero dmg" value={mvp.heroDamage.toLocaleString()} />
      <Stat icon={HeartPulse} label="Healing" value={mvp.healing.toLocaleString()} />
    </div>
    <div className="flex gap-1" aria-label="Items">
      {Array.from({ length: 6 }, (_, i) => (
        // oxlint-disable-next-line react/no-array-index-key -- inventory slots are positional
        <ItemSlot key={i} id={mvp.items[i]} size={22} />
      ))}
    </div>
  </section>
)

export const ResultsScreen = ({
  draft,
  you,
  final,
  history,
  dispatch,
}: {
  draft: DraftState
  you: DraftSide
  final: MatchSnapshot
  history?: MatchHistory
  dispatch: (e: FlowEvent) => void
}) => {
  const won = final.winner === you
  const mvp = [...final.heroes].toSorted((a, b) => mvpScore(b) - mvpScore(a))[0]!
  const them: DraftSide = you === "blue" ? "red" : "blue"
  const sides: DraftSide[] = [you, them]
  return (
    <div className="pointer-events-auto absolute inset-0 flex animate-in overflow-y-auto bg-black/55 p-6 backdrop-blur-[3px] duration-300 fade-in motion-reduce:animate-none max-md:p-2">
      <Panel className="m-auto w-full max-w-5xl p-5 max-md:p-3">
        <div className="flex items-center gap-4">
          <Crown className={cn("size-9", won ? "text-amber-300" : "text-white/30")} aria-hidden />
          <div>
            <h1 className="text-3xl font-black tracking-tight">{won ? "Victory" : "Defeat"}</h1>
            <p className="text-sm text-white/60">
              {(final.winner === "blue" ? draft.blue : draft.red).name} won in{" "}
              {clockText(final.time)} · kills {final.kills[you]}–{final.kills[them]} · towers{" "}
              {final.towers[you]}–{final.towers[them]}
            </p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-[1fr_250px] gap-3 max-lg:grid-cols-1">
          <GoldGraph
            samples={history?.gold ?? []}
            feed={final.feed}
            heroes={final.heroes}
            you={you}
            duration={final.time}
          />
          <MvpCard mvp={mvp} winnerSide={final.winner} />
        </div>

        <div className="mt-3 grid grid-cols-[minmax(0,1fr)_300px] gap-3 max-lg:grid-cols-1">
          <div>
            {sides.map((side) => {
              const team = side === "blue" ? draft.blue : draft.red
              const rows = final.heroes.filter((h) => h.side === side)
              return (
                <section key={side} className="mt-2 first:mt-0" aria-label={team.name}>
                  <div className="flex items-center gap-2">
                    <TeamCrest team={team} size={20} />
                    <h2 className="text-sm font-semibold">{team.name}</h2>
                    {final.winner === side ? (
                      <span className="text-[10px] font-bold tracking-widest text-amber-300 uppercase">
                        Winner
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1.5 overflow-x-auto rounded-xl border border-white/[0.07]">
                    <table className="w-full text-left text-[12px]">
                      <thead className="bg-white/[0.04] text-[10px] tracking-wider text-white/45 uppercase">
                        <tr>
                          <th className="px-3 py-1.5 font-medium">Player</th>
                          <th className="px-2 py-1.5 text-right font-medium">Lvl</th>
                          <th className="px-2 py-1.5 text-right font-medium">K / D / A</th>
                          <th className="px-2 py-1.5 text-right font-medium">LH</th>
                          <th className="px-2 py-1.5 text-right font-medium">Gold</th>
                          <th className="px-2 py-1.5 font-medium max-xl:hidden">Items</th>
                          <th className="px-3 py-1.5 text-right font-medium">Healing</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/[0.05]">
                        {rows.map((h) => (
                          <tr key={h.id} className={h === mvp ? "bg-amber-300/[0.05]" : ""}>
                            <td className="px-3 py-[3px]">
                              <span className="flex items-center gap-2">
                                <HeroGem heroId={h.heroId} size={20} className="rounded-lg" />
                                <span className="truncate">
                                  <span className="font-semibold">{h.playerName}</span>
                                  <span className="ml-1.5 text-white/50">{h.heroName}</span>
                                </span>
                              </span>
                            </td>
                            <td className="px-2 text-right tabular-nums">{h.level}</td>
                            <td className="px-2 text-right font-mono whitespace-nowrap tabular-nums">
                              {h.kills} / {h.deaths} / {h.assists}
                            </td>
                            <td className="px-2 text-right tabular-nums">{h.lastHits}</td>
                            <td className="px-2 text-right tabular-nums">
                              {(h.gold / 1000).toFixed(1)}k
                            </td>
                            <td className="px-2 max-xl:hidden">
                              <span className="flex gap-0.5">
                                {Array.from({ length: 6 }, (_, i) => (
                                  // oxlint-disable-next-line react/no-array-index-key -- inventory slots are positional
                                  <ItemSlot key={i} id={h.items[i]} size={16} />
                                ))}
                              </span>
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
          </div>
          <DamageBars heroes={final.heroes} you={you} mvpId={mvp.id} />
        </div>

        <div className="mt-4 flex justify-end gap-2">
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
