/** spec/06 acceptance — tactics, matrix, phases, vision, economy, IGL, sliders. */
import { describe, expect, test } from "bun:test"
import { generateMap } from "@mobacraft/map"
import {
  ALL_HERO_IDS,
  type DraftState,
  type TeamTactics,
  TEAMS,
  aiChoose,
  applyDraft,
  createDraft,
  createMatch,
  defaultTactics,
  heroTags,
  isComplete,
  laneOfSlot,
  lanePreview,
  matchup,
  normalizeTactics,
  swapPlayers,
  synergy,
  teamSynergy,
  wardSpots,
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

const withBehavior = (t: TeamTactics, aggression: number): TeamTactics => ({
  ...t,
  players: Object.fromEntries(
    Object.entries(t.players).map(([id, p]) => [
      id,
      { ...p, behavior: { ...p.behavior, aggression } },
    ]),
  ),
})

describe("synergy & counter matrix", () => {
  test("tags are derived, every hero has one, no tag covers > 60 % of the roster", () => {
    const counts = new Map<string, number>()
    for (const id of ALL_HERO_IDS) {
      const tags = heroTags(id)
      expect(tags.length).toBeGreaterThan(0)
      for (const t of tags) counts.set(t, (counts.get(t) ?? 0) + 1)
    }
    for (const n of counts.values()) expect(n / ALL_HERO_IDS.length).toBeLessThanOrEqual(0.6)
    // Snapshot of a few derivations (fails loudly if ability data changes the matrix).
    expect(heroTags("ironwarden")).toEqual(["lockdown", "protect", "frontline"])
    expect(heroTags("vexlash")).toEqual(["duelist"])
    expect(heroTags("embercall")).toEqual(["aoe", "burst", "poke", "fragile"])
  })

  test("synergy is symmetric, matchup antisymmetric, scores are bounded", () => {
    for (const a of ALL_HERO_IDS)
      for (const b of ALL_HERO_IDS) {
        expect(synergy(a, b)).toBe(synergy(b, a))
        expect(matchup(a, b) + matchup(b, a)).toBe(0)
        expect(Math.abs(synergy(a, b))).toBeLessThanOrEqual(3)
      }
    // Lockdown counters dive: Chainwarden (lockdown) over Duskblade (dive).
    expect(matchup("chainwarden", "duskblade")).toBeGreaterThan(0)
    expect(teamSynergy(ALL_HERO_IDS.slice(0, 5))).toBeLessThanOrEqual(15)
  })
})

describe("tactics data", () => {
  test("defaults follow roles; Dire safe lane is top, Radiant safe lane is bot", () => {
    const d = autoDraft()
    const t = defaultTactics(d, "blue")
    const carry = d.blue.players.find((p) => p.role === "carry")!
    expect(t.players[carry.id]!.slot).toBe("safe")
    expect(laneOfSlot("safe", "blue")).toBe("bot")
    expect(laneOfSlot("safe", "red")).toBe("top")
    expect(laneOfSlot("off", "red")).toBe("bot")
  })

  test("normalize repairs invalid tactics without throwing", () => {
    const d = autoDraft()
    const bad = {
      ...defaultTactics(d, "blue"),
      igl: "nobody",
      vision: ["roshan", "roshan"],
    } as unknown as TeamTactics
    const t = normalizeTactics(d, "blue", bad)
    expect(d.blue.players.some((p) => p.id === t.igl)).toBe(true)
    expect(new Set(t.vision).size).toBe(4)
  })

  test("lane preview pairs our safe lane with their off lane", () => {
    const d = autoDraft()
    const p = lanePreview(d, "blue", defaultTactics(d, "blue"), defaultTactics(d, "red"))
    const safe = p.find((l) => l.slot === "safe")!
    expect(safe.lane).toBe("bot")
    expect(safe.ours.length).toBe(2)
    expect(safe.theirs.length).toBeGreaterThanOrEqual(1)
  })

  test("map yields 7 ward spots", () => {
    expect(wardSpots(map)).toHaveLength(7)
  })
})

describe("match with tactics", () => {
  test("phases advance in order laning → mid → late", () => {
    const m = createMatch(map, autoDraft(), { seed: 4, aiCoach: ["blue", "red"] })
    const s = m.runToEnd()
    const at = s.phaseAt
    expect(at.laning).toBe(0)
    expect(at.mid!).toBeGreaterThan(0)
    expect(at.mid!).toBeLessThanOrEqual(7 * 60 + 0.2)
    if (at.late !== undefined) expect(at.late).toBeGreaterThan(at.mid!)
    expect(s.feed.filter((f) => f.kind === "phase").length).toBeGreaterThanOrEqual(1)
  }, 30_000)

  test("lane assignment is honoured during laning (Dire safe = top)", () => {
    const d = autoDraft()
    const m = createMatch(map, d, { seed: 9 })
    m.runToEnd(150)
    const s = m.snapshot()
    const red = m.units().filter((u) => u.hero && u.team === "dire")
    const carryLine = s.heroes.find((h) => h.side === "red" && h.slot === "safe")!
    const carry = red.find((u) => u.id === carryLine.id)!
    const lane = (id: string) => map.lanes.find((l) => l.id === id)!.path
    const distTo = (path: readonly { x: number; z: number }[]) =>
      Math.min(...path.map((p) => Math.hypot(p.x - carry.x, p.z - carry.z)))
    if (carryLine.alive) expect(distTo(lane("top"))).toBeLessThan(distTo(lane("bot")))
  }, 60_000)

  test("lane swaps: laning only, own cooldown", () => {
    const d = autoDraft()
    const m = createMatch(map, d, { seed: 1 })
    m.runToEnd(30)
    const [a, b] = [d.blue.players[0]!.id, d.blue.players[2]!.id]
    const before = m.tactics("blue").players[a]!.slot
    expect(m.swapLanes("blue", a, b)).toBe(true)
    expect(m.tactics("blue").players[a]!.slot).toBe(
      m.snapshot().heroes.find((h) => h.playerId === a)!.slot,
    )
    expect(m.tactics("blue").players[b]!.slot).toBe(before)
    expect(m.swapLanes("blue", a, b)).toBe(false) // cooldown
    m.runToEnd(8 * 60)
    expect(m.snapshot().phase).not.toBe("laning")
    expect(m.swapLanes("blue", a, b)).toBe(false) // phase
    expect(swapPlayers(defaultTactics(d, "blue"), a, a)).toEqual(defaultTactics(d, "blue"))
  }, 60_000)

  test("wards get placed and give map control", () => {
    const m = createMatch(map, autoDraft(), { seed: 6 })
    m.runToEnd(150)
    const s = m.snapshot()
    expect(s.wards.length).toBeGreaterThan(0)
    const w = s.wards[0]!
    expect(m.visibleTo(w.side, w.x, w.z)).toBe(true)
    expect(s.control.blue).toBeGreaterThan(0.03)
    expect(s.control.blue).toBeLessThan(0.8)
  }, 60_000)

  test("economy: net worth = gold + items, sources sum to earned, history sampled", () => {
    const m = createMatch(map, autoDraft(), { seed: 8, aiCoach: ["blue", "red"] })
    m.runToEnd(12 * 60)
    const s = m.snapshot()
    const a = m.goldAudit()
    for (const side of ["blue", "red"] as const) {
      const sum = Object.values(a.sources[side]).reduce((x, y) => x + y, 0)
      expect(sum).toBeCloseTo(a.earned[side], 3)
      expect(s.netWorth[side]).toBe(
        s.heroes.filter((h) => h.side === side).reduce((x, h) => x + h.netWorth, 0),
      )
    }
    expect(s.purchases.length).toBeGreaterThan(5)
    expect(s.history.length).toBeGreaterThanOrEqual(12 * 12)
    expect(s.history.at(-1)!.nw.blue).toBeGreaterThan(s.history[1]!.nw.blue)
  }, 60_000)

  test("IGL relays coach calls with latency; backup caller when the IGL is dead", () => {
    const d = autoDraft()
    const m = createMatch(map, d, { seed: 5 })
    m.runToEnd(300)
    expect(m.call("blue", "group")).toBe(true)
    // Not relayed instantly.
    expect(m.snapshot().comms.filter((c) => c.side === "blue" && c.from === "coach")).toHaveLength(
      0,
    )
    m.runToEnd(304)
    const relayed = m.snapshot().comms.filter((c) => c.side === "blue" && c.from === "coach")
    expect(relayed).toHaveLength(1)
    expect(relayed[0]!.caller).not.toBeNull()
    expect(relayed[0]!.followers).toBeGreaterThanOrEqual(1)

    // Backup: find a moment the IGL is dead and the call is off cooldown.
    const iglName = d.blue.players.find((p) => p.id === m.tactics("blue").igl)!.name
    let tested = false
    while (!tested && m.time() < 30 * 60 && !m.snapshot().winner) {
      m.runToEnd(m.time() + 1)
      const s = m.snapshot()
      const igl = s.heroes.find((h) => h.side === "blue" && h.igl)!
      if (!igl.alive && igl.respawnIn > 8 && s.calls.blue.cooldown === 0) {
        const anyAlive = s.heroes.some((h) => h.side === "blue" && h.alive)
        expect(m.call("blue", "safe")).toBe(true)
        const calledAt = m.time()
        m.runToEnd(m.time() + 6)
        // Only look at comms produced by THIS call — unrelated coach entries
        // (plan changes, relays) must not shadow it.
        const last = m
          .snapshot()
          .comms.filter((c) => c.t >= calledAt)
          .findLast((c) => c.side === "blue" && c.from === "coach")
        // A team wipe inside the relay window leaves nobody to relay — try a later moment.
        if (last && anyAlive) {
          expect(last.caller).not.toBe(iglName)
          tested = true
        }
      }
    }
    expect(tested).toBe(true)
  }, 30_000)

  test("aggression 100 vs 0 produces ≥ 20 % more kills+deaths", () => {
    let calm = 0
    let wild = 0
    for (let seed = 0; seed < 4; seed++) {
      const d = autoDraft(seed % 4, (seed + 1) % 4)
      const run = (aggr: number) => {
        const s = createMatch(map, d, {
          seed,
          tactics: {
            blue: withBehavior(defaultTactics(d, "blue"), aggr),
            red: withBehavior(defaultTactics(d, "red"), aggr),
          },
          maxTime: 12 * 60,
        }).runToEnd()
        return s.kills.blue + s.kills.red
      }
      calm += run(0)
      wild += run(100)
    }
    expect(wild).toBeGreaterThanOrEqual(calm * 1.2)
  }, 60_000)

  test("deterministic with tactics and live commands", () => {
    const d = autoDraft()
    const go = () => {
      const m = createMatch(map, d, { seed: 12, aiCoach: ["red"] })
      m.runToEnd(60)
      m.swapLanes("blue", d.blue.players[0]!.id, d.blue.players[1]!.id)
      m.setBehavior("blue", d.blue.players[3]!.id, { aggression: 90, target: "carry" })
      m.runToEnd(9 * 60)
      m.setPlan("blue", "mid", "split")
      return m.runToEnd(14 * 60)
    }
    const a = go()
    const b = go()
    expect(a.heroes).toEqual(b.heroes)
    expect(a.history).toEqual(b.history)
  }, 30_000)

  test("plan changes are rate-limited and relayed", () => {
    const m = createMatch(map, autoDraft(), { seed: 3 })
    m.runToEnd(30)
    expect(m.setPlan("blue", "mid", "farm")).toBe(true)
    expect(m.setPlan("blue", "mid", "group")).toBe(false)
    expect(m.setPlan("red", "late", "nonsense")).toBe(false)
    m.runToEnd(40)
    expect(m.tactics("blue").plans.mid).toBe("farm")
  }, 60_000)
})
