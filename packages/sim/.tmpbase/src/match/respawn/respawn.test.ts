/** spec/12 — respawn & match tempo. State assertions over pure modules. */
import { describe, expect, test } from "bun:test"
import { createRandom } from "../random.ts"
import {
  BUYBACK_COOLDOWN,
  BarracksState,
  CreepPool,
  POWER_RUNES,
  PowerRuneRoller,
  ROSHAN_MAX_RESPAWN,
  ROSHAN_MIN_RESPAWN,
  RoshanTimer,
  SPAWN_PROTECTION_MAX,
  TREE_REGROW_RETRY,
  TREE_REGROW_SECONDS,
  TreeRegrowth,
  baseRespawnTime,
  boxAround,
  breakSpawnProtection,
  buybackCost,
  campTicksDue,
  clearCamp,
  consumeDeathPenalty,
  createBuybackState,
  createCamp,
  createHeroLife,
  creepTemplate,
  decideBuyback,
  dotaLevel,
  forceRespawn,
  isInvulnerable,
  killHero,
  planDeadBrain,
  planStack,
  reapersScythe,
  respawnHero,
  respawnTime,
  runeTimesDue,
  spawnWave,
  suspectBlock,
  tickLife,
  trySpawnCamp,
  upcomingRunes,
  useBuyback,
  waveComposition,
  wavesDue,
  type BuybackContext,
} from "./index.ts"

const FOUNTAIN = { x: 4, z: 124 }

describe("§1 hero respawn timer", () => {
  test("12 s at level 1, 100 s at 30, strictly increasing and convex", () => {
    expect(baseRespawnTime(1)).toBe(12)
    expect(baseRespawnTime(30)).toBe(100)
    let prevStep = 0
    for (let l = 2; l <= 30; l++) {
      const step = baseRespawnTime(l) - baseRespawnTime(l - 1)
      expect(step).toBeGreaterThan(prevStep - 1e-9)
      prevStep = step
    }
    expect(baseRespawnTime(0)).toBe(12)
    expect(baseRespawnTime(99)).toBe(100)
  })

  test("our 15-level curve maps 1→1 and 15→30", () => {
    expect(dotaLevel(1)).toBe(1)
    expect(dotaLevel(15)).toBe(30)
    expect(baseRespawnTime(dotaLevel(1))).toBe(12)
  })

  test("modifiers: multipliers on base, then adds (Scythe + penalty + talent)", () => {
    const base = baseRespawnTime(20)
    expect(respawnTime(20, [reapersScythe(3)])).toBeCloseTo(base + 35)
    expect(respawnTime(20, [reapersScythe(1)])).toBeCloseTo(base + 15)
    const t = respawnTime(20, [
      { source: "talent", mul: 0.8 },
      reapersScythe(2),
      { source: "buyback-penalty", add: 25 },
      { source: "item", add: -10 },
    ])
    expect(t).toBeCloseTo(base * 0.8 + 25 + 25 - 10)
    expect(respawnTime(1, [{ source: "x", add: -100 }])).toBe(3)
  })
})

