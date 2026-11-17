import type { MapViewShape } from "@mobacraft/engine"
import type { MobaMap } from "@mobacraft/map"
import {
  type CoachCall,
  type DraftSide,
  type DraftState,
  type MatchSnapshot,
  type TeamTactics,
  type Unit,
  createMatch,
} from "@mobacraft/sim"
import { Button, Panel, Tooltip, cn } from "@mobacraft/ui"
import { ChartLine, Crown, FastForward, Pause, Play, SlidersHorizontal, X } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Announcer, enqueue } from "./announcer.tsx"
import { CALLS, CoachBar } from "./coach-bar.tsx"
import type { FlowEvent } from "./flow.ts"
import { HeroColumn } from "./hero-frame.tsx"
import { AnnouncerTracker, type Banner } from "./hud-data.ts"
import { KillFeed } from "./kill-feed.tsx"
import { CommsLog } from "./live/comms-log.tsx"
import { EconomyPanel } from "./live/economy-panel.tsx"
import { PhaseChip } from "./live/phase-chip.tsx"
import { TacticsDrawer } from "./live/tactics-drawer.tsx"
import { WardMap } from "./live/ward-map.tsx"
import { Scoreboard } from "./scoreboard.tsx"

const SPEEDS = [1, 2, 4, 8] as const

