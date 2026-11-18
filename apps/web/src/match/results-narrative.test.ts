import { describe, expect, test } from "bun:test"
import type { DraftSide, FeedEntry, HistorySample } from "@mobacraft/sim"
import { narrative } from "./results-narrative.ts"

const hist = (t: number, blue: number, red: number): HistorySample => ({
  t,
  nw: { blue, red } as Record<DraftSide, number>,
  xp: { blue: 0, red: 0 } as Record<DraftSide, number>,
  control: { blue: 0, red: 0 } as Record<DraftSide, number>,
})

const feed = (t: number, kind: FeedEntry["kind"], text: string): FeedEntry => ({
  t,
  kind,
  side: "blue",
  text,
})

describe("results narrative (playtest #3: only true claims)", () => {
  const names = { blue: "Alpha", red: "Beta" }

  test("a real comeback: winner trailed ≥ 3k, then got the lead back", () => {
    const final = {
      winner: "red" as DraftSide,
      time: 21 * 60,
      // red−blue gap: +0.5k, −4.0k (worst), −1.0k (+3.0k swing toward red), +1.5k, +2.0k
      history: [
        hist(0, 30_000, 30_500),
        hist(300, 44_000, 40_000),
        hist(600, 51_000, 50_000),
        hist(900, 58_500, 60_000),
        hist(1200, 68_000, 70_000),
      ],
      feed: [
        feed(500, "kill", "early kill"),
        feed(870, "tower", "Beta destroyed a tier 2 tower (mid)"),
        feed(1020, "roshan", "Beta slew Roshan"),
        feed(1180, "tower", "Beta destroyed a tier 3 tower (top)"),
        feed(1265, "ancient", "Beta destroyed the Ancient!"),
        feed(1240, "ward", "ignored ward event"),
      ],
    }
    const lines = narrative(final, names)
    expect(lines.map((l) => l.kind)).toEqual(["swing", "event", "event", "event", "closing"])
    expect(lines[0]!.text).toBe("Turning point 10:00: Beta swung the gold lead by 3.0k")
    expect(lines[1]!.text).toBe("17:00 · Beta slew Roshan")
    expect(lines.at(-1)!.text).toBe("Beta won — comeback from −4.0k")
  })

  test("m1 regression: the winner never recovered gold — no 'comeback', and no loser swing", () => {
    // Alpha (blue) led all game by up to 19.4k and is still +4.2k when Beta takes the Ancient.
    const final = {
      winner: "red" as DraftSide,
      time: 1734,
      history: [
        hist(0, 3000, 3000),
        hist(600, 30_000, 25_000),
        hist(1200, 60_000, 40_600), // blue +19.4k
        hist(1500, 70_000, 62_000), // +11.4k step toward red: the real turning point
        hist(1730, 76_000, 71_800), // last 30 s: ignored even if bigger
      ],
      feed: [feed(1734, "ancient", "Beta destroyed the Ancient!")],
    }
    const lines = narrative(final, names)
    expect(lines[0]!.text).toBe("Turning point 25:00: Beta swung the gold lead by 11.4k")
    expect(lines.at(-1)!.text).toBe("Beta won while still −4.2k on gold — objectives beat gold")
    expect(lines.some((l) => /comeback/.test(l.text))).toBe(false)
  })

  test("m4 regression: a wire-to-wire stomp with a −0.1k blip is not a comeback", () => {
    const final = {
      winner: "blue" as DraftSide,
      time: 1173,
      history: [hist(0, 3000, 3100), hist(400, 20_000, 14_000), hist(1100, 60_000, 43_000)],
      feed: [feed(1173, "ancient", "Alpha destroyed the Ancient!")],
    }
    const lines = narrative(final, names)
    expect(lines.at(-1)!.text).toBe("Alpha led by up to +17.0k and closed it out")
  })
})
