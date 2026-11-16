import type { ViewState } from "@mobacraft/engine"
import type { MobaMap } from "@mobacraft/map"
import { Moon, Sun, Sunrise, Sunset } from "lucide-react"
import { t } from "../strings.ts"

export const PHASE_ICON = { Night: Moon, Dawn: Sunrise, Daytime: Sun, Dusk: Sunset } as const

export const clock = (tod: number) => {
  const minutes = Math.round(tod * 24 * 60) % (24 * 60)
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`
}

const shadow = "[text-shadow:0_1px_2px_rgba(0,0,0,0.55),0_0_12px_rgba(0,0,0,0.25)]"

/** Top-left: island name + "Day 2 · Summer · Daytime" line + team legend, like Quack. */
export const TitleBlock = ({
  map,
  state,
  day,
}: {
  map: MobaMap
  state: ViewState
  day: number
}) => {
  const PhaseIcon = PHASE_ICON[state.phase]
  const towers = (team: "radiant" | "dire") =>
    map.structures.filter((s) => s.kind === "tower" && s.team === team).length
  return (
    <header className={`max-w-[60vw] ${shadow}`}>
      <h1 className="text-[22px] leading-7 font-semibold tracking-[-0.02em] text-white max-md:text-lg">
        {t("hud.title")}
      </h1>
      <p className="mt-0.5 flex items-center gap-1.5 text-[12.5px] font-medium text-white/70">
        <PhaseIcon className="size-3.5 text-amber-200/90" aria-hidden />
        <span>
          {t("hud.subtitle.day")} {day}
        </span>
        <span aria-hidden className="text-white/35">
          ·
        </span>
        <span>{t("hud.subtitle.season")}</span>
        <span aria-hidden className="text-white/35">
          ·
        </span>
        <span>{state.phase}</span>
        <span aria-hidden className="text-white/35">
          ·
        </span>
        <time className="tabular-nums">{clock(state.timeOfDay)}</time>
      </p>
      <div className="mt-3 inline-flex items-center gap-2.5 rounded-full border border-white/10 bg-neutral-950/45 py-1 pr-3 pl-1 text-[11px] font-semibold [text-shadow:none] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-xl max-md:hidden">
        <span className="sr-only">{t("hud.legend")}:</span>
        <span className="flex items-center gap-1.5 rounded-full bg-radiant/15 py-0.5 pr-2 pl-1.5 text-radiant">
          <span className="size-1.5 rounded-full bg-radiant shadow-[0_0_6px] shadow-radiant" />
          {t("team.radiant")}
          <span className="text-white/90 tabular-nums">{towers("radiant")}</span>
        </span>
        <span className="text-[10px] font-medium tracking-widest text-white/40 uppercase">vs</span>
        <span className="flex items-center gap-1.5 text-dire">
          <span className="text-white/90 tabular-nums">{towers("dire")}</span>
          {t("team.dire")}
          <span className="size-1.5 rounded-full bg-dire shadow-[0_0_6px] shadow-dire" />
        </span>
      </div>
    </header>
  )
}
