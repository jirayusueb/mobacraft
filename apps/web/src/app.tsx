import { DEFAULT_SPEC, generateMap } from "@mobacraft/map"
import { useRef } from "react"
import { Hud } from "./hud/hud.tsx"
import { t } from "./strings.ts"
import { useMapView } from "./use-map-view.ts"

// Composition root: the map is data, built once; the engine renders it.
const map = generateMap(DEFAULT_SPEC)

export const App = () => {
  const canvas = useRef<HTMLCanvasElement>(null)
  const status = useMapView(canvas, map)

  return (
    <main className="relative h-full w-full bg-[radial-gradient(ellipse_at_center,#20262a_0%,#15181a_70%)]">
      <canvas ref={canvas} className="block size-full" aria-label="Map view" />
      {status._tag === "ready" ? <Hud map={map} view={status.view} state={status.state} /> : null}
      {status._tag === "loading" ? (
        <div className="absolute inset-0 grid place-items-center text-sm text-white/60">
          {t("hud.loading")}
        </div>
      ) : null}
      {status._tag === "failed" ? (
        <div className="absolute inset-0 grid place-items-center p-8 text-center text-sm text-white/80">
          <div>
            <p className="font-semibold">{t("hud.failed")}</p>
            <pre className="mt-3 max-w-xl overflow-auto text-left text-xs whitespace-pre-wrap text-white/50">
              {status.message}
            </pre>
          </div>
        </div>
      ) : null}
    </main>
  )
}
