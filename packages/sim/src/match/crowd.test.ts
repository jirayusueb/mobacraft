import { describe, expect, test } from "bun:test"
import {
  type CrowdAgent,
  type CrowdWorld,
  type Mover,
  PRIORITY,
  contextSteer,
  crowdStep,
  newMoverState,
  orcaVelocity,
  yieldDirection,
} from "./crowd.ts"
import { AttackRings, reach, ringGeometry } from "./attack-ring.ts"
import {
  MOTION_BUFFER,
  beginSwing,
  cancelBackswing,
  isLocked,
  newSwing,
  swingTiming,
  tickSwing,
} from "./attack-phase.ts"

const DT = 0.1
const agent = (x: number, z: number, vx: number, vz: number, priority: number): CrowdAgent => ({
  x,
  z,
  vx,
  vz,
  radius: 0.4,
  priority,
})

const mover = (id: string, x: number, z: number, team = "a"): Mover => ({
  id,
  team,
  x,
  z,
  radius: 0.4,
  maxSpeed: 3,
  mode: "free",
  ...newMoverState(),
})

const openWorld = (movers: readonly Mover[]): CrowdWorld<Mover> => ({
  neighbors: (_m, _r, out) => {
    out.push(...movers)
  },
  walkable: () => true,
  canYield: () => true,
})

const minGap = (ms: readonly Mover[]) => {
  let g = Infinity
  for (let i = 0; i < ms.length; i++)
    for (let j = i + 1; j < ms.length; j++)
      g = Math.min(g, Math.hypot(ms[i]!.x - ms[j]!.x, ms[i]!.z - ms[j]!.z) - 0.8)
  return g
}

const deviation = (pSelf: number, pOther: number) => {
  const v = orcaVelocity(agent(0, 0, 2, 0, pSelf), 2, 0, 3, [agent(2, 0.1, -2, 0, pOther)], DT)
  return Math.hypot(v.x - 2, v.z)
}

const runCrowd = () => {
  const ms = Array.from({ length: 8 }, (_, i) =>
    mover(`m${i}`, (i % 3) * 0.5, Math.floor(i / 3) * 0.5),
  )
  for (let t = 0; t < 30; t++) {
    for (const m of ms) {
      m.pvx = 10 - m.x
      m.pvz = 1 - m.z
      const l = Math.hypot(m.pvx, m.pvz)
      m.pvx = (m.pvx / l) * 3
      m.pvz = (m.pvz / l) * 3
    }
    crowdStep(ms, DT, openWorld(ms))
  }
  return ms.map((m) => [m.x, m.z])
}

describe("ORCA", () => {
  test("head-on pair passes each other without overlapping", () => {
    const a = mover("a", 0, 0)
    const b = mover("b", 6, 0.05)
    const ms = [a, b]
    let worst = Infinity
    for (let t = 0; t < 40; t++) {
      a.pvx = 3
      a.pvz = 0
      b.pvx = -3
      b.pvz = 0
      crowdStep(ms, DT, openWorld(ms))
      worst = Math.min(worst, minGap(ms))
    }
    expect(a.x).toBeGreaterThan(6)
    expect(b.x).toBeLessThan(0)
    expect(worst).toBeGreaterThan(-0.08)
  })

  test("a priority-1.0 agent never avoids", () => {
    const self = agent(0, 0, 0, 0, PRIORITY.locked)
    const v = orcaVelocity(self, 0, 0, 3, [agent(0.5, 0, -3, 0, PRIORITY.moving)], DT)
    expect(v).toEqual({ x: 0, z: 0 })
  })

  test("the lower-priority agent takes the larger share of the correction", () => {
    // Two agents converging head-on; compare how far each deviates from preferred.
    expect(deviation(PRIORITY.idle, PRIORITY.moving)).toBeGreaterThan(
      deviation(PRIORITY.moving, PRIORITY.idle),
    )
  })

  test("locked movers stay put while others flow around them", () => {
    const wall = mover("w", 3, 0)
    wall.mode = "locked"
    const a = mover("a", 0, 0.1)
    const ms = [wall, a]
    for (let t = 0; t < 40; t++) {
      a.pvx = 3
      a.pvz = 0
      crowdStep(ms, DT, openWorld(ms))
    }
    expect(wall.x).toBe(3)
    expect(wall.z).toBe(0)
    expect(a.x).toBeGreaterThan(5)
  })

  test("stacked spawns separate within a few ticks", () => {
    const ms = [mover("a", 5, 5), mover("b", 5.01, 5), mover("c", 5, 5.02)]
    for (let t = 0; t < 10; t++) crowdStep(ms, DT, openWorld(ms))
    expect(minGap(ms)).toBeGreaterThan(-0.1)
  })

  test("is deterministic", () => {
    expect(runCrowd()).toEqual(runCrowd())
  })
})

