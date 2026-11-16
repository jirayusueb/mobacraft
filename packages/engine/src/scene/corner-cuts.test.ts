import { describe, expect, test } from "bun:test"
import type { MobaMap } from "@mobacraft/map"
import { CornerCuts } from "./corner-cuts.ts"

/** 3×3 heights with a raised centre tile. */
const plateau = (h: number[]): MobaMap =>
  ({ size: 3, height: Float32Array.from(h) }) as unknown as MobaMap

describe("CornerCuts", () => {
  test("isolated raised tile bevels all four corners", () => {
    const cuts = new CornerCuts(plateau([0, 0, 0, 0, 1, 0, 0, 0, 0]))
    for (let k = 0; k < 4; k++)
      expect(cuts.at(1, 1, k)).toEqual({ fillHeight: 0, fillTile: expect.any(Number) })
  })

  test("corner stays square when a neighbour is level", () => {
    // Left neighbour (0,1) level with the centre → corners touching edge e0 stay square.
    const cuts = new CornerCuts(plateau([0, 0, 0, 1, 1, 0, 0, 0, 0]))
    expect(cuts.at(1, 1, 0)).toBeNull()
    expect(cuts.at(1, 1, 1)).toBeNull()
    expect(cuts.at(1, 1, 2)).not.toBeNull()
  })

  test("edge tiles never cut (neighbours outside the map)", () => {
    const cuts = new CornerCuts(plateau([1, 0, 0, 0, 0, 0, 0, 0, 0]))
    expect(cuts.at(0, 0, 0)).toBeNull()
  })

  test("fill borrows the higher lower neighbour", () => {
    const cuts = new CornerCuts(plateau([0, 0.5, 0, 0.25, 1, 0, 0, 0, 0]))
    // Corner 0 sits between e3 (-z → tile (1,0), h .5) and e0 (-x → tile (0,1), h .25).
    expect(cuts.at(1, 1, 0)).toEqual({ fillHeight: 0.5, fillTile: 1 })
  })
})
