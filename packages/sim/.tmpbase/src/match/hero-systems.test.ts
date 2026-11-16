import { describe, expect, test } from "bun:test"
import {
  ARCHETYPES,
  STRATEGIC_TAGS,
  archetypeOf,
  flexScore,
  illusionAnswerMul,
  laneScore,
  powerAt,
  tagMatchup,
} from "./archetypes.ts"
import { type PurchaseView, choosePurchase } from "./builds.ts"
import {
  RUST_GRACE_DAYS,
  TIER_FLOOR,
  advanceDays,
  careerMastery,
  createCareer,
  isRusting,
  pocketHeroes,
  practiceWeek,
  recordMatch,
  scoutedMastery,
  teamView,
  tierOf,
} from "./career.ts"
import { aiChoose, applyDraft, createDraft } from "./draft.ts"
import { HEROES } from "./heroes.ts"
import { type HeroEntry, createHeroSystems } from "./hero-systems.ts"
import { TEAMS } from "./teams.ts"

const min = (m: number) => m * 60

describe("archetypes", () => {
  test("every hero has an archetype with ≥1 position and 2 facets", () => {
    expect(ARCHETYPES).toHaveLength(HEROES.length)
    for (const h of HEROES) {
      const a = archetypeOf(h.id)
      expect(Object.keys(a.positions).length).toBeGreaterThan(0)
      expect(a.facets).toHaveLength(2)
      expect(flexScore(h.id)).toBeGreaterThanOrEqual(1)
    }
    // Flex picks exist (draft mind games) and specialists exist.
    expect(HEROES.filter((h) => flexScore(h.id) >= 3).length).toBeGreaterThanOrEqual(3)
    expect(HEROES.filter((h) => flexScore(h.id) === 1).length).toBeGreaterThanOrEqual(3)
  })

  test("every strategic tag is used, none on more than 60 % of heroes", () => {
    for (const tag of STRATEGIC_TAGS) {
      const n = ARCHETYPES.filter((a) => a.tags.includes(tag)).length
      expect(n).toBeGreaterThanOrEqual(1)
      expect(n / ARCHETYPES.length).toBeLessThanOrEqual(0.6)
    }
  })

  test("unknown hero → neutral archetype, never throws", () => {
    expect(archetypeOf("nobody").tags).toEqual([])
  })

  test("power curves: snowball peaks early and fades; hard carry needs 3 items", () => {
    const early = min(5) // 10 Dota-minutes
    const late = min(20) // 40 Dota-minutes
    expect(powerAt("goreclaw", early, 0)).toBeGreaterThan(powerAt("goreclaw", late, 3))
    expect(powerAt("goreclaw", late, 3)).toBeLessThan(1)
    expect(powerAt("vexlash", early, 0)).toBeLessThan(0.9)
    expect(powerAt("vexlash", late, 3)).toBeGreaterThan(1.25)
    expect(powerAt("vexlash", late, 3)).toBeGreaterThan(powerAt("vexlash", late, 0))
  })

  test("AOE Clear counters Illusion; team answer bonus needs two illusion heroes", () => {
    expect(tagMatchup("embercall", "duskblade")).toBeGreaterThan(0)
    expect(illusionAnswerMul(["embercall"], ["duskblade", "vexlash"])).toBeGreaterThan(1)
    expect(illusionAnswerMul(["embercall"], ["duskblade"])).toBe(1)
  })

  test("lane score: ranged lane bully beats a melee hero; averages ignore headcount", () => {
    expect(laneScore(["hexweaver"], ["gravejaw"])).toBeGreaterThan(0)
    expect(laneScore(["gravejaw"], ["hexweaver"])).toBeLessThan(0)
    // Same heroes, duo vs solo, isn't automatically lost by the solo laner.
    const solo = laneScore(["gravejaw"], ["vexlash", "lumenmaid"])
    expect(solo).toBeGreaterThan(-3)
    expect(laneScore(["ironwarden"], [])).toBe(1)
  })
})

