import { describe, expect, test } from "bun:test"
import { generateMap } from "@mobacraft/map"
import { TEAMS, aiChoose, applyDraft, createDraft, createMatch, isComplete } from "../../index.ts"

const map = generateMap()
const draft = (a: number, b: number) => {
  let d = createDraft(TEAMS[a]!, TEAMS[b]!)
  while (!isComplete(d)) {
    const r = applyDraft(d, aiChoose(d))
    if (!r.ok) throw new Error(r.error)
    d = r.state
  }
  return d
}

describe("hero think in the match (spec/09 acceptance)", () => {
  test("seeds 1–6: actives fire, projectiles fizzle, locks focus, saves happen", () => {
    const actives: Record<string, number> = {}
    let fizzled = 0
    let total = 0
    let onLock = 0
    const seen = new Set<string>()
    let minMana = Infinity
    for (let seed = 1; seed <= 6; seed++) {
      const m = createMatch(map, draft(seed % 4, (seed + 1) % 4), {
        seed,
        aiCoach: ["blue", "red"],
      })
      while (!m.snapshot().winner && m.time() < 40 * 60) {
        m.advance(2)
        for (const h of m.snapshot().heroes) {
          if (h.think.action) seen.add(h.think.action)
          if (h.alive) minMana = Math.min(minMana, h.mana / h.maxMana)
          expect(h.mana).toBeLessThanOrEqual(h.maxMana)
        }
      }
      const st = m.thinkStats()
      for (const [k, v] of Object.entries(st.actives)) actives[k] = (actives[k] ?? 0) + v
      fizzled += st.fizzled
      total += st.lockCasts.total
      onLock += st.lockCasts.onLock
    }
    for (const id of ["bkb", "blink", "force", "eul"])
      expect(actives[id]!).toBeGreaterThanOrEqual(1)
    expect(fizzled).toBeGreaterThanOrEqual(1)
    expect(total).toBeGreaterThan(0)
    expect(onLock / total).toBeGreaterThanOrEqual(0.5)
    for (const a of ["farm", "fight", "gank", "objective", "retreat", "save"])
      expect(seen.has(a)).toBe(true)
    expect(minMana).toBeLessThan(0.5) // mana is actually spent
  }, 120_000)

  test("deterministic with hero think", () => {
    const d = draft(0, 1)
    const run = () => createMatch(map, d, { seed: 21, aiCoach: ["blue", "red"] }).runToEnd()
    const a = run()
    const b = run()
    expect(a.heroes).toEqual(b.heroes)
    expect(a.time).toBe(b.time)
  }, 60_000)
})