const fresh = () => {
  const l = createHeroLife({
    heroId: "h",
    team: "radiant",
    maxHp: 900,
    maxMana: 400,
    pos: { x: 50, z: 50 },
  })
  l.cooldowns = { ult: 60, blink: 10 }
  l.modifiers = [
    { id: "slow", remaining: 5 },
    { id: "aura", remaining: 1, persistsThroughDeath: true },
  ]
  return l
}
describe("§1 death cleanup & respawn execution", () => {
  test("kill hides, uncollides, purges dispellables, pins to fountain, keeps cooldowns", () => {
    const l = fresh()
    const dur = killHero(l, 100, 1, FOUNTAIN)
    expect(dur).toBe(12)
    expect(l.state).toBe("dead")
    expect(l.render).toBeFalse()
    expect(l.collide).toBeFalse()
    expect(l.anchor).toEqual(FOUNTAIN)
    expect(l.brain).toBe("dead")
    expect(l.modifiers.map((m) => m.id)).toEqual(["aura"])
    expect(l.cooldowns).toEqual({ ult: 60, blink: 10 })
    // Cooldowns keep ticking while dead.
    for (let i = 0; i < 50; i++) tickLife(l, 0.1)
    expect(l.cooldowns.ult).toBeCloseTo(55)
    expect(l.cooldowns.blink).toBeCloseTo(5)
    // Killing a dead hero is a no-op.
    expect(killHero(l, 101, 1, FOUNTAIN)).toBeCloseTo(11)
    expect(l.deaths).toBe(1)
  })

  test("respawns at the timer with full HP/mana at the spawn point, protected until acting", () => {
    const l = fresh()
    l.mana = 10
    killHero(l, 100, 1, FOUNTAIN)
    expect(respawnHero(l, 111.9, FOUNTAIN)).toBeFalse()
    expect(respawnHero(l, 112, FOUNTAIN)).toBeTrue()
    expect(l.hp).toBe(900)
    expect(l.mana).toBe(400)
    expect(l.pos).toEqual(FOUNTAIN)
    expect(l.render && l.collide).toBeTrue()
    expect(isInvulnerable(l, 113)).toBeTrue()
    breakSpawnProtection(l, "attacked")
    expect(isInvulnerable(l, 113)).toBeTrue()
    breakSpawnProtection(l, "move")
    expect(isInvulnerable(l, 113)).toBeFalse()
  })

  test("spawn protection times out for an idle hero", () => {
    const l = fresh()
    killHero(l, 0, 1, FOUNTAIN)
    respawnHero(l, 12, FOUNTAIN)
    expect(isInvulnerable(l, 12 + SPAWN_PROTECTION_MAX - 0.1)).toBeTrue()
    expect(isInvulnerable(l, 12 + SPAWN_PROTECTION_MAX)).toBeFalse()
  })

  test("dead brain: buys above buyback reserve, sorts backpack, plans TP to nearest tower", () => {
    const value: Record<string, number> = { bkb: 4050, boots: 500, wand: 450, tango: 90 }
    const plan = planDeadBrain({
      gold: 3000,
      reserve: 1000,
      shoppingList: [
        { id: "blink", cost: 1800 },
        { id: "bkb", cost: 4050 },
      ],
      main: ["tango", "boots", "wand", "x", "y", "z"],
      backpack: [null, "bkb", null],
      value: (id) => value[id] ?? 1000,
      hasTp: true,
      objective: { x: 100, z: 20 },
      towers: [
        { x: 30, z: 90 },
        { x: 90, z: 30 },
      ],
    })
    expect(plan).toEqual([
      { kind: "buy", id: "blink", cost: 1800 },
      { kind: "swap", backpackIdx: 1, mainIdx: 0 },
      { kind: "tp", to: { x: 90, z: 30 } },
    ])
  })
})

