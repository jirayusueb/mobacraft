import { describe, expect, test } from "bun:test"
import type { FeedEntry, HeroLine, MatchSnapshot } from "@mobacraft/sim"
import type { CommsEntry } from "@mobacraft/sim"
import {
  AnnouncerTracker,
  commsText,
  inventorySummary,
  inventoryZones,
  leadMarkers,
  leadSeries,
  noCallerAlive,
  phaseBands,
  signedK,
  roshanHp,
  roshanUnderAttack,
} from "./hud-data.ts"

const hero = (over: Partial<HeroLine>): HeroLine =>
  ({
    id: "h",
    heroId: "hero",
    heroName: "Hero",
    playerId: "p",
    playerName: "P",
    side: "blue",
    alive: true,
    ...over,
  }) as HeroLine

const ana = hero({ id: "a", heroId: "ha", heroName: "Ash", playerId: "pa", playerName: "Ana" })
const bo = hero({
  id: "b",
  heroId: "hb",
  heroName: "Bog",
  playerId: "pb",
  playerName: "Bo",
  side: "red",
})

const snap = (over: Partial<MatchSnapshot>): MatchSnapshot =>
  ({ time: 0, heroes: [ana, bo], feed: [], winner: null, ...over }) as MatchSnapshot

const kill = (t: number, first = false): FeedEntry => ({
  t,
  kind: first ? "first-blood" : "kill",
  side: "blue",
  text: `${first ? "First blood! " : ""}Ana (Ash) slew Bo (Bog)`,
})

const full = { blue: 1, red: 1 }
const name = (s: string) => s.toUpperCase()

describe("AnnouncerTracker", () => {
  test("announces each feed entry once with increasing ids", () => {
    const tr = new AnnouncerTracker()
    const feed = [kill(1, true)]
    const first = tr.announce(snap({ feed }), full, name)
    expect(first.map((b) => b.kind)).toEqual(["first-blood"])
    expect(tr.announce(snap({ feed }), full, name)).toEqual([])
    const next = tr.announce(snap({ feed: [...feed, kill(30)] }), full, name)
    expect(next).toEqual([])
    const tower: FeedEntry = { t: 31, kind: "tower", side: "red", text: "" }
    const more = tr.announce(snap({ feed: [...feed, kill(30), tower] }), full, name)
    expect(more[0]!.kind).toBe("tower")
    expect(more[0]!.id).toBeGreaterThan(first[0]!.id)
  })

  test("tiebreak warning becomes a high-priority time banner", () => {
    const tr = new AnnouncerTracker()
    const warn: FeedEntry = {
      t: 2280,
      kind: "time-warning",
      side: "blue",
      text: "2 minutes left — ANA lead on objectives",
    }
    const out = tr.announce(snap({ feed: [warn] }), full, name)
    expect(out.map((b) => b.kind)).toEqual(["time"])
    expect(out[0]!.detail).toBe("ANA lead on objectives")
    expect(out[0]!.priority).toBeGreaterThanOrEqual(7)
  })

  test("multi-kills inside the window escalate", () => {
    const tr = new AnnouncerTracker()
    const out = tr.announce(snap({ feed: [kill(1), kill(3), kill(5)] }), full, name)
    expect(out.map((b) => b.title)).toHaveLength(2)
    expect(out.every((b) => b.kind === "multi")).toBe(true)
    expect(out[1]!.priority).toBeGreaterThan(out[0]!.priority)
  })

  test("team wipe fires once until the team revives", () => {
    const tr = new AnnouncerTracker()
    const dead = snap({ heroes: [ana, { ...bo, alive: false }] })
    expect(tr.announce(dead, full, name).map((b) => b.kind)).toEqual(["wipe"])
    expect(tr.announce(dead, full, name)).toEqual([])
    tr.announce(snap({}), full, name)
    expect(tr.announce(dead, full, name).map((b) => b.side)).toEqual(["blue"])
  })

  test("ancient warning is rate limited", () => {
    const tr = new AnnouncerTracker()
    const a = tr.announce(snap({ time: 100 }), { blue: 0.9, red: 1 }, name)
    expect(a.map((b) => [b.kind, b.side])).toEqual([["ancient", "red"]])
    expect(tr.announce(snap({ time: 110 }), { blue: 0.8, red: 1 }, name)).toEqual([])
    expect(tr.announce(snap({ time: 200 }), { blue: 0.7, red: 1 }, name)).toHaveLength(1)
  })
})

describe("phase banner", () => {
  test("a phase feed entry becomes a neutral phase banner", () => {
    const tr = new AnnouncerTracker()
    const f: FeedEntry = {
      t: 420,
      kind: "phase",
      side: "neutral",
      text: "Mid game — the laning phase is over",
    }
    const [b] = tr.announce(snap({ feed: [f] }), full, name)
    expect(b!.kind).toBe("phase")
    expect(b!.side).toBe("neutral")
    expect(b!.title).toBe("Mid Game")
    expect(b!.detail).toBe("the laning phase is over")
  })
})

const hist = (t: number, nb: number, nr: number) => ({
  t,
  nw: { blue: nb, red: nr },
  xp: { blue: nb / 2, red: nr / 2 },
  control: { blue: 0, red: 0 },
})

const entry = (over: Partial<CommsEntry>): CommsEntry => ({
  t: 0,
  side: "blue",
  from: "coach",
  caller: "Ana",
  text: "Group up!",
  followers: 4,
  total: 5,
  ...over,
})

