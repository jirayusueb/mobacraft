import { describe, expect, test } from "bun:test"
import type { Role } from "../heroes.ts"
import {
  Blackboard,
  type Bias,
  type MacroInput,
  ThreatMap,
  baseScores,
  blinkLanding,
  computeBias,
  decide,
  defensiveTrigger,
  holdDisable,
  holdPoint,
  itemTiming,
  killPotential,
  kiteVector,
  survivalReadiness,
} from "./index.ts"

const NEUTRAL: Bias = { mul: {}, add: {}, mode: "team" }

const input = (o: Partial<MacroInput> = {}): MacroInput => ({
  traits: { role: "carry", initiator: false, followUp: false, pusher: false, global: false },
  phase: "mid",
  survival: 0.9,
  hpPct: 1,
  manaPct: 1,
  canCast: true,
  farmSafety: 0.8,
  itemCloseness: 0.3,
  curveGreed: 1,
  gankValue: 0,
  hasDisable: false,
  ultReady: false,
  alliesFighting: 0,
  fightOdds: 0.6,
  fightDist: 10,
  blinkReady: false,
  pushPower: 0.4,
  farSide: 0,
  alliesOnObjective: 0,
  nearEnemies: 0,
  danger: 0,
  saveTarget: false,
  current: null,
  ...o,
})

const ghost = (age: number) => ({ x: 64, z: 64, level: 6, age, speed: 3 })

describe("layer 1 — awareness", () => {
  test("survival readiness weighs hp, mana and ready defensive actives", () => {
    expect(survivalReadiness({ hpPct: 1, manaPct: 1, defensives: [] })).toBeCloseTo(0.825)
    expect(
      survivalReadiness({ hpPct: 1, manaPct: 1, defensives: [{ id: "bkb", ready: true }] }),
    ).toBeCloseTo(1)
    expect(
      survivalReadiness({ hpPct: 0.34, manaPct: 0.2, defensives: [{ id: "bkb", ready: false }] }),
    ).toBeCloseTo(0.227)
  })

  test("kill potential = burst ÷ effective hp, clamped", () => {
    const me = { ultDamage: 300, skillDamage: 100, attackDps: 50 }
    expect(killPotential(me, { hp: 950, physicalTaken: 0.5, magicTaken: 1 })).toBeCloseTo(0.5)
    expect(killPotential(me, { hp: 100, physicalTaken: 1, magicTaken: 1 })).toBe(1)
    expect(
      killPotential(
        { ultDamage: 0, skillDamage: 0, attackDps: 0 },
        { hp: 500, physicalTaken: 1, magicTaken: 1 },
      ),
    ).toBe(0)
  })

  test("item timing delta: 300 g short of Blink", () => {
    const t = itemTiming(1300, 1600)
    expect(t.delta).toBe(300)
    expect(t.closeness).toBeCloseTo(0.8125)
    expect(itemTiming(500, null).closeness).toBe(0)
  })

  test("threat map: towers are dangerous, a fresh ghost spikes then decays", () => {
    const m = new ThreatMap(128)
    m.update({ towers: [{ x: 20, z: 20, range: 6.5 }], visible: [], ghosts: [] })
    expect(m.danger({ x: 20, z: 20 })).toBeCloseTo(0.6)
    expect(m.danger({ x: 100, z: 100 })).toBe(0)
    m.update({ towers: [], visible: [], ghosts: [ghost(1)] })
    const fresh = m.danger({ x: 64, z: 64 })
    m.update({ towers: [], visible: [], ghosts: [ghost(15)] })
    const old = m.danger({ x: 64, z: 64 })
    m.update({ towers: [], visible: [], ghosts: [ghost(25)] })
    expect(fresh).toBeGreaterThan(0.3)
    expect(old).toBeLessThan(fresh)
    expect(m.danger({ x: 64, z: 64 })).toBe(0)
  })
})

