import { describe, expect, test } from "bun:test"
import { generateMap } from "@mobacraft/map"
import {
  TEAMS,
  aiChoose,
  applyDraft,
  createDraft,
  createMatch,
  heroDef,
  isComplete,
} from "../../index.ts"

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

  test("ranged heroes kite smoothly: few direction reversals while fighting", () => {
    const m = createMatch(map, draft(0, 1), { seed: 3, aiCoach: ["blue", "red"] })
    m.setSpeed(1)
    const prev = new Map<string, { x: number; z: number; dx: number; dz: number }>()
    let moving = 0
    let reversals = 0
    while (m.time() < 12 * 60 && !m.snapshot().winner) {
      m.advance(0.1)
      const units = m.units()
      for (const h of m.snapshot().heroes) {
        if (!h.alive || h.intent !== "fight" || heroDef(h.heroId).attack !== "ranged") continue
        const u = units.find((x) => x.id === h.id)!
        const p = prev.get(h.id)
        const dx = p ? u.x - p.x : 0
        const dz = p ? u.z - p.z : 0
        const sp = Math.hypot(dx, dz)
        // Ignore teleports (blink/force/respawn); count real steps only.
        if (p && sp > 0.02 && sp < 0.6) {
          moving++
          if (p.dx * dx + p.dz * dz < -0.5 * Math.hypot(p.dx, p.dz) * sp) reversals++
        }
        const keep = p && !(sp > 0.02 && sp < 0.6)
        prev.set(h.id, { x: u.x, z: u.z, dx: keep ? p.dx : dx, dz: keep ? p.dz : dz })
      }
    }
    expect(moving).toBeGreaterThan(100)
    expect(reversals / moving).toBeLessThan(0.08)
  }, 60_000)
})
