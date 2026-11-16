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
  })

  test("is deterministic for a seed", () => {
    const a = createMatch(map, autoDraft(), { seed: 3 }).runToEnd()
    const b = createMatch(map, autoDraft(), { seed: 3 }).runToEnd()
    expect(a.time).toBe(b.time)
    expect(a.heroes).toEqual(b.heroes)
  })

  test("both sides can win (no structural side bias) across seeds", () => {
    const winners = new Set<string>()
    for (let i = 0; i < 6 && winners.size < 2; i++) {
      winners.add(
        createMatch(map, autoDraft(i % 4, (i + 1) % 4), {
          seed: 50 + i,
          aiCoach: ["blue", "red"],
        }).runToEnd().winner!,
      )
    }
    expect(winners.size).toBe(2)
  })

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
  })

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
