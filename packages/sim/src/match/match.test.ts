import { describe, expect, test } from "bun:test"
import { generateMap } from "@mobacraft/map"
import {
  DRAFT_ORDER,
  HEROES,
  TEAMS,
  aiChoose,
  applyDraft,
  createDraft,
  createMatch,
  heroDef,
  isComplete,
  TIME_WARNING_LEAD,
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

describe("heroes", () => {
  test("20 unique heroes, each with a skill and an ultimate", () => {
    expect(HEROES).toHaveLength(20)
    expect(new Set(HEROES.map((h) => h.id)).size).toBe(20)
    for (const h of HEROES) {
      expect(h.skill.effects.length).toBeGreaterThan(0)
      expect(h.ultimate.cooldown).toBeGreaterThan(h.skill.cooldown)
    }
  })
})

describe("draft", () => {
  test("follows 4 bans then snake picks, 5 heroes per side, no duplicates", () => {
    const d = autoDraft()
    expect(DRAFT_ORDER).toHaveLength(14)
    expect(d.bans).toHaveLength(4)
    expect(d.picks.blue).toHaveLength(5)
    expect(d.picks.red).toHaveLength(5)
    const all = [
      ...d.bans.map((b) => b.heroId),
      ...d.picks.blue.map((p) => p.heroId),
      ...d.picks.red.map((p) => p.heroId),
    ]
    expect(new Set(all).size).toBe(all.length)
    // Every player gets exactly one hero.
    expect(new Set(d.picks.blue.map((p) => p.playerId)).size).toBe(5)
  })

  test("rejects unavailable heroes and actions after completion", () => {
    let d = createDraft(TEAMS[0]!, TEAMS[1]!)
    const first = applyDraft(d, "ironwarden")
    expect(first.ok).toBe(true)
    if (first.ok) d = first.state
    expect(applyDraft(d, "ironwarden")).toEqual({ ok: false, error: "hero-unavailable" })
    expect(applyDraft(autoDraft(), "duskblade")).toEqual({ ok: false, error: "draft-complete" })
  })

  test("AI coach bans the opponent's comfort heroes", () => {
    let d = createDraft(TEAMS[0]!, TEAMS[1]!)
    // Red's first ban targets blue's best hero.
    const r = applyDraft(d, aiChoose(d))
    if (r.ok) d = r.state
    const redBan = aiChoose(d)
    const blueMastery = TEAMS[0]!.players.flatMap((p) => Object.entries(p.mastery))
    expect(blueMastery.some(([id, m]) => id === redBan && m >= 0.8)).toBe(true)
  })
})

describe("match", () => {
  test("plays to a winner with sensible stats", () => {
    const s = createMatch(map, autoDraft(), { seed: 7, aiCoach: ["blue", "red"] }).runToEnd()
    expect(s.winner).not.toBeNull()
    expect(s.time).toBeGreaterThan(8 * 60)
    expect(s.time).toBeLessThan(35 * 60)
    expect(s.kills.blue + s.kills.red).toBeGreaterThan(5)
    const loser = s.winner === "blue" ? "red" : "blue"
    expect(s.towers[s.winner!]).toBeGreaterThan(s.towers[loser])
    for (const h of s.heroes) {
      expect(h.level).toBeGreaterThanOrEqual(4)
      expect(h.items.length).toBeGreaterThan(0)
    }
    expect(s.feed.some((f) => f.kind === "first-blood")).toBe(true)
  }, 30_000)

  test("hero balance patch applies on top of base kits", () => {
    const chain = HEROES.find((h) => h.id === "chainwarden")!
    expect(heroDef("chainwarden").skill.cooldown).toBeLessThan(chain.skill.cooldown)
    expect(heroDef("ironwarden")).toBe(HEROES.find((h) => h.id === "ironwarden")!)
  })

  test("is deterministic for a seed", () => {
    const a = createMatch(map, autoDraft(), { seed: 3 }).runToEnd()
    const b = createMatch(map, autoDraft(), { seed: 3 }).runToEnd()
    expect(a.time).toBe(b.time)
    expect(a.heroes).toEqual(b.heroes)
    // Two full matches; CI runners need more than the 5 s default.
  }, 60_000)

  test("no structural side bias: same comps swapped across sides split wins", () => {
    // Swapping the two compositions between sides must flip most outcomes.
    const d = autoDraft(0, 1)
    const swapped: DraftState = {
      ...d,
      blue: d.red,
      red: d.blue,
      picks: { blue: d.picks.red, red: d.picks.blue },
    }
    let blueWins = 0
    for (let s = 0; s < 3; s++) {
      if (createMatch(map, d, { seed: s }).runToEnd().winner === "blue") blueWins++
      if (createMatch(map, swapped, { seed: s }).runToEnd().winner === "blue") blueWins++
    }
    expect(blueWins).toBeGreaterThanOrEqual(1)
    expect(blueWins).toBeLessThanOrEqual(5)
  }, 60_000)

  test("first pick is an advantage but not decisive: red wins some drafts", () => {
    let red = 0
    for (const [a, b] of [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
      [1, 0],
      [2, 1],
    ] as const) {
      if (
        createMatch(map, autoDraft(a, b), { seed: a * 7 + b, aiCoach: ["blue", "red"] }).runToEnd()
          .winner === "red"
      )
        red++
    }
    expect(red).toBeGreaterThanOrEqual(1)
  }, 60_000)

  test("towers fall in tier order", () => {
    const m = createMatch(map, autoDraft(), { seed: 11, aiCoach: ["blue", "red"] })
    const fallen: string[] = []
    while (!m.snapshot().winner && m.time() < 35 * 60) {
      m.advance(0.25)
      for (const st of m.structures()) if (!st.alive && !fallen.includes(st.id)) fallen.push(st.id)
    }
    const order = (team: string, lane: string) =>
      fallen
        .filter((id) => id.startsWith(team) && id.includes(`tower-${lane}-`))
        .map((id) => Number(id.at(-1)))
    for (const team of ["radiant", "dire"])
      for (const lane of ["top", "mid", "bot"]) {
        const tiers = order(team, lane)
        expect(tiers).toEqual([...tiers].toSorted((x, y) => x - y))
      }
  }, 30_000)

  test("coach calls respect cooldown and steer heroes", () => {
    const m = createMatch(map, autoDraft(), { seed: 5 })
    while (m.time() < 300) m.advance(0.25)
    expect(m.call("blue", "group")).toBe(true)
    expect(m.call("blue", "push")).toBe(false)
    // 20 × 0.25 s × 4× = 20 game seconds — well inside CALL_DURATION.
    for (let i = 0; i < 20; i++) m.advance(0.25)
    const s = m.snapshot()
    expect(s.calls.blue.active).toBe("group")
    expect(
      s.heroes.filter(
        (h) =>
          h.side === "blue" &&
          (h.intent === "group" ||
            h.intent === "fight" ||
            h.intent === "retreat" ||
            h.intent === "dead"),
      ).length,
    ).toBeGreaterThanOrEqual(3)
  })

  test("implements the Population seam (units, fx, structures)", () => {
    const m = createMatch(map, autoDraft(), { seed: 2 })
    for (let i = 0; i < 400; i++) m.advance(0.25)
    const units = m.units()
    expect(units.filter((u) => u.hero)).toHaveLength(10)
    expect(units.some((u) => u.kind === "roshan")).toBe(true)
    expect(m.structures()).toHaveLength(
      map.structures.filter(
        (s) =>
          s.team !== "neutral" &&
          ["tower", "ancient", "barracks-melee", "barracks-ranged"].includes(s.kind),
      ).length,
    )
    expect(m.fx().length).toBeGreaterThan(0)
    expect(m.fx()).toHaveLength(0)
  })
})

describe("itemization in a live match (spec/10)", () => {
  test("couriers deliver stash items and net worth counts every zone", () => {
    const m = createMatch(map, autoDraft(), { seed: 11 })
    let sawCargo = false
    let sawStash = false
    while (m.time() < 14 * 60 && !m.snapshot().winner) {
      m.runToEnd(m.time() + 5)
      const s = m.snapshot()
      if (s.couriers.some((c) => c.cargo.length > 0)) sawCargo = true
      if (s.heroes.some((h) => h.stash.some((i) => i !== null))) sawStash = true
      if (sawCargo && sawStash) break
    }
    expect(sawStash).toBeTrue()
    expect(sawCargo).toBeTrue()
    const s = m.snapshot()
    expect(s.couriers).toHaveLength(2)
    for (const side of ["blue", "red"] as const) {
      const lines = s.heroes.filter((h) => h.side === side)
      expect(s.netWorth[side]).toBe(lines.reduce((a, h) => a + h.netWorth, 0))
    }
  }, 60_000)
})

describe("time limit", () => {
  test("warns once, TIME_WARNING_LEAD before the cap, then ends on objectives", () => {
    const m = createMatch(map, autoDraft(), { seed: 4, maxTime: 200 })
    m.runToEnd(200 - TIME_WARNING_LEAD - 1)
    expect(m.snapshot().feed.some((f) => f.kind === "time-warning")).toBe(false)
    m.runToEnd()
    const s = m.snapshot()
    const warns = s.feed.filter((f) => f.kind === "time-warning")
    expect(warns).toHaveLength(1)
    expect(warns[0]!.t).toBeGreaterThanOrEqual(200 - TIME_WARNING_LEAD)
    expect(warns[0]!.t).toBeLessThan(200 - TIME_WARNING_LEAD + 0.2)
    expect(warns[0]!.text).toMatch(/^2 minutes left/)
    expect(s.winner).not.toBeNull()
    expect(s.feed.at(-1)!.text).toMatch(/^Time!/)
  })
})

describe("S5a actives in a live match (spec/10)", () => {
  test("heroes eat Tangos during laning", () => {
    const m = createMatch(map, autoDraft(), { seed: 4 })
    m.runToEnd(6 * 60)
    expect(m.thinkStats().actives.tango ?? 0).toBeGreaterThan(0)
  }, 60_000)
})
