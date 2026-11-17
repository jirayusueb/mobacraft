/**
 * spec/12 S6 — respawn & tempo wired into the live match. State assertions on
 * real seeded matches (deterministic), one long match shared across tests.
 */
import { beforeAll, describe, expect, test } from "bun:test"
import { generateMap } from "@mobacraft/map"
import {
  MAX_LEVEL,
  ROSHAN_WINDOW,
  TEAMS,
  aiChoose,
  applyDraft,
  createDraft,
  createMatch,
  isComplete,
  respawnSeconds,
  type DraftState,
  type Match,
  type MatchSnapshot,
} from "../../index.ts"
import { POWER_RUNES } from "./index.ts"

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

let m: Match
let end: MatchSnapshot
let stats: ReturnType<Match["tempoStats"]>
beforeAll(() => {
  m = createMatch(map, autoDraft(), { seed: 7, aiCoach: ["blue", "red"] })
  end = m.runToEnd()
  stats = m.tempoStats()
}, 120_000)

describe("§1 hero respawn in the match", () => {
  test("timer follows the spec/12 curve on the match clock (12 → 100 Dota s)", () => {
    expect(respawnSeconds(1)).toBeCloseTo(6)
    expect(respawnSeconds(MAX_LEVEL)).toBeCloseTo(50)
    for (const d of stats.deaths) {
      const base = respawnSeconds(d.level)
      if (d.mods.length === 0) expect(d.total).toBeCloseTo(base)
      else expect(d.total).toBeGreaterThan(base)
    }
  })

  test("respawned heroes are protected at the fountain until they move", () => {
    const g = createMatch(map, autoDraft(), { seed: 11, aiCoach: ["blue", "red"] })
    // Find a death, then step tick by tick to the respawn tick.
    let t = 30
    let dead: string | undefined
    while (!dead && t < 900) dead = g.runToEnd((t += 2)).heroes.find((h) => !h.alive)?.id
    expect(dead).toBeDefined()
    let line = g.snapshot().heroes.find((h) => h.id === dead)!
    while (!line.alive) line = g.runToEnd((t += 0.1)).heroes.find((h) => h.id === dead)!
    expect(line.protected).toBeTrue()
    // A few seconds later it has walked off and lost protection.
    line = g.runToEnd(t + 5).heroes.find((h) => h.id === dead)!
    expect(line.protected).toBeFalse()
  }, 60_000)

  test("snapshot exposes the full death duration and a buyback price", () => {
    const g = createMatch(map, autoDraft(), { seed: 7, aiCoach: ["blue", "red"] })
    let dead: MatchSnapshot["heroes"][number] | undefined
    for (let t = 30; t <= 900 && !dead; t += 2) dead = g.runToEnd(t).heroes.find((h) => !h.alive)
    expect(dead).toBeDefined()
    expect(dead!.respawnTotal).toBeGreaterThanOrEqual(dead!.respawnIn)
    expect(dead!.buyback.cost).toBeGreaterThanOrEqual(200)
  }, 60_000)
})

describe("§2 buyback", () => {
  test("AI buys back for a stated reason, pays, and the next death carries +25 Dota s", () => {
    // Buybacks are situational: scan seeds until one match has them.
    let bbStats = m.tempoStats()
    let bbEnd = m.snapshot()
    for (let seed = 1; seed <= 8 && bbStats.buybacks.length === 0; seed++) {
      const g = createMatch(map, autoDraft(seed % 4, (seed + 1) % 4), {
        seed,
        aiCoach: ["blue", "red"],
      })
      bbEnd = g.runToEnd()
      bbStats = g.tempoStats()
    }
    expect(bbStats.buybacks.length).toBeGreaterThan(0)
    for (const b of bbStats.buybacks)
      expect(["base-defense", "high-value-fight", "game-ending-push"]).toContain(b.reason)
    expect(bbEnd.feed.some((f) => f.kind === "buyback" && /buys back/.test(f.text))).toBeTrue()
    const penalised = bbStats.deaths.filter((d) => d.mods.includes("buyback-penalty"))
    for (const d of penalised) expect(d.total).toBeCloseTo(respawnSeconds(d.level) + 25 / 2)
    // 480 Dota s cooldown = 240 match s between one hero's buybacks.
    const byHero = new Map<string, number[]>()
    for (const b of bbStats.buybacks) byHero.set(b.hero, [...(byHero.get(b.hero) ?? []), b.t])
    for (const ts of byHero.values())
      for (let i = 1; i < ts.length; i++) expect(ts[i]! - ts[i - 1]!).toBeGreaterThanOrEqual(240)
  }, 240_000)
})

