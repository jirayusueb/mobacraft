/**
 * @mobacraft/sim — creatures as data: who exists, where, facing where, doing what.
 * Pure and deterministic; the engine renders snapshots, a future server can run it headless.
 */
export * from "./kinds.ts"
export { type Creature, type CreepSim, type SimOptions, createCreepSim } from "./sim.ts"