describe("layer 2 — macro utility", () => {
  test("a carry 300 g short of a big item farms instead of ganking", () => {
    const d = decide(
      input({ itemCloseness: itemTiming(1300, 1600).closeness, gankValue: 0.5, hasDisable: true }),
      NEUTRAL,
    )
    expect(d.action).toBe("farm")
    expect(d.scores.farm).toBeGreaterThan(d.scores.gank)
  })

  test("a level-6 ganker with ult ready ganks an isolated target over farming", () => {
    const d = decide(
      input({
        traits: { role: "jungle", initiator: true, followUp: false, pusher: false, global: true },
        gankValue: 0.7,
        hasDisable: true,
        ultReady: true,
      }),
      NEUTRAL,
    )
    expect(d.action).toBe("gank")
  })

  test("an initiator with Blink + ult ready joins a fight two allies started", () => {
    const d = decide(
      input({
        traits: { role: "offlane", initiator: true, followUp: false, pusher: false, global: false },
        alliesFighting: 2,
        ultReady: true,
        blinkReady: true,
        fightOdds: 0.8,
        fightDist: 6,
      }),
      NEUTRAL,
    )
    expect(d.action).toBe("fight")
  })

  test("a split pusher pushes the far lane when all 5 enemies are seen elsewhere", () => {
    const bias = computeBias({
      phase: "mid",
      plans: { laning: "standard", mid: "split", late: "siege" },
      coach: null,
      igl: null,
      aggression: 50,
      farmPriority: 50,
      slot: "safe",
      isCore: true,
      roshanUp: true,
      alliesAlive: 5,
      enemiesDead: 0,
      stall: false,
    })
    expect(bias.mode).toBe("split")
    const d = decide(
      input({
        traits: { role: "carry", initiator: false, followUp: false, pusher: true, global: false },
        pushPower: 1,
        farSide: 1,
      }),
      bias,
    )
    expect(d.action).toBe("objective")
    expect(d.mode).toBe("split")
  })

  test("spec retreat example beats every action for every role", () => {
    const survival = survivalReadiness({
      hpPct: 0.34,
      manaPct: 0.2,
      defensives: [{ id: "bkb", ready: false }],
    })
    for (const role of ["carry", "mid", "offlane", "jungle", "support"] as Role[]) {
      const d = decide(
        input({
          traits: { role, initiator: true, followUp: true, pusher: true, global: true },
          survival,
          hpPct: 0.34,
          manaPct: 0.2,
          canCast: false,
          nearEnemies: 1,
          gankValue: 0.4,
          hasDisable: true,
          alliesFighting: 1,
          itemCloseness: 0.9,
        }),
        NEUTRAL,
      )
      expect(d.scores.retreat).toBeCloseTo(0.773, 2)
      expect(d.action).toBe("retreat")
    }
  })

  test("scores stay in [0,1] after boosts; save 1.0 outranks a coach-pushed fight", () => {
    const s = baseScores(
      input({
        traits: { role: "offlane", initiator: true, followUp: true, pusher: true, global: true },
        alliesFighting: 5,
        blinkReady: true,
        ultReady: true,
        fightOdds: 1,
        fightDist: 0,
        gankValue: 1,
        hasDisable: true,
      }),
      "team",
    )
    for (const v of Object.values(s)) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
    const coachGroup = computeBias({
      phase: "late",
      plans: { laning: "standard", mid: "group", late: "siege" },
      coach: "group",
      igl: "push",
      aggression: 100,
      farmPriority: 0,
      slot: "safe",
      isCore: false,
      roshanUp: false,
      alliesAlive: 5,
      enemiesDead: 0,
      stall: false,
    })
    const d = decide(
      input({
        traits: {
          role: "support",
          initiator: false,
          followUp: false,
          pusher: false,
          global: false,
        },
        saveTarget: true,
        alliesFighting: 3,
        fightOdds: 1,
        fightDist: 2,
      }),
      coachGroup,
    )
    expect(d.action).toBe("save")
  })

  test("biases: coach farm boosts farm, aggression shifts gank vs retreat", () => {
    const base = {
      phase: "mid" as const,
      plans: { laning: "standard" as const, mid: "group" as const, late: "siege" as const },
      coach: null,
      igl: null,
      aggression: 50,
      farmPriority: 50,
      slot: "safe",
      isCore: false,
      roshanUp: true,
      alliesAlive: 5,
      enemiesDead: 0,
      stall: false,
    }
    expect(computeBias({ ...base, coach: "farm" }).mul.farm!).toBeGreaterThan(1.5)
    const wild = computeBias({ ...base, aggression: 100 })
    const calm = computeBias({ ...base, aggression: 0 })
    expect(wild.mul.gank!).toBeGreaterThan(calm.mul.gank!)
    expect(wild.mul.retreat!).toBeLessThan(calm.mul.retreat!)
    expect(computeBias({ ...base, coach: "roshan" }).mode).toBe("roshan")
  })

  test("commitment keeps the current action on near-ties", () => {
    const i = input({ farmSafety: 0.75, itemCloseness: 0, alliesOnObjective: 0 })
    const s = baseScores(i, "team")
    const other = s.farm >= s.objective ? "objective" : "farm"
    expect(decide({ ...i, current: other }, NEUTRAL).action).toBe(other)
  })
})

