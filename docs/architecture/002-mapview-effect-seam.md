# ADR 002: One Effect service, `MapView`, is the renderer's only seam

- Date: 2026-11-16
- Status: Accepted

## Context

WebGPU init is async and fallible, GPU resources must be disposed, DOM listeners
removed and the rAF loop stopped — and React StrictMode mounts twice.

## Decision

`MapView.layer(canvas, map)` acquires renderer → world → listeners → loop with
`Effect.acquireRelease`, so the layer's `Scope` owns every resource. Callers get
a small command surface plus `state: Stream<ViewState>`. React runs one fiber
per canvas and interrupts it on unmount.

## Alternatives considered

- React-three-fiber: couples scene lifetime to React reconciliation; harder to
  reuse the renderer outside React, and WebGPU support is still catching up.
- Imperative class with `dispose()`: every caller must remember ordering.

## Consequences

Teardown is one interrupt. Picking returns map ids, never three objects. Pure
internals (camera rig, sky curve) are unit-tested; the WebGPU path is verified
by screenshot. `WebGPURenderer` falls back to WebGL2 automatically; the backend
is reported in `ViewState.backend`.
