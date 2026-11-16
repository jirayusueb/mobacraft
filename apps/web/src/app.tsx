import { DEFAULT_SPEC, generateMap } from "@mobacraft/map"
import { Button, Panel } from "@mobacraft/ui"
import { RefreshCw, TriangleAlert } from "lucide-react"
import { useRef } from "react"
import { Hud } from "./hud/hud.tsx"
import { t } from "./strings.ts"
import { useMapView } from "./use-map-view.ts"

// Composition root: the map is data, built once; the engine renders it.
const map = generateMap(DEFAULT_SPEC)

/** Little isometric island that bobs while the renderer warms up. */
const IslandMark = () => (
  <svg viewBox="0 0 64 64" className="size-16 drop-shadow-[0_8px_16px_rgba(0,0,0,0.5)]" aria-hidden>
    <path d="M32 14 56 28 32 42 8 28Z" fill="#7cc35a" />
    <path d="M8 28 32 42v8L8 36Z" fill="#6b4a2f" />
    <path d="M56 28 32 42v8l24-14Z" fill="#4f3522" />
    <path d="M32 21 44 28 32 35 20 28Z" fill="#c9b48a" opacity=".9" />
    <path d="M18 24l3-7 3 7-3 1.5Z" fill="#3f8f3a" />
    <path d="M42 22l3-7 3 7-3 1.5Z" fill="#c75b2a" />
    <path d="M30 26h4v-6l-2-2-2 2Z" fill="#f2efe6" />
  </svg>
)

const Loader = () => (
  <div
    aria-live="polite"
    aria-busy
    className="absolute inset-0 grid animate-in place-items-center duration-500 fade-in motion-reduce:animate-none"
  >
    <div className="flex flex-col items-center text-center">
      <div className="animate-[bob_2.4s_ease-in-out_infinite] motion-reduce:animate-none">
        <IslandMark />
      </div>
      <p className="mt-5 text-[11px] font-semibold tracking-[0.25em] text-white/40 uppercase">
        {t("app.name")}
      </p>
      <h1 className="mt-1 text-2xl font-semibold tracking-[-0.02em] text-white">
        {t("hud.title")}
      </h1>
      <div className="mt-5 h-1 w-40 overflow-hidden rounded-full bg-white/10">
        <div className="h-full w-1/3 animate-[sweep_1.4s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-radiant/0 via-radiant to-radiant/0 motion-reduce:w-full motion-reduce:animate-none motion-reduce:opacity-50" />
      </div>
      <p className="mt-3 text-xs text-white/55">{t("hud.loading")}</p>
    </div>
  </div>
)

const Failure = ({ message }: { message: string }) => (
  <div className="absolute inset-0 grid animate-in place-items-center p-6 duration-300 fade-in">
    <Panel role="alert" className="w-full max-w-md p-6">
      <div className="flex items-start gap-3.5">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-dire/15 text-dire ring-1 ring-dire/25 ring-inset">
          <TriangleAlert className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <h1 className="text-base font-semibold tracking-tight text-white">{t("hud.failed")}</h1>
          <p className="mt-1.5 text-[13px] leading-relaxed text-white/65">{t("hud.failed.body")}</p>
        </div>
      </div>
      <details className="group mt-4 rounded-xl border border-white/10 bg-black/30">
        <summary className="cursor-pointer list-none rounded-xl px-3 py-2 text-xs font-medium text-white/70 outline-none hover:text-white focus-visible:ring-2 focus-visible:ring-sky-300/90">
          <span className="mr-1.5 inline-block transition-transform group-open:rotate-90">›</span>
          {t("hud.failed.details")}
        </summary>
        <pre className="max-h-48 overflow-auto px-3 pb-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-white/50">
          {message}
        </pre>
      </details>
      <div className="mt-5 flex justify-end">
        <Button size="sm" className="h-9 px-4" onPress={() => window.location.reload()}>
          <RefreshCw className="size-3.5!" aria-hidden />
          {t("hud.failed.retry")}
        </Button>
      </div>
    </Panel>
  </div>
)

export const App = () => {
  const canvas = useRef<HTMLCanvasElement>(null)
  const status = useMapView(canvas, map)

  return (
    <main className="relative h-full w-full bg-[radial-gradient(ellipse_at_center,#20262a_0%,#15181a_70%)]">
      <canvas
        ref={canvas}
        className={`block size-full transition-opacity duration-700 motion-reduce:transition-none ${status._tag === "ready" ? "opacity-100" : "opacity-0"}`}
        aria-label="Map view"
      />
      {status._tag === "ready" ? <Hud map={map} view={status.view} state={status.state} /> : null}
      {status._tag === "loading" ? <Loader /> : null}
      {status._tag === "failed" ? <Failure message={status.message} /> : null}
    </main>
  )
}
