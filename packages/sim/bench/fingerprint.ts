/**
 * Determinism fingerprint: hash of runToEnd() for several seeds. A pure optimization
 * must leave this output byte-identical.   bun bench/fingerprint.ts
 */
import { generateMap } from "@mobacraft/map"
import {
  TEAMS,
  aiChoose,
  applyDraft,
  createDraft,
  createMatch,
  isComplete,
  type DraftState,
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
for (const seed of [3, 7, 11, 19]) {
  const m = createMatch(map, autoDraft(seed % 4, (seed + 1) % 4), {
    seed,
    aiCoach: ["blue", "red"],
  })
  const s = m.runToEnd()
  const json = JSON.stringify(s, (_k, v) => (v instanceof Uint8Array ? Array.from(v) : v))
  const hash = new Bun.CryptoHasher("sha256").update(json).digest("hex").slice(0, 16)
  console.log(`seed ${seed}: ${s.winner} @ ${(s.time / 60).toFixed(2)} min  ${hash}`)
}
