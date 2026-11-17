import { describe, expect, test } from "bun:test"
import { generateMap } from "@mobacraft/map"
import { Bits, createStaticFog, createTeamFog, recomputeFog, sourceRadius } from "./fog.ts"
import { losWardSpots } from "./ward-spots.ts"

const map = generateMap()
const staticFog = createStaticFog(map)
const seen = (x: number, z: number) => {
  const fog = createTeamFog(staticFog.cols)
  recomputeFog({ staticFog, fog, tick: 0, sources: [{ x, z, radius: sourceRadius("ward", 0) }] })
  let n = 0
  for (const b of fog.bits) if (b & Bits.Visible) n++
  return n
}

describe("ward spots under fog LOS", () => {
  const spots = losWardSpots(map, staticFog)

  test("7 walkable spots; every jungle ward lights a useful area", () => {
    expect(spots).toHaveLength(7)
    for (const s of spots) expect(map.isWalkable(s.at.x, s.at.z)).toBe(true)
    // Regression: a centroid ward buried in forest lit only 32 cells (half a free disc).
    for (const s of spots.filter((x) => x.owner)) expect(seen(s.at.x, s.at.z)).toBeGreaterThan(120)
  })

  test("jungle ward value is roughly even between teams", () => {
    const total = (team: string) =>
      spots.filter((s) => s.owner === team).reduce((n, s) => n + seen(s.at.x, s.at.z), 0)
    const r = total("radiant") / total("dire")
    expect(r).toBeGreaterThan(0.8)
    expect(r).toBeLessThan(1.25)
  })
})
