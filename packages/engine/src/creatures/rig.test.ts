import { describe, expect, test } from "bun:test"
import { ALL_CREATURE_KINDS, HEROES, type Unit, type UnitKind } from "@mobacraft/sim"
import { creatureModel } from "./kit.ts"
import { ATTACK_TIME, createAnimState, stepAnim } from "./motion.ts"
import { BONE } from "./rig.ts"

const kinds: UnitKind[] = [...ALL_CREATURE_KINDS, ...HEROES.map((h) => h.id)]

describe("creature rigging", () => {
  test.each(kinds)("%s: every limb vertex is bound to a joint on its own side", (kind) => {
    const g = creatureModel(kind).geometry
    const pos = g.getAttribute("position")
    const meta = g.getAttribute("partInfo")
    const rig = g.getAttribute("rig")
    const limb = { getX: (i: number) => meta.getX(i) }
    const bone = { getX: (i: number) => rig.getW(i) }
    const pivot = { getY: (i: number) => rig.getY(i) }
    expect(Object.keys(g.attributes).length).toBeLessThanOrEqual(5)
    const h = creatureModel(kind).height
    let unbound = 0
    for (let i = 0; i < pos.count; i++) {
      if (limb.getX(i) === 0) {
        expect(bone.getX(i)).toBe(BONE.body)
        continue
      }
      if (bone.getX(i) === BONE.body) {
        unbound++
        continue
      }
      // Pivot inside the model's bounds — a stray joint would fling the limb.
      expect(pivot.getY(i)).toBeGreaterThanOrEqual(-0.01)
      expect(pivot.getY(i)).toBeLessThanOrEqual(h + 0.01)
    }
    expect(unbound).toBe(0)
  })

  test("attribute names are legal WGSL identifiers (not reserved words)", () => {
    // WGSL reserves many common words; a reserved attribute name silently drops every
    // creature draw (pipeline creation fails at runtime only).
    const reserved = new Set(
      "meta self super this type typedef typeof union unless using var void with yield as async attribute auto await become cast catch class const_cast continue_if default delete demote do dynamic_cast enum explicit export extends extern external fallthrough filter final finally friend from fxgroup get goto groupshared highp impl implements import inline instanceof interface layout lowp macro macro_rules match mediump mod module move mut mutable namespace new nil noexcept noinline nointerpolation noperspective null nullptr of operator package packoffset partition pass patch pixelfragment precise precision premerge priv protected pub public readonly ref regardless register reinterpret_cast require resource restrict sample sampler set shared signed sizeof smooth snorm static static_assert static_cast std subroutine template unorm unsafe virtual volatile wgsl where".split(
        " ",
      ),
    )
    for (const kind of kinds)
      for (const name of Object.keys(creatureModel(kind).geometry.attributes))
        expect(reserved.has(name)).toBe(false)
  })

  test("legs pivot at the hip, above the feet", () => {
    const g = creatureModel("radiant-melee").geometry
    const rig = g.getAttribute("rig")
    for (let i = 0; i < rig.count; i++)
      if (rig.getW(i) === BONE.leg) expect(rig.getY(i)).toBeGreaterThan(0.2)
  })

  test("siege wheels roll exactly one turn per circumference", () => {
    expect(creatureModel("radiant-siege").stride).toBeCloseTo(2 * Math.PI * 0.2, 5)
  })
})

const unit = (x: number, extra: Partial<Unit> = {}): Unit => ({
  id: "u1",
  kind: "radiant-melee",
  team: "radiant",
  x,
  z: 0,
  heading: Math.PI / 2,
  ...extra,
})

describe("creature motion", () => {
  test("phase advances with distance, not time", () => {
    const s = createAnimState(unit(0))
    const start = s.phase
    stepAnim(s, unit(0), 1, 1)
    expect(s.phase).toBe(start)
    stepAnim(s, unit(0.5), 1 / 60, 1)
    expect(s.phase - start).toBeCloseTo(Math.PI, 5)
  })

  test("move eases in while walking and out at rest", () => {
    const s = createAnimState(unit(0))
    for (let i = 1; i <= 30; i++) stepAnim(s, unit(i * 0.04), 1 / 60, 1)
    expect(s.move).toBeGreaterThan(0.95)
    for (let i = 0; i < 60; i++) stepAnim(s, unit(1.2), 1 / 60, 1)
    expect(s.move).toBeLessThan(0.05)
  })

  test("a teleport (respawn) does not spin the stride", () => {
    const s = createAnimState(unit(0))
    const start = s.phase
    stepAnim(s, unit(40), 1 / 60, 1)
    expect(s.phase).toBe(start)
    expect(s.move).toBe(0)
  })

  test("an attack counter increase plays one swing", () => {
    const s = createAnimState(unit(0))
    expect(s.attack).toBe(1)
    stepAnim(s, unit(0, { attacks: 1 }), 1 / 60, 1)
    expect(s.attack).toBeLessThan(0.1)
    for (let t = 0; t < ATTACK_TIME + 0.1; t += 1 / 60)
      stepAnim(s, unit(0, { attacks: 1 }), 1 / 60, 1)
    expect(s.attack).toBe(1)
  })

  test("heading turns along the shortest arc", () => {
    const s = createAnimState(unit(0, { heading: 3 }))
    stepAnim(s, unit(0, { heading: -3 }), 1 / 60, 1)
    // From 3 to -3 the short way crosses ±π (increasing), never back through 0.
    expect(Math.abs(s.heading)).toBeGreaterThan(3)
  })
})
