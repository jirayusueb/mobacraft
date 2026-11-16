import { describe, expect, test } from "bun:test"
import { createRig } from "./camera-rig.ts"
import { skyAt } from "./sky.ts"

const settle = (rig: ReturnType<typeof createRig>) => {
  for (let i = 0; i < 600; i++) rig.update(1 / 60)
}

describe("camera rig", () => {
  test("starts at home, looking at the map centre", () => {
    const rig = createRig({ size: 128 })
    expect(rig.pose().target).toEqual({ x: 64, z: 64 })
  })

  test("rotate is a 90° quarter turn and wraps", () => {
    const rig = createRig({ size: 128 })
    const before = rig.pose().yaw
    rig.rotate(1)
    settle(rig)
    expect(rig.pose().yaw - before).toBeCloseTo(Math.PI / 2, 3)
    rig.rotate(-1)
    rig.rotate(-1)
    expect(rig.turn()).toBe(3)
  })

  test("zoom is clamped", () => {
    const rig = createRig({ size: 128, minZoom: 0.5, maxZoom: 2 })
    for (let i = 0; i < 50; i++) rig.zoomBy(1.5)
    settle(rig)
    expect(rig.pose().zoom).toBeCloseTo(2, 3)
  })

  test("pan is clamped to the map and follows yaw", () => {
    const rig = createRig({ size: 128 })
    rig.panScreen(1000, 0)
    settle(rig)
    const { x, z } = rig.pose().target
    expect(x).toBeLessThanOrEqual(128)
    expect(z).toBeGreaterThanOrEqual(0)

    // Same screen pan after a half turn moves the opposite way in the world.
    const a = createRig({ size: 128 })
    const b = createRig({ size: 128 })
    b.rotate(1)
    b.rotate(1)
    a.panScreen(5, 0)
    b.panScreen(5, 0)
    settle(a)
    settle(b)
    expect(a.pose().target.x - 64).toBeCloseTo(-(b.pose().target.x - 64), 3)
  })

  test("camera always sits above the ground", () => {
    expect(createRig({ size: 128 }).pose().back.y).toBeGreaterThan(0.3)
  })
})

describe("sky", () => {
  test("noon is bright day, midnight is night", () => {
    expect(skyAt(0.5).label).toBe("Daytime")
    expect(skyAt(0).label).toBe("Night")
    expect(skyAt(0.5).sunIntensity).toBeGreaterThan(skyAt(0).sunIntensity)
  })

  test("sun always lights from above", () => {
    for (let t = 0; t < 1; t += 0.05) expect(skyAt(t).sunDir.y).toBeGreaterThan(0)
  })
})