describe("context steering", () => {
  test("goes straight when clear", () => {
    expect(contextSteer({ x: 0, z: 0 }, 0.4, { x: 2, z: 0 }, [], () => true)).toEqual({
      x: 1,
      z: 0,
    })
  })

  test("detours around a blocker sitting on the line", () => {
    const d = contextSteer(
      { x: 0, z: 0 },
      0.4,
      { x: 3, z: 0 },
      [{ x: 1, z: 0, radius: 0.4 }],
      () => true,
    )!
    expect(d.x).toBeGreaterThan(0) // still makes progress
    expect(Math.abs(d.z)).toBeGreaterThan(0.3) // but sidesteps
  })

  test("avoids unwalkable ground", () => {
    const d = contextSteer(
      { x: 0, z: 0 },
      0.4,
      { x: 2, z: 0 },
      [],
      (x, z) => !(x > 0.3 && z > -0.5 && z < 0.5),
    )!
    expect(Math.abs(d.z)).toBeGreaterThan(0.3)
  })
})

describe("yielding", () => {
  test("perpendicular, on the side the yielder already stands", () => {
    const left = yieldDirection({ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 0.1 }, false)
    expect(left).toEqual({ x: -0, z: 1 })
    const right = yieldDirection({ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 1, z: -0.1 }, true)
    expect(right).toEqual({ x: 0, z: -1 })
  })

  test("an idle teammate steps aside for a mover and the mover gets through", () => {
    const idle = mover("idle", 1.2, 0.02)
    const a = mover("a", 0, 0)
    const ms = [idle, a]
    let yielded = false
    for (let t = 0; t < 20; t++) {
      a.pvx = 3
      a.pvz = 0
      crowdStep(ms, DT, openWorld(ms))
      if (idle.yieldT > 0) yielded = true
    }
    expect(yielded).toBe(true)
    expect(a.x).toBeGreaterThan(4)
    expect(Math.abs(idle.z)).toBeGreaterThan(0.2)
  })

  test("the in-range guard blocks a yield", () => {
    const idle = mover("idle", 1.2, 0.02)
    idle.mode = "engaged"
    const a = mover("a", 0, 0)
    const ms = [idle, a]
    const world: CrowdWorld<Mover> = { ...openWorld(ms), canYield: () => false }
    a.pvx = 3
    crowdStep(ms, DT, world)
    expect(idle.yieldT).toBe(0)
  })
})

