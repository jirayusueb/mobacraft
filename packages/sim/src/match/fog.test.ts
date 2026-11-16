/**
 * Fog of War acceptance tests — spec/08 §7. Synthetic fixtures for the
 * geometric rules; real map fixtures for calibration, night sanity and
 * the recompute budget.
 */
import { describe, expect, test } from "bun:test"
import { generateMap } from "@mobacraft/map"
import {
  ATTACK_REVEAL_RADIUS,
  Bits,
  LINGER_TICKS,
  createStaticFog,
  createTeamFog,
  castVision,
  destroyTree,
  fogSnapshot,
  isNight,
  recomputeFog,
  sourceRadius,
  treeAt,
} from "./fog.ts"
import type { VisionSource } from "./fog.ts"

const makeStatic = (
  bandAt: (x: number, z: number) => number,
  treeAt: (x: number, z: number) => boolean = () => false,
  cols = 32,
) => {
  const band = new Uint8Array(cols * cols)
  const forest = new Uint8Array(cols * cols)
  for (let z = 0; z < cols; z++)
    for (let x = 0; x < cols; x++) {
      band[z * cols + x] = bandAt(x, z)
      forest[z * cols + x] = treeAt(x, z) ? 1 : 0
    }
  return { cols, band, forest, cutTrees: new Uint8Array(cols * cols) }
}

const lit = (fog: { bits: Uint8Array }, s: { cols: number }, x: number, z: number) =>
  (fog.bits[z * s.cols + x]! & Bits.Visible) !== 0

const cast1 = (s: ReturnType<typeof makeStatic>, src: VisionSource, tick = 0) => {
  const fog = createTeamFog(s.cols)
  castVision(s, fog, src, tick)
  return fog
}

describe("fog: tree walls (test 1)", () => {
  // Vertical forest wall at x=16, open lane band elsewhere.
  const s = makeStatic(
    () => 1,
    () => false,
    32,
  )
  for (let z = 0; z < 32; z++) s.forest[z * 32 + 16] = 1
  test("wall blocks: near side lit, far side dark", () => {
    const fog = cast1(s, { x: 8.5 * 2, z: 16 * 2, radius: 9 })
    expect(lit(fog, s, 14, 16)).toBe(true)
    expect(lit(fog, s, 18, 16)).toBe(false)
    expect(fog.bits[16 * 32 + 18]! & Bits.Explored).toBe(0)
  })
  test("cutting one tree opens a wedge through it", () => {
    expect(destroyTree(s, { x: 33, z: 33 })).toBe(true) // cell (16,16)
    const fog = cast1(s, { x: 8.5 * 2, z: 16 * 2, radius: 10 })
    expect(lit(fog, s, 16, 16)).toBe(true)
    expect(lit(fog, s, 17, 16)).toBe(true)
    expect(lit(fog, s, 18, 16)).toBe(true)
  })
})

describe("fog: high ground (test 2)", () => {
  // High-ground rim: x >= 20 is band 2, everything else band 1 (no trees).
  const s = makeStatic(
    (x) => (x >= 20 ? 2 : 1),
    () => false,
    32,
  )
  test("low-side source lights the rim but nothing beyond it", () => {
    const fog = cast1(s, { x: 29, z: 33, radius: 14 })
    expect(lit(fog, s, 17, 16)).toBe(true) // pre-rim
    expect(lit(fog, s, 20, 16)).toBe(true) // rim cell is lit (occluding)
    expect(lit(fog, s, 22, 16)).toBe(false) // behind the rim: dark
    expect(lit(fog, s, 26, 16)).toBe(false)
  })
  test("the same source on the high ground lights the basin", () => {
    const fog = cast1(s, { x: 45, z: 33, radius: 14 }) // cell (22,16), band 2
    expect(lit(fog, s, 26, 16)).toBe(true)
    expect(lit(fog, s, 22, 16)).toBe(true)
    expect(lit(fog, s, 10, 16)).toBe(true) // descending terrain re-lights
  })
})

describe("fog: night (test 3)", () => {
  test("single-source lit area is 0.36x day (radius 8 vs round(8*0.6)=5)", () => {
    const s = makeStatic(
      () => 1,
      () => false,
      64,
    )
    const day = cast1(s, { x: 64, z: 64, radius: sourceRadius("hero", 100) })
    const night = cast1(s, { x: 64, z: 64, radius: sourceRadius("hero", 3700) })
    const count = (fog: { bits: Uint8Array }) =>
      fog.bits.reduce((n, b) => n + (b & Bits.Visible ? 1 : 0), 0)
    const ratio = count(night) / count(day)
    // Area ratio ≈ 25/81 = 0.309; radius^2 ratio bounds it loosely.
    expect(ratio).toBeGreaterThan(0.22)
    expect(ratio).toBeLessThan(0.45)
    expect(sourceRadius("hero", 3700, 1 / 0.6)).toBe(8) // nightVision restores day radius
  })
  test("tower light is identical day vs night", () => {
    expect(sourceRadius("tower", 100)).toBe(sourceRadius("tower", 3700))
  })
  test("night tick derivation", () => {
    expect(isNight(0)).toBe(false)
    expect(isNight(3599)).toBe(false)
    expect(isNight(3600)).toBe(true)
    expect(isNight(7200)).toBe(false)
  })
})

