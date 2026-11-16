import type { MapViewShape } from "@mobacraft/engine"
import type { MobaMap } from "@mobacraft/map"
import {
  CALL_COOLDOWN,
  type CoachCall,
  type DraftSide,
  type DraftState,
  type HeroLine,
  type MatchSnapshot,
  createMatch,
  itemById,
} from "@mobacraft/sim"
import { Button, Panel, Tooltip, cn } from "@mobacraft/ui"
import {
  Crown,
  FastForward,
  Flag,
  Pause,
  Play,
  Shield,
  Skull,
  Sprout,
  Users,
  X,
} from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import type { FlowEvent } from "./flow.ts"
import { HeroGem, TeamCrest, clockText } from "./ui.tsx"

const CALLS: readonly {
  id: CoachCall
  label: string
  key: string
  icon: typeof Users
  hint: string
}[] = [
  {
    id: "group",
    label: "Group up",
    key: "1",
    icon: Users,
    hint: "All five gather and take the next objective together.",
  },
  {
    id: "push",
    label: "Push",
    key: "2",
    icon: Flag,
    hint: "Commit to towers now — accept riskier dives.",
  },
  { id: "roshan", label: "Roshan", key: "3", icon: Skull, hint: "Go kill Roshan for the Aegis." },
  {
    id: "farm",
    label: "Farm",
    key: "4",
    icon: Sprout,
    hint: "Spread out, clear jungle camps, catch up on gold.",
  },
  {
    id: "safe",
    label: "Play safe",
    key: "5",
    icon: Shield,
    hint: "Back off earlier, avoid even fights.",
  },
]

const SPEEDS = [1, 2, 4, 8] as const

