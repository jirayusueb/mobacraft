import { drawMinimap, type ViewState } from "@mobacraft/engine"
import type { MobaMap } from "@mobacraft/map"
import { useEffect, useRef } from "react"
import { t } from "../strings.ts"

const PX = 176

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

  const k = PX / map.size
  const w = Math.min(PX * 2, state.viewExtent.halfWidth * 2 * k)
  const h = Math.min(PX * 2, state.viewExtent.halfHeight * 2 * k)

  const pick = (e: React.PointerEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    onFocus(
      ((e.clientX - r.left) / r.width) * map.size,
      ((e.clientY - r.top) / r.height) * map.size,
    )
  }

  return (
    <div className="rounded-2xl border border-white/12 bg-black/45 p-1.5 shadow-lg shadow-black/30 backdrop-blur-md">
      <button
        type="button"
        aria-label={t("hud.minimap")}
        className="relative block cursor-crosshair overflow-hidden rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-white/70"
        style={{ width: PX, height: PX }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          pick(e)
        }}
        onPointerMove={(e) => {
          if (e.buttons & 1) pick(e)
        }}
      >
        <canvas ref={canvas} className="size-full" style={{ imageRendering: "pixelated" }} />
        <div
          className="pointer-events-none absolute rounded-sm border-[1.5px] border-white shadow-[0_0_0_1px_rgba(0,0,0,0.4)]"
          style={{
            width: w,
            height: h,
            left: state.focus.x * k,
            top: state.focus.z * k,
            // Screen-right on the ground is (cos yaw, -sin yaw) → minimap angle -yaw.
            transform: `translate(-50%, -50%) rotate(${-state.yaw}rad)`,
          }}
        />
      </button>
    </div>
  )
}
