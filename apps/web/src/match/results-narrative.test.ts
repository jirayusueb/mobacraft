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

describe("results narrative (playtest #2)", () => {
  test("tells the swing, last objectives and comeback from the final snapshot", () => {
    const final = {
      winner: "red" as DraftSide,
      time: 21 * 60,
      // blue−red gap: −2k, −2.2k, +1.0k (biggest swing: +3.2k toward blue), −0.5k, +0.4k
      history: [
        hist(0, 30_000, 32_000),
        hist(60, 40_000, 42_200),
        hist(120, 52_000, 51_000),
        hist(180, 60_000, 60_500),
        hist(240, 70_000, 69_600),
      ],
      feed: [
        feed(500, "kill", "early kill"),
        feed(870, "tower", "Alpha destroyed a tier 2 tower (mid)"),
        feed(1020, "roshan", "Alpha slew Roshan"),
        feed(1180, "tower", "Alpha destroyed a tier 3 tower (top)"),
        feed(1265, "ancient", "Alpha destroyed the Ancient!"),
        feed(1240, "ward", "ignored ward event"),
      ],
    }
    const lines = narrative(final, { blue: "Alpha", red: "Beta" })
    expect(lines.map((l) => l.kind)).toEqual(["swing", "event", "event", "event", "closing"])
    expect(lines[0]!.text).toBe("At 2:00 Alpha swung the gold lead by 3.2k")
    expect(lines[1]!.text).toBe("17:00 · Alpha slew Roshan")
    expect(lines[2]!.text).toBe("19:40 · Alpha destroyed a tier 3 tower (top)")
    expect(lines[3]!.text).toBe("21:05 · Alpha destroyed the Ancient!")
    expect(lines[4]!.text).toBe("Beta won — comeback from −1.0k")
  })

  test("a wire-to-wire winner gets a never-trailed closing line", () => {
    const final = {
      winner: "blue" as DraftSide,
      time: 900,
      history: [hist(0, 32_000, 30_000), hist(300, 50_000, 45_000)],
      feed: [feed(600, "ancient", "Alpha destroyed the Ancient!")],
    }
    const lines = narrative(final, { blue: "Alpha", red: "Beta" })
    expect(lines[0]!.text).toBe("At 5:00 Alpha swung the gold lead by 3.0k")
    expect(lines.at(-1)!.text).toBe("Alpha won without ever trailing on gold")
  })
})