describe("fog: linger (test 5)", () => {
  const s = makeStatic(
    () => 1,
    () => false,
    32,
  )
  test("cells stay visible LINGER_TICKS past last light, then explored-dark", () => {
    const fog = createTeamFog(s.cols)
    const src = { x: 17, z: 33, radius: 6 }
    recomputeFog({ staticFog: s, fog, tick: 100, sources: [src] })
    expect(lit(fog, s, 12, 16)).toBe(true)
    // Source gone: linger keeps cells visible while tick <= lastLit + LINGER_TICKS.
    recomputeFog({ staticFog: s, fog, tick: 105, sources: [] })
    expect(lit(fog, s, 12, 16)).toBe(true)
    recomputeFog({ staticFog: s, fog, tick: 106, sources: [] })
    expect(lit(fog, s, 12, 16)).toBe(false)
    // Explored persists; never reverts to unexplored.
    expect(fog.bits[16 * 32 + 12]! & Bits.Explored).toBe(Bits.Explored)
    expect(LINGER_TICKS).toBe(5)
  })
})

describe("fog: attack reveal (test 4)", () => {
  const s = makeStatic(
    () => 1,
    () => false,
    32,
  )
  test("bubble lights the attacker for the victim's team, then lingers out", () => {
    const fog = createTeamFog(s.cols)
    const atk = { x: 25, z: 33, radius: ATTACK_REVEAL_RADIUS }
    const t = 200
    recomputeFog({ staticFog: s, fog, tick: t + 20, sources: [], reveals: [atk] }) // bubble ends at t+20
    expect(lit(fog, s, 12, 16)).toBe(true)
    recomputeFog({ staticFog: s, fog, tick: t + 25, sources: [], reveals: [] }) // linger window
    expect(lit(fog, s, 12, 16)).toBe(true)
    recomputeFog({ staticFog: s, fog, tick: t + 26, sources: [], reveals: [] })
    expect(lit(fog, s, 12, 16)).toBe(false)
  })
})

describe("fog: dirty/full convergence (test 7)", () => {
  test("recomputes are deterministic and byte-identical regardless of event order", () => {
    const s1 = makeStatic(
      (x) => (x >= 20 ? 2 : 1),
      (_x, z) => z % 5 === 0,
      32,
    )
    const s2 = makeStatic(
      (x) => (x >= 20 ? 2 : 1),
      (_x, z) => z % 5 === 0,
      32,
    )
    destroyTree(s2, { x: 41, z: 10 })
    const srcs = [
      { x: 12, z: 12, radius: 8 },
      { x: 22, z: 24, radius: 7 },
    ]
    const a = createTeamFog(32)
    const b = createTeamFog(32)
    recomputeFog({ staticFog: s1, fog: a, tick: 10, sources: srcs })
    recomputeFog({ staticFog: s2, fog: b, tick: 10, sources: srcs })
    expect(Buffer.from(a.bits).equals(Buffer.from(b.bits))).toBe(true) // cut tree identical in both
    const again = createTeamFog(32)
    recomputeFog({ staticFog: s1, fog: again, tick: 10, sources: [...srcs].reverse() })
    expect(Buffer.from(again.bits).equals(Buffer.from(a.bits))).toBe(true) // source order free
  })
})

describe("fog: real map calibration", () => {
  const map = generateMap({ seed: 7, size: 128, forestDensity: 0.62 })
  const s = createStaticFog(map)
  test("bands: a rim band-2 cell exists adjacent to a band-1 lane cell", () => {
    let found = false
    for (let z = 1; z < s.cols - 1 && !found; z++)
      for (let x = 1; x < s.cols - 1 && !found; x++) {
        const b = s.band[z * s.cols + x]!
        if (b === 2 && (s.band[z * s.cols + x - 1] === 1 || s.band[z * s.cols + x + 1] === 1))
          found = true
      }
    expect(found).toBe(true)
  })
  test("forest cells are blockers and destroyTree toggles them", () => {
    const p = { x: 0, z: 0 }
    outer: for (let z = 0; z < s.cols; z++)
      for (let x = 0; x < s.cols; x++)
        if (s.forest[z * s.cols + x] === 1) {
          p.x = (x + 0.5) * 2
          p.z = (z + 0.5) * 2
          break outer
        }
    expect(treeAt(s, p)).toBe(true)
    expect(destroyTree(s, p)).toBe(true)
    expect(treeAt(s, p)).toBe(false)
    expect(destroyTree(s, p)).toBe(false) // already cut
  })
  test("budget (test 8): 100-source recompute under CI-padded 8 ms", () => {
    const fog = createTeamFog(s.cols)
    const sources: VisionSource[] = Array.from({ length: 110 }, (_, i) => ({
      x: 4 + (i % 60) * 2,
      z: 4 + ((i * 7) % 60) * 2,
      radius: i % 3 === 0 ? 9 : 6,
    }))
    recomputeFog({ staticFog: s, fog, tick: 0, sources })
    const t0 = performance.now()
    recomputeFog({ staticFog: s, fog, tick: 1, sources })
    expect(performance.now() - t0).toBeLessThan(8)
  })
  test("render snapshot encoding (spec/08 §5)", () => {
    const fog = createTeamFog(s.cols)
    recomputeFog({ staticFog: s, fog, tick: 0, sources: [{ x: 64, z: 64, radius: 8 }] })
    const snap = fogSnapshot(fog, s)
    expect(snap.cols).toBe(64)
    expect(snap.bytes.length).toBe(64 * 64)
    for (const v of snap.bytes) expect(v === 0 || v === 1 || v === 2).toBe(true)
  })
})
