/**
 * Cheap seeded PRNG for decorative scatter (foliage, ambient motes) so placement
 * is stable per map. Not the sim's RNG — visuals only; sequence must stay fixed.
 */
export class ScatterRng {
  #s: number

  constructor(seed: number) {
    this.#s = (seed * 2654435761) >>> 0
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.#s = (Math.imul(this.#s ^ (this.#s >>> 15), 2246822519) + 1) >>> 0
    return this.#s / 4294967296
  }
}
