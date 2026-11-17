/**
 * Aggression sweep: kills+deaths at aggression 0 vs 100 across seeds. A balance change
 * to fight-seeking must keep the ≥ 20 % gap.   bun bench/aggression.ts
 */
import { generateMap } from "@mobacraft/map"
import {
  TEAMS,
  aiChoose,
  applyDraft,
  createDraft,
  createMatch,
  defaultTactics,
  isComplete,
  type DraftState,
  type TeamTactics,
} from "../src/index.ts"

const map = generateMap()
const autoDraft = (a: number, b: number): DraftState => {
  let d = createDraft(TEAMS[a]!, TEAMS[b]!)
  while (!isComplete(d)) {
    const r = applyDraft(d, aiChoose(d))
    if (!r.ok) throw new Error(r.error)
    d = r.state
  }
  return d
}
const withBehavior = (t: TeamTactics, aggression: number): TeamTactics => ({
  ...t,
  players: Object.fromEntries(
    Object.entries(t.players).map(([id, p]) => [
      id,
      { ...p, behavior: { ...p.behavior, aggression } },
    ]),
  ),
})

let calm = 0
let wild = 0
for (let seed = 0; seed < 4; seed++) {
  const d = autoDraft(seed % 4, (seed + 1) % 4)
  const run = (aggr: number) => {
    const s = createMatch(map, d, {
      seed,
      tactics: {
        blue: withBehavior(defaultTactics(d, "blue"), aggr),
        red: withBehavior(defaultTactics(d, "red"), aggr),
      },
      maxTime: 12 * 60,
    }).runToEnd()
    return s.kills.blue + s.kills.red
  }
  const c = run(0)
  const w = run(100)
  calm += c
  wild += w
  console.log(`seed ${seed}: calm ${c} kills, wild ${w} kills`)
}
const gap = ((wild - calm) / calm) * 100
console.log(`calm ${calm} vs wild ${wild} — gap ${gap.toFixed(1)} % (target ≥ 20 %)`)
if (gap < 20) {
  console.error("FAIL: aggression no longer widens fights")
  process.exit(1)
}