describe("attack rings", () => {
  test("geometry: hero target gets 8 inner slots, all within melee reach", () => {
    const g = ringGeometry(0.4)
    expect(g.n1).toBe(8)
    expect(g.r1).toBeLessThanOrEqual(reach(1.2, 0.4))
    expect(g.n2).toBeGreaterThan(g.n1)
  })

  test("reserves the cheapest slot facing the attacker, distinct per attacker", () => {
    const rings = new AttackRings()
    const t = { x: 10, z: 10 }
    const s1 = rings.request("a", { x: 13, z: 10 }, "t", t, 0.4, 1.7)!
    const g1 = rings.goalOf("a", t)!
    expect(g1.x).toBeGreaterThan(10.9) // east side, toward the attacker
    const s2 = rings.request("b", { x: 13, z: 10 }, "t", t, 0.4, 1.7)!
    expect(s2).not.toEqual(s1)
    expect(rings.free("t", 1)).toBe(6)
  })

  test("long-reach melee prefers ring 2", () => {
    const rings = new AttackRings()
    expect(rings.request("doom", { x: 13, z: 10 }, "t", { x: 10, z: 10 }, 0.4, 2.6)!.ring).toBe(2)
  })

  test("full ring 1 overflows to ring 2; release frees the slot", () => {
    const rings = new AttackRings()
    const t = { x: 0, z: 0 }
    for (let i = 0; i < 8; i++)
      expect(rings.request(`a${i}`, { x: 3, z: 0 }, "t", t, 0.4, 1.7)!.ring).toBe(1)
    expect(rings.request("late", { x: 3, z: 0 }, "t", t, 0.4, 1.7)!.ring).toBe(2)
    rings.release("a0")
    expect(rings.free("t", 1)).toBe(1)
    rings.dropTarget("t")
    expect(rings.slotOf("a1")).toBeUndefined()
  })

  test("preemption: an in-reach arriver swaps with a far-away holder, then both freeze", () => {
    const rings = new AttackRings()
    const t = { x: 0, z: 0 }
    const far = new Map<string, { x: number; z: number }>()
    for (let i = 0; i < 8; i++) {
      rings.request(`h${i}`, { x: 3, z: 0 }, "t", t, 0.4, 1.7)
      far.set(`h${i}`, { x: 2.9, z: 0 })
    }
    rings.request("arr", { x: 1.2, z: 0 }, "t", t, 0.4, 1.7) // ring 2
    const arriver = { x: 1.2, z: 0 }
    const victim = rings.preempt(
      "arr",
      arriver,
      "t",
      t,
      0,
      (id) => far.get(id),
      () => false,
    )
    expect(victim).toBeDefined()
    expect(rings.slotOf("arr")!.slot.ring).toBe(1)
    expect(rings.slotOf(victim!)!.slot.ring).toBe(2)
    // Frozen: the victim cannot immediately preempt back.
    expect(
      rings.preempt(
        victim!,
        arriver,
        "t",
        t,
        0.5,
        () => ({ x: 9, z: 9 }),
        () => false,
      ),
    ).toBeUndefined()
  })

  test("preemption never steals from a holder already in reach", () => {
    const rings = new AttackRings()
    const t = { x: 0, z: 0 }
    for (let i = 0; i < 8; i++) rings.request(`h${i}`, { x: 3, z: 0 }, "t", t, 0.4, 1.7)
    expect(
      rings.preempt(
        "arr",
        { x: 1, z: 0 },
        "t",
        t,
        0,
        () => ({ x: 3, z: 0 }),
        () => true,
      ),
    ).toBeUndefined()
  })
})

describe("attack phases", () => {
  const timing = swingTiming("hero", 1.4, 1)

  test("timings fit inside the base attack time", () => {
    expect(timing.point).toBeCloseTo(0.3)
    expect(timing.backswing).toBeCloseTo(0.5)
    const fast = swingTiming("hero", 0.6, 2)
    expect(fast.point + fast.backswing).toBeLessThanOrEqual(0.3 + 1e-9)
  })

  test("damage fires exactly once, when the point completes; point locks", () => {
    const s = newSwing()
    beginSwing(s, "t", timing, 1.4)
    expect(isLocked(s)).toBe(true)
    const events = Array.from({ length: 10 }, () => tickSwing(s, DT, true, 1, 1.7))
    expect(events.filter((e) => e === "damage")).toHaveLength(1)
    expect(events.indexOf("damage")).toBe(2) // 0.3 s = third tick
    expect(isLocked(s)).toBe(false)
  })

  test("motion buffer keeps the swing while the target walks out of range", () => {
    const s = newSwing()
    beginSwing(s, "t", timing, 1.4)
    expect(tickSwing(s, DT, true, 1.7 + MOTION_BUFFER - 0.1, 1.7)).toBe("none")
    tickSwing(s, DT, true, 1.7 + MOTION_BUFFER - 0.1, 1.7)
    expect(tickSwing(s, DT, true, 1.7 + MOTION_BUFFER - 0.1, 1.7)).toBe("damage")
  })

  test("beyond the buffer, or invalid, the point cancels", () => {
    const s = newSwing()
    beginSwing(s, "t", timing, 1.4)
    expect(tickSwing(s, DT, true, 1.7 + MOTION_BUFFER + 0.1, 1.7)).toBe("cancel")
    beginSwing(s, "t", timing, 1.4)
    expect(tickSwing(s, DT, false, 1, 1.7)).toBe("cancel")
  })

  test("backswing is cancelable, the point is not", () => {
    const s = newSwing()
    beginSwing(s, "t", timing, 1.4)
    expect(cancelBackswing(s)).toBe(false)
    for (let i = 0; i < 3; i++) tickSwing(s, DT, true, 1, 1.7)
    expect(s.phase).toBe("backswing")
    expect(cancelBackswing(s)).toBe(true)
    expect(s.phase).toBe("idle")
  })
})
