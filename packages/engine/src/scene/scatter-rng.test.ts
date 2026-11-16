import { describe, expect, test } from "bun:test"
import { ScatterRng } from "./scatter-rng.ts"

/** The closure this class replaced; the sequence must not drift (map visuals depend on it). */
const legacy = (seed: number) => {
  let s = (seed * 2654435761) >>> 0
  return () => (s = (Math.imul(s ^ (s >>> 15), 2246822519) + 1) >>> 0) / 4294967296
}

describe("ScatterRng", () => {
  test("matches the legacy sequence and stays in [0, 1)", () => {
    for (const seed of [0, 7, 101, 1337]) {
      const a = new ScatterRng(seed)
      const b = legacy(seed)
      for (let i = 0; i < 200; i++) {
        const v = a.next()
        expect(v).toBe(b())
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThan(1)
      }
    }
  })
})
