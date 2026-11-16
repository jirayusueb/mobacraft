import { describe, expect, test } from "bun:test"
import { FOG_LERP, blendFog, fogColor, paintFog, targetLight } from "./fog-blend.ts"

describe("fog blend (spec/08 §5)", () => {
  test("states are ordered unexplored < explored < visible", () => {
    expect(targetLight(0)).toBe(0)
    expect(targetLight(1)).toBeGreaterThan(0)
    expect(targetLight(1)).toBeLessThan(targetLight(2))
  })

  test("visible cells read brighter and more transparent than the dark", () => {
    const dark = fogColor(0)
    const lit = fogColor(1)
    expect(lit[0] + lit[1] + lit[2]).toBeGreaterThan((dark[0] + dark[1] + dark[2]) * 5)
    expect(lit[3]).toBeLessThan(dark[3] / 2)
  })

  test("lerp fades gradually, then settles exactly", () => {
    const light = new Float32Array([0])
    const lit = new Uint8Array([2])
    expect(blendFog(light, lit)).toBe(true)
    expect(light[0]).toBeCloseTo(FOG_LERP, 5)
    let frames = 1
    while (blendFog(light, lit)) frames++
    expect(light[0]).toBe(1)
    // 0.15 lerp at 20 Hz settles in ~2 s: a fade, not a pop or a crawl.
    expect(frames).toBeGreaterThan(10)
    expect(frames).toBeLessThan(60)
  })

  test("k = 1 snaps for reduced motion", () => {
    const light = new Float32Array([1, 1])
    expect(blendFog(light, new Uint8Array([0, 1]), 1)).toBe(false)
    expect([...light]).toEqual([0, targetLight(1)])
  })

  test("paint writes the colour ramp into RGBA", () => {
    const rgba = new Uint8ClampedArray(8)
    paintFog(new Float32Array([0, 1]), rgba)
    expect(rgba[3]).toBe(240)
    expect(rgba[7]).toBe(0)
  })
})