const ctx = (o: Partial<BuybackContext>): BuybackContext => ({
  gold: 5000,
  netWorth: 20_000,
  now: 2000,
  respawnRemaining: 60,
  highGroundUnderAttack: false,
  alliesAlive: 3,
  enemiesAtBase: 3,
  bigFightOngoing: false,
  fightRemaining: 0,
  ultReady: false,
  ultImpact: 0,
  hasTp: false,
  wonFight: false,
  isCoreDamage: false,
  timeToAncient: 60,
  enemyMinRespawn: 0,
  ...o,
})
describe("§2 buyback", () => {
  test("cost = 200 + NW/13 (floored)", () => {
    expect(buybackCost(0)).toBe(200)
    expect(buybackCost(13_000)).toBe(1200)
    expect(buybackCost(26_013)).toBe(2201)
  })

  test("480 s cooldown, penalty applies once to the next death", () => {
    const s = createBuybackState()
    const q = { dead: true, gold: 5000, netWorth: 13_000, now: 1000 }
    expect(useBuyback(s, { ...q, dead: false })).toBeNull()
    expect(useBuyback(s, { ...q, gold: 100 })).toBeNull()
    expect(useBuyback(s, q)).toBe(1200)
    expect(useBuyback(s, { ...q, now: 1000 + BUYBACK_COOLDOWN - 1 })).toBeNull()
    expect(consumeDeathPenalty(s)).toEqual({ source: "buyback-penalty", add: 25 })
    expect(consumeDeathPenalty(s)).toBeNull()
    expect(useBuyback(s, { ...q, now: 1000 + BUYBACK_COOLDOWN })).toBe(1200)
  })

  test("buyback force-respawns; second death within the window costs +25 s", () => {
    const s = createBuybackState()
    const l = createHeroLife({
      heroId: "h",
      team: "dire",
      maxHp: 2000,
      maxMana: 800,
      pos: { x: 60, z: 60 },
    })
    killHero(l, 0, 25, FOUNTAIN)
    expect(useBuyback(s, { dead: true, gold: 9999, netWorth: 20_000, now: 5 })).not.toBeNull()
    expect(forceRespawn(l, 5, FOUNTAIN)).toBeTrue()
    const pen = consumeDeathPenalty(s)
    const dur = killHero(l, 40, 25, FOUNTAIN, pen ? [pen] : [])
    expect(dur).toBeCloseTo(baseRespawnTime(25) + 25)
  })

  test("AI: base defense only with enough allies alive to fight back", () => {
    const s = createBuybackState()
    expect(decideBuyback(s, ctx({ highGroundUnderAttack: true }))).toMatchObject({
      buy: true,
      reason: "base-defense",
    })
    expect(
      decideBuyback(s, ctx({ highGroundUnderAttack: true, alliesAlive: 0, enemiesAtBase: 5 })).buy,
    ).toBeFalse()
  })

  test("AI: high-value fight needs ult ready + TP + fight outlasting the TP", () => {
    const s = createBuybackState()
    const yes = ctx({
      bigFightOngoing: true,
      ultReady: true,
      hasTp: true,
      fightRemaining: 10,
      ultImpact: 1,
    })
    expect(decideBuyback(s, yes)).toMatchObject({ buy: true, reason: "high-value-fight" })
    expect(decideBuyback(s, { ...yes, hasTp: false }).buy).toBeFalse()
    expect(decideBuyback(s, { ...yes, ultReady: false }).buy).toBeFalse()
    expect(decideBuyback(s, { ...yes, fightRemaining: 2 }).buy).toBeFalse()
    // Low-impact ult scores 0.55 < threshold.
    expect(decideBuyback(s, { ...yes, ultImpact: 0 }).buy).toBeFalse()
  })

  test("AI: game-ending push when the core reaches the Ancient before enemies respawn", () => {
    const s = createBuybackState()
    const yes = ctx({ wonFight: true, isCoreDamage: true, timeToAncient: 25, enemyMinRespawn: 40 })
    expect(decideBuyback(s, yes)).toMatchObject({ buy: true, reason: "game-ending-push" })
    expect(decideBuyback(s, { ...yes, enemyMinRespawn: 20 }).buy).toBeFalse()
    expect(decideBuyback(s, { ...yes, isCoreDamage: false }).buy).toBeFalse()
  })

  test("AI gates: never spam — no reason, cooldown, gold, short timer", () => {
    const s = createBuybackState()
    expect(decideBuyback(s, ctx({}))).toMatchObject({ buy: false, reason: "none" })
    const emergency = ctx({ highGroundUnderAttack: true })
    expect(decideBuyback(s, { ...emergency, gold: 100 }).blocked).toBe("gold")
    expect(decideBuyback(s, { ...emergency, respawnRemaining: 10 }).blocked).toBe("short-timer")
    s.readyAt = 3000
    expect(decideBuyback(s, emergency).blocked).toBe("cooldown")
  })
})

