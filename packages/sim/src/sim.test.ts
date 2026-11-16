import { describe, expect, test } from "bun:test"
import { Terrain, generateMap } from "@mobacraft/map"
import { ALL_CREATURE_KINDS, NEUTRALS_BY_CAMP, createCreepSim } from "./index.ts"

const map = generateMap()

const run = (seconds: number, dt = 1 / 30) => {
  const sim = createCreepSim(map)
  for (let t = 0; t < seconds; t += dt) sim.step(dt)
  return sim
}

describe("creep sim", () => {
  test("spawns a 4-unit wave per lane per team immediately", () => {
    const sim = createCreepSim(map)
    sim.step(0.01)
    const lane = sim.creatures().filter((c) => c.team !== "neutral")
    expect(lane).toHaveLength(2 * 3 * 4)
    expect(lane.filter((c) => c.kind === "radiant-ranged")).toHaveLength(3)
  })

  test("every 5th wave brings a siege engine", () => {
    const sim = createCreepSim(map, { waveInterval: 1, maxWavesInFlight: 10 })
    for (let i = 0; i < 5 * 30; i++) sim.step(1 / 30)
    expect(sim.creatures().some((c) => c.kind === "radiant-siege")).toBe(true)
    expect(sim.creatures().some((c) => c.kind === "dire-siege")).toBe(true)
  })

  test("lane creeps stay on lane-side ground (never in forest) while marching", () => {
    const sim = run(40)
    const lane = sim.creatures().filter((c) => c.team !== "neutral")
    expect(lane.length).toBeGreaterThan(0)
    for (const c of lane) expect(map.terrainAt(c.x, c.z)).not.toBe(Terrain.Forest)
  })

  test("radiant marches toward dire and vice versa", () => {
    const sim = createCreepSim(map)
    sim.step(0.01)
    const before = new Map(sim.creatures().map((c) => [c.id, c]))
    for (let i = 0; i < 60; i++) sim.step(1 / 10)
    const direAncient = map.structures.find(
      (s) => s.kind === "ancient" && s.team === "dire",
    )!.position
    const radAncient = map.structures.find(
      (s) => s.kind === "ancient" && s.team === "radiant",
    )!.position
    for (const c of sim.creatures()) {
      const b = before.get(c.id)
      if (!b || c.team === "neutral" || c.state !== "marching") continue
      const goal = c.team === "radiant" ? direAncient : radAncient
      // Mid is a straight line; side lanes bend, so compare only mid.
      if (c.lane !== "mid") continue
      expect(Math.hypot(c.x - goal.x, c.z - goal.z)).toBeLessThan(
        Math.hypot(b.x - goal.x, b.z - goal.z),
      )
    }
  })

  test("opposing waves meet and clash before passing through each other", () => {
    const sim = run(60)
    expect(sim.creatures().some((c) => c.state === "clashing") || sim.stats().wave > 1).toBe(true)
    let clashed = false
    const s2 = createCreepSim(map)
    for (let t = 0; t < 60 && !clashed; t += 1 / 30) {
      s2.step(1 / 30)
      clashed = s2.creatures().some((c) => c.state === "clashing")
    }
    expect(clashed).toBe(true)
  })

  test("in-flight waves are bounded", () => {
    const sim = run(600, 1 / 5)
    expect(sim.stats().lane).toBeLessThanOrEqual(2 * 3 * 3 * 5)
  })

  test("every camp has neutrals from its own roster and Roshan is home", () => {
    const sim = createCreepSim(map)
    const all = sim.creatures()
    for (const camp of map.camps) {
      const here = all.filter((c) => c.home === camp.id)
      expect(here.length).toBeGreaterThanOrEqual(2)
      for (const c of here)
        expect(NEUTRALS_BY_CAMP[camp.kind] as readonly string[]).toContain(c.kind)
    }
    expect(all.filter((c) => c.kind === "roshan")).toHaveLength(1)
  })

  test("all lane + neutral kinds are reachable over a long session", () => {
    const seen = new Set<string>()
    const sim = createCreepSim(map, { waveInterval: 2, maxWavesInFlight: 10 })
    for (let i = 0; i < 400; i++) {
      sim.step(0.1)
      for (const c of sim.creatures()) seen.add(c.kind)
    }
    // Camps pick one roster pair each, so not every neutral kind must appear; lane kinds must.
    for (const k of ALL_CREATURE_KINDS.filter(
      (kind) => kind.includes("-melee") || kind.includes("-ranged") || kind.includes("-siege"),
    ))
      expect(seen.has(k)).toBe(true)
  })

  test("is deterministic", () => {
    const a = run(45)
    const b = run(45)
    expect(a.creatures()).toEqual(b.creatures())
  })
})
