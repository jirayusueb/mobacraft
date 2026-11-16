import type { MapViewShape, ViewState } from "@mobacraft/engine"
import type { MobaMap } from "@mobacraft/map"
import { Button, Separator, Slider, Toolbar, Tooltip } from "@mobacraft/ui"
import {
  Activity,
  Castle,
  Crown,
  House,
  Minus,
  Moon,
  Pause,
  Play,
  Plus,
  RotateCcw,
  RotateCw,
  Skull,
  Sun,
  Sunrise,
  Sunset,
  X,
} from "lucide-react"
import { useEffect, useState } from "react"
import { KIND_BLURB, KIND_LABEL, t } from "../strings.ts"
import { Minimap } from "./minimap.tsx"

const PHASE_ICON = { Night: Moon, Dawn: Sunrise, Daytime: Sun, Dusk: Sunset } as const

const clock = (tod: number) => {
  const minutes = Math.round(tod * 24 * 60) % (24 * 60)
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`
}

const teamClass = (team: string) =>
  team === "radiant" ? "text-radiant" : team === "dire" ? "text-dire" : "text-neutral-team"

export const Hud = ({
  map,
  view,
  state,
}: {
  map: MobaMap
  view: MapViewShape
  state: ViewState
}) => {
  // `null` = paused; otherwise the time of day the cycle started from.
  const [cycleFrom, setCycleFrom] = useState<number | null>(null)
  const cycling = cycleFrom !== null
  const [stats, setStats] = useState(false)

  // Day cycle: one full day per 90 s while playing.
  useEffect(() => {
    if (cycleFrom === null) return
    let tod = cycleFrom
    let last = performance.now()
    let raf = requestAnimationFrame(function tick(now) {
      tod = (tod + (now - last) / 90_000) % 1
      last = now
      view.setTimeOfDay(tod)
      raf = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(raf)
  }, [cycleFrom, view])

  const focusOn = (pred: (x: (typeof map.structures)[number]) => boolean) => {
    const found = map.structures.find(pred)
    if (found) view.select(found.id)
  }
  const PhaseIcon = PHASE_ICON[state.phase]
  const card = state.selected ?? state.hovered

  return (
    <div className="pointer-events-none absolute inset-0 select-none text-white">
      {/* top-left: title, like Quack's island name */}
      <div className="absolute top-6 left-7 drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]">
        <h1 className="text-xl font-semibold tracking-tight">{t("hud.title")}</h1>
        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-white/70">
          <PhaseIcon className="size-3.5" aria-hidden />
          {t("hud.subtitle.season")} · {state.phase} · {clock(state.timeOfDay)}
        </p>
      </div>

      {/* top-right: minimap */}
      <div className="pointer-events-auto absolute top-5 right-5">
        <Minimap map={map} state={state} onFocus={view.focus} />
      </div>

      {/* right: selection card */}
      {card ? (
        <div className="pointer-events-auto absolute top-[228px] right-5 w-[188px] rounded-2xl border border-white/12 bg-black/55 p-3.5 shadow-lg backdrop-blur-md">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p
                className={`text-[11px] font-semibold uppercase tracking-wider ${teamClass(card.team)}`}
              >
                {card.team}
              </p>
              <p className="text-sm font-semibold">{KIND_LABEL[card.kind] ?? card.kind}</p>
            </div>
            {state.selected ? (
              <Button
                variant="ghost"
                size="sm"
                className="-mr-2 -mt-1 size-7 px-0"
                aria-label="Clear selection"
                onPress={() => view.select(null)}
              >
                <X />
              </Button>
            ) : null}
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-white/70">
            {KIND_BLURB[card.kind] ?? ""}
          </p>
        </div>
      ) : null}

      {/* bottom-left: jump-to pills */}
      <div className="pointer-events-auto absolute bottom-6 left-6 flex gap-2">
        <Tooltip label={t("hud.focus.radiant")}>
          <Button
            aria-label={t("hud.focus.radiant")}
            onPress={() => focusOn((s) => s.kind === "ancient" && s.team === "radiant")}
          >
            <Crown className="text-radiant" /> Radiant
          </Button>
        </Tooltip>
        <Tooltip label={t("hud.focus.dire")}>
          <Button
            aria-label={t("hud.focus.dire")}
            onPress={() => focusOn((s) => s.kind === "ancient" && s.team === "dire")}
          >
            <Castle className="text-dire" /> Dire
          </Button>
        </Tooltip>
        <Tooltip label={t("hud.focus.roshan")}>
          <Button
            size="icon-lg"
            aria-label={t("hud.focus.roshan")}
            onPress={() => view.select("roshan")}
          >
            <Skull />
          </Button>
        </Tooltip>
      </div>

      {/* bottom-centre: time of day */}
      <div className="pointer-events-auto absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/12 bg-black/45 py-1 pr-5 pl-1 shadow-lg shadow-black/30 backdrop-blur-md">
        <Tooltip label={cycling ? t("hud.time.pause") : t("hud.time.play")}>
          <Button
            variant="ghost"
            size="icon"
            aria-label={cycling ? t("hud.time.pause") : t("hud.time.play")}
            onPress={() => setCycleFrom(cycling ? null : state.timeOfDay)}
          >
            {cycling ? <Pause /> : <Play />}
          </Button>
        </Tooltip>
        <Slider
          aria-label={t("hud.time")}
          className="w-44"
          minValue={0}
          maxValue={24}
          step={0.25}
          value={state.timeOfDay * 24}
          formatOptions={{ maximumFractionDigits: 2 }}
          onChange={(h) => {
            setCycleFrom(null)
            view.setTimeOfDay(h / 24)
          }}
        />
        <PhaseIcon className="ml-2 size-[18px] text-white/80" aria-hidden />
        <Separator />
        <Tooltip label={t("hud.stats")}>
          <Button
            variant="ghost"
            size="icon"
            isSelected={stats}
            aria-label={t("hud.stats")}
            onPress={() => setStats((s) => !s)}
          >
            <Activity />
          </Button>
        </Tooltip>
      </div>

      {/* bottom-right: camera, like Quack's undo/redo/home/zoom pill */}
      <Toolbar aria-label="Camera" className="pointer-events-auto absolute right-6 bottom-6">
        <Tooltip label={t("hud.rotate.left")} shortcut="Q">
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("hud.rotate.left")}
            onPress={() => view.rotate(-1)}
          >
            <RotateCcw />
          </Button>
        </Tooltip>
        <Tooltip label={t("hud.rotate.right")} shortcut="E">
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("hud.rotate.right")}
            onPress={() => view.rotate(1)}
          >
            <RotateCw />
          </Button>
        </Tooltip>
        <Tooltip label={t("hud.home")} shortcut="H">
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("hud.home")}
            onPress={() => view.home()}
          >
            <House />
          </Button>
        </Tooltip>
        <Separator />
        <Tooltip label={t("hud.zoom.out")}>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("hud.zoom.out")}
            onPress={() => view.zoomBy(1 / 1.35)}
          >
            <Minus />
          </Button>
        </Tooltip>
        <Tooltip label={t("hud.zoom.in")}>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("hud.zoom.in")}
            onPress={() => view.zoomBy(1.35)}
          >
            <Plus />
          </Button>
        </Tooltip>
      </Toolbar>

      {stats ? (
        <div className="absolute top-24 left-7 rounded-lg bg-black/55 px-2.5 py-1.5 font-mono text-[11px] text-white/80 backdrop-blur">
          {state.backend.toUpperCase()} · {state.fps} fps · {state.drawCalls} draws
        </div>
      ) : null}

      <p className="absolute bottom-[84px] left-1/2 -translate-x-1/2 text-[11px] text-white/45">
        {t("hud.help")}
      </p>
    </div>
  )
}
