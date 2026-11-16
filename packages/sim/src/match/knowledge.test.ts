/**
 * Knowledge isolation tests — spec/08 §3 and §7 test 6. State assertions
 * only: the enemy grid must stay dark along a forested corridor, and the
 * ghost must freeze at the last lit cell.
 */
import { describe, expect, test } from "bun:test"
import { Bits, createStaticFog, createTeamFog, recomputeFog } from "./fog.ts"
import { TeamKnowledge, type KnowledgeUnit } from "./knowledge.ts"

// Corridor: walls at x=10 and x=20 made of trees, band 1 everywhere.
const s = createStaticFog({
  size: 64,
  waterLevel: 0,
  height: new Float32Array(64 * 64).fill(1),
  heightAt: () => 1,
  terrainAt: () => 0,
} as never)
s.forest.fill(0)
for (let z = 0; z < s.cols; z++) {
  s.forest[z * s.cols + 10] = 1
  s.forest[z * s.cols + 20] = 1
}

const enemyGrid = createTeamFog(s.cols)
const knowledge = new TeamKnowledge("radiant", enemyGrid, s)

const unit = (id: string, x: number, z: number): KnowledgeUnit => ({
  id,
  pos: { x, z },
  vel: { x: 1, z: 0 },
  hpFrac: 1,
  level: 6,
  items: ["tango"],
  alive: true,
})

describe("TeamKnowledge isolation (spec/08 test 6)", () => {
  test("visible while lit, ghost freezes at the last lit cell", () => {
    // Room 1 lit (left of the x=10 wall); walker inside it.
    recomputeFog({ staticFog: s, fog: enemyGrid, tick: 50, sources: [{ x: 4, z: 12, radius: 8 }] })
    knowledge.clearTick()
    knowledge.observe(unit("e1", 6, 12), 50)
    expect(knowledge.visible("e1")).toBeDefined()
    expect(knowledge.ghost("e1")!.lastSeenTick).toBe(50)
    expect(knowledge.ghost("e1")!.pos).toEqual({ x: 6, z: 12 })

    // Walker enters the forest corridor (world x 21–39 sits between the
    // tree columns at cells 10 and 20) — the enemy grid stays dark there.
    for (const [x, t] of [
      [23, 60],
      [27, 70],
      [35, 80],
    ] as const) {
      recomputeFog({ staticFog: s, fog: enemyGrid, tick: t, sources: [{ x: 4, z: 12, radius: 8 }] })
      knowledge.clearTick()
      knowledge.observe(unit("e1", x, 12), t)
      expect(knowledge.visible("e1")).toBeUndefined()
      expect(enemyGrid.bits[6 * s.cols + Math.floor(x / 2)]! & Bits.Visible).toBe(0)
    }
    const g = knowledge.ghost("e1")!
    expect(g.lastSeenTick).toBe(50) // frozen
    expect(g.pos).toEqual({ x: 6, z: 12 }) // frozen at last lit cell
    expect(g.itemsAtSeen).toEqual(["tango"])
  })

  test("re-entering light updates the ghost again", () => {
    recomputeFog({ staticFog: s, fog: enemyGrid, tick: 90, sources: [{ x: 4, z: 12, radius: 8 }] })
    knowledge.clearTick()
    knowledge.observe(unit("e1", 6, 12), 90)
    expect(knowledge.visible("e1")).toBeDefined()
    expect(knowledge.ghost("e1")!.lastSeenTick).toBe(90)
  })

  test("dead units are never observed", () => {
    recomputeFog({ staticFog: s, fog: enemyGrid, tick: 95, sources: [{ x: 4, z: 12, radius: 8 }] })
    knowledge.clearTick()
    knowledge.observe({ ...unit("e1", 6, 12), alive: false }, 95)
    expect(knowledge.visible("e1")).toBeUndefined()
  })
})

describe("TeamKnowledge in a real match (spec/08 §3)", () => {
  test("AI only knows enemies standing in its own lit fog; ghosts never lead truth", async () => {
    const { generateMap } = await import("@mobacraft/map")
    const { TEAMS, aiChoose, applyDraft, createDraft, createMatch, isComplete } =
      await import("../index.ts")
    const map = generateMap()
    let d = createDraft(TEAMS[0]!, TEAMS[1]!)
    while (!isComplete(d)) {
      const r = applyDraft(d, aiChoose(d))
      if (!r.ok) throw new Error(r.error)
      d = r.state
    }
    const m = createMatch(map, d, { seed: 11 })
    let checks = 0
    let hidden = 0
    for (let t = 30; t <= 600; t += 15) {
      m.runToEnd(t)
      for (const side of ["blue", "red"] as const) {
        const k = m.knowledgeOf(side)
        for (const u of k.allVisible()) {
          expect(m.visibleTo(side, u.pos.x, u.pos.z)).toBe(true)
          checks++
        }
        const enemyTeam = side === "blue" ? "dire" : "radiant"
        for (const u of m.units()) {
          if (u.team !== enemyTeam || !u.id.startsWith("hero")) continue
          if (!k.visible(u.id)) hidden++
          const g = k.ghost(u.id)
          if (g) expect(g.lastSeenTick).toBeLessThanOrEqual(Math.round(m.time() * 10))
        }
      }
    }
    expect(checks).toBeGreaterThan(0)
    expect(hidden).toBeGreaterThan(0) // fog really hides heroes
  }, 60_000)
})
