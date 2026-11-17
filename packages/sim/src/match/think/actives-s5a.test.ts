import { describe, expect, test } from "bun:test"
import { type ActiveId, type ActiveView, defensiveTrigger, tangoTrigger } from "./combat.ts"

const view = (over: Partial<ActiveView> = {}): ActiveView => ({
  hpPct: 0.9,
  stunned: false,
  ready: new Set<ActiveId>(),
  sinceHeroDamage: 10,
  incomingProjectile: Infinity,
  enemiesClose: 0,
  enemiesNear: 1,
  role: "carry",
  fightStart: false,
  ...over,
})

describe("self-cleanse actives (spec/10 S5a)", () => {
  test("rooted with an enemy near → Manta dispels", () => {
    expect(defensiveTrigger(view({ rooted: true, ready: new Set(["manta"]) }))).toEqual({
      item: "manta",
    })
  })

  test("Manta is preferred over Eul's; Eul's covers when Manta is down", () => {
    const both = new Set<ActiveId>(["manta", "eul"])
    expect(defensiveTrigger(view({ rooted: true, ready: both }))?.item).toBe("manta")
    expect(defensiveTrigger(view({ rooted: true, ready: new Set(["eul"]) }))?.item).toBe("eul")
  })

  test("no cleanse when nobody is around to follow up, or while stunned", () => {
    const r = new Set<ActiveId>(["manta"])
    expect(defensiveTrigger(view({ rooted: true, enemiesNear: 0, ready: r }))).toBeNull()
    expect(defensiveTrigger(view({ rooted: true, stunned: true, ready: r }))).toBeNull()
  })

  test("existing spec/09 triggers unchanged when not rooted", () => {
    const r = new Set<ActiveId>(["bkb"])
    expect(defensiveTrigger(view({ fightStart: true, enemiesNear: 2, ready: r }))?.item).toBe("bkb")
    expect(defensiveTrigger(view({ ready: new Set(["manta"]) }))).toBeNull()
  })
})

describe("Tango (spec/10 S5a)", () => {
  test("eats only when ≥ 115 HP missing, a charge is left and no tango is running", () => {
    expect(tangoTrigger({ hp: 500, maxHp: 600, charges: 3, regenLeft: 0 })).toBeFalse()
    expect(tangoTrigger({ hp: 485, maxHp: 600, charges: 3, regenLeft: 0 })).toBeTrue()
    expect(tangoTrigger({ hp: 300, maxHp: 600, charges: 0, regenLeft: 0 })).toBeFalse()
    expect(tangoTrigger({ hp: 300, maxHp: 600, charges: 2, regenLeft: 4 })).toBeFalse()
  })
})
