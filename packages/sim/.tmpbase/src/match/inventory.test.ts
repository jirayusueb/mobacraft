import { describe, expect, test } from "bun:test"
import {
  BACKPACK_MUTE_S,
  addItem,
  countItems,
  emptyInventory,
  effectiveItems,
  NEUTRAL_ITEMS,
  NEUTRAL_TIERS,
  netWorthItems,
  promoteFirstBackpack,
  removeItem,
  rollNeutralDrop,
  swapToMain,
  unlockedTier,
} from "./inventory.ts"
import { itemById } from "./items.ts"

describe("inventory zones (spec/10 layer 1)", () => {
  test("buy fills main first, then backpack, then stash", () => {
    const inv = emptyInventory()
    for (let i = 0; i < 6; i++) expect(addItem(inv, "boots")).toBeTrue()
    expect(inv.main.every((x) => x === "boots")).toBeTrue()
    expect(addItem(inv, "plate")).toBeTrue()
    expect(inv.backpack[0]).toBe("plate")
    for (let i = 0; i < 2; i++) addItem(inv, "charm")
    expect(addItem(inv, "tome")).toBeTrue()
    expect(inv.stash[0]).toBe("tome")
    expect(countItems(inv)).toBe(10)
    for (let i = 0; i < 5; i++) expect(addItem(inv, "heart")).toBeTrue()
    expect(countItems(inv)).toBe(15) // 6 main + 3 backpack + 6 stash
    expect(addItem(inv, "heart")).toBeFalse() // everything full
  })

  test("backpack items are inert until swapped; swap mutes for 6 s", () => {
    const inv = emptyInventory()
    for (let i = 0; i < 6; i++) addItem(inv, "boots")
    addItem(inv, "blink")
    expect(effectiveItems(inv, 100)).toHaveLength(6) // blink inert in backpack
    removeItem(inv, "boots") // frees a main slot
    expect(swapToMain(inv, "blink", 100)).toBeTrue()
    expect(effectiveItems(inv, 100)).toHaveLength(5) // 5 boots; blink muted for 6 s
    expect(effectiveItems(inv, 100 + BACKPACK_MUTE_S)).toHaveLength(6)
  })

  test("promoteFirstBackpack moves the first backpack item with mute", () => {
    const inv = emptyInventory()
    for (let i = 0; i < 5; i++) addItem(inv, "boots")
    addItem(inv, "charm") // main[5] — main now full
    addItem(inv, "blink") // backpack[0]
    expect(removeItem(inv, "boots")).toBeTrue() // frees main[0]
    expect(promoteFirstBackpack(inv, 0)).toBeTrue()
    expect(inv.main[0]).toBe("blink")
    expect(inv.backpack[0]).toBeNull()
    expect(inv.mainMute[0]).toBe(BACKPACK_MUTE_S)
  })

  test("neutral item is active immediately (no mute on grant)", () => {
    const inv = emptyInventory()
    inv.neutral = "n-apex-power"
    expect(effectiveItems(inv, 0)).toEqual(["n-apex-power"])
  })

  test("net worth counts every zone; power counts only effective", () => {
    const inv = emptyInventory()
    addItem(inv, "blink") // 1600 main
    addItem(inv, "heart") // 1500 main
    for (let i = 0; i < 5; i++) addItem(inv, "plate") // 4 main + 1 backpack
    expect(netWorthItems(inv)).toBe(1600 + 1500 + 5 * 1150)
    expect(effectiveItems(inv, 0)).toHaveLength(6) // backpack plate inert
    expect(inv.backpack.filter(Boolean)).toHaveLength(1)
  })

  test("removeItem finds items in any zone and clears mute stamps", () => {
    const inv = emptyInventory()
    addItem(inv, "blink")
    inv.mainMute[0] = 99
    expect(removeItem(inv, "blink")).toBeTrue()
    expect(inv.main[0]).toBeNull()
    expect(inv.mainMute[0]).toBe(0)
    expect(removeItem(inv, "blink")).toBeFalse()
  })
})

describe("neutral drops (spec/10 layer 1)", () => {
  test("tier gates follow game minutes 0/6/12/18/24", () => {
    expect(unlockedTier(0)).toBe(0)
    expect(unlockedTier(5.9)).toBe(0)
    expect(unlockedTier(6)).toBe(1)
    expect(unlockedTier(12)).toBe(2)
    expect(unlockedTier(18)).toBe(3)
    expect(unlockedTier(24)).toBe(4)
  })

  test("drop is deterministic per camp index and only when slot empty", () => {
    expect(rollNeutralDrop(0, 3, null)).toBe("n-charm-luck")
    expect(rollNeutralDrop(0, 3, null)).toBe("n-charm-luck") // same roll
    expect(rollNeutralDrop(0, 3, "n-trinket")).toBeNull()
    expect(rollNeutralDrop(24, 0, null)).toBe("n-apex-power")
  })

  test("neutral ids never collide with shop ids; pool entries exist", () => {
    const shop = new Set(["boots", "blink", "bkb"])
    for (const tier of NEUTRAL_TIERS) {
      for (const id of tier) {
        expect(id.startsWith("n-")).toBeTrue()
        expect(shop.has(id)).toBeFalse()
        expect(NEUTRAL_ITEMS.some((i) => i.id === id)).toBeTrue()
      }
    }
    expect(() => itemById("n-trinket")).toThrow()
  })
})
