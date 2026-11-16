import { describe, expect, test } from "bun:test"
import { DEFAULT_SPEC, generateMap, Terrain } from "./index.ts"

const map = generateMap(DEFAULT_SPEC)
const N = map.size

describe("generateMap", () => {
  test("is deterministic for a given spec", () => {
    const again = generateMap(DEFAULT_SPEC)
    expect(again.terrain).toEqual(map.terrain)
    expect(again.trees).toEqual(map.trees)
  })

  test("different seeds change scatter but not layout", () => {
    const other = generateMap({ ...DEFAULT_SPEC, seed: 99 })
    expect(other.structures).toEqual(map.structures)
    expect(other.trees).not.toEqual(map.trees)
  })

  test("has three lanes and Dota's structure counts per team", () => {
    expect(map.lanes.map((l) => l.id)).toEqual(["top", "mid", "bot"])
    for (const team of ["radiant", "dire"] as const) {
      const of = (kind: string) => map.structures.filter((s) => s.team === team && s.kind === kind)
      expect(of("ancient")).toHaveLength(1)
      expect(of("tower")).toHaveLength(11)
      expect(of("barracks-melee")).toHaveLength(3)
      expect(of("barracks-ranged")).toHaveLength(3)
    }
  })

  test("is point-symmetric: every radiant structure has a dire mirror", () => {
    for (const s of map.structures.filter((x) => x.team === "radiant")) {
      const twin = map.structures.find(
        (d) =>
          d.team === "dire" &&
          d.kind === s.kind &&
          Math.abs(d.position.x - (N - s.position.x)) < 1e-9 &&
          Math.abs(d.position.z - (N - s.position.z)) < 1e-9,
      )
      expect(twin).toBeDefined()
    }
  })

  test("ancients sit on high ground above the river", () => {
    const ancients = map.structures.filter((s) => s.kind === "ancient")
    const centre = map.heightAt(N / 2, N / 2)
    for (const a of ancients)
      expect(map.heightAt(a.position.x, a.position.z)).toBeGreaterThan(centre + 1)
  })

  test("the river is water and lies below the water level", () => {
    const mid = map.river[Math.floor(map.river.length / 2)]!
    expect(map.terrainAt(mid.x, mid.z)).toBe(Terrain.Water)
    // Lanes cross the river, so sample a river point away from mid.
    const p = map.river[2]!
    expect(map.heightAt(p.x, p.z)).toBeLessThan(map.waterLevel)
  })

  test("lanes are walkable end to end and trees block", () => {
    for (const lane of map.lanes) {
      for (let k = 0; k <= 20; k++) {
        const t = k / 20
        const i = Math.min(lane.path.length - 2, Math.floor(t * (lane.path.length - 1)))
        const a = lane.path[i]!
        const b = lane.path[i + 1]!
        const f = t * (lane.path.length - 1) - i
        const x = a.x + (b.x - a.x) * f
        const z = a.z + (b.z - a.z) * f
        expect<Terrain[]>([Terrain.Lane, Terrain.Plaza, Terrain.Shore, Terrain.Water]).toContain(
          map.terrainAt(x, z),
        )
      }
    }
    const tree = map.trees[0]!
    expect(map.isWalkable(tree.position.x, tree.position.z)).toBe(false)
    expect(map.isWalkable(-1, -1)).toBe(false)
  })

  test("lanes ramp smoothly — no cliff steps along any lane", () => {
    for (const lane of map.lanes) {
      for (let i = 0; i < lane.path.length - 1; i++) {
        const a = lane.path[i]!
        const b = lane.path[i + 1]!
        const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) * 2)
        let prev = map.height[Math.floor(a.z) * N + Math.floor(a.x)]!
        for (let k = 1; k <= steps; k++) {
          const x = a.x + ((b.x - a.x) * k) / steps
          const z = a.z + ((b.z - a.z) * k) / steps
          const h = map.height[Math.floor(z) * N + Math.floor(x)]!
          expect(Math.abs(h - prev)).toBeLessThanOrEqual(0.25)
          prev = h
        }
      }
    }
  })

  test("every camp is reachable open ground", () => {
    for (const c of map.camps) expect(map.isWalkable(c.position.x, c.position.z)).toBe(true)
  })
})
