/**
 * MapView — the engine's one external seam.
 *
 * Interface:
 *   MapView.layer(canvas, map)  → Layer<MapView, RendererInitError>
 *   yield* MapView              → { state, rotate, zoomBy, home, focus, select, setTimeOfDay }
 *
 * Invariants callers can rely on:
 *   - The layer's scope owns everything: closing it stops the frame loop, removes
 *     every DOM listener and disposes all GPU resources. Nothing else to clean up.
 *   - All commands are synchronous, never fail, and are safe to call every frame.
 *   - `state` emits only when something a HUD would show has changed.
 *   - Input (drag pan, wheel zoom-to-cursor, Q/E rotate, WASD/arrows pan, click
 *     select, hover) is handled internally; callers do not wire pointer events.
 */
import type { MobaMap } from "@mobacraft/map"
import { Context, Effect, Layer, Stream, SubscriptionRef } from "effect"
import { WebGPURenderer } from "three/webgpu"
import { CREATURE_NAME, type Population } from "@mobacraft/sim"
import { CameraRig } from "./camera-rig.ts"
import { FpsMeter, HeldKeys } from "./input-state.ts"
import { RendererInitError } from "./errors.ts"
import { createWorld, type Picked } from "./world.ts"

export type Backend = "webgpu" | "webgl2"

export interface ViewState {
  readonly backend: Backend
  /** Camera look-at point in map tiles — drives the minimap viewport marker. */
  readonly focus: { readonly x: number; readonly z: number }
  /** Camera yaw, radians. Screen-right on the ground is (cos yaw, -sin yaw). */
  readonly yaw: number
  readonly zoom: number
  /** Map-space half extents of the visible area (for the minimap rectangle). */
  readonly viewExtent: { readonly halfWidth: number; readonly halfHeight: number }
  /** 0..1 over a day; 0.5 is noon. */
  readonly timeOfDay: number
  readonly phase: "Night" | "Dawn" | "Daytime" | "Dusk"
  readonly hovered: Picked | null
  readonly selected: Picked | null
  readonly fps: number
  readonly drawCalls: number
}

export interface MapViewShape {
  readonly state: Stream.Stream<ViewState>
  readonly rotate: (dir: 1 | -1) => void
  readonly zoomBy: (factor: number) => void
  readonly home: () => void
  readonly focus: (x: number, z: number) => void
  readonly select: (id: string | null) => void
  readonly setTimeOfDay: (t: number) => void
  /**
   * Swap the units on the map. `null` = explore mode (ambient creeps).
   * The caller owns the Population; MapView only reads it each frame
   * (advance → units → fx → structures).
   */
  readonly setPopulation: (population: Population | null) => void
  readonly setHealthBars: (on: boolean) => void
  /** Crowd/combat debug overlay: rings, slots, velocities, locks (spec/13 §4). */
  readonly setDebugOverlay: (on: boolean) => void
}

const same = (a: Picked | null, b: Picked | null) => a?.id === b?.id

const changed = (a: ViewState, b: ViewState) =>
  Math.abs(a.focus.x - b.focus.x) > 0.05 ||
  Math.abs(a.focus.z - b.focus.z) > 0.05 ||
  Math.abs(a.yaw - b.yaw) > 0.002 ||
  Math.abs(a.zoom - b.zoom) > 0.002 ||
  Math.abs(a.timeOfDay - b.timeOfDay) > 1e-4 ||
  a.phase !== b.phase ||
  !same(a.hovered, b.hovered) ||
  !same(a.selected, b.selected) ||
  a.fps !== b.fps ||
  a.drawCalls !== b.drawCalls

const makeRenderer = (canvas: HTMLCanvasElement) =>
  Effect.acquireRelease(
    Effect.tryPromise({
      try: async () => {
        const renderer = new WebGPURenderer({
          canvas,
          antialias: true,
          powerPreference: "high-performance",
        })
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
        await renderer.init()
        return renderer
      },
      catch: (cause) => new RendererInitError({ cause }),
    }),
    (renderer) => Effect.sync(() => renderer.dispose()),
  )

