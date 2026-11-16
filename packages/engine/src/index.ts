/**
 * @mobacraft/engine — renders a MobaMap as an isometric diorama with three.js WebGPU.
 *
 * External seam: the `MapView` service (see map-view.ts for the full interface).
 * Everything else here is either pure (camera rig, sky) or used by MapView only.
 */
export { RendererInitError } from "./errors.ts"
export { MapView, type Backend, type MapViewShape, type ViewState } from "./map-view.ts"
export { drawMinimap } from "./minimap.ts"
export type { Picked } from "./world.ts"
