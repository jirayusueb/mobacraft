import { drawMinimap, type ViewState } from "@mobacraft/engine"
import type { MobaMap } from "@mobacraft/map"
import { Panel } from "@mobacraft/ui"
import { useEffect, useRef } from "react"
import { t } from "../strings.ts"

/** Static map painted once by the engine; the viewport marker is a CSS overlay driven by ViewState. */
export const Minimap = ({
  map,
  state,
  onFocus,
}: {
  map: MobaMap
  state: ViewState
  onFocus: (x: number, z: number) => void
}) => {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (canvas.current) drawMinimap(map, canvas.current, 2)
  }, [map])

  // Everything is laid out in % of the map so the frame can resize responsively.
  const pct = (v: number) => `${(v / map.size) * 100}%`
  const w = Math.min(200, ((state.viewExtent.halfWidth * 2) / map.size) * 100)
  const h = Math.min(200, ((state.viewExtent.halfHeight * 2) / map.size) * 100)

  const pick = (e: React.PointerEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const clamp = (v: number) => Math.min(map.size, Math.max(0, v))
    onFocus(
      clamp(((e.clientX - r.left) / r.width) * map.size),
      clamp(((e.clientY - r.top) / r.height) * map.size),
    )
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const step = e.shiftKey ? map.size / 8 : map.size / 32
    const d: Record<string, readonly [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }
    const delta = d[e.key]
    if (!delta) return
    e.preventDefault()
    const clamp = (v: number) => Math.min(map.size, Math.max(0, v))
    onFocus(clamp(state.focus.x + delta[0]), clamp(state.focus.z + delta[1]))
  }

  return (
    <Panel className="group/minimap relative p-1.5 max-lg:rounded-xl max-lg:p-1">
      <button
        type="button"
        aria-label={t("hud.minimap")}
        aria-describedby="minimap-hint"
        className="relative block size-44 cursor-crosshair touch-none overflow-hidden rounded-[11px] outline-none ring-1 ring-black/40 transition-shadow focus-visible:ring-2 focus-visible:ring-sky-300/90 max-lg:size-32 max-lg:rounded-lg"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          pick(e)
        }}
        onPointerMove={(e) => {
          if (e.buttons & 1) pick(e)
        }}
        onKeyDown={onKeyDown}
      >
        <canvas
          ref={canvas}
          className="size-full saturate-[0.9]"
          style={{ imageRendering: "pixelated" }}
        />
        {/* soft vignette for depth */}
        <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_18px_rgba(0,0,0,0.45)]" />
        <div
          className="pointer-events-none absolute rounded-[3px] border-[1.5px] border-white bg-white/10 shadow-[0_0_0_1px_rgba(0,0,0,0.45)] transition-[left,top] duration-75 motion-reduce:transition-none"
          style={{
            width: `${w}%`,
            height: `${h}%`,
            left: pct(state.focus.x),
            top: pct(state.focus.z),
            // Screen-right on the ground is (cos yaw, -sin yaw) → minimap angle -yaw.
            transform: `translate(-50%, -50%) rotate(${-state.yaw}rad)`,
          }}
        />
        {/* camera focus point — always visible, even when the viewport covers the whole map */}
        <span
          className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-[1.5px] border-white bg-sky-400 shadow-[0_0_0_2px_rgba(0,0,0,0.35)]"
          style={{ left: pct(state.focus.x), top: pct(state.focus.z) }}
        />
        {/* team corner labels */}
        <span className="pointer-events-none absolute top-1.5 right-1.5 rounded-full bg-black/55 px-1.5 py-px text-[9px] font-semibold tracking-wider text-dire uppercase backdrop-blur-sm max-lg:hidden">
          {t("team.dire")}
        </span>
        <span className="pointer-events-none absolute bottom-1.5 left-1.5 rounded-full bg-black/55 px-1.5 py-px text-[9px] font-semibold tracking-wider text-radiant uppercase backdrop-blur-sm max-lg:hidden">
          {t("team.radiant")}
        </span>
      </button>
      <span id="minimap-hint" className="sr-only">
        {t("hud.minimap.hint")}
      </span>
      {/* north marker */}
      <span
        aria-hidden
        className="pointer-events-none absolute -top-2 left-1/2 flex size-4 -translate-x-1/2 items-center justify-center rounded-full border border-white/15 bg-neutral-950/85 text-[8px] leading-none font-bold text-white/90 shadow"
      >
        N
      </span>
    </Panel>
  )
}
