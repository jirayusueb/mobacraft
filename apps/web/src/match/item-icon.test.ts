import { describe, expect, test } from "bun:test"
import { itemName, itemText } from "./item-icon.tsx"

describe("item display (unknown ids never crash the HUD)", () => {
  test("known shop and neutral items resolve to names", () => {
    expect(itemName("boots")).not.toBe("boots")
    expect(itemName("n-trinket")).toBe("Keen Trinket")
    expect(itemText("boots")).toMatch(/gold$/)
  })
  test("an unknown id falls back to the id instead of throwing", () => {
    expect(() => itemName("not-a-real-item")).not.toThrow()
    expect(itemName("not-a-real-item")).toBe("not-a-real-item")
    expect(itemText("not-a-real-item")).toBe("not-a-real-item")
  })
})
