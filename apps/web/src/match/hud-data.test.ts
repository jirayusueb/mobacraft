import { describe, expect, test } from "bun:test"
import type { FeedEntry, HeroLine, MatchSnapshot } from "@mobacraft/sim"
import { AnnouncerTracker, GoldHistory, SAMPLE_EVERY } from "./hud-data.ts"

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

const at = (time: number, blue = time, red = 0) => snap({ time, gold: { blue, red } })

describe("GoldHistory", () => {
  test("throttles samples to SAMPLE_EVERY", () => {
    const h = new GoldHistory()
    h.sample(at(0))
    h.sample(at(SAMPLE_EVERY / 2))
    h.sample(at(SAMPLE_EVERY))
    expect(h.samples.map((s) => s.t)).toEqual([0, SAMPLE_EVERY])
  })

  test("finish always records the final moment once and returns a copy", () => {
    const h = new GoldHistory()
    h.sample(at(10))
    const done = h.finish(at(10.3, 99))
    expect(done.gold.map((s) => s.t)).toEqual([10, 10.3])
    expect(done.gold.at(-1)!.blue).toBe(99)
    expect(h.finish(at(10.3)).gold).toHaveLength(2)
    h.sample(at(50))
    expect(done.gold).toHaveLength(2)
  })
})
