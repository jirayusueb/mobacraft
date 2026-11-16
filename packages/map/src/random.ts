/** Seeded PRNG (mulberry32). Same seed → same sequence on every platform. */
export const createRng = (seed: number) => {
  let a = seed >>> 0
  return (): number => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const hash2 = (seed: number, x: number, y: number): number => {
  let h = (seed ^ Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1)) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

const smooth = (t: number) => t * t * (3 - 2 * t)

/** Value noise in [0,1], fractal over `octaves`. */
export const createNoise = (seed: number) => {
  const value = (x: number, y: number) => {
    const xi = Math.floor(x)
    const yi = Math.floor(y)
    const tx = smooth(x - xi)
    const ty = smooth(y - yi)
    const a = hash2(seed, xi, yi)
    const b = hash2(seed, xi + 1, yi)
    const c = hash2(seed, xi, yi + 1)
    const d = hash2(seed, xi + 1, yi + 1)
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty
  }
  return (x: number, y: number, octaves = 3): number => {
    let sum = 0
    let amp = 1
    let norm = 0
    let freq = 1
    for (let o = 0; o < octaves; o++) {
      sum += value(x * freq, y * freq) * amp
      norm += amp
      amp *= 0.5
      freq *= 2
    }
    return sum / norm
  }
}
