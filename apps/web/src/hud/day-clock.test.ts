import { describe, expect, test } from "bun:test"
import { DAY_MS, DayClock } from "./day-clock.ts"

describe("DayClock", () => {
  test("advances by elapsed fraction of a day", () => {
    const c = new DayClock(0.25, 1000)
    expect(c.tick(1000 + DAY_MS / 4)).toBe(0)
    expect(c.timeOfDay).toBeCloseTo(0.5, 9)
  })

  test("wraps past midnight and reports new days", () => {
    const c = new DayClock(0.9, 0)
    expect(c.tick(DAY_MS * 0.2)).toBe(1)
    expect(c.timeOfDay).toBeCloseTo(0.1, 9)
  })
})
