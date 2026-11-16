import type { MapViewShape } from "@mobacraft/engine"
import type { MobaMap } from "@mobacraft/map"
import {
  type CoachCall,
  type DraftSide,
  type DraftState,
  type MatchSnapshot,
  createMatch,
} from "@mobacraft/sim"
import { Button, Panel, Tooltip, cn } from "@mobacraft/ui"
import { Crown, FastForward, Pause, Play, X } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Announcer, enqueue } from "./announcer.tsx"
import { CALLS, CoachBar } from "./coach-bar.tsx"
import type { FlowEvent } from "./flow.ts"
import { HeroColumn } from "./hero-frame.tsx"
import { type Banner, type GoldSample, announce, createTracker, pushSample } from "./hud-data.ts"
import { KillFeed } from "./kill-feed.tsx"
import { Scoreboard } from "./scoreboard.tsx"

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
  const [banners, setBanners] = useState<readonly Banner[]>([])
  const history = useRef<GoldSample[]>([])
  const tracker = useRef(createTracker())

  // Each side's own Ancient (for "under attack" banners), resolved once from map data.
  const ancientIds = useMemo(() => {
    const id = (team: "radiant" | "dire") =>
      map.structures.find((s) => s.kind === "ancient" && s.team === team)?.id
    return { blue: id("radiant"), red: id("dire") }
  }, [map])

  // Hand the match to the renderer for the lifetime of this screen.
  useEffect(() => {
    view.setPopulation(match)
    view.focus(map.size / 2, map.size / 2)
    history.current = []
    tracker.current = createTracker()
    return () => view.setPopulation(null)
  }, [view, match, map])

  // HUD refresh at 6 Hz (the renderer advances the sim every frame): sample gold, run the announcer.
  useEffect(() => {
    const teamName = (s: DraftSide) => (s === "blue" ? draft.blue.name : draft.red.name)
    const id = setInterval(() => {
      const s = match.snapshot()
      pushSample(history.current, s)
      const st = match.structures()
      const hp = (sid: string | undefined) => st.find((x) => x.id === sid)?.hp ?? 1
      const fresh = announce(
        tracker.current,
        s,
        { blue: hp(ancientIds.blue), red: hp(ancientIds.red) },
        teamName,
      )
      if (fresh.length > 0) setBanners((q) => enqueue(q, fresh))
      setSnap(s)
    }, 160)
    return () => clearInterval(id)
  }, [match, draft, ancientIds])

  const bannerDone = useCallback(
    (bid: number) => setBanners((q) => (q[0]?.id === bid ? q.slice(1) : q)),
    [],
  )

  // Hand off to results shortly after the Ancient falls.
  useEffect(() => {
    if (!snap.winner) return
    const tid = setTimeout(() => {
      const final = match.snapshot()
      pushSample(history.current, final)
      const last = history.current.at(-1)
      if (last && last.t < final.time)
        history.current.push({ t: final.time, blue: final.gold.blue, red: final.gold.red })
      dispatch({ _tag: "finished", final, history: { gold: history.current } })
    }, 3500)
    return () => clearTimeout(tid)
  }, [snap.winner, match, dispatch])

  const doCall = useCallback(
    (c: CoachCall) => {
      match.call(you, c)
      setSnap(match.snapshot())
    },
    [match, you],
  )

  // Keyboard: 1-5 calls, Space pause, [ ] speed.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target !== document.body) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
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

  const mine = snap.heroes.filter((h) => h.side === you)
  const theirs = snap.heroes.filter((h) => h.side === them)

  return (
    <div className="pointer-events-none absolute inset-0 text-white">
      <Scoreboard snap={snap} draft={draft} you={you} />

      {/* hero frames: yours left, theirs right */}
      <HeroColumn
        heroes={mine}
        side="left"
        label={`${you === "blue" ? draft.blue.name : draft.red.name} heroes`}
        onPick={(id) => view.select(id)}
      />
      <HeroColumn
        heroes={theirs}
        side="right"
        label={`${them === "blue" ? draft.blue.name : draft.red.name} heroes`}
        onPick={(id) => view.select(id)}
      />

      <KillFeed feed={snap.feed} heroes={snap.heroes} you={you} />

      {snap.winner ? null : <Announcer queue={banners} you={you} onDone={bannerDone} />}

      {/* bottom: coach calls + speed */}
      <div className="pointer-events-auto absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-2">
        <CoachBar
          state={snap.calls[you]}
          winner={!!snap.winner}
          roshanAlive={snap.roshanAlive}
          onCall={doCall}
        />
        <Panel className="flex items-center gap-0.5 rounded-full p-1">
          <Tooltip label={snap.paused ? "Resume" : "Pause"} shortcut="Space">
            <Button
              variant="ghost"
              size="icon"
              aria-label={snap.paused ? "Resume" : "Pause"}
              aria-keyshortcuts="Space"
              onPress={() => {
                match.setPaused(!snap.paused)
                setSnap(match.snapshot())
              }}
            >
              {snap.paused ? <Play /> : <Pause />}
            </Button>
          </Tooltip>
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
          <Tooltip label="Slower / faster" shortcut={["[", "]"]}>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Cycle speed"
              aria-keyshortcuts="[ ]"
              excludeFromTabOrder
              onPress={() => {
                const i = SPEEDS.indexOf(snap.speed as (typeof SPEEDS)[number])
                match.setSpeed(SPEEDS[(i + 1) % SPEEDS.length]!)
                setSnap(match.snapshot())
              }}
            >
              <FastForward className="text-white/35" />
            </Button>
          </Tooltip>
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
    </div>
  )
}
