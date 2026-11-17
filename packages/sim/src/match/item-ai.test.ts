import { describe, expect, test } from "bun:test"
import type { PurchaseView } from "./builds.ts"
import {
  NO_THREAT,
  type ThreatProfile,
  buybackCost,
  chooseItem,
  goldFloor,
  scanThreats,
  threatScore,
} from "./item-ai.ts"

const view = (over: Partial<PurchaseView> = {}): PurchaseView => ({
  heroId: "ashbringer",
  role: "carry",
  isCarry: true,
  isPipeBuyer: false,
  gold: 5000,
  items: [],
  bookIndex: 0,
  enemyHeroIds: [],
  enemyMagicShare: 0,
  losingBase: false,
  netWorthDeficit: 0,
  teamHasPipe: false,
  followsRules: true,
  enabledRules: new Set(["rapier", "mkb", "bkb", "pipe"]),
  ...over,
})
const BOOK = ["boots", "bow", "blade", "fang", "blade", "heart"]
const threat = (over: Partial<ThreatProfile>): ThreatProfile => ({ ...NO_THREAT, ...over })

describe("item AI (spec/10 layer 3)", () => {
  test("skeleton: first two book items are bought in order regardless of threats", () => {
    const th = threat({ evasion: 3, magicShare: 1 })
    expect(chooseItem(view({ heroId: "hollowfang" }), BOOK, th)?.id).toBe("boots")
    expect(chooseItem(view({ heroId: "hollowfang", bookIndex: 1 }), BOOK, th)?.reason).toBe(
      "skeleton",
    )
  })

  test("hard override: a spec/07 rule wins outright, even inside the skeleton", () => {
    // ashbringer is an initiator → built-in Blink rule after 1 core item.
    const c = chooseItem(view({ items: ["bow"], bookIndex: 1 }), BOOK, NO_THREAT)
    expect(c).toEqual({ id: "blink", reason: "rule:blink", fromBook: false })
  })

  test("rule priority preserved: Rapier > MKB > Pipe > Blink", () => {
    const v = view({
      items: ["bow", "blade"],
      bookIndex: 3,
      enemyHeroIds: ["hollowfang"],
      losingBase: true,
      netWorthDeficit: 20_000,
      enemyMagicShare: 0.9,
    })
    expect(chooseItem(v, BOOK, NO_THREAT)?.id).toBe("rapier")
    expect(chooseItem({ ...v, losingBase: false }, BOOK, NO_THREAT)?.id).toBe("mkb")
  })

  test("buy-before ordering survives: pipe-buyer gets Pipe before Blink", () => {
    const v = view({
      heroId: "ironwarden",
      role: "offlane",
      isCarry: false,
      isPipeBuyer: true,
      items: ["plate"],
      bookIndex: 2,
      enemyMagicShare: 0.8,
    })
    expect(chooseItem(v, BOOK, NO_THREAT)?.id).toBe("pipe")
    expect(chooseItem({ ...v, items: ["plate", "pipe"] }, BOOK, NO_THREAT)?.id).toBe("blink")
  })

  test("evasion seen → MKB jumps the carry's queue (rules off)", () => {
    const v = view({ heroId: "hollowfang", bookIndex: 3, items: ["boots", "bow", "blade"] })
    expect(chooseItem(v, BOOK, NO_THREAT)?.id).toBe("fang") // no threat: book
    const c = chooseItem(v, BOOK, threat({ evasion: 1 }))
    expect(c).toEqual({ id: "mkb", reason: "threat", fromBook: false })
  })

  test("heavy disable / magic → BKB tops a carry's list", () => {
    const v = view({ heroId: "hollowfang", bookIndex: 3, items: ["boots", "bow", "blade"] })
    expect(chooseItem(v, BOOK, threat({ disablers: 3, magicShare: 0.5 }))?.id).toBe("bkb")
  })

  test("divers on the enemy → support prioritises Force Staff", () => {
    const v = view({
      heroId: "thornmaw",
      role: "support",
      isCarry: false,
      bookIndex: 2,
      followsRules: false,
    })
    const book = ["boots", "charm", "aegis-cloak", "tome"]
    expect(chooseItem(v, book, NO_THREAT)?.id).toBe("aegis-cloak")
    expect(chooseItem(v, book, threat({ divers: 2 }))?.id).toBe("force")
  })

  test("scanThreats reads hero tags and seen item tags", () => {
    const th = scanThreats(
      [
        { heroId: "hollowfang", items: ["bkb"] },
        { heroId: "gravejaw", items: [] },
      ],
      0.4,
    )
    expect(th.evasion).toBe(1)
    expect(th.disablers).toBe(2) // initiator + bkb-piercing
    expect(th.divers).toBe(1) // hollowfang is global
    expect(th.itemTags.has("spellImmunity")).toBeTrue()
    expect(threatScore("mkb", "support", th)).toBe(0) // supports never want MKB
  })

  test("deterministic: same inputs, same answer", () => {
    const v = view({ heroId: "hollowfang", bookIndex: 3, items: ["boots", "bow", "blade"] })
    const th = threat({ evasion: 1, disablers: 2, magicShare: 0.3 })
    expect(chooseItem(v, BOOK, th)).toEqual(chooseItem(v, BOOK, th))
  })
})

describe("buyback reserve (spec/10 layer 3)", () => {
  test("floor is zero early, buyback cost late or after losing a T3", () => {
    expect(goldFloor(10, 10, false, false)).toBe(0)
    expect(goldFloor(10, 15, false, false)).toBe(buybackCost(10))
    expect(goldFloor(10, 8, true, false)).toBe(400)
  })

  test("rule items ignore the floor", () => {
    expect(goldFloor(20, 30, true, true)).toBe(0)
  })
})
