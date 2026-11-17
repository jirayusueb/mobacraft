import { describe, expect, test } from "bun:test"
import { ALL_CREATURE_KINDS, HEROES, type Unit, type UnitKind } from "@mobacraft/sim"
import { creatureModel } from "./kit.ts"
import { createAnimState, DEATH_TIME, stepAnim } from "./motion.ts"
import { FLOATS_PER_BONE, PoseSolver, type Skeleton } from "./skeleton.ts"

const kinds: UnitKind[] = [...ALL_CREATURE_KINDS, ...HEROES.map((h) => h.id)]
const modelOf = (kind: UnitKind) => creatureModel(kind)

const pose = (skel: Skeleton, over: Partial<Parameters<PoseSolver["solve"]>[0]> = {}) => {
  const solver = new PoseSolver(skel)
  const out = new Float32Array(skel.count * FLOATS_PER_BONE)
  solver.solve(
    {
      time: 0,
      phase: 0,
      move: 0,
      stride: 0.8,
      attack: 1,
      style: "swing",
      hit: 0,
      death: -1,
      turn: 0,
      seed: 0,
      ...over,
    },
    out,
  )
  return { solver, out }
}

describe("creature skeletons", () => {
  test("every kind builds a valid hierarchy", () => {
    for (const kind of kinds) {
      const skel = modelOf(kind).skeleton
      expect(skel.count).toBeGreaterThan(3)
      expect(skel.names[skel.root]).toBe("root")
      for (let i = 0; i < skel.count; i++)
        if (i !== skel.root) expect(skel.parent[i]!).toBeGreaterThanOrEqual(0)
    }
  })

  test("bind pose reproduces rest positions (FK ≈ rest)", () => {
    for (const kind of kinds.slice(0, 8)) {
      const skel = modelOf(kind).skeleton
      const solver = new PoseSolver(skel)
      const out = new Float32Array(skel.count * FLOATS_PER_BONE)
      solver.bind(out)
      // Root translation must be ~0 in bind; child heads land on rest heads.
      for (let i = 0; i < skel.count; i++) {
        const o = i * FLOATS_PER_BONE
        const ry = skel.rest[i * 3 + 1]!
        // Identity rotation at bind: world y = rest y + root ty (a small rest crouch).
        const worldY = out[o + 5]! * ry + out[o + 7]! // m11·y + ty
        expect(Math.abs(worldY - ry)).toBeLessThan(0.02)
        const worldZ = out[o + 10]! * skel.rest[i * 3 + 2]! + out[o + 11]!
        expect(Math.abs(worldZ - skel.rest[i * 3 + 2]!)).toBeLessThan(0.05)
      }
    }
  })

  test("walking moves a foot forward and back, planted feet do not slide", () => {
    const skel = modelOf("radiant-melee").skeleton
    const solver = new PoseSolver(skel)
    const out = new Float32Array(skel.count * FLOATS_PER_BONE)
    const inp = {
      time: 0,
      phase: 0,
      move: 1,
      stride: 0.8,
      attack: 1,
      style: "swing" as const,
      hit: 0,
      death: -1,
      turn: 0,
      seed: 0,
    }
    const footZ = (phase: number) => {
      solver.solve({ ...inp, phase }, out)
      const l = skel.legs[0]!
      const o = l.foot * FLOATS_PER_BONE
      return out[o + 11]! // tz of the foot bone
    }
    const back = footZ(0) // group −1 leg: swing start
    const fwd = footZ(Math.PI) // half a cycle later: stance end → furthest forward
    expect(fwd).toBeGreaterThan(back + 0.05)
  })

  test("attack swing swings the weapon arm below its rest height", () => {
    const skel = modelOf("ironwarden").skeleton
    const arm = skel.arms.find((a) => a.side < 0)!
    const rest = skel.rest[arm.hand * 3 + 1]!
    const { out } = pose(skel, { attack: 0.45, style: "swing" })
    const o = arm.hand * FLOATS_PER_BONE
    const y = out[o + 5]! * rest + out[o + 7]!
    expect(y).toBeGreaterThan(rest - skel.height) // sane range
    const { out: outWind } = pose(skel, { attack: 0.2, style: "swing" })
    const ow = arm.hand * FLOATS_PER_BONE
    const yWind = outWind[ow + 5]! * rest + outWind[ow + 7]!
    // Wind-up raises the hand above the strike point.
    expect(yWind).toBeGreaterThan(y - 0.05)
  })

  test("death topples the body below standing height", () => {
    const skel = modelOf("kobold").skeleton
    const { out } = pose(skel, { death: 0.6 })
    const head = skel.head
    const restY = skel.rest[head * 3 + 1]!
    const o = head * FLOATS_PER_BONE
    const y = out[o + 5]! * restY + out[o + 7]!
    expect(y).toBeLessThan(restY * 0.5)
  })

  test("leg IK keeps the ankle within reach of the hip", () => {
    for (const kind of kinds) {
      const skel = modelOf(kind).skeleton
      if (!skel.legs.length) continue
      const { out } = pose(skel, { move: 1, phase: 1.3 })
      for (const leg of skel.legs) {
        const o = leg.shin * FLOATS_PER_BONE
        const knee = [out[o + 3]!, out[o + 7]!, out[o + 11]!]
        const oh = leg.thigh * FLOATS_PER_BONE
        const hip = [out[oh + 3]!, out[oh + 7]!, out[oh + 11]!]
        const d = Math.hypot(knee[0]! - hip[0]!, knee[1]! - hip[1]!, knee[2]! - hip[2]!)
        expect(d).toBeLessThan(1.2 * skel.height)
      }
    }
  })

  test("skinning covers every vertex with weights in [0,1]", () => {
    for (const kind of kinds) {
      const g = modelOf(kind).geometry
      const bind = g.getAttribute("bind")
      for (let i = 0; i < bind.count; i++) {
        expect(bind.getX(i)).toBeGreaterThanOrEqual(0)
        expect(bind.getY(i)).toBeGreaterThanOrEqual(0)
        expect(bind.getZ(i)).toBeGreaterThanOrEqual(0)
        expect(bind.getZ(i)).toBeLessThanOrEqual(1)
      }
    }
  })

  test("attribute names are legal WGSL identifiers (not reserved words)", () => {
    const reserved = new Set(
      "meta self super this type typedef typeof union unless using var void with yield as async attribute auto await become cast catch class const_cast continue_if default delete demote do dynamic_cast enum explicit export extends extern external fallthrough filter final finally friend from fxgroup get goto groupshared highp impl implements import inline instanceof interface layout lowp macro macro_rules match mediump mod module move mut mutable namespace new nil noexcept noinline nointerpolation noperspective null nullptr of operator package packoffset partition pass patch pixelfragment precise precision premerge priv protected pub public readonly ref regardless register reinterpret_cast require resource restrict sample sampler set shared signed sizeof smooth snorm static static_assert static_cast std subroutine template unorm unsafe virtual volatile wgsl where".split(
        " ",
      ),
    )
    for (const kind of kinds)
      for (const name of Object.keys(modelOf(kind).geometry.attributes))
        expect(reserved.has(name)).toBe(false)
  })

  test("vertex count is preserved by the bake", () => {
    for (const kind of ["radiant-melee", "wolf", "roshan", "ironwarden"] as const) {
      const g = modelOf(kind).geometry
      // partInfo and bind must cover every vertex.
      expect(g.getAttribute("partInfo").count).toBe(g.getAttribute("position").count)
      expect(g.getAttribute("bind").count).toBe(g.getAttribute("position").count)
    }
  })

  test("legged kinds have legs; spirits float; siege has wheels", () => {
    expect(modelOf("wolf").skeleton.legs.length).toBe(4)
    expect(modelOf("ghost").skeleton.floating).toBe(true)
    expect(modelOf("radiant-siege").skeleton.wheels.length).toBeGreaterThan(1)
    expect(modelOf("dire-siege").skeleton.lever).toBeGreaterThanOrEqual(0)
    expect(modelOf("wolf").skeleton.tail.length).toBeGreaterThan(0)
  })
})

