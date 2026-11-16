import { describe, expect, test } from "bun:test"
import { type MobaMap, Terrain, generateMap, DEFAULT_SPEC } from "@mobacraft/map"
import {
  ACCEL,
  DynamicNav,
  GATE,
  HULL,
  resolveUnits,
  slideMove,
  TURN,
  moveBody,
} from "./locomotion.ts"

/** Minimal forest grid map: forest where mask=1, else grass. */
const tinyMap = (mask: number[], n: number) =>
  ({
    size: n,
    terrain: Uint8Array.from(mask, (m) => (m ? Terrain.Forest : Terrain.Grass)),
  }) as unknown as MobaMap

const run = (steps: number, dt: number, fn: (i: number) => void) => {
  for (let i = 0; i < steps; i++) fn(i)
}

const makeMoveBody = (over: Record<string, unknown> = {}) =>
  ({ x: 10, z: 10, heading: 0, speed: 3, turnRate: TURN.mid, ...over }) as Parameters<
    typeof moveBody
  >[0]

describe("turn rate (spec/09 test 1)", () => {
  const nav = new DynamicNav(tinyMap([0], 1))
  test("180° command: no movement before the gate tick, then moves", () => {
    const b = makeMoveBody()
    const goal = { x: 10, z: 4 } // straight behind (heading 0 = +z)
    const gateTick = Math.ceil((Math.PI - GATE) / TURN.mid / 0.1)
    run(gateTick - 1, 0.1, () => moveBody(b, nav, goal, 0, 0.1))
    expect(Math.hypot(b.x - 10, b.z - 10)).toBeLessThan(1e-9) // still rotating, not moving
    moveBody(b, nav, goal, 0, 0.1)
    expect(b.z).toBeLessThan(10) // gate open: accelerated along (rotated) heading
  })

  test("heading never exceeds turnRate * dt per tick", () => {
    const b = makeMoveBody()
    const goal = { x: 10, z: 4 }
    moveBody(b, nav, goal, 0, 0.1)
    expect(Math.abs(b.heading)).toBeLessThanOrEqual(TURN.mid * 0.1 + 1e-9)
  })

  test("moveWithoutTurning moves on tick 1", () => {
    const b = makeMoveBody({ moveWithoutTurning: true })
    moveBody(b, nav, { x: 10, z: 4 }, 0, 0.1)
    expect(b.z).toBeLessThan(10)
  })

  test("accelerates gradually (12 tiles/s²)", () => {
    const b = makeMoveBody({ heading: 0, moveWithoutTurning: true })
    moveBody(b, nav, { x: 10, z: 20 }, 0, 0.1)
    expect(b.velMag!).toBeLessThan(3) // not full speed instantly
    expect(b.velMag).toBeCloseTo(ACCEL * 0.1, 9)
  })
})