describe("§3 creep waves", () => {
  test("one wave per 30 s, siege every 10th, super/mega after barracks fall, pooled bodies", () => {
    // Wave k leaves at match second 1 + 30k (the 1 s opening offset is kept).
    expect(stats.waves).toBe(Math.floor((end.time - 1 + 1e-6) / 30) + 1)
    expect(stats.sieges).toBe(Math.floor((stats.waves - 1) / 10))
    expect(stats.superCreeps + stats.megaCreeps).toBeGreaterThan(0)
    // Late game reuses pooled creep bodies far more than it allocates.
    expect(stats.pool.reused).toBeGreaterThan(stats.pool.created * 3)
  })
})

describe("§4 neutral camps", () => {
  test("camps are empty before 1:00 Dota and spawn at the first box check", () => {
    const g = createMatch(map, autoDraft(), { seed: 5 })
    g.runToEnd(29.5)
    expect(g.units().some((u) => u.team === "neutral" && u.kind !== "roshan")).toBeFalse()
    g.runToEnd(30.5)
    expect(g.tempoStats().campSpawns).toBe(map.camps.length)
  }, 30_000)

  test("a sentry in the box blocks the spawn", () => {
    const g = createMatch(map, autoDraft(), { seed: 5 })
    const camp = map.camps[0]!
    g.plantWard("red", camp.position.x + 1, camp.position.z, "sentry")
    g.runToEnd(30.5)
    const s = g.tempoStats()
    expect(s.campSpawns).toBe(map.camps.length - 1)
    expect(s.camps.find((c) => c.id === camp.id)!.stacks).toBe(0)
  }, 30_000)

  test("box checks run every Dota minute and some spawns are blocked", () => {
    expect(stats.campSpawns + stats.campBlocks).toBe(
      map.camps.length * Math.floor((end.time * 2) / 60),
    )
    expect(stats.campBlocks).toBeGreaterThan(0)
  })
})

describe("§5 world events", () => {
  test("runes spawn on cadence; power runes never repeat back-to-back", () => {
    const dota = end.time * 2
    expect(stats.runes.bounty).toBe(Math.floor(dota / 180) + 1)
    expect(stats.runes.power).toBe(dota >= 360 ? Math.floor((dota - 360) / 120) + 1 : 0)
    for (let i = 1; i < stats.powerTypes.length; i++)
      expect(stats.powerTypes[i]).not.toBe(stats.powerTypes[i - 1])
    for (const t of stats.powerTypes) expect(POWER_RUNES).toContain(t)
    expect(stats.runesTaken).toBeGreaterThan(0)
  })

  test("Roshan respawns inside the 8–11 Dota-min window; snapshot shows only the window", () => {
    let checked = 0
    for (let seed = 1; seed <= 6 && checked === 0; seed++) {
      const g = createMatch(map, autoDraft(), { seed, aiCoach: ["blue", "red"] })
      const s = g.runToEnd()
      for (const r of g.tempoStats().roshan) {
        if (r.respawnedAt === null) continue
        const gap = r.respawnedAt - r.diedAt
        expect(gap).toBeGreaterThanOrEqual(ROSHAN_WINDOW[0] - 0.11)
        expect(gap).toBeLessThanOrEqual(ROSHAN_WINDOW[1] + 0.11)
        checked++
      }
      expect(Object.keys(s.roshanWindow).toSorted()).toEqual(["earliest", "latest", "state"])
    }
    expect(checked).toBeGreaterThan(0)
  }, 180_000)

  test("a cut tree regrows 3 Dota minutes later", () => {
    const g = createMatch(map, autoDraft(), { seed: 5 })
    const tree = map.trees.find((t) => t.position.x > 20 && t.position.z > 20)!.position
    expect(g.cutTree(tree.x, tree.z)).toBeTrue()
    g.runToEnd(89)
    expect(g.tempoStats().treesRegrown).toBe(0)
    g.runToEnd(92)
    expect(g.tempoStats().treesRegrown).toBe(1)
  }, 30_000)
})

const runTo600 = () =>
  createMatch(map, autoDraft(), { seed: 21, aiCoach: ["blue", "red"] }).runToEnd(600)

test("deterministic with the tempo systems on", () => {
  const a = runTo600()
  const b = runTo600()
  expect(a.heroes).toEqual(b.heroes)
  expect(a.feed).toEqual(b.feed)
  expect(a.runes).toEqual(b.runes)
}, 60_000)