/** Registers a DOM listener for the lifetime of the current scope. */
const listen = <K extends keyof HTMLElementEventMap>(
  target: HTMLElement | Window,
  type: K,
  handler: (e: HTMLElementEventMap[K]) => void,
  options?: AddEventListenerOptions,
) =>
  Effect.acquireRelease(
    Effect.sync(() => target.addEventListener(type, handler as EventListener, options)),
    () => Effect.sync(() => target.removeEventListener(type, handler as EventListener, options)),
  )

export class MapView extends Context.Service<MapView, MapViewShape>()("@mobacraft/engine/MapView") {
  static layer(canvas: HTMLCanvasElement, map: MobaMap): Layer.Layer<MapView, RendererInitError> {
    return Layer.effect(MapView, make(canvas, map))
  }
}

const make = Effect.fnUntraced(function* (canvas: HTMLCanvasElement, map: MobaMap) {
  const renderer = yield* makeRenderer(canvas)
  const backend: Backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend
    ? "webgpu"
    : "webgl2"

  const world = yield* Effect.acquireRelease(
    Effect.sync(() => createWorld(renderer, map)),
    (w) => Effect.sync(() => w.dispose()),
  )
  const rig = new CameraRig({
    size: map.size,
    home: { x: map.size / 2, z: map.size / 2, zoom: 0.62 },
  })

  // Mutable frame-local state; published to `ref` at most once per frame.
  const local = {
    timeOfDay: 0.42,
    phase: world.setTimeOfDay(0.42),
    hovered: null as Picked | null,
    selected: null as Picked | null,
    fps: 60,
    drawCalls: 0,
  }

  const snapshot = (): ViewState => {
    const pose = rig.pose()
    const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight)
    return {
      backend,
      focus: pose.target,
      yaw: pose.yaw,
      zoom: pose.zoom,
      viewExtent: {
        halfWidth: pose.halfHeight * aspect,
        halfHeight: pose.halfHeight / Math.max(0.3, pose.back.y),
      },
      timeOfDay: local.timeOfDay,
      phase: local.phase,
      hovered: local.hovered,
      selected: local.selected,
      fps: local.fps,
      drawCalls: local.drawCalls,
    }
  }
  const ref = yield* SubscriptionRef.make(snapshot())
  let published = snapshot()

  // --- size ------------------------------------------------------------------
  const resize = () => world.setSize(canvas.clientWidth, canvas.clientHeight)
  resize()
  const observer = yield* Effect.acquireRelease(
    Effect.sync(() => {
      const o = new ResizeObserver(resize)
      o.observe(canvas)
      return o
    }),
    (o) => Effect.sync(() => o.disconnect()),
  )
  void observer

  // --- input -----------------------------------------------------------------
  const ndc = (e: { clientX: number; clientY: number }) => {
    const r = canvas.getBoundingClientRect()
    return {
      x: ((e.clientX - r.left) / r.width) * 2 - 1,
      y: -((e.clientY - r.top) / r.height) * 2 + 1,
    }
  }
  let drag: { x: number; y: number; moved: number } | null = null
  /** Creature id the camera is tracking, if any. */
  let following: string | null = null
  const keys = new HeldKeys()

  yield* listen(canvas, "pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId)
    drag = { x: e.clientX, y: e.clientY, moved: 0 }
  })
  yield* listen(canvas, "pointermove", (e) => {
    if (drag) {
      const dx = e.clientX - drag.x
      const dy = e.clientY - drag.y
      drag = { x: e.clientX, y: e.clientY, moved: drag.moved + Math.abs(dx) + Math.abs(dy) }
      if (drag.moved > 4) {
        following = null
        rig.panPixels(dx, dy, canvas.clientHeight)
      }
      canvas.style.cursor = drag.moved > 4 ? "grabbing" : canvas.style.cursor
    } else {
      const p = ndc(e)
      local.hovered = world.pick(p.x, p.y)
      canvas.style.cursor = local.hovered ? "pointer" : "grab"
    }
  })
  yield* listen(canvas, "pointerup", (e) => {
    if (drag && drag.moved <= 4) {
      const p = ndc(e)
      const hit = world.pick(p.x, p.y)
      local.selected = hit
      following = hit && world.unitById(hit.id) ? hit.id : null
      world.highlight(hit?.id ?? null)
    }
    if (drag && drag.moved > 4) rig.release()
    drag = null
    canvas.style.cursor = "grab"
  })
  yield* listen(
    canvas,
    "wheel",
    (e) => {
      e.preventDefault()
      const factor = Math.exp(-e.deltaY * 0.0015)
      // Zoom toward the cursor: nudge focus toward the ground point under it.
      const p = ndc(e)
      const g = world.groundAt(p.x, p.y)
      const t = rig.pose().target
      if (g && factor > 1)
        rig.focus(t.x + (g.x - t.x) * (1 - 1 / factor), t.z + (g.z - t.z) * (1 - 1 / factor))
      rig.zoomBy(factor)
    },
    { passive: false },
  )
  yield* listen(window, "keydown", (e) => {
    // HUD widgets own the keyboard while focused (react-aria sliders use arrows).
    if (e.target !== document.body && e.target !== canvas) return
    if (e.key === "q" || e.key === "Q") rig.rotate(-1)
    else if (e.key === "e" || e.key === "E") rig.rotate(1)
    else if (e.key === "h" || e.key === "H") rig.home()
    else keys.press(e.key)
  })
  yield* listen(window, "keyup", (e) => keys.release(e.key))
  yield* listen(window, "blur", () => keys.clear())

  // --- frame loop --------------------------------------------------------------
  let last = performance.now()
  const meter = new FpsMeter()
  const frame = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000)
    last = now

    const pan = 40 * dt * (1 / rig.pose().zoom)
    const { right, up } = keys.panAxes()
    if (right || up) rig.panScreen(right * pan, up * pan)

    world.tick(dt)
    // Follow a selected creature until the user pans away.
    if (following) {
      const c = world.unitById(following)
      if (c) rig.focus(c.x, c.z)
      else following = null
    }
    rig.update(dt)
    world.applyPose(rig.pose())
    world.render()

    if (meter.tick(dt)) {
      local.fps = meter.fps
      local.drawCalls = world.stats().calls
    }

    const next = snapshot()
    if (changed(published, next)) {
      published = next
      Effect.runSync(SubscriptionRef.set(ref, next))
    }
  }
  yield* Effect.acquireRelease(
    Effect.sync(() => renderer.setAnimationLoop(frame)),
    () => Effect.sync(() => renderer.setAnimationLoop(null)),
  )
  canvas.style.cursor = "grab"
  canvas.style.touchAction = "none"

  return MapView.of({
    state: SubscriptionRef.changes(ref),
    rotate: (dir) => rig.rotate(dir),
    zoomBy: (factor) => rig.zoomBy(factor),
    home: () => rig.home(),
    focus: (x, z) => rig.focus(x, z),
    select: (id) => {
      const unit = id ? world.unitById(id) : undefined
      if (id && unit) {
        local.selected = {
          id,
          kind: unit.kind,
          team: unit.team,
          name: unit.label ?? CREATURE_NAME[unit.kind as keyof typeof CREATURE_NAME] ?? unit.kind,
        }
        following = id
        world.highlight(id)
        return
      }
      following = null
      const s =
        id === null
          ? null
          : (map.structures.find((x) => x.id === id) ??
            map.camps.find((x) => x.id === id) ??
            map.landmarks.find((x) => x.id === id))
      local.selected = s ? { id: s.id, kind: s.kind, team: "team" in s ? s.team : "neutral" } : null
      world.highlight(local.selected?.id ?? null)
      if (s) rig.focus(s.position.x, s.position.z)
    },
    setPopulation: (p) => {
      following = null
      local.selected = null
      local.hovered = null
      world.setPopulation(p)
    },
    setHealthBars: (on) => world.setHealthBars(on),
    setDebugOverlay: (on) => world.setDebugOverlay(on),
    setTimeOfDay: (t) => {
      local.timeOfDay = ((t % 1) + 1) % 1
      local.phase = world.setTimeOfDay(local.timeOfDay)
    },
  })
})
