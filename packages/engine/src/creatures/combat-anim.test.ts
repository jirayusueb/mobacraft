/** spec/13 acceptance 2–3: phase-driven attack animation and debug segment builder. */
import { describe, expect, test } from "bun:test"
import type { CrowdDebug, Unit } from "@mobacraft/sim"
import { MAX_SEGMENTS, buildDebugSegments } from "./debug-overlay.ts"
import { ATTACK_TIME, CANCEL_TIME, createAnimState, stepAnim } from "./motion.ts"

const FRAME = 1 / 60
const unit = (over: Partial<Unit> = {}): Unit => ({
  id: "h1",
  kind: "ironwarden",
  team: "radiant",
  x: 0,
  z: 0,
  heading: 0,
  hp: 1,
  attacks: 0,
  swing: null,
  ...over,
})

/**
 * Drive one swing the way the sim does: 0.1 s ticks, snapshots read once per frame.
 * Returns the animated `attack` per frame and the frame where the point ended.
 */
const playSwing = (opts: {
  point: number
  backswing: number
  timeScale: number
  cancelAfterBackswing?: number
}) => {
  const TICK = 0.1
  const q = (x: number) => Math.ceil(x / TICK - 1e-6) * TICK
  const s = createAnimState(unit())
  const trace: number[] = []
  let game = 0
  let pointEndFrame = -1
  const point = q(opts.point)
  const back = q(opts.backswing)
  const end = opts.cancelAfterBackswing ?? back
  for (let f = 0; f < 600; f++) {
    // Sim time advances in whole ticks only.
    const simGame = Math.floor(game / TICK + 1e-9) * TICK
    let u: Unit
    if (simGame < point)
      u = unit({ attacks: 1, swing: "point", swingT: simGame / point, swingDur: point })
    else if (simGame < point + end)
      u = unit({ attacks: 1, swing: "backswing", swingT: (simGame - point) / back, swingDur: back })
    else u = unit({ attacks: 1, swing: null })
    if (pointEndFrame < 0 && simGame >= point) pointEndFrame = f
    stepAnim(s, u, FRAME, 1, opts.timeScale)
    trace.push(s.attack)
    game += FRAME * opts.timeScale
    if (simGame >= point + end && s.attack >= 1) break
  }
  return { trace, pointEndFrame, s }
}

describe("phase-driven attack animation", () => {
  test("the strike lands (attack = 0.5) exactly when the point completes", () => {
    const { trace, pointEndFrame } = playSwing({ point: 0.3, backswing: 0.5, timeScale: 1 })
    expect(trace[pointEndFrame - 1]!).toBeLessThanOrEqual(0.5)
    expect(trace[pointEndFrame - 1]!).toBeGreaterThan(0.45)
    expect(trace[pointEndFrame]!).toBeGreaterThanOrEqual(0.5)
  })

  test("never steps backwards within a swing at ×8 speed", () => {
    for (const ts of [1, 2, 8]) {
      const { trace } = playSwing({ point: 0.4, backswing: 0.5, timeScale: ts })
      for (let i = 1; i < trace.length; i++) {
        // The only allowed drop is the 1 → 0 restart, which never happens mid-swing here.
        expect(trace[i]!).toBeGreaterThanOrEqual(trace[i - 1]! - 1e-9)
      }
      expect(trace.at(-1)).toBe(1)
    }
  })

  test("a cancelled backswing (orb-walk) returns to rest within CANCEL_TIME + 1 frame", () => {
    const { trace, pointEndFrame } = playSwing({
      point: 0.3,
      backswing: 0.5,
      timeScale: 1,
      cancelAfterBackswing: 0.1,
    })
    // Cancel happens at point + 0.1 s game time = 6 frames after the point at ×1.
    const cancelFrame = pointEndFrame + 6
    const restFrame = trace.findIndex((a, i) => i > cancelFrame && a >= 1)
    expect(restFrame).toBeGreaterThan(0)
    expect((restFrame - cancelFrame) * FRAME).toBeLessThanOrEqual(CANCEL_TIME + 2 * FRAME)
    // Much sooner than a natural backswing would have finished.
    expect((restFrame - cancelFrame) * FRAME).toBeLessThan(0.4)
  })

  test("pause freezes the swing", () => {
    const s = createAnimState(unit())
    stepAnim(s, unit({ attacks: 1, swing: "point", swingT: 0.2, swingDur: 0.3 }), FRAME, 1, 1)
    const before = s.attack
    for (let i = 0; i < 60; i++)
      stepAnim(s, unit({ attacks: 1, swing: "point", swingT: 0.2, swingDur: 0.3 }), FRAME, 1, 0)
    expect(s.attack).toBe(before)
  })

  test("units without phase data keep the fixed clip", () => {
    const s = createAnimState(unit({ swing: undefined }))
    stepAnim(s, unit({ swing: undefined, attacks: 1 }), FRAME, 1)
    expect(s.attack).toBeLessThan(0.1)
    for (let t = 0; t < ATTACK_TIME + 0.1; t += FRAME)
      stepAnim(s, unit({ swing: undefined, attacks: 1 }), FRAME, 1)
    expect(s.attack).toBe(1)
  })

  test("a swing that began and ended between frames still plays the clip", () => {
    const s = createAnimState(unit())
    expect(s.attack).toBe(1)
    stepAnim(s, unit({ attacks: 1, swing: null }), FRAME, 1, 8)
    // Restarted this frame, then advanced by one ×8 frame of game time.
    expect(s.attack).toBeCloseTo((FRAME * 8) / ATTACK_TIME, 6)
  })
})

describe("debug overlay segments", () => {
  const d: CrowdDebug = {
    rings: [
      {
        targetId: "t",
        x: 10,
        z: 10,
        r1: 1.1,
        r2: 1.95,
        slots: [
          { x: 11.1, z: 10, ring: 1, holder: { x: 11, z: 10 } },
          { x: 8.9, z: 10, ring: 1 },
        ],
      },
    ],
    units: [
      {
        x: 11,
        z: 10,
        radius: 0.4,
        vx: 0,
        vz: 0,
        pvx: 0,
        pvz: 0,
        mode: "locked",
        swing: "point",
        yielding: false,
      },
      {
        x: 5,
        z: 5,
        radius: 0.4,
        vx: 1,
        vz: 0,
        pvx: 2,
        pvz: 0,
        mode: "free",
        swing: null,
        yielding: true,
      },
    ],
  }

  test("counts: 2 circles × 24 + 2 slot crosses × 2 + locked ring 24 + yield ring 24 + 2 vectors", () => {
    const pos = new Float32Array(MAX_SEGMENTS * 6)
    const col = new Float32Array(MAX_SEGMENTS * 6)
    const n = buildDebugSegments(d, () => 0, pos, col)
    expect(n).toBe(48 + 4 + 24 + 24 + 2)
    // Held slot is green, free slot grey (first cross segment colours).
    const slotStart = 48
    expect(col[slotStart * 6 + 1]).toBeCloseTo(1)
    expect(col[(slotStart + 2) * 6 + 1]).toBeCloseTo(0.45)
  })

  test("truncates at the cap instead of overflowing", () => {
    const pos = new Float32Array(10 * 6)
    const col = new Float32Array(10 * 6)
    expect(buildDebugSegments(d, () => 0, pos, col, 10)).toBe(10)
  })
})
