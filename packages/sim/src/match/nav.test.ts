import { describe, expect, test } from "bun:test"
import { type MobaMap, Terrain } from "@mobacraft/map"
import { Nav } from "./nav.ts"

/** Tiny map: 16×16 grass with a forest wall at x = 8 except a gap at z = 14. */
const walled = (): MobaMap => {
  const size = 16
  const terrain = new Uint8Array(size * size).fill(Terrain.Grass)
  for (let z = 0; z < size; z++) if (z !== 14) terrain[z * size + 8] = Terrain.Forest
  return { size, terrain } as unknown as MobaMap
}

const tile = (p: { x: number; z: number }) => ({ x: Math.floor(p.x), z: Math.floor(p.z) })

describe("Nav", () => {
  test("straight line when clear", () => {
    const nav = new Nav(walled())
    const to = { x: 5.5, z: 10.5 }
    expect(nav.path({ x: 1.5, z: 1.5 }, to)).toEqual([to])
  })

  test("routes through the gap and never enters forest", () => {
    const map = walled()
    const nav = new Nav(map)
    const to = { x: 14.5, z: 2.5 }
    const path = nav.path({ x: 2.5, z: 2.5 }, to)
    expect(path.at(-1)).toBe(to)
    expect(path.length).toBeGreaterThan(1)
    expect(path.some((p) => tile(p).z === 14 || tile(p).z === 13)).toBe(true)
    for (const p of path) expect(nav.walkable(p)).toBe(true)
  })

  test("caches identical queries", () => {
    const nav = new Nav(walled())
    const a = nav.path({ x: 2.5, z: 2.5 }, { x: 14.5, z: 2.5 })
    expect(nav.path({ x: 2.2, z: 2.7 }, { x: 14.5, z: 2.5 })).toBe(a)
  })

  test("walkable reflects forest", () => {
    const nav = new Nav(walled())
    expect(nav.walkable({ x: 8.5, z: 3.5 })).toBe(false)
    expect(nav.walkable({ x: 8.5, z: 14.5 })).toBe(true)
  })
})