describe("career", () => {
  test("tier thresholds", () => {
    expect(tierOf(0.3)).toBe("unfamiliar")
    expect(tierOf(0.45)).toBe("playable")
    expect(tierOf(0.7)).toBe("comfortable")
    expect(tierOf(0.9)).toBe("signature")
  })

  test("rust starts after 30 idle days and stops at the floor", () => {
    let c = createCareer()
    const before = careerMastery(c, "lnt-mae", "lumenmaid")
    c = advanceDays(c, RUST_GRACE_DAYS - 3)
    expect(careerMastery(c, "lnt-mae", "lumenmaid")).toBe(before)
    c = advanceDays(c, 20)
    expect(isRusting(c, "lnt-mae", "lumenmaid")).toBe(true)
    expect(careerMastery(c, "lnt-mae", "lumenmaid")).toBeLessThan(before)
    c = advanceDays(c, 400)
    expect(careerMastery(c, "lnt-mae", "lumenmaid")).toBe(TIER_FLOOR.playable)
  })

  test("practice resets rust; playing a match gains mastery", () => {
    let c = advanceDays(createCareer(), 40)
    const rusty = careerMastery(c, "lnt-mae", "lumenmaid")
    c = practiceWeek(c, { "lnt-mae": { kind: "scrim", heroId: "lumenmaid" } })
    expect(careerMastery(c, "lnt-mae", "lumenmaid")).toBeGreaterThan(rusty)
    expect(isRusting(c, "lnt-mae", "lumenmaid")).toBe(false)
    const m = careerMastery(c, "lnt-mae", "lumenmaid")
    c = recordMatch(c, [{ playerId: "lnt-mae", heroId: "lumenmaid" }])
    expect(careerMastery(c, "lnt-mae", "lumenmaid")).toBeGreaterThan(m)
  })

  test("private lobby practice is hidden from scouting → pocket pick", () => {
    let c = createCareer()
    for (let w = 0; w < 6; w++)
      c = practiceWeek(c, { "lnt-bram": { kind: "private", heroId: "duskblade" } })
    expect(careerMastery(c, "lnt-bram", "duskblade")).toBeGreaterThanOrEqual(0.65)
    expect(scoutedMastery(c, "lnt-bram", "duskblade")).toBe(0.35)
    expect(pocketHeroes(c, "lnt-bram")).toContain("duskblade")
    // A scrim reveals it.
    c = practiceWeek(c, { "lnt-bram": { kind: "scrim", heroId: "duskblade" } })
    expect(pocketHeroes(c, "lnt-bram")).not.toContain("duskblade")
  })

  test("the AI coach drafts against scouted mastery, not real mastery", () => {
    // Make Bram's pocket Duskblade a real Signature that scouting can't see.
    let c = createCareer()
    for (let w = 0; w < 10; w++)
      c = practiceWeek(c, { "lnt-bram": { kind: "private", heroId: "duskblade" } })
    const blueReal = teamView(TEAMS[0]!, c, "real")
    const blueScouted = teamView(TEAMS[0]!, c, "scouted")
    expect(blueReal.players[0]!.mastery["duskblade"]).toBeGreaterThan(0.85)
    // Red bans after blue's first ban: built from what red can see.
    const bans = (blue: typeof blueReal) => {
      let d = createDraft(blue, TEAMS[1]!)
      const r1 = applyDraft(d, aiChoose(d))
      if (r1.ok) d = r1.state
      return aiChoose(d)
    }
    expect(bans(blueScouted)).not.toBe("duskblade")
  })
})

describe("builds", () => {
  const base: PurchaseView = {
    heroId: "vexlash",
    role: "carry",
    isCarry: true,
    isPipeBuyer: false,
    gold: 5000,
    items: ["boots", "bow"],
    bookIndex: 2,
    enemyHeroIds: ["lumenmaid", "ironwarden"],
    enemyMagicShare: 0.3,
    losingBase: false,
    netWorthDeficit: 0,
    teamHasPipe: false,
    followsRules: true,
    enabledRules: new Set(["rapier", "mkb", "bkb", "pipe"]),
  }

  test("no rule → follows the book cursor", () => {
    expect(choosePurchase(base)).toEqual({ itemId: "blade", fromBook: true })
  })

  test("Rule 1: magic-heavy enemy → Pipe, and Blink waits", () => {
    const v: PurchaseView = {
      ...base,
      heroId: "ironwarden",
      role: "offlane",
      isCarry: false,
      isPipeBuyer: true,
      items: ["boots", "plate"],
      enemyMagicShare: 0.7,
    }
    expect(choosePurchase(v)?.itemId).toBe("pipe")
    expect(choosePurchase({ ...v, enemyMagicShare: 0.3 })?.itemId).toBe("blink")
    expect(choosePurchase({ ...v, teamHasPipe: true })?.itemId).toBe("blink")
  })

  test("Rule 2: evasion on the enemy → carry must buy MKB", () => {
    expect(choosePurchase({ ...base, enemyHeroIds: ["hollowfang"] })?.itemId).toBe("mkb")
    // Not the support.
    expect(
      choosePurchase({ ...base, isCarry: false, role: "support", enemyHeroIds: ["hollowfang"] })
        ?.ruleId,
    ).toBeUndefined()
  })

  test("Rule 3: losing base and 15k behind → Rapier gamble", () => {
    const v = { ...base, losingBase: true, netWorthDeficit: 16_000 }
    expect(choosePurchase(v)?.itemId).toBe("rapier")
    expect(choosePurchase({ ...v, netWorthDeficit: 9000 })?.itemId).toBe("blade")
  })

  test("Unfamiliar heroes ignore rules; disabled rules don't fire", () => {
    const v = { ...base, enemyHeroIds: ["hollowfang"] }
    expect(choosePurchase({ ...v, followsRules: false })?.itemId).toBe("blade")
    expect(choosePurchase({ ...v, enabledRules: new Set() })?.itemId).toBe("blade")
  })

  test("full inventory sells the cheapest book item for a rule item", () => {
    const v = {
      ...base,
      items: ["boots", "bow", "blade", "fang", "blade", "heart"],
      bookIndex: 6,
      enemyHeroIds: ["hollowfang"],
    }
    expect(choosePurchase(v)).toMatchObject({ itemId: "mkb", sell: "boots" })
  })
})