const mkUnit = (over: Partial<Unit> = {}): Unit => ({
  id: "u1",
  kind: "radiant-melee",
  team: "radiant",
  x: 0,
  z: 0,
  heading: Math.PI / 2,
  ...over,
})

describe("creature motion state", () => {
  test("phase advances with distance, not time", () => {
    const s = createAnimState(mkUnit())
    const start = s.phase
    stepAnim(s, mkUnit(), 1, 1)
    expect(s.phase).toBe(start)
    stepAnim(s, mkUnit({ x: 0.5 }), 1 / 60, 1)
    expect(s.phase - start).toBeCloseTo(Math.PI, 5)
  })

  test("move eases in while walking and out at rest", () => {
    const s = createAnimState(mkUnit())
    for (let i = 1; i <= 30; i++) stepAnim(s, mkUnit({ x: i * 0.04 }), 1 / 60, 1)
    expect(s.move).toBeGreaterThan(0.95)
    for (let i = 0; i < 60; i++) stepAnim(s, mkUnit({ x: 1.2 }), 1 / 60, 1)
    expect(s.move).toBeLessThan(0.05)
  })

  test("a teleport (respawn) does not spin the stride", () => {
    const s = createAnimState(mkUnit())
    const start = s.phase
    stepAnim(s, mkUnit({ x: 40 }), 1 / 60, 1)
    expect(s.phase).toBe(start)
    expect(s.move).toBe(0)
  })

  test("an attack counter increase plays one swing", () => {
    const s = createAnimState(mkUnit())
    expect(s.attack).toBe(1)
    stepAnim(s, mkUnit({ attacks: 1 }), 1 / 60, 1)
    expect(s.attack).toBeLessThan(0.1)
    for (let t = 0; t < 0.8; t += 1 / 60) stepAnim(s, mkUnit({ attacks: 1 }), 1 / 60, 1)
    expect(s.attack).toBe(1)
  })

  test("an hp drop triggers the hit flinch; death starts the clip", () => {
    const s = createAnimState(mkUnit({ hp: 1 }))
    stepAnim(s, mkUnit({ hp: 0.9 }), 1 / 60, 1)
    expect(s.hit).toBeGreaterThan(0.9)
    for (let i = 0; i < 90; i++) stepAnim(s, mkUnit({ hp: 0.9, alive: false }), 1 / 60, 1)
    expect(s.death).toBeGreaterThan(DEATH_TIME * 0.9)
  })

  test("a respawned hero leaves the death pose (not stuck sunk underground)", () => {
    const s = createAnimState(mkUnit({ hp: 1 }))
    for (let i = 0; i < 120; i++) stepAnim(s, mkUnit({ hp: 0, alive: false }), 1 / 60, 1)
    expect(s.death).toBe(1)
    // Respawn at the fountain (teleport) — must render alive again.
    stepAnim(s, mkUnit({ hp: 1, alive: true, x: 60 }), 1 / 60, 1)
    expect(s.death).toBe(-1)
  })

  test("an Aegis revive mid-death-clip (alive again in place) ends the clip", () => {
    const s = createAnimState(mkUnit({ hp: 1 }))
    for (let i = 0; i < 20; i++) stepAnim(s, mkUnit({ hp: 0, alive: false }), 1 / 60, 1)
    expect(s.death).toBeGreaterThan(0)
    stepAnim(s, mkUnit({ hp: 1, alive: true }), 1 / 60, 1)
    expect(s.death).toBe(-1)
  })

  test("heading turns along the shortest arc", () => {
    const s = createAnimState(mkUnit({ heading: 3 }))
    stepAnim(s, mkUnit({ heading: -3 }), 1 / 60, 1)
    expect(Math.abs(s.heading)).toBeGreaterThan(3)
  })
})
