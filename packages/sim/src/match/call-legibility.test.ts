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
    const m = createMatch(map, autoDraft(), { seed: 1 })
    let paid = false
    while (m.time() < 30 * 60 && !m.snapshot().winner) {
      const s = m.snapshot()
      if (s.roshanAlive && s.calls.blue.cooldown === 0) m.call("blue", "roshan")
      m.advance(1)
      if (
        m.snapshot().feed.some((f) => f.kind === "roshan" && f.text.startsWith("Call paid off"))
      ) {
        paid = true
        break
      }
    }
    expect(paid).toBe(true)
    const feed = m.snapshot().feed
    expect(
      feed.some((f) => f.kind === "roshan" && f.text.startsWith("Call paid off: Roshan down")),
    ).toBe(true)
    expect(feed.some((f) => f.kind === "aegis" && f.text.startsWith("Aegis picked up: "))).toBe(
      true,
    )
    expect(feed.some((f) => f.kind === "aegis" && /\(.+\)$/.test(f.text))).toBe(true)
  }, 60_000)

  test("a push call pays off in the tower feed line", () => {
    const m = createMatch(map, autoDraft(), { seed: 1 })
    let paid = false
    while (m.time() < 8 * 60) {
      const s = m.snapshot()
      if (s.calls.blue.cooldown === 0 && !s.calls.blue.active) m.call("blue", "push")
      m.advance(1)
      if (s.feed.some((f) => f.kind === "tower" && f.text.includes("Call paid off"))) {
        paid = true
        break
      }
    }
    expect(paid).toBe(true)
    const towers = m.snapshot().feed.filter((f) => f.kind === "tower")
    expect(towers.length).toBeGreaterThan(0)
    expect(
      towers.some((f) => f.text.includes("Call paid off") && f.text.includes("tower falls")),
    ).toBe(true)
  }, 60_000)

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