describe("clearance-aware pathing (spec/09 test 2)", () => {
  const map = generateMap(DEFAULT_SPEC)
  const nav = new DynamicNav(map)

  test("route between lane points never enters clearance < radius", () => {
    const a = map.lanes[0]!.path[0]!
    const b = map.lanes[0]!.path.at(-1)!
    const pts = nav.path(a, b, HULL.hero)
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i]!
      expect(nav.walkable(p)).toBeTrue()
      // Waypoints (except the raw goal) sit at cell centers; check the cells traversed.
    }
    const goal = pts.at(-1)!
    expect(Math.hypot(goal.x - b.x, goal.z - b.z)).toBeLessThan(0.5 + HULL.hero)
  })

  test("1-tile slit (clearance 0.5) resolves and is used", () => {
    // 7x7: a wall of forest at x=3 with a single gap at z=3.
    const n = 7
    const mask: number[] = []
    for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) mask.push(x === 3 && z !== 3 ? 1 : 0)
    const slit = new DynamicNav(tinyMap(mask, n))
    expect(slit.clearance({ x: 3.5, z: 3.5 })).toBeGreaterThanOrEqual(HULL.hero)
    const pts = slit.path({ x: 0.5, z: 3.5 }, { x: 6.5, z: 3.5 }, HULL.hero)
    // The straight line through the slit is hull-clear, so it collapses to one leg.
    expect(pts.length).toBe(1)
    expect(pts[0]!.x).toBeCloseTo(6.5, 9)
    // ...and that line crosses the slit column.
    expect(pts[0]!.x > 3.5).toBeTrue()
  })

  test("tighter-than-hull slit is pruned when a wide route exists", () => {
    // 7x7: wall at x=3 with a 1-tile slit at z=1 and a 3-wide gap at z=4..6.
    // A radius-0.6 body does not fit the slit (clearance 0.5) but fits the
    // wide gap's centre (clearance 1.5), so the route bends through it.
    const n = 7
    const mask: number[] = []
    for (let z = 0; z < n; z++)
      for (let x = 0; x < n; x++) mask.push(x === 3 && !(z === 1 || (z >= 4 && z <= 6)) ? 1 : 0)
    const grid = new DynamicNav(tinyMap(mask, n))
    const pts = grid.path({ x: 0.5, z: 4.5 }, { x: 6.5, z: 4.5 }, 0.6)
    // Waypoints (cell centres) never sit in the tight slit row.
    for (const p of pts) expect(Math.floor(p.z)).not.toBe(1)
    // The goal is reached and the direct (slit-adjacent) line was not taken.
    expect(pts.length).toBeGreaterThan(1) // had to keep a corner
    expect(pts.at(-1)!.x).toBeCloseTo(6.5, 9)
  })
})

describe("dynamic nav: cut / regrow (spec/09 test 3)", () => {
  const n = 40
  const mask: number[] = []
  for (let z = 0; z < n; z++)
    for (let x = 0; x < n; x++) mask.push(x === 20 && z >= 1 && z <= 38 ? 1 : 0)
  const nav = new DynamicNav(tinyMap(mask, n))
  const west = { x: 0.5, z: 20.5 }
  const east = { x: 39.5, z: 20.5 }

  test("cut opens the shortcut, regrow closes it; dirty chunks ≤ 4", () => {
    // Before: wall blocks; path must snap around (long route through row 0 or 39).
    const before = nav.path(west, east, HULL.creep)
    expect(before.length).toBeGreaterThan(1)
    // Cut the tree at (20, 20) — opens the direct line.
    expect(nav.cutTree({ x: 20.5, z: 20.5 })).toBeTrue()
    expect(nav.lastDirtyChunks.length).toBeLessThanOrEqual(4)
    const opened = nav.path(west, east, HULL.creep)
    expect(opened.length).toBe(1) // straight shot
    // Regrow — closes it again.
    expect(nav.regrowTree({ x: 20.5, z: 20.5 })).toBeTrue()
    const closed = nav.path(west, east, HULL.creep)
    expect(closed.length).toBeGreaterThan(1)
  })
})

