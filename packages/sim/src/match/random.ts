/** Seeded RNG for the match (mulberry32). All match randomness flows through one stream. */
import { Rng } from "@mobacraft/map"

export type Random = Rng

export const createRandom = (seed: number): Random => new Rng(seed)
