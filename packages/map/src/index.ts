/**
 * @mobacraft/map — the map as data.
 *
 * Interface: `generateMap(spec) → MobaMap`. Pure, deterministic, no rendering,
 * no Effect, no DOM. Everything downstream (renderer, pathing, minimap, server)
 * reads the same `MobaMap`.
 */
export { DEFAULT_SPEC, generateMap } from "./generate.ts"
export * from "./types.ts"