describe("layer 3 — micro combat", () => {
  const view = {
    hpPct: 0.5,
    stunned: false,
    ready: new Set<"bkb" | "blink" | "force" | "eul">(["bkb", "eul"]),
    sinceHeroDamage: 10,
    incomingProjectile: 2,
    enemiesClose: 1,
    enemiesNear: 2,
    role: "carry" as const,
    fightStart: false,
  }
  test("defensive trigger: projectile < 400 u and hp < 60 % → BKB, then Eul's", () => {
    expect(defensiveTrigger(view)).toEqual({ item: "bkb" })
    expect(defensiveTrigger({ ...view, ready: new Set(["eul"]) })).toEqual({ item: "eul" })
    expect(defensiveTrigger({ ...view, hpPct: 0.7 })).toBeNull()
    expect(defensiveTrigger({ ...view, incomingProjectile: 5 })).toBeNull()
    expect(defensiveTrigger({ ...view, stunned: true })).toBeNull()
  })
  test("low hp with an enemy close → Force Staff, else escape Blink (not while hit)", () => {
    const low = { ...view, hpPct: 0.2, incomingProjectile: Infinity }
    expect(defensiveTrigger({ ...low, ready: new Set(["force", "blink"]) })).toEqual({
      item: "force",
    })
    expect(defensiveTrigger({ ...low, ready: new Set(["blink"]) })).toEqual({
      item: "blink",
      escape: true,
    })
    expect(defensiveTrigger({ ...low, ready: new Set(["blink"]), sinceHeroDamage: 1 })).toBeNull()
  })
  test("chain-stun: hold while our stun outlasts travel + slack", () => {
    expect(holdDisable(1.2, 0.3)).toBe(true)
    expect(holdDisable(0.5, 0.3)).toBe(false)
    expect(holdDisable(0, 0)).toBe(false)
  })
  test("kite vector points away from a melee enemy inside 60 % range", () => {
    const v = kiteVector({ x: 10, z: 10 }, 5, [{ x: 12, z: 10, melee: true }])!
    expect(v.x).toBeLessThan(0)
    expect(kiteVector({ x: 10, z: 10 }, 5, [{ x: 14, z: 10, melee: true }])).toBeNull()
    expect(kiteVector({ x: 10, z: 10 }, 5, [{ x: 12, z: 10, melee: false }])).toBeNull()
  })
  test("initiator holds at 8.5–10 tiles and blinks to 1.5 tiles short", () => {
    expect(holdPoint({ x: 0, z: 0 }, { x: 9, z: 0 })).toBeNull()
    const p = holdPoint({ x: 3, z: 0 }, { x: 0, z: 0 })!
    expect(Math.hypot(p.x, p.z)).toBeCloseTo(9.25)
    const l = blinkLanding({ x: 0, z: 0 }, { x: 10, z: 0 })
    expect(l.x).toBeCloseTo(8.5)
  })
})

describe("layer 4 — blackboard", () => {
  test("claims split two farmers across two camps; expiry and release free them", () => {
    const bb = new Blackboard()
    const camps = ["camp:a", "camp:b"]
    const pick = (hero: string, t: number) => camps.find((c) => bb.isFree(c, hero, t))!
    const a = pick("h1", 0)
    expect(bb.claim(a, "h1", 0)).toBe(true)
    const b = pick("h2", 0)
    expect(b).not.toBe(a)
    expect(bb.claim(a, "h2", 0)).toBe(false)
    bb.claim(b, "h2", 0)
    // A hero holds one camp: moving releases the old one.
    expect(bb.isFree(a, "h3", 9)).toBe(true) // expired after CLAIM_TTL
    bb.claim(a, "h1", 1)
    bb.release("h1")
    expect(bb.isFree(a, "h3", 1)).toBe(true)
  })
  test("ganks allow two hunters; target lock expires", () => {
    const bb = new Blackboard()
    expect(bb.claim("gank:e1", "h1", 0)).toBe(true)
    expect(bb.claim("gank:e1", "h2", 0)).toBe(true)
    expect(bb.claim("gank:e1", "h3", 0)).toBe(false)
    bb.setLock("e1", "h1", 0)
    expect(bb.lock(2)?.target).toBe("e1")
    expect(bb.lock(5)).toBeNull()
  })
})