describe("§3 lane creep waves", () => {
  test("scheduler hits every :00/:30 exactly once at any tick size", () => {
    for (const dt of [0.1, 0.2, 0.7, 3, 29.9, 45]) {
      const got: number[] = []
      let prev = -dt
      for (let now = 0; now <= 600 + 1e-9; now += dt) {
        got.push(...wavesDue(prev, now))
        prev = now
      }
      const expected = Array.from({ length: Math.floor((prev + 1e-6) / 30) + 1 }, (_, i) => i)
      expect(got).toEqual(expected)
    }
    expect(wavesDue(-1, -0.5)).toEqual([])
  })

  test("+1 melee per 7:30 tier, ranged every other tier, siege every 10th wave", () => {
    expect(waveComposition(0)).toMatchObject({ melee: 3, ranged: 1, siege: 0, tier: 0 })
    expect(waveComposition(10).siege).toBe(1)
    expect(waveComposition(11).siege).toBe(0)
    expect(waveComposition(15)).toMatchObject({ melee: 4, ranged: 1, tier: 1 })
    expect(waveComposition(30)).toMatchObject({ melee: 5, ranged: 2, tier: 2 })
    expect(waveComposition(500)).toMatchObject({ melee: 6, ranged: 3 })
    expect(waveComposition(30).statMul).toBeCloseTo(1.2)
  })

  test("super per barracks type, mega once all six fall", () => {
    const rax = new BarracksState()
    expect(creepTemplate(rax, "radiant", "top", "melee")).toBe("normal")
    rax.destroy("dire", "top", "melee")
    expect(creepTemplate(rax, "radiant", "top", "melee")).toBe("super")
    expect(creepTemplate(rax, "radiant", "top", "ranged")).toBe("normal")
    expect(creepTemplate(rax, "radiant", "mid", "melee")).toBe("normal")
    expect(creepTemplate(rax, "dire", "top", "melee")).toBe("normal")
    rax.destroy("dire", "top", "ranged")
    expect(creepTemplate(rax, "radiant", "top", "siege")).toBe("super")
    for (const lane of ["mid", "bot"] as const)
      for (const k of ["melee", "ranged"] as const) rax.destroy("dire", lane, k)
    expect(creepTemplate(rax, "radiant", "mid", "ranged")).toBe("mega")
    const wave = spawnWave(new CreepPool(0), rax, "radiant", "bot", 0)
    expect(wave.every((c) => c.template === "mega")).toBeTrue()
  })

  test("object pool: no allocation after warm-up across a late game", () => {
    const pool = new CreepPool(160)
    const rax = new BarracksState()
    const live: ReturnType<typeof spawnWave> = []
    for (let w = 0; w < 120; w++) {
      for (const team of ["radiant", "dire"] as const)
        for (const lane of ["top", "mid", "bot"] as const)
          live.push(...spawnWave(pool, rax, team, lane, w))
      // Waves die ~2 waves later.
      while (live.length > 80) pool.release(live.shift()!)
    }
    // Peak live = 80 kept + one late 60-creep wave batch ≤ 140 < 160 prewarm.
    expect(pool.created).toBe(160)
    expect(pool.reused).toBeGreaterThan(1000)
    expect(pool.inUse).toBe(live.length)
    const c = live[0]!
    expect(c.hp).toBe(c.maxHp)
  })
})

describe("§4 neutral camps", () => {
  const box = boxAround({ x: 40, z: 40 }, 2)

  test("checks at every :00 from 1:00", () => {
    expect(campTicksDue(-1, 59.9)).toEqual([])
    expect(campTicksDue(59.9, 60)).toEqual([60])
    expect(campTicksDue(60, 60.1)).toEqual([])
    expect(campTicksDue(0, 185)).toEqual([60, 120, 180])
  })

  test("any hero, neutral, lane creep or ward in the box blocks the spawn", () => {
    for (const kind of ["hero", "neutral", "creep", "ward"] as const) {
      const camp = createCamp("c", box)
      const r = trySpawnCamp(camp, [{ id: "x", kind, pos: { x: 41, z: 39 } }])
      expect(r).toMatchObject({ spawned: false, blockedBy: kind })
      expect(camp.stacks).toBe(0)
    }
    const camp = createCamp("c", box)
    expect(
      trySpawnCamp(camp, [{ id: "w", kind: "ward", pos: { x: 43, z: 40 } }]).spawned,
    ).toBeTrue()
  })

  test("pulling creeps out at :53–:55 stacks; clearing resets", () => {
    const camp = createCamp("c", box)
    trySpawnCamp(camp, [])
    for (let i = 0; i < 3; i++) {
      // Pulled neutrals stand outside the box at :00.
      expect(
        trySpawnCamp(camp, [{ id: "n", kind: "neutral", pos: { x: 46, z: 40 } }]).spawned,
      ).toBeTrue()
    }
    expect(camp.stacks).toBe(4)
    // Not pulled: the stack sits in the box and blocks.
    expect(
      trySpawnCamp(camp, [{ id: "n", kind: "neutral", pos: { x: 40, z: 40 } }]).spawned,
    ).toBeFalse()
    clearCamp(camp)
    expect(camp.stacks).toBe(0)
  })

  test("stack planner: leave time and window feasibility", () => {
    const p = planStack({ heroDistance: 6, heroSpeed: 3, exitDistance: 3, creepSpeed: 3 })
    expect(p.aggroAt).toBe(53.5)
    expect(p.leaveAt).toBeCloseTo(53.5 - 0.3 - 2)
    expect(p.clearAt).toBeCloseTo(54.5)
    expect(p.feasible).toBeTrue()
    expect(
      planStack({ heroDistance: 6, heroSpeed: 3, exitDistance: 30, creepSpeed: 3 }).feasible,
    ).toBeFalse()
    expect(
      planStack({ heroDistance: 6, heroSpeed: 3, exitDistance: 3, creepSpeed: 3, pullSecond: 50 })
        .feasible,
    ).toBeFalse()
  })

  test("fog-safe ward-block inference → buy sentry and deward", () => {
    expect(suspectBlock("c", { hadVision: true, campAppeared: false, visibleBlockers: 0 })).toEqual(
      {
        kind: "deward",
        campId: "c",
        buy: "sentry",
      },
    )
    expect(
      suspectBlock("c", { hadVision: false, campAppeared: false, visibleBlockers: 0 }).kind,
    ).toBe("none")
    expect(
      suspectBlock("c", { hadVision: true, campAppeared: false, visibleBlockers: 1 }).kind,
    ).toBe("none")
    expect(
      suspectBlock("c", { hadVision: true, campAppeared: true, visibleBlockers: 0 }).kind,
    ).toBe("none")
  })
})

