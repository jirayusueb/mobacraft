import { describe, expect, test } from "bun:test"
import { ITEMS, itemById, itemsUsing, missingComponents, recipeCost } from "./items.ts"

describe("item DAG (spec/10 layer 2)", () => {
  test("every component exists — the graph is closed", () => {
    const ids = new Set(ITEMS.map((i) => i.id))
    for (const item of ITEMS) for (const c of item.components) expect(ids.has(c)).toBeTrue()
  })

  test("acyclic — components always sort before their consumers", () => {
    const depth = (id: string, seen: Set<string> = new Set()): number => {
      if (seen.has(id)) throw new Error(`cycle at ${id}`)
      seen.add(id)
      const comps = itemById(id).components
      return comps.length === 0 ? 0 : 1 + Math.max(...comps.map((c) => depth(c, new Set(seen))))
    }
    for (const item of ITEMS) expect(depth(item.id)).toBeLessThan(10)
  })

  test("recipe cost is non-negative and items cost more than their parts", () => {
    for (const item of ITEMS) {
      expect(recipeCost(item.id)).toBeGreaterThanOrEqual(0)
      if (item.components.length > 0) {
        const parts = item.components.reduce((s, c) => s + itemById(c).cost, 0)
        expect(item.cost).toBe(parts + recipeCost(item.id))
      }
    }
  })

  test("missingComponents honours multiplicity and orders cheapest-first", () => {
    // mkb = blade + steel; blade = steel + steel
    // mkb = blade + steel; steel (500) sorts before blade (1100)
    expect(missingComponents([], "mkb")).toEqual(["steel", "blade"])
    expect(missingComponents(["steel"], "blade")).toEqual(["steel"])
    expect(missingComponents(["steel", "steel"], "blade")).toEqual([])
    expect(missingComponents(["blade"], "mkb")).toEqual(["steel"])
    expect(missingComponents(["boots"], "boots")).toEqual([])
  })

  test("strategic tags exist on the counter-play items (layer 3 vocabulary)", () => {
    expect(itemById("bkb").tags).toContain("spellImmunity")
    expect(itemById("blink").tags).toContain("initiation")
    expect(itemById("mkb").tags).toContain("trueStrike")
    expect(itemById("eul").tags).toContain("dispel")
    expect(itemById("force").tags).toContain("save")
  })

  test("itemsUsing lists consumers of a component", () => {
    expect(itemsUsing("steel").map((i) => i.id)).toContain("blade")
    expect(itemsUsing("nullstone").map((i) => i.id)).toContain("pipe")
  })
})
