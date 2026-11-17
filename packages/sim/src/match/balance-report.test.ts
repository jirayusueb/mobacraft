import { describe, expect, test } from "bun:test"
import { generateMap } from "@mobacraft/map"
import {
  applyDraft,
  aiChoose,
  createDraft,
  createMatch,
  isComplete,
  TEAMS,
  type DraftState,
} from "../index.ts"

const map = generateMap()

// Swap team order per seed so side parity is measured, not one comp's bias.
const autoDraft = (swap: boolean): DraftState => {
  let d = createDraft(TEAMS[swap ? 1 : 0]!, TEAMS[swap ? 0 : 1]!)
  while (!isComplete(d)) {
    const r = applyDraft(d, aiChoose(d))
    if (!r.ok) throw new Error(r.error)
    d = r.state
  }
  return d
}

const SEEDS = [1, 2, 4, 5, 8, 13]

/**
 * Playtest #4 balance gate (dota-2-player feedback): farm income and the jungle
 * role must let non-mid heroes carry. Gates: no stomp-short or stalled games,
 * both sides win across seeds, and a jungle/carry/offlane hero tops net worth
 * in at least 2 of 6 matches.
 */
describe("balance report (playtest #4: farm and jungle)", () => {
  test("6-seed AI-vs-AI report: pace, side parity, non-mid carries", () => {
    const nonMidTop: string[] = []
    const winners: string[] = []
    for (const [i, seed] of SEEDS.entries()) {
      const s = createMatch(map, autoDraft(i % 2 === 1), {
        seed,
        aiCoach: ["blue", "red"],
      }).runToEnd()
      expect(s.winner).not.toBeNull()
      // Pace: no stomps under 8 min, no stalls past 35 min.
      expect(s.time).toBeGreaterThan(8 * 60)
      expect(s.time).toBeLessThan(35 * 60)
      winners.push(s.winner!)
      const top = [...s.heroes].toSorted((a, b) => b.netWorth - a.netWorth)[0]!
      if (top.role !== "mid") nonMidTop.push(`${top.heroName}(${top.role})`)
      console.log(
        `seed ${seed}: winner=${s.winner} time=${(s.time / 60).toFixed(1)}m ` +
          `topNW=${top.heroName}(${top.role}) ${Math.round(top.netWorth)} ` +
          `lastHits=${s.heroes.reduce((n, h) => n + h.lastHits, 0)}`,
      )
    }
    expect(new Set(winners).size).toBe(2)
    expect(nonMidTop.length).toBeGreaterThanOrEqual(2)
  }, 180_000)
})
