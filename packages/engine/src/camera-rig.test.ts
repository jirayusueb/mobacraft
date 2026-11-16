import { describe, expect, test } from "bun:test"
import { CameraRig } from "./camera-rig.ts"
import { skyAt } from "./sky.ts"

const settle = (rig: CameraRig) => {
  for (let i = 0; i < 600; i++) rig.update(1 / 60)
}

describe("camera rig", () => {
  test("starts at home, looking at the map centre", () => {
    const rig = new CameraRig({ size: 128 })
    expect(rig.pose().target).toEqual({ x: 64, z: 64 })
  })

  test("rotate is a 90° quarter turn and wraps", () => {
    const rig = new CameraRig({ size: 128 })
    const before = rig.pose().yaw
    rig.rotate(1)
    settle(rig)
    expect(rig.pose().yaw - before).toBeCloseTo(Math.PI / 2, 3)
    rig.rotate(-1)
    rig.rotate(-1)
    expect(rig.turn()).toBe(3)
  })

  test("zoom is clamped", () => {
    const rig = new CameraRig({ size: 128, minZoom: 0.5, maxZoom: 2 })
    for (let i = 0; i < 50; i++) rig.zoomBy(1.5)
    settle(rig)
    expect(rig.pose().zoom).toBeCloseTo(2, 3)
  })

  test("pan is clamped to the map and follows yaw", () => {
    const rig = new CameraRig({ size: 128 })
    rig.panScreen(1000, 0)
    settle(rig)
    const { x, z } = rig.pose().target
    expect(x).toBeLessThanOrEqual(128)
    expect(z).toBeGreaterThanOrEqual(0)

    // Same screen pan after a half turn moves the opposite way in the world.
    const a = new CameraRig({ size: 128 })
    const b = new CameraRig({ size: 128 })
    b.rotate(1)
    b.rotate(1)
    a.panScreen(5, 0)
    b.panScreen(5, 0)
    settle(a)
    settle(b)
    expect(a.pose().target.x - 64).toBeCloseTo(-(b.pose().target.x - 64), 3)
  })

  test("a released drag glides on, then stops", () => {
    const rig = new CameraRig({ size: 128 })
    for (let i = 0; i < 5; i++) {
      rig.panPixels(-20, 0, 800)
      rig.update(1 / 60)
    }
    const atRelease = rig.pose().target.x
    rig.release()
    settle(rig)
    const after = rig.pose().target
    expect(Math.abs(after.x - atRelease)).toBeGreaterThan(0.5)
    rig.update(1)
    expect(rig.pose().target.x).toBeCloseTo(after.x, 2)
    expect(rig.pose().target.z).toBeCloseTo(after.z, 2)
  })

  test("pitch flattens as you zoom in", () => {
    const rig = new CameraRig({ size: 128 })
    const far = rig.pose().back.y
    rig.zoomBy(10)
    settle(rig)
    expect(rig.pose().back.y).toBeLessThan(far)
  })

  test("home also resets rotation to the default quarter", () => {
    const rig = new CameraRig({ size: 128 })
    rig.rotate(1)
    rig.home()
    expect(rig.turn()).toBe(0)
  })

  test("camera always sits above the ground", () => {
    expect(new CameraRig({ size: 128 }).pose().back.y).toBeGreaterThan(0.3)
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
