import { describe, expect, test } from "bun:test"
import { advanceCourier, courierBusy, createCourier, dispatchCourier } from "./courier.ts"

const HOME = { x: 0, z: 0 }

describe("courier (spec/10 S3)", () => {
  test("idle at base until dispatched", () => {
    const c = createCourier("blue", HOME)
    expect(courierBusy(c)).toBeFalse()
    expect(dispatchCourier(c, "hero-blue-0", { x: 30, z: 0 }, [])).toBeFalse()
    expect(dispatchCourier(c, "hero-blue-0", { x: 30, z: 0 }, ["steel"])).toBeTrue()
    expect(courierBusy(c)).toBeTrue()
  })

  test("one run at a time — a busy courier refuses a second load", () => {
    const c = createCourier("blue", HOME)
    dispatchCourier(c, "hero-blue-0", { x: 5, z: 0 }, ["steel"])
    expect(dispatchCourier(c, "hero-blue-1", { x: 6, z: 0 }, ["orb"])).toBeFalse()
  })

  test("delivery takes flight time and returns the cargo once", () => {
    const c = createCourier("blue", HOME)
    dispatchCourier(c, "hero-blue-0", { x: 11, z: 0 }, ["steel", "orb"])
    // 11 tiles at 5.5 t/s ≈ 2 s; nothing delivered before that.
    expect(advanceCourier(c, { x: 11, z: 0 }, HOME, 1)).toEqual([])
    const delivered = advanceCourier(c, { x: 11, z: 0 }, HOME, 1.5)
    expect(delivered).toEqual(["steel", "orb"])
    expect(advanceCourier(c, { x: 11, z: 0 }, HOME, 0.1)).toEqual([])
    // Now flying home.
    expect(c.returning).toBeTrue()
    expect(advanceCourier(c, null, HOME, 10)).toEqual([])
    expect(courierBusy(c)).toBeFalse()
  })

  test("courier tracks a moving hero and waits when the hero dies", () => {
    const c = createCourier("red", HOME)
    dispatchCourier(c, "hero-red-2", { x: 0, z: 0 }, ["plate"])
    advanceCourier(c, { x: 20, z: 0 }, HOME, 1) // hero ran
    expect(advanceCourier(c, null, HOME, 5)).toEqual([]) // dead: hover, no delivery
    expect(c.cargo).toEqual(["plate"])
    const at = { x: 20, z: 4 }
    for (let i = 0; i < 12; i++) advanceCourier(c, at, HOME, 1)
    expect(c.cargo).toEqual([]) // delivered after respawn
  })
})
