import { describe, expect, test } from "bun:test"
import { generateMap } from "@mobacraft/map"
import {
  TEAMS,
  aiChoose,
  applyDraft,
  createDraft,
  createMatch,
  isComplete,
  type DraftState,
} from "../index.ts"

const map = generateMap()

const autoDraft = (a = 0, b = 1): DraftState => {
  let d = createDraft(TEAMS[a]!, TEAMS[b]!)
  while (!isComplete(d)) {
    const r = applyDraft(d, aiChoose(d))
    if (!r.ok) throw new Error(r.error)
    d = r.state
  }
  return d
}

describe("coach call legibility (playtest fix #1)", () => {
  test("a roshan call pays off in the feed: Aegis line + call-paid-off line", () => {
    // The AI decides whether to answer the call, so which seed pays off drifts with
    // balance patches — try a few seeds and call for both sides.
    let paid = false
    let m: ReturnType<typeof createMatch> | undefined
    for (const seed of [1, 3, 5, 7, 11]) {
      m = createMatch(map, autoDraft(), { seed })
      while (m.time() < 30 * 60 && !m.snapshot().winner) {
        const s = m.snapshot()
        for (const side of ["blue", "red"] as const)
          if (s.roshanAlive && s.calls[side].cooldown === 0) m.call(side, "roshan")
        m.advance(1)
        if (
          m.snapshot().feed.some((f) => f.kind === "roshan" && f.text.startsWith("Call paid off"))
        ) {
          paid = true
          break
        }
      }
      if (paid) break
    }
    expect(paid).toBe(true)
    const feed = m!.snapshot().feed
    expect(
      feed.some((f) => f.kind === "roshan" && f.text.startsWith("Call paid off: Roshan down")),
    ).toBe(true)
    expect(feed.some((f) => f.kind === "aegis" && f.text.startsWith("Aegis picked up: "))).toBe(
      true,
    )
    expect(feed.some((f) => f.kind === "aegis" && /\(.+\)$/.test(f.text))).toBe(true)
  }, 60_000)

  test("a push call pays off in the tower feed line", () => {
    // Multi-seed like the Roshan test above: the sim is seeded, but float
    // trig (Math.hypot/sin/cos) varies across platforms, so a single seed's
    // fight outcomes are not portable. Any seed paying off proves the link.
    let m: ReturnType<typeof createMatch> | null = null
    let paid = false
    for (const seed of [1, 2, 3]) {
      const cand = createMatch(map, autoDraft(), { seed })
      while (cand.time() < 8 * 60) {
        const s = cand.snapshot()
        if (s.calls.blue.cooldown === 0 && !s.calls.blue.active) cand.call("blue", "push")
        cand.advance(1)
        if (s.feed.some((f) => f.kind === "tower" && f.text.includes("Call paid off"))) {
          paid = true
          break
        }
      }
      if (paid) {
        m = cand
        break
      }
    }
    expect(paid).toBe(true)
    const towers = m!.snapshot().feed.filter((f) => f.kind === "tower")
    expect(towers.length).toBeGreaterThan(0)
    expect(
      towers.some((f) => f.text.includes("Call paid off") && f.text.includes("tower falls")),
    ).toBe(true)
  }, 120_000)

  test("every accepted call emits exactly one aoe ping fx and an ack comms entry", () => {
    const m = createMatch(map, autoDraft(), { seed: 2 })
    while (m.time() < 300) m.advance(0.25)
    for (const c of ["group", "safe", "farm"] as const) {
      m.fx() // drain
      expect(m.call("blue", c)).toBe(true)
      const pings = m.fx().filter((e) => e.kind === "aoe" && e.radius === 1.2)
      expect(pings).toHaveLength(1)
      while (m.snapshot().calls.blue.cooldown > 0) m.advance(0.25)
    }
    // Roshan ping requires Roshan alive; push needs a vulnerable tower — both hold early.
    m.fx()
    if (m.snapshot().roshanAlive) {
      expect(m.call("blue", "roshan")).toBe(true)
      expect(m.fx().filter((e) => e.kind === "aoe" && e.radius === 1.2)).toHaveLength(1)
      while (m.snapshot().calls.blue.cooldown > 0) m.advance(0.25)
    }
    m.fx()
    expect(m.call("blue", "push")).toBe(true)
    expect(m.fx().filter((e) => e.kind === "aoe" && e.radius === 1.2)).toHaveLength(1)
    // Every accepted call is acknowledged in comms.
    const acks = m
      .snapshot()
      .comms.filter((e) => e.side === "blue" && e.from === "coach" && e.text.startsWith("Coach → "))
    expect(acks.length).toBeGreaterThanOrEqual(4)
    expect(acks[0]!.text).toMatch(/^Coach → .+ \(IGL\): /)
  }, 60_000)
})
