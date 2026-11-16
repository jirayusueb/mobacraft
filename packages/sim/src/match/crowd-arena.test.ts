/**
 * spec/09 acceptance arenas: the same planner (engage.ts), swing state machine
 * (attack-phase.ts) and crowd pass (crowd.ts) that match.ts runs, on open ground.
 */
import { describe, expect, test } from "bun:test"
import { AttackRings, reach } from "./attack-ring.ts"
import {
  type Swing,
  beginSwing,
  cancelBackswing,
  isLocked,
  newSwing,
  swingTiming,
  tickSwing,
} from "./attack-phase.ts"
import { type CrowdWorld, type Mover, crowdStep, newMoverState } from "./crowd.ts"
import { isMicro, microWaypoint, planEngage } from "./engage.ts"

const DT = 0.1

interface Unit {
  m: Mover
  range: number
  speed: number
  bat: number
  cd: number
  sw: Swing
  micro: boolean
  target?: Unit
  dealt: number
}

const unit = (id: string, team: string, x: number, z: number, range = 1.4, speed = 3): Unit => ({
  m: { id, team, x, z, radius: 0.4, maxSpeed: speed, mode: "free", ...newMoverState() },
  range,
  speed,
  bat: 1.4,
  cd: 0,
  sw: newSwing(),
  micro: false,
  dealt: 0,
})

const world = (units: readonly Unit[], walkable = (_x: number, _z: number) => true) => {
  const byMover = new Map(units.map((u) => [u.m, u]))
  const w: CrowdWorld<Mover> = {
    neighbors: (_m, _r, out) => {
      for (const u of units) out.push(u.m)
    },
    walkable: (x, z) => walkable(x, z),
    canYield: (m, dx, dz) => {
      const u = byMover.get(m)!
      const t = u.target
      if (m.mode !== "engaged" || !t) return true
      return Math.hypot(m.x + dx - t.m.x, m.z + dz - t.m.z) <= reach(u.range, t.m.radius)
    },
  }
  return w
}

/** One tick of the match loop's combat + movement, in the same order as match.ts. */
const tick = (
  units: readonly Unit[],
  rings: AttackRings,
  now: number,
  walkable = (_x: number, _z: number) => true,
) => {
  const byId = new Map(units.map((u) => [u.m.id, u]))
  for (const u of units) {
    u.cd = Math.max(0, u.cd - DT)
    const t = u.target
    if (u.sw.phase !== "idle") {
      const ev = tickSwing(
        u.sw,
        DT,
        !!t,
        t ? Math.hypot(t.m.x - u.m.x, t.m.z - u.m.z) : Infinity,
        t ? reach(u.range, t.m.radius) : 0,
      )
      if (ev === "damage") u.dealt++
    }
  }
  for (const u of units) {
    const t = u.target
    if (!t) continue
    const plan = planEngage(
      rings,
      { id: u.m.id, x: u.m.x, z: u.m.z, range: u.range },
      { id: t.m.id, x: t.m.x, z: t.m.z, radius: t.m.radius },
      now,
      (id) => byId.get(id)?.m,
      (id) => {
        const o = byId.get(id)!
        return Math.hypot(o.m.x - t.m.x, o.m.z - t.m.z) <= reach(o.range, t.m.radius)
      },
    )
    if (plan.inReach) {
      u.m.mode = "engaged"
      if (u.cd <= 0 && !isLocked(u.sw)) {
        u.cd = u.bat
        beginSwing(u.sw, t.m.id, swingTiming("hero", u.bat, 1), u.cd)
      }
      if (plan.drift && !isLocked(u.sw)) {
        cancelBackswing(u.sw)
        const dx = plan.drift.x - u.m.x
        const dz = plan.drift.z - u.m.z
        const d = Math.hypot(dx, dz)
        const v = Math.min(u.speed, d / DT)
        u.m.pvx = (dx / d) * v
        u.m.pvz = (dz / d) * v
      }
      continue
    }
    if (isLocked(u.sw)) continue
    cancelBackswing(u.sw)
    const gd = Math.hypot(plan.goal.x - u.m.x, plan.goal.z - u.m.z)
    u.micro = isMicro(u.micro, gd)
    let wp = plan.goal
    if (u.micro) {
      const blockers = units.filter((o) => o !== u && !idleAlly(u, o)).map((o) => o.m)
      const w = microWaypoint(u.m, u.m.radius, plan.goal, blockers, walkable)
      if (!w) continue
      wp = w
    }
    const dx = wp.x - u.m.x
    const dz = wp.z - u.m.z
    const d = Math.hypot(dx, dz) || 1
    const v = Math.min(u.speed, (gd - plan.stopAt) / DT)
    if (v <= 0.01) continue
    u.m.pvx = (dx / d) * v
    u.m.pvz = (dz / d) * v
  }
  for (const u of units) if (isLocked(u.sw)) u.m.mode = "locked"
  crowdStep(
    units.map((u) => u.m),
    DT,
    world(units, walkable),
  )
  for (const u of units) {
    u.m.pvx = 0
    u.m.pvz = 0
    u.m.mode = "free"
  }
}