describe("§5 world events", () => {
  test("cadences: power every 2 min from 6:00, bounty every 3 min, wisdom every 7 min", () => {
    expect(runeTimesDue("power", -1, 600)).toEqual([360, 480, 600])
    expect(runeTimesDue("bounty", -1, 540)).toEqual([0, 180, 360, 540])
    expect(runeTimesDue("wisdom", -1, 900)).toEqual([420, 840])
    expect(runeTimesDue("power", 360, 479)).toEqual([])
  })

  test("alarm fires 15 s ahead", () => {
    expect(upcomingRunes(344)).toEqual([])
    expect(upcomingRunes(345)).toEqual([
      { kind: "bounty", at: 360 },
      { kind: "power", at: 360 },
    ])
    expect(upcomingRunes(465)).toEqual([{ kind: "power", at: 480 }])
    expect(upcomingRunes(830).map((r) => r.kind)).toEqual(["power", "wisdom"])
  })

  test("power runes never repeat back-to-back; both spots and all types appear", () => {
    const r = new PowerRuneRoller(createRandom(7))
    const rolls = Array.from({ length: 200 }, (_, i) => r.roll(360 + i * 120))
    for (let i = 1; i < rolls.length; i++) expect(rolls[i]!.type).not.toBe(rolls[i - 1]!.type)
    expect(new Set(rolls.map((x) => x.type)).size).toBe(POWER_RUNES.length)
    expect(new Set(rolls.map((x) => x.spot))).toEqual(new Set(["top", "bottom"]))
  })

  test("Roshan respawns within 8–11 min; public view never exposes the exact time", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const rosh = new RoshanTimer(createRandom(seed))
      rosh.killed(1000)
      const at = rosh.debugRespawnAt()
      expect(at).toBeGreaterThanOrEqual(1000 + ROSHAN_MIN_RESPAWN)
      expect(at).toBeLessThanOrEqual(1000 + ROSHAN_MAX_RESPAWN)
      expect(Number.isInteger(at)).toBeTrue()
      const pub = rosh.public(1200)
      expect(pub).toEqual({ state: "dead", earliest: 1480, latest: 1660 })
      expect(Object.keys(pub)).not.toContain("respawnAt")
      expect(rosh.public(1500).state).toBe("maybe")
      expect(rosh.aliveProbability(1570)).toBeCloseTo(0.5)
      let spawned = -1
      for (let t = 1000; t <= 1700; t++) if (rosh.tick(t)) spawned = t
      expect(spawned).toBe(at)
    }
  })

  test("trees regrow after 180 s, restoring fog + nav; occupied cells retry", () => {
    const trees = new TreeRegrowth()
    const fog: number[] = []
    const nav: number[] = []
    let occupied = new Set([7])
    const hooks = {
      isOccupied: (id: number) => occupied.has(id),
      restoreFogBlocker: (id: number) => fog.push(id),
      restoreNav: (id: number) => nav.push(id),
    }
    trees.destroy(7, 100)
    trees.destroy(3, 100)
    trees.destroy(3, 150) // already cut: keeps original timestamp
    expect(trees.destroyedAt.get(3)).toBe(100)
    expect(trees.tick(100 + TREE_REGROW_SECONDS - 0.1, hooks)).toEqual([])
    expect(trees.tick(100 + TREE_REGROW_SECONDS, hooks)).toEqual([3])
    expect(trees.isCut(7)).toBeTrue()
    occupied = new Set()
    expect(trees.tick(100 + TREE_REGROW_SECONDS + TREE_REGROW_RETRY - 0.1, hooks)).toEqual([])
    expect(trees.tick(100 + TREE_REGROW_SECONDS + TREE_REGROW_RETRY, hooks)).toEqual([7])
    expect(fog).toEqual([3, 7])
    expect(nav).toEqual([3, 7])
  })
})