describe("leadSeries", () => {
  test("maps sim history to your-side leads and appends the live moment", () => {
    const s = snap({
      time: 12,
      history: [hist(0, 0, 0), hist(5, 600, 400), hist(10, 900, 1000)],
      netWorth: { blue: 1000, red: 1500 },
      heroes: [
        { ...ana, xp: 300 },
        { ...bo, xp: 100 },
      ],
    })
    const blue = leadSeries(s, "blue")
    expect(blue.map((p) => p.t)).toEqual([0, 5, 10, 12])
    expect(blue[1]!.nw).toBe(200)
    expect(blue.at(-1)).toEqual({ t: 12, nw: -500, xp: 200 })
    expect(leadSeries(s, "red")[1]!.nw).toBe(-200)
  })
  test("does not duplicate a sample at the same moment", () => {
    const s = snap({ time: 5, history: [hist(5, 1, 0)], netWorth: { blue: 1, red: 0 } })
    expect(leadSeries(s, "blue")).toHaveLength(1)
  })
})

describe("phaseBands", () => {
  test("spans each started phase up to the next one or the end", () => {
    expect(phaseBands({ laning: 0, mid: 420 }, 600)).toEqual([
      { phase: "laning", from: 0, to: 420 },
      { phase: "mid", from: 420, to: 600 },
    ])
    expect(phaseBands({}, 30)).toEqual([{ phase: "laning", from: 0, to: 30 }])
  })
})

describe("leadMarkers", () => {
  test("keeps kills, objectives and phase changes with the right owner", () => {
    const feed: FeedEntry[] = [
      kill(10),
      { t: 20, kind: "call", side: "blue", text: "x" },
      { t: 420, kind: "phase", side: "neutral", text: "Mid game" },
    ]
    const m = leadMarkers(feed, [ana, bo], "red")
    expect(m.map((x) => [x.kind, x.mine])).toEqual([
      ["kill", false],
      ["phase", null],
    ])
    expect(m[0]!.label).toBe("Ana slew Bo")
  })
})

describe("comms", () => {
  test("formats coach relays through the IGL", () => {
    expect(commsText(entry({}), [{ ...ana, igl: true }])).toBe(
      'Coach → Ana (IGL): "Group up!" · 4/5 following',
    )
    expect(commsText(entry({}), [{ ...ana, igl: false }])).toContain("Ana (backup)")
  })
  test("no caller alive", () => {
    expect(commsText(entry({ caller: null }), [])).toBe('Coach: "Group up!" · no caller alive')
    expect(noCallerAlive([{ ...ana, alive: false }, bo], "blue")).toBe(true)
    expect(noCallerAlive([ana, bo], "blue")).toBe(false)
  })
  test("signedK", () => {
    expect(signedK(1500)).toBe("+1.5k")
    expect(signedK(-400)).toBe("−0.4k")
    expect(signedK(10)).toBe("0")
  })
})

describe("roshan HUD", () => {
  test("roshanHp reads the pit boss from live units; null when dead/absent", () => {
    expect(
      roshanHp([
        { kind: "creep", hp: 1 },
        { kind: "roshan", hp: 0.64 },
      ]),
    ).toBeCloseTo(0.64, 9)
    expect(roshanHp([{ kind: "creep", hp: 1 }])).toBeNull()
    expect(roshanHp([])).toBeNull()
  })

  test("roshanUnderAttack only while alive and hurt", () => {
    expect(roshanUnderAttack(1)).toBeFalse()
    expect(roshanUnderAttack(0.995)).toBeFalse()
    expect(roshanUnderAttack(0.42)).toBeTrue()
    expect(roshanUnderAttack(null)).toBeFalse()
  })
})

describe("inventory zones (spec/10)", () => {
  test("older snapshots without zone fields read as empty", () => {
    const z = inventoryZones(hero({ items: ["boots"] }))
    expect(z).toEqual({
      backpack: [],
      neutral: null,
      stash: [],
      inTransit: [],
      buffs: [],
      tango: 0,
      any: false,
    })
    expect(inventorySummary(hero({ items: ["boots"] }))).toBe("items: boots")
  })

  test("every zone is surfaced, empties dropped", () => {
    const h = hero({
      items: ["boots", "blade"],
      main: ["boots", null, "blade", "blink", null, null],
      mainMute: [0, 0, 0, 4.2, 0, 0],
      backpack: ["steel", null, null],
      neutral: "n-trinket",
      stash: [null, "orb", null, null, null, null],
      inTransit: ["plating"],
      buffs: ["moon-shard"],
      tango: 2,
    })
    const z = inventoryZones(h)
    expect(z.backpack).toEqual(["steel"])
    expect(z.stash).toEqual(["orb"])
    expect(z.inTransit).toEqual(["plating"])
    expect(z.any).toBeTrue()
    expect(inventorySummary(h)).toBe(
      "items: boots, blade, blink; muted: blink; neutral: n-trinket; backpack: steel; " +
        "stash: orb; on courier: plating; buffs: moon-shard; 2 tango",
    )
  })

  test("names come from the supplied resolver", () => {
    const h = hero({ items: ["boots"], main: ["boots", null, null, null, null, null] })
    expect(inventorySummary(h, (id) => id.toUpperCase())).toBe("items: BOOTS")
  })
})
