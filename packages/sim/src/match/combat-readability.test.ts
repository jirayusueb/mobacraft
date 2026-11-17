/** spec/13 acceptance 1: per-hero swing timing, swing phase on units, crowd debug data. */
import { describe, expect, test } from "bun:test"
import { generateMap } from "@mobacraft/map"
import { swingTiming } from "./attack-phase.ts"
import { HEROES } from "./heroes.ts"
import { HERO_SWING, SHAPE_SWING, heroSwing } from "./swing-timing.ts"
import {
  TEAMS,
  aiChoose,
  applyDraft,
  createDraft,
  createMatch,
  isComplete,
  type DraftState,
} from "../index.ts"

const draft = (): DraftState => {
  let d = createDraft(TEAMS[0]!, TEAMS[1]!)
  while (!isComplete(d)) {
    const r = applyDraft(d, aiChoose(d))
    if (!r.ok) throw new Error(r.error)
    d = r.state
  }
  return d
}

describe("per-hero swing timing", () => {
  test("shape default, hero override, and every hero fits inside its BAT", () => {
    const iron = HEROES.find((h) => h.id === "ironwarden")!
    expect(heroSwing(iron)).toEqual(SHAPE_SWING.knight)
    const dusk = HEROES.find((h) => h.id === "duskblade")!
    expect(heroSwing(dusk)).toEqual({ point: HERO_SWING.duskblade!.point!, backswing: 0.4 })
    for (const h of HEROES) {
      const b = heroSwing(h)
      expect(b.point + b.backswing).toBeLessThanOrEqual(h.attackTime)
      // At attack speed 1 the authored values survive the BAT cap unchanged.
      expect(swingTiming("hero", h.attackTime, 1, b)).toEqual(b)
    }
  })

  test("attack speed scales the authored timing and the BAT cap still holds", () => {
    const t = swingTiming("hero", 1.2, 3, { point: 0.45, backswing: 0.5 })
    expect(t.point).toBeCloseTo(0.15)
    expect(t.point + t.backswing).toBeLessThanOrEqual(1.2 / 3 + 1e-9)
  })
})

describe("swing phase on the seam + debug overlay data", () => {
  test("units report phase/progress consistent with swings; debug lists rings and locks", () => {
    const m = createMatch(generateMap(), draft(), { seed: 7, aiCoach: ["blue", "red"] })
    let sawPoint = false
    let sawBackswing = false
    let sawRingHeld = false
    let sawLocked = false
    for (let i = 0; i < 1200 && !(sawPoint && sawBackswing && sawRingHeld && sawLocked); i++) {
      m.advance(0.1)
      for (const u of m.units()) {
        if (u.swing === undefined) continue
        if (u.swing === "point" || u.swing === "backswing") {
          expect(u.swingT!).toBeGreaterThanOrEqual(0)
          expect(u.swingT!).toBeLessThanOrEqual(1)
          expect(u.swingDur!).toBeGreaterThan(0)
        }
        if (u.swing === "point") sawPoint = true
        if (u.swing === "backswing") sawBackswing = true
      }
      if (i % 10 === 0) {
        const d = m.debug()
        if (d.rings.some((r) => r.slots.some((s) => s.holder))) sawRingHeld = true
        if (d.units.some((u) => u.mode === "locked" && u.swing !== null)) sawLocked = true
        for (const r of d.rings) {
          expect(r.r2).toBeGreaterThan(r.r1)
          expect(r.slots.filter((s) => s.ring === 1).length).toBeGreaterThanOrEqual(4)
        }
      }
    }
    expect(sawPoint).toBe(true)
    expect(sawBackswing).toBe(true)
    expect(sawRingHeld).toBe(true)
    expect(sawLocked).toBe(true)
  }, 60_000)
})