export const MatchScreen = ({
  map,
  view,
  draft,
  you,
  seed,
  dispatch,
}: {
  map: MobaMap
  view: MapViewShape
  draft: DraftState
  you: DraftSide
  seed: number
  dispatch: (e: FlowEvent) => void
}) => {
  const them: DraftSide = you === "blue" ? "red" : "blue"
  const match = useMemo(
    () => createMatch(map, draft, { seed, speed: 4, aiCoach: [them] }),
    [map, draft, seed, them],
  )
  const [snap, setSnap] = useState<MatchSnapshot>(() => match.snapshot())

  // Hand the match to the renderer for the lifetime of this screen.
  useEffect(() => {
    view.setPopulation(match)
    view.focus(map.size / 2, map.size / 2)
    return () => view.setPopulation(null)
  }, [view, match, map])

  // HUD refresh at 6 Hz (the renderer advances the sim every frame).
  useEffect(() => {
    const id = setInterval(() => setSnap(match.snapshot()), 160)
    return () => clearInterval(id)
  }, [match])

  // Hand off to results shortly after the Ancient falls.
  useEffect(() => {
    if (!snap.winner) return
    const id = setTimeout(() => dispatch({ _tag: "finished", final: match.snapshot() }), 3500)
    return () => clearTimeout(id)
  }, [snap.winner, match, dispatch])

  // Keyboard: 1-5 calls, Space pause, [ ] speed.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target !== document.body) return
      const c = CALLS.find((x) => x.key === e.key)
      if (c) match.call(you, c.id)
      else if (e.key === " ") match.setPaused(!match.snapshot().paused)
      else if (e.key === "]") match.setSpeed(Math.min(8, match.snapshot().speed * 2))
      else if (e.key === "[") match.setSpeed(Math.max(1, match.snapshot().speed / 2))
      else if (e.key === "=" || e.key === "+") view.zoomBy(1.35)
      else if (e.key === "-" || e.key === "_") view.zoomBy(1 / 1.35)
      else return
      e.preventDefault()
      setSnap(match.snapshot())
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [match, you, view])

  const yourTeam = you === "blue" ? draft.blue : draft.red
  const theirTeam = you === "blue" ? draft.red : draft.blue
  const mine = snap.heroes.filter((h) => h.side === you)
  const theirs = snap.heroes.filter((h) => h.side === them)
  const callState = snap.calls[you]
  const feed = snap.feed.slice(-6).toReversed()

  return (
    <div className="pointer-events-none absolute inset-0 text-white">
      {/* top-centre scoreboard */}
      <div className="absolute top-4 left-1/2 flex -translate-x-1/2 items-stretch gap-2">
        <Panel className="flex items-center gap-3 px-3.5 py-2">
          <TeamCrest team={yourTeam} size={26} />
          <span className="text-3xl leading-none font-bold tabular-nums text-radiant">
            {snap.kills[you]}
          </span>
          <span className="flex flex-col items-center px-1">
            <span className="font-mono text-sm tabular-nums text-white/85">
              {clockText(snap.time)}
            </span>
            <span className="text-[10px] tabular-nums text-white/45">
              <span aria-label={`Towers destroyed ${snap.towers[you]} to ${snap.towers[them]}`}>
                Towers {snap.towers[you]}–{snap.towers[them]}
              </span>
            </span>
          </span>
          <span className="text-3xl leading-none font-bold tabular-nums text-dire">
            {snap.kills[them]}
          </span>
          <TeamCrest team={theirTeam} size={26} />
        </Panel>
        <Panel className="flex flex-col justify-center px-3 py-1.5 text-[11px] text-white/60 max-md:hidden">
          <span>
            Gold{" "}
            <span className="font-semibold text-radiant tabular-nums">
              {(snap.gold[you] / 1000).toFixed(1)}k
            </span>
            <span className="text-white/30"> / </span>
            <span className="font-semibold text-dire tabular-nums">
              {(snap.gold[them] / 1000).toFixed(1)}k
            </span>
          </span>
          <span className={snap.roshanAlive ? "text-violet-300" : "text-white/35"}>
            Roshan {snap.roshanAlive ? "is up" : "is down"}
          </span>
        </Panel>
      </div>

      {/* hero frames: yours left, theirs right */}
      <HeroColumn heroes={mine} side="left" onPick={(id) => view.select(id)} />
      <HeroColumn heroes={theirs} side="right" onPick={(id) => view.select(id)} />

      {/* kill feed */}
      <ol
        className="absolute top-24 right-4 flex w-72 flex-col gap-1 max-lg:hidden"
        aria-live="polite"
        aria-label="Match feed"
      >
        {feed.map((f) => (
          <li
            key={`${f.t}-${f.text}`}
            className={cn(
              "animate-in rounded-lg border border-white/10 bg-black/55 px-2.5 py-1.5 text-[11.5px] backdrop-blur fade-in slide-in-from-right-2",
              f.side === you
                ? "border-l-2 border-l-radiant"
                : f.side === them
                  ? "border-l-2 border-l-dire"
                  : "border-l-2 border-l-violet-400",
              f.kind === "ancient" && "text-base font-semibold",
            )}
          >
            <span className="mr-1.5 font-mono text-[10px] text-white/40">{clockText(f.t)}</span>
            {f.text}
          </li>
        ))}
      </ol>

      {/* bottom: coach calls + speed */}
      <div className="pointer-events-auto absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-2">
        <Panel className="flex items-center gap-1 rounded-full p-1">
          <span className="px-2.5 text-[10px] font-semibold tracking-[0.2em] text-white/45 uppercase max-md:hidden">
            Coach
          </span>
          {CALLS.map((c) => {
            const active = callState.active === c.id
            const Icon = c.icon
            return (
              <Tooltip key={c.id} label={c.hint} shortcut={c.key}>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-10 gap-1.5 rounded-full px-3",
                    active && "bg-amber-300/20 text-amber-100",
                  )}
                  isDisabled={(callState.cooldown > 0 && !active) || !!snap.winner}
                  aria-label={c.label}
                  onPress={() => {
                    match.call(you, c.id)
                    setSnap(match.snapshot())
                  }}
                >
                  <Icon className="size-4!" aria-hidden />
                  <span className="max-lg:hidden">{c.label}</span>
                </Button>
              </Tooltip>
            )
          })}
          <span
            className="w-16 px-2 text-center font-mono text-[11px] tabular-nums text-white/55"
            aria-live="off"
          >
            {callState.active
              ? `${Math.ceil(callState.remaining)}s`
              : callState.cooldown > 0
                ? `↻ ${Math.ceil(callState.cooldown)}s`
                : "ready"}
          </span>
        </Panel>
        <Panel className="flex items-center gap-0.5 rounded-full p-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label={snap.paused ? "Resume" : "Pause"}
            onPress={() => {
              match.setPaused(!snap.paused)
              setSnap(match.snapshot())
            }}
          >
            {snap.paused ? <Play /> : <Pause />}
          </Button>
          {SPEEDS.map((s) => (
            <Button
              key={s}
              variant="ghost"
              size="sm"
              className={cn(
                "h-9 rounded-full px-2.5 font-mono text-xs",
                snap.speed === s && "bg-white/15 text-white",
              )}
              aria-label={`Speed ${s}×`}
              onPress={() => {
                match.setSpeed(s)
                setSnap(match.snapshot())
              }}
            >
              {s}×
            </Button>
          ))}
          <FastForward className="mx-1 size-3.5 text-white/30" aria-hidden />
          <Tooltip label="Concede and return to the island">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Leave match"
              onPress={() => dispatch({ _tag: "exit" })}
            >
              <X />
            </Button>
          </Tooltip>
        </Panel>
      </div>

      {snap.winner ? (
        <div className="absolute inset-0 grid animate-in place-items-center duration-500 fade-in">
          <div className="text-center drop-shadow-[0_4px_24px_rgba(0,0,0,0.8)]">
            <Crown
              className={cn(
                "mx-auto size-10",
                snap.winner === you ? "text-amber-300" : "text-white/40",
              )}
              aria-hidden
            />
            <p className="mt-2 text-5xl font-black tracking-tight">
              {snap.winner === you ? "Victory" : "Defeat"}
            </p>
            <p className="mt-1 text-sm text-white/70">
              {(snap.winner === "blue" ? draft.blue : draft.red).name} destroyed the Ancient
            </p>
          </div>
        </div>
      ) : null}
      <span className="sr-only">Call cooldown {CALL_COOLDOWN} seconds</span>
    </div>
  )
}

