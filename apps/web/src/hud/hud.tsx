import type { MapViewShape, ViewState } from "@mobacraft/engine"
import type { MobaMap } from "@mobacraft/map"
import { Button, cn, Panel, Separator, Slider, ToggleButton, Toolbar, Tooltip } from "@mobacraft/ui"
import {
  Activity,
  Gem,
  House,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  RotateCw,
  Skull,
  Swords,
} from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { t } from "../strings.ts"
import { HoverChip, SelectedCard } from "./entity-card.tsx"
import { creatureEntity, indexEntities } from "./entity.ts"
import { HelpPopover } from "./help-popover.tsx"
import { Minimap } from "./minimap.tsx"
import { clock, PHASE_ICON, TitleBlock } from "./title-block.tsx"
import { usePresence } from "./use-presence.ts"

const ZOOM_STEP = 1.35
const MIN_ZOOM = 0.35
const MAX_ZOOM = 4

/** Day-to-night track: deep night → dawn → noon → dusk → night, for the slider. */
const SKY_GRADIENT =
  "linear-gradient(90deg,#1e2547 0%,#2d3566 18%,#d98a5f 26%,#f3d58a 36%,#cfe7f5 50%,#f3d58a 64%,#e07a52 74%,#2d3566 82%,#1e2547 100%)"

/** Keys the HUD owns. Like the engine, only act when no HUD widget has focus. */
const fromWorld = (e: KeyboardEvent) =>
  e.target === document.body || (e.target instanceof HTMLCanvasElement && !e.defaultPrevented)