const entry = (key: string, heroId: string, side: "blue" | "red", mastery = 0.7): HeroEntry => ({
  key,
  heroId,
  playerId: key,
  playerName: key,
  side,
  role: "mid",
  mastery,
  teamwork: 12,
  facet: archetypeOf(heroId).facets[0],
})
const run = (chem: number) => {
  const hs = createHeroSystems({
    seed: 9,
    heroes: [entry("i", "gravejaw", "blue"), entry("f", "embercall", "blue")],
    chemistry: () => chem,
  })
  let n = 0
  for (let t = 0; t < 3000; t += 10) if (hs.combo("i", "f", t, false) === "combo") n++
  return n
}

describe("hero systems runtime", () => {
  test("damage multiplier is clamped", () => {
    const hs = createHeroSystems({
      seed: 1,
      heroes: [entry("a", "vexlash", "blue", 0.95), entry("b", "duskblade", "red")],
    })
    const m = hs.damageMul({
      src: "a",
      dst: "b",
      dstType: "hero",
      dstHpPct: 0.9,
      kind: "ability",
      t: min(20),
      srcCoreItems: 4,
      combo: true,
    })
    expect(m).toBeLessThanOrEqual(1.35)
    expect(m).toBeGreaterThan(1.2)
  })

  test("Evasion: ~20 % misses, True Strike never misses", () => {
    const hs = createHeroSystems({
      seed: 3,
      heroes: [entry("a", "vexlash", "blue"), entry("b", "hollowfang", "red")],
    })
    let miss = 0
    for (let i = 0; i < 2000; i++) if (!hs.attackHits("a", "b", false)) miss++
    expect(miss / 2000).toBeGreaterThan(0.15)
    expect(miss / 2000).toBeLessThan(0.25)
    for (let i = 0; i < 200; i++) expect(hs.attackHits("a", "b", true)).toBe(true)
  })

  test("Signature heroes clutch-dodge, at most once per 20 s", () => {
    const hs = createHeroSystems({
      seed: 5,
      heroes: [entry("a", "gravejaw", "blue"), entry("b", "duskblade", "red", 0.95)],
    })
    let clutches = 0
    for (let t = 0; t < 2000; t += 1)
      if (hs.spellLands("a", "b", { singleTarget: false, t, threatening: true }) === "clutch")
        clutches++
    expect(clutches).toBeGreaterThan(20)
    expect(clutches).toBeLessThanOrEqual(100)
    expect(hs.events().some((e) => e.kind === "clutch")).toBe(true)
  })

  test("combos land more often with good chemistry", () => {
    expect(run(1)).toBeGreaterThanOrEqual(run(-1) * 1.5)
  })

  test("bad chemistry produces overlapping spells", () => {
    const hs = createHeroSystems({
      seed: 2,
      heroes: [entry("i", "gravejaw", "blue"), entry("f", "embercall", "blue")],
      chemistry: () => -1,
    })
    const outcomes = new Set<string | null>()
    for (let t = 0; t < 2000; t += 10) outcomes.add(hs.combo("i", "f", t, true))
    expect(outcomes.has("overlap")).toBe(true)
    // Non-pairs never combo.
    expect(hs.combo("f", "i", 5000, true)).toBeNull()
  })

  test("losing lanes cost last-hit gold, badly losing lanes zone the hero out", () => {
    const hs = createHeroSystems({
      seed: 1,
      heroes: [
        entry("w", "duskblade", "blue"),
        entry("x", "embercall", "red"),
        entry("y", "hexweaver", "red"),
      ],
    })
    hs.setLanes(
      new Map([
        ["w", "top"],
        ["x", "top"],
        ["y", "top"],
      ]),
      (k) => (k === "w" ? 6 : 18),
    )
    expect(hs.laneAdvantage("w")).toBeLessThanOrEqual(-2)
    expect(hs.laneGoldMul("w", 60)).toBeLessThan(1)
    expect(hs.laneGoldMul("x", 60)).toBe(1)
    // Laning ends at 7:30 game time (15 Dota minutes).
    expect(hs.laneGoldMul("w", min(8))).toBe(1)
  })

  test("Unfamiliar: slower casts", () => {
    const hs = createHeroSystems({
      seed: 1,
      heroes: [entry("u", "vexlash", "blue", 0.3), entry("s", "duskblade", "blue", 0.9)],
    })
    expect(hs.castDelay("u")).toBeGreaterThan(hs.castDelay("s"))
  })
})