export const MatchScreen = ({
  map,
  view,
  draft,
  you,
  seed,
  tactics,
  dispatch,
}: {
  map: MobaMap
  view: MapViewShape
  draft: DraftState
  you: DraftSide
  seed: number
  /** Your side's game plan from the tactics board; the AI side uses `aiTactics`. */
  tactics?: TeamTactics
  dispatch: (e: FlowEvent) => void
}) => {
  const them: DraftSide = you === "blue" ? "red" : "blue"
  const match = useMemo(
    () =>
      createMatch(map, draft, {
        seed,
        speed: 4,
        aiCoach: [them],
        ...(tactics ? { tactics: { [you]: tactics } } : {}),
      }),
    [map, draft, seed, them, you, tactics],
  )
  const [snap, setSnap] = useState<MatchSnapshot>(() => match.snapshot())
  const [plan, setPlan] = useState<TeamTactics>(() => match.tactics(you))
  const [units, setUnits] = useState<readonly Unit[]>([])
  const [banners, setBanners] = useState<readonly Banner[]>([])
  const [economyOpen, setEconomyOpen] = useState(false)
  const [tacticsOpen, setTacticsOpen] = useState(false)
  /** Crowd/combat debug overlay (spec/13 §4), toggled with backquote. */
  const [debugOn, setDebugOn] = useState(false)
  useEffect(() => {
    view.setDebugOverlay(debugOn)
    return () => view.setDebugOverlay(false)
  }, [view, debugOn])
  const announcer = useRef(new AnnouncerTracker())

  /** Coach-perspective fog bytes (spec/08 §5), read by the 20 Hz fog layer. */
  const fogOfYou = useCallback(() => match.fog(you), [match, you])

  /** Re-read everything the HUD shows from the sim. */
  const refresh = useCallback(() => {
    setSnap(match.snapshot())
    setPlan(match.tactics(you))
    setUnits(match.units())
  }, [match, you])

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
    announcer.current = new AnnouncerTracker()
    return () => view.setPopulation(null)
  }, [view, match, map])

  // HUD refresh at 6 Hz (the renderer advances the sim every frame): run the announcer.
  useEffect(() => {
    const teamName = (s: DraftSide) => (s === "blue" ? draft.blue.name : draft.red.name)
    const id = setInterval(() => {
      const s = match.snapshot()
      const st = match.structures()
      const hp = (sid: string | undefined) => st.find((x) => x.id === sid)?.hp ?? 1
      const fresh = announcer.current.announce(
        s,
        { blue: hp(ancientIds.blue), red: hp(ancientIds.red) },
        teamName,
      )
      if (fresh.length > 0) setBanners((q) => enqueue(q, fresh))
      setSnap(s)
      setPlan(match.tactics(you))
      setUnits(match.units())
    }, 160)
    return () => clearInterval(id)
  }, [match, draft, ancientIds, you])

  const bannerDone = useCallback(
    (bid: number) => setBanners((q) => (q[0]?.id === bid ? q.slice(1) : q)),
    [],
  )

  // Hand off to results shortly after the Ancient falls.
  useEffect(() => {
    if (!snap.winner) return
    const tid = setTimeout(() => {
      // The sim owns the economy history now (final.history); results read it directly.
      dispatch({ _tag: "finished", final: match.snapshot() })
    }, 3500)
    return () => clearTimeout(tid)
  }, [snap.winner, match, dispatch])

  const [callNotice, setCallNotice] = useState<string | null>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Issue a call; a rejected one (cooldown) surfaces as a transient notice. */
  const doCall = useCallback(
    (c: CoachCall) => {
      const ok = match.call(you, c)
      const s = match.snapshot()
      if (!ok && !s.winner) {
        const cd = Math.ceil(s.calls[you].cooldown)
        setCallNotice(cd > 0 ? `Call on cooldown — ${cd}s` : "Call unavailable")
        if (noticeTimer.current) clearTimeout(noticeTimer.current)
        noticeTimer.current = setTimeout(() => setCallNotice(null), 1600)
      } else {
        setCallNotice(null)
      }
      setSnap(s)
    },
    [match, you],
  )

  // Keyboard: 1-5 calls, Space pause, [ ] speed, G economy, T live tactics, ` debug overlay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target !== document.body) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const c = CALLS.find((x) => x.key === e.key)
      if (c) doCall(c.id)
      else if (e.key === "g" || e.key === "G") setEconomyOpen((o) => !o)
      else if (e.key === "t" || e.key === "T") setTacticsOpen((o) => !o)
      else if (e.key === "`") setDebugOn((o) => !o)
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
  }, [match, view, doCall])

  const mine = snap.heroes.filter((h) => h.side === you)
  const theirs = snap.heroes.filter((h) => h.side === them)

  return (
    <div className="pointer-events-none absolute inset-0 text-white">
      <Scoreboard snap={snap} draft={draft} you={you} units={units} />
      {callNotice ? (
        <output
          className={cn(
            "absolute top-[4.6rem] left-1/2 z-20 -translate-x-1/2 rounded-sm border border-amber-300/50 bg-black/70 px-2 py-0.5 font-mono text-[11px] tracking-wider text-amber-200",
          )}
          aria-live="polite"
        >
          {callNotice}
        </output>
      ) : null}
      <PhaseChip snap={snap} you={you} />
      {debugOn ? (
        <output className="absolute top-[4.6rem] left-1/2 -translate-x-1/2 rounded-sm border border-amber-300/50 bg-black/60 px-2 py-0.5 font-mono text-[11px] tracking-wider text-amber-200">
          DEBUG · rings · slots · velocity · locks — press ` to hide
        </output>
      ) : null}

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

      {tacticsOpen ? null : <KillFeed feed={snap.feed} heroes={snap.heroes} you={you} />}

      <CommsLog snap={snap} you={you} />

      <div className="absolute bottom-5 left-4 max-md:hidden">
        <WardMap
          map={map}
          snap={snap}
          units={units}
          you={you}
          fog={fogOfYou}
          onFocus={view.focus}
        />
      </div>

      {economyOpen ? (
        <div className="absolute top-[8.4rem] left-1/2 z-10 -translate-x-1/2">
          <EconomyPanel snap={snap} draft={draft} you={you} onClose={() => setEconomyOpen(false)} />
        </div>
      ) : null}

      {tacticsOpen ? (
        <div className="absolute top-24 right-4 z-10">
          <TacticsDrawer
            match={match}
            snap={snap}
            tactics={plan}
            you={you}
            onChange={refresh}
            onClose={() => setTacticsOpen(false)}
          />
        </div>
      ) : null}

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
          <Tooltip label="Economy" shortcut="G">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Economy panel"
              aria-keyshortcuts="G"
              aria-expanded={economyOpen}
              isSelected={economyOpen}
              onPress={() => setEconomyOpen((o) => !o)}
            >
              <ChartLine />
            </Button>
          </Tooltip>
          <Tooltip label="Live tactics" shortcut="T">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Live tactics"
              aria-keyshortcuts="T"
              aria-expanded={tacticsOpen}
              isSelected={tacticsOpen}
              onPress={() => setTacticsOpen((o) => !o)}
            >
              <SlidersHorizontal />
            </Button>
          </Tooltip>
        </Panel>
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