const HeroColumn = ({
  heroes,
  side,
  onPick,
}: {
  heroes: readonly HeroLine[]
  side: "left" | "right"
  onPick: (id: string) => void
}) => (
  <ul
    className={cn(
      "pointer-events-auto absolute top-24 flex w-56 flex-col gap-1.5 max-md:hidden",
      side === "left" ? "left-4" : "right-4 top-auto bottom-24",
    )}
  >
    {heroes.map((h) => (
      <li key={h.id}>
        <button
          type="button"
          onClick={() => onPick(h.id)}
          className={cn(
            "flex w-full items-center gap-2 rounded-xl border border-white/10 bg-black/55 p-1.5 text-left outline-none backdrop-blur transition hover:bg-black/70 focus-visible:ring-2 focus-visible:ring-sky-300/90",
            !h.alive && "opacity-60",
          )}
          aria-label={`${h.heroName}, ${h.playerName}, level ${h.level}${h.alive ? "" : `, respawning in ${Math.ceil(h.respawnIn)} seconds`}`}
        >
          <span className="relative">
            <HeroGem heroId={h.heroId} size={34} dim={!h.alive} />
            <span className="absolute -right-1 -bottom-1 grid size-4 place-items-center rounded-full bg-black text-[9px] font-bold tabular-nums ring-1 ring-white/20">
              {h.level}
            </span>
            {!h.alive ? (
              <span className="absolute inset-0 grid place-items-center text-sm font-bold tabular-nums">
                {Math.ceil(h.respawnIn)}
              </span>
            ) : null}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline justify-between gap-1">
              <span className="truncate text-[12px] font-semibold">{h.playerName}</span>
              <span className="font-mono text-[10px] tabular-nums text-white/60">
                {h.kills}/{h.deaths}/{h.assists}
              </span>
            </span>
            <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-white/10">
              <span
                className={cn(
                  "block h-full rounded-full transition-[width] duration-150",
                  side === "left" ? "bg-radiant" : "bg-dire",
                )}
                style={{ width: `${Math.round(h.hp * 100)}%` }}
              />
            </span>
            <span className="mt-1 flex items-center gap-0.5">
              {h.items.slice(0, 6).map((it, i) => (
                <span
                  // oxlint-disable-next-line react/no-array-index-key -- item slots are positional
                  key={i}
                  className="grid h-3.5 min-w-3.5 place-items-center rounded-[3px] bg-white/10 px-0.5 text-[8px] text-white/70"
                  title={itemById(it).name}
                >
                  {itemById(it).name[0]}
                </span>
              ))}
              {h.aegis ? (
                <span className="ml-auto text-[9px] font-bold text-amber-300" title="Aegis">
                  AEGIS
                </span>
              ) : null}
            </span>
          </span>
        </button>
      </li>
    ))}
  </ul>
)