/** Idle teammates are not steering obstacles: we walk at them and they yield (spec/09 §6). */
const idleAlly = (self: Unit, o: Unit) =>
  o.m.team === self.m.team && !o.target && Math.hypot(o.m.vx, o.m.vz) < 0.05

/** 3-tile lane z ∈ (8.5, 11.5). */
const laneWalk = (_x: number, z: number) => z > 8.5 && z < 11.5

const worstOverlap = (units: readonly Unit[]) => {
  let worst = 0
  for (let i = 0; i < units.length; i++)
    for (let j = i + 1; j < units.length; j++) {
      const a = units[i]!.m
      const b = units[j]!.m
      const R = a.radius + b.radius
      worst = Math.max(worst, (R - Math.hypot(a.x - b.x, a.z - b.z)) / R)
    }
  return worst
}

describe("crowd arena (spec/09 acceptance)", () => {
  test("8 melee attackers on one target: ≥ 6 swinging within 4 s, no deep overlap, no crowd cancels", () => {
    const target = unit("t", "b", 10, 10)
    target.m.maxSpeed = 0
    const attackers = Array.from({ length: 8 }, (_, i) =>
      unit(`a${i}`, "a", 6.6 - (i % 2) * 0.9, 8.65 + (i >> 1) * 0.9),
    )
    for (const a of attackers) a.target = target
    const all = [target, ...attackers]
    const rings = new AttackRings()
    const swinging = new Set<string>()
    let cancels = 0
    for (let k = 0; k < 40; k++) {
      tick(all, rings, k * DT)
      for (const a of attackers) if (a.sw.phase !== "idle" || a.dealt > 0) swinging.add(a.m.id)
    }
    for (const a of attackers)
      cancels += a.sw.phase === "idle" && a.dealt === 0 && swinging.has(a.m.id) ? 1 : 0
    expect(swinging.size).toBeGreaterThanOrEqual(6)
    expect(cancels).toBe(0)
    // Settle, then check spacing.
    for (let k = 40; k < 60; k++) tick(all, rings, k * DT)
    expect(worstOverlap(all)).toBeLessThan(0.3)
  })

  test("corridor: a hero passes a melee brawl and an idle ally in a 3-tile lane", () => {
    // Lane z ∈ (8.5, 11.5). A 1v1 brawl mid-lane, an idle ally in the runner's way.
    const ally = unit("x1", "a", 9.2, 10)
    const foe = unit("fa", "b", 10.4, 10)
    ally.target = foe
    foe.target = ally
    const idle = unit("idle", "a", 6, 10.6)
    const runner = unit("run", "a", 3, 10.6)
    const all = [foe, ally, idle, runner]
    const rings = new AttackRings()
    let passed = -1
    let yielded = false
    for (let k = 0; k < 150 && passed < 0; k++) {
      const w = microWaypoint(
        runner.m,
        0.4,
        { x: Math.min(18, runner.m.x + 2.5), z: 10 },
        all.filter((u) => u !== runner && !idleAlly(runner, u)).map((u) => u.m),
        laneWalk,
      )
      if (w) {
        const dx = w.x - runner.m.x
        const dz = w.z - runner.m.z
        const d = Math.hypot(dx, dz) || 1
        runner.m.pvx = (dx / d) * 3
        runner.m.pvz = (dz / d) * 3
      }
      tick(all, rings, k * DT, laneWalk)
      if (idle.m.yieldT > 0) yielded = true
      if (runner.m.x > 12) passed = k * DT
    }
    expect(yielded).toBe(true)
    expect(passed).toBeGreaterThan(0)
    expect(passed).toBeLessThan(6)
    // The brawl kept swinging the whole time.
    expect(ally.dealt + foe.dealt).toBeGreaterThan(0)
  })

  test("DPS parity: 3-phase swings kill as fast as instant hits, plus one attack point", () => {
    const a = unit("a", "a", 0, 0)
    const t = unit("t", "b", 1.2, 0)
    t.m.maxSpeed = 0
    a.target = t
    const rings = new AttackRings()
    const hits = 5
    let at = -1
    for (let k = 0; k < 200 && at < 0; k++) {
      tick([a, t], rings, k * DT)
      if (a.dealt >= hits) at = (k + 1) * DT
    }
    // Instant model: hits at 0, BAT, 2·BAT … → last hit at (hits−1)·BAT.
    const instant = (hits - 1) * a.bat
    expect(at).toBeGreaterThanOrEqual(instant)
    expect(at).toBeLessThanOrEqual(instant + 0.3 + DT + 1e-9)
  })

  test("motion buffer: a target walking away mid-point still gets hit", () => {
    const a = unit("a", "a", 0, 0)
    const t = unit("t", "b", 1.5, 0)
    a.target = t
    const rings = new AttackRings()
    tick([a, t], rings, 0) // point starts
    expect(a.sw.phase).toBe("point")
    // Target flees at 3 tiles/s for the rest of the point.
    for (let k = 1; k < 4; k++) {
      t.m.x += 3 * DT
      tick([a, t], rings, k * DT)
    }
    expect(a.dealt).toBe(1)
  })
})