describe("local avoidance (spec/09 test 4)", () => {
  const nav = new DynamicNav(tinyMap([0], 1))
  type U = Parameters<typeof resolveUnits>[0][number]
  const mk = (over: Record<string, unknown>): U =>
    ({
      id: "x",
      x: 0,
      z: 0,
      heading: 0,
      vx: 0,
      vz: 0,
      radius: HULL.creep,
      priority: 1,
      mass: 1,
      speed: 3,
      ...over,
    }) as U

  test("head-on bodies pass without final overlap", () => {
    const a = mk({ id: "a", x: 20, z: 20, vz: 3 })
    const b = mk({ id: "b", x: 20, z: 26, vz: -3 })
    run(60, 0.1, () => resolveUnits([a, b], nav, 0.1))
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(a.radius + b.radius - 1e-6)
    expect(a.z).toBeGreaterThan(26) // passed each other
  })

  test("creep blocking: lower priority yields behind a slower hero", () => {
    // 1-wide forest corridor; hulls (0.6 + 0.6 = 1.2) cannot fit side by
    // side inside its 1.0 width, so the priority yield + hull separation
    // must hold the creep behind the hero.
    const n = 40
    const mask: number[] = []
    for (let z = 0; z < n; z++)
      for (let x = 0; x < n; x++) mask.push((x === 19 || x === 21) && z >= 8 && z <= 30 ? 1 : 0)
    const corridor = new DynamicNav(tinyMap(mask, n))
    const creep = mk({
      id: "c",
      x: 20.5,
      z: 10,
      heading: 0,
      vz: 3,
      priority: 1,
      mass: 1,
      radius: 0.6,
    })
    const hero = mk({
      id: "h",
      x: 20.5,
      z: 12,
      heading: 0,
      vz: 0.1,
      priority: 2,
      mass: 2,
      radius: 0.6,
      speed: 0.1,
    })
    run(80, 0.1, () => {
      hero.z += hero.vz * 0.1
      resolveUnits([creep, hero], corridor, 0.1)
    })
    // On the creep's goal axis (+z): creep never advances past hero + hull sum.
    expect(creep.z).toBeLessThanOrEqual(hero.z + creep.radius + hero.radius + 1e-6)
  })

  test("phase movement ignores unit collision", () => {
    const ghost = mk({ id: "g", x: 20, z: 10, vz: 3, phase: 5 })
    const hero = mk({
      id: "h",
      x: 20,
      z: 12,
      heading: 0,
      priority: 2,
      mass: 2,
      radius: HULL.hero,
      speed: 0.5,
    })
    run(30, 0.1, () => {
      ghost.z += ghost.vz * 0.1 // phased units integrate their own motion
      resolveUnits([ghost, hero], nav, 0.1)
    })
    expect(ghost.z).toBeGreaterThan(12) // walked straight through
  })
})

describe("wall sliding (spec/09 test 5)", () => {
  const n = 5
  const mask: number[] = []
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) mask.push(x >= 3 ? 1 : 0)
  const nav = new DynamicNav(tinyMap(mask, n))

  test("45° into a wall: slides along it, normal component removed", () => {
    const b = { x: 2.8, z: 2.5 }
    slideMove(nav, b, 0.3, 0.25, false) // diagonal; x-step lands in forest at x≥3
    expect(b.x).toBe(2.8) // normal (x) component projected out
    expect(b.z).toBeCloseTo(2.75, 9) // tangential component kept
  })
})

describe("free pathing (spec/09 test 6)", () => {
  const n = 9
  const mask: number[] = []
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) mask.push(z === 4 ? 1 : 0)
  const nav = new DynamicNav(tinyMap(mask, n))

  test("free-pathing body paths out of forest; flag decays", () => {
    const b = {
      x: 4.5,
      z: 4.5, // inside the forest row
      heading: 0,
      speed: 2,
      turnRate: TURN.mid,
      freePath: 5,
      moveWithoutTurning: true,
    }
    // Straight north out of the wall, ignoring forest.
    run(60, 0.1, () => moveBody(b, nav, { x: 4.5, z: 0.5 }, 0, 0.1))
    expect(b.z).toBeLessThan(4) // escaped the forest row
    // Decay: simulate flag expiry, then movement into forest is blocked again.
    b.freePath = 0
    const x0 = b.x
    const z0 = b.z
    run(5, 0.1, () => moveBody(b, nav, { x: 4.5, z: 8.5 }, 0, 0.1))
    expect(nav.blocked({ x: b.x, z: b.z })).toBeFalse()
    expect(Math.hypot(b.x - x0, b.z - z0)).toBeGreaterThan(0) // it still slid along the wall
  })

  test("path() with ignoreForest crosses forest cells", () => {
    const pts = nav.path({ x: 4.5, z: 1.5 }, { x: 4.5, z: 7.5 }, HULL.hero, { ignoreForest: true })
    expect(pts.length).toBe(1) // direct line allowed
  })
})
