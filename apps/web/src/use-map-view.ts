import { MapView, type MapViewShape, type ViewState } from "@mobacraft/engine"
import type { MobaMap } from "@mobacraft/map"
import { Cause, Effect, Fiber, Stream } from "effect"
import { type RefObject, useEffect, useState } from "react"

export type MapViewStatus =
  | { readonly _tag: "loading" }
  | { readonly _tag: "ready"; readonly view: MapViewShape; readonly state: ViewState }
  | { readonly _tag: "failed"; readonly message: string }

/**
 * React ↔ Effect bridge. One fiber per mounted canvas: it builds the MapView
 * layer and streams state into React. Unmount (and StrictMode's double-invoke)
 * interrupts the fiber; the layer's scope then disposes renderer, listeners
 * and loop in one step.
 */
export const useMapView = (
  canvasRef: RefObject<HTMLCanvasElement | null>,
  map: MobaMap,
): MapViewStatus => {
  const [status, setStatus] = useState<MapViewStatus>({ _tag: "loading" })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const program = Effect.gen(function* () {
      const view = yield* MapView
      yield* Stream.runForEach(view.state, (state) =>
        Effect.sync(() => setStatus({ _tag: "ready", view, state })),
      )
    }).pipe(
      Effect.provide(MapView.layer(canvas, map)),
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.void
          : Effect.sync(() => setStatus({ _tag: "failed", message: Cause.pretty(cause) })),
      ),
    )

    const fiber = Effect.runFork(program)
    return () => {
      Effect.runFork(Fiber.interrupt(fiber))
    }
  }, [canvasRef, map])

  return status
}
