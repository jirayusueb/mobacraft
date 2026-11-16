/**
 * @mobacraft/sim — creatures as data: who exists, where, facing where, doing what.
 * Pure and deterministic; the engine renders snapshots, a future server can run it headless.
 */
export * from "./kinds.ts"
export {
  type Creature,
  type CreepSim,
  type SimOptions,
  createCreepSim,
  creepPopulation,
} from "./sim.ts"
export * from "./population.ts"
export * from "./match/heroes.ts"
export * from "./match/teams.ts"
export * from "./match/items.ts"
export * from "./match/draft.ts"
export * from "./match/match.ts"
export * from "./match/matrix.ts"
export * from "./match/tactics.ts"
export * from "./match/vision.ts"
export * from "./match/fog.ts"
export * from "./match/knowledge.ts"
export * as respawn from "./match/respawn/index.ts"
export * from "./match/inventory.ts"
