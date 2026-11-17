import { describe, expect, test } from "bun:test"
import { FpsMeter, HeldKeys } from "./input-state.ts"

describe("HeldKeys", () => {
  test("pan axes combine WASD and arrows, case-insensitive", () => {
    const k = new HeldKeys()
    expect(k.panAxes()).toEqual({ right: 0, up: 0 })
    k.press("D")
    k.press("ArrowUp")
    expect(k.panAxes()).toEqual({ right: 1, up: 1 })
    k.press("a")
    expect(k.panAxes().right).toBe(0)
    k.release("d")
    expect(k.panAxes().right).toBe(-1)
    k.clear()
    expect(k.panAxes()).toEqual({ right: 0, up: 0 })
  })
})

describe("debug overlay hotkey", () => {
  test("backquote (spec/13 overlay toggle) never pans the camera", () => {
    const k = new HeldKeys()
    k.press("`")
    expect(k.panAxes()).toEqual({ right: 0, up: 0 })
  })
})

describe("FpsMeter", () => {
  test("reports once per window", () => {
    const m = new FpsMeter(0.5)
    expect(m.fps).toBe(60)
    let ready = 0
    for (let i = 0; i < 16; i++) if (m.tick(1 / 32)) ready++
    expect(ready).toBe(1)
    expect(m.fps).toBe(32)
  })
})