export const Hud = ({
  map,
  view,
  state,
  onMatchDay,
}: {
  map: MobaMap
  view: MapViewShape
  state: ViewState
  /** Opens the Match Day flow (team pick → draft → match). */
  onMatchDay: () => void
}) => {
  // `null` = paused; otherwise the time of day the cycle started from.
  const [cycleFrom, setCycleFrom] = useState<number | null>(null)
  const cycling = cycleFrom !== null
  const [stats, setStats] = useState(false)
  const [help, setHelp] = useState(false)
  const [day, setDay] = useState(2)
  const entities = useMemo(() => indexEntities(map), [map])

  // Day cycle: one full day per 90 s while playing; wrapping past midnight starts a new day.
  useEffect(() => {
    if (cycleFrom === null) return
    let tod = cycleFrom
    let last = performance.now()
    let raf = requestAnimationFrame(function tick(now) {
      const next = tod + (now - last) / 90_000
      if (next >= 1) setDay((d) => d + 1)
      tod = next % 1
      last = now
      view.setTimeOfDay(tod)
      raf = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(raf)
  }, [cycleFrom, view])

  const togglePlay = () => setCycleFrom((c) => (c === null ? state.timeOfDay : null))

  // HUD shortcuts (camera keys Q/E/H/WASD are handled by the engine).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || !fromWorld(e)) return
      if (e.key === "Escape") view.select(null)
      else if (e.key === "?") setHelp((h) => !h)
      else if (e.key === "t" || e.key === "T") togglePlay()
      else if (e.key === "+" || e.key === "=") view.zoomBy(ZOOM_STEP)
      else if (e.key === "-" || e.key === "_") view.zoomBy(1 / ZOOM_STEP)
      else return
      e.preventDefault()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  // Creature entities are built on demand; memoise per picked id so identity is
  // stable across renders (usePresence compares by reference).
  const sel = state.selected
  const hov = state.hovered
  const selectedEntity = useMemo(
    () => (sel ? (entities.get(sel.id) ?? creatureEntity(sel)) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by id: picks are value objects
    [entities, sel?.id],
  )
  const hoveredLookup = useMemo(
    () => (hov ? (entities.get(hov.id) ?? creatureEntity(hov)) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by id: picks are value objects
    [entities, hov?.id],
  )
  const selected = usePresence(selectedEntity)
  const hoveredEntity = hov && hov.id !== sel?.id ? hoveredLookup : null
  const PhaseIcon = PHASE_ICON[state.phase]
  const ancient = (team: "radiant" | "dire") =>
    map.structures.find((s) => s.kind === "ancient" && s.team === team)?.id ?? null

  return (
    <div className="pointer-events-none absolute inset-0 text-white select-none">
      {/* top-left: title, like Quack's island name */}
      <div className="absolute top-6 left-7 max-md:top-4 max-md:left-4">
        <TitleBlock map={map} state={state} day={day} />
        {stats ? (
          <Panel className="mt-3 inline-flex animate-in items-center gap-2 rounded-full px-3 py-1 font-mono text-[11px] text-white/80 tabular-nums duration-150 fade-in motion-reduce:animate-none">
            <span className="size-1.5 rounded-full bg-emerald-400" aria-hidden />
            {state.backend.toUpperCase()} · {state.fps} fps · {state.drawCalls} draws
          </Panel>
        ) : null}
      </div>

      {/* top-centre: transient hover chip */}
      <div className="absolute top-6 left-1/2 -translate-x-1/2 max-md:hidden">
        {hoveredEntity ? <HoverChip key={hoveredEntity.id} entity={hoveredEntity} /> : null}
      </div>

      {/* top-right: minimap, then the pinned selection card */}
      <div className="absolute top-5 right-5 flex flex-col items-end gap-3 max-md:top-4 max-md:right-4">
        <div className="pointer-events-auto">
          <Minimap map={map} state={state} onFocus={view.focus} />
        </div>
        {selected.value ? (
          <div className="pointer-events-auto">
            <SelectedCard
              key={selected.value.id}
              entity={selected.value}
              exiting={selected.exiting}
              onClose={() => view.select(null)}
              onCenter={() => {
                const p = selected.value?.position
                if (p) view.focus(p.x, p.z)
              }}
            />
          </div>
        ) : null}
      </div>

      {/* top-right under the minimap stack is busy; Match Day lives bottom-left, above the jump pill */}
      <div className="pointer-events-auto absolute bottom-[84px] left-6 max-md:bottom-[72px] max-md:left-4">
        <Button
          className="h-11 gap-2 rounded-full bg-amber-300/90 px-5 text-sm font-semibold text-black shadow-lg shadow-black/40 hover:bg-amber-200"
          onPress={onMatchDay}
        >
          <Swords className="size-4!" aria-hidden /> Match Day
        </Button>
      </div>
      {/* bottom-left: jump-to pill, like Quack's Build pill */}
      <Toolbar
        aria-label={t("hud.jump")}
        className="pointer-events-auto absolute bottom-6 left-6 max-md:bottom-4 max-md:left-4"
      >
        <Tooltip label={t("hud.focus.radiant")}>
          <Button
            variant="ghost"
            className="h-10 px-4 max-lg:w-10 max-lg:px-0"
            aria-label={t("hud.focus.radiant")}
            onPress={() => view.select(ancient("radiant"))}
          >
            <Gem className="text-radiant" aria-hidden />
            <span className="max-lg:hidden">{t("team.radiant")}</span>
          </Button>
        </Tooltip>
        <Tooltip label={t("hud.focus.dire")}>
          <Button
            variant="ghost"
            className="h-10 px-4 max-lg:w-10 max-lg:px-0"
            aria-label={t("hud.focus.dire")}
            onPress={() => view.select(ancient("dire"))}
          >
            <Gem className="text-dire" aria-hidden />
            <span className="max-lg:hidden">{t("team.dire")}</span>
          </Button>
        </Tooltip>
        <Separator />
        <Tooltip label={t("hud.focus.roshan")}>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("hud.focus.roshan")}
            onPress={() => view.select("roshan")}
          >
            <Skull className="text-neutral-team" aria-hidden />
          </Button>
        </Tooltip>
      </Toolbar>

      {/* bottom-centre: time of day */}
      <Toolbar
        aria-label={t("hud.time.group")}
        className="pointer-events-auto absolute bottom-6 left-1/2 -translate-x-1/2 max-md:bottom-4"
      >
        <Tooltip label={cycling ? t("hud.time.pause") : t("hud.time.play")} shortcut="T">
          <ToggleButton
            variant="ghost"
            size="icon"
            aria-label={t("hud.time.play")}
            isSelected={cycling}
            onChange={togglePlay}
          >
            {cycling ? <Pause aria-hidden /> : <Play aria-hidden className="translate-x-px" />}
          </ToggleButton>
        </Tooltip>
        <div className="flex items-center gap-2.5 pr-2 pl-1 max-lg:gap-2 max-lg:pr-1">
          <PhaseIcon
            key={state.phase}
            className="size-[18px] animate-in text-amber-200/90 duration-300 zoom-in-50 motion-reduce:animate-none max-lg:hidden"
            aria-hidden
          />
          <Slider
            aria-label={t("hud.time")}
            className="w-40 max-lg:w-24"
            minValue={0}
            maxValue={24}
            step={0.25}
            value={state.timeOfDay * 24}
            trackBackground={SKY_GRADIENT}
            formatOptions={{ maximumFractionDigits: 2 }}
            onChange={(h) => {
              setCycleFrom(null)
              view.setTimeOfDay(h / 24)
            }}
          />
          <time className="w-10 text-right text-xs font-medium text-white/80 tabular-nums max-lg:hidden">
            {clock(state.timeOfDay)}
          </time>
        </div>
        <Separator />
        <Tooltip label={t("hud.stats")}>
          <ToggleButton
            variant="ghost"
            size="icon"
            aria-label={t("hud.stats")}
            isSelected={stats}
            onChange={setStats}
          >
            <Activity aria-hidden />
          </ToggleButton>
        </Tooltip>
        <HelpPopover isOpen={help} onOpenChange={setHelp} />
      </Toolbar>

      {/* bottom-right: camera, like Quack's undo/redo/home/zoom pill */}
      <Toolbar
        aria-label={t("hud.camera")}
        className="pointer-events-auto absolute right-6 bottom-6 max-md:right-4 max-md:bottom-4"
      >
        <Tooltip label={t("hud.rotate.left")} shortcut="Q">
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("hud.rotate.left")}
            onPress={() => view.rotate(-1)}
          >
            <RotateCcw aria-hidden />
          </Button>
        </Tooltip>
        <Tooltip label={t("hud.rotate.right")} shortcut="E">
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("hud.rotate.right")}
            onPress={() => view.rotate(1)}
          >
            <RotateCw aria-hidden />
          </Button>
        </Tooltip>
        <Tooltip label={t("hud.home")} shortcut="H">
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("hud.home")}
            onPress={() => view.home()}
          >
            <House aria-hidden />
          </Button>
        </Tooltip>
        <Separator />
        <Tooltip label={t("hud.zoom.out")} shortcut="−">
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("hud.zoom.out")}
            isDisabled={state.zoom <= MIN_ZOOM + 0.01}
            onPress={() => view.zoomBy(1 / ZOOM_STEP)}
          >
            <Minus aria-hidden />
          </Button>
        </Tooltip>
        <Tooltip label={t("hud.zoom.in")} shortcut="+">
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("hud.zoom.in")}
            isDisabled={state.zoom >= MAX_ZOOM - 0.01}
            onPress={() => view.zoomBy(ZOOM_STEP)}
          >
            <Plus aria-hidden />
          </Button>
        </Tooltip>
      </Toolbar>
      <span className={cn("sr-only")} aria-live="polite">
        {selected.value && !selected.exiting ? selected.value.name : ""}
      </span>
    </div>
  )
}
