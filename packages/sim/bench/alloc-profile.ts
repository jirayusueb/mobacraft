/**
 * Allocation profile (V8 sampling heap profiler): a seed-7 AI-vs-AI match, game minutes
 * 8→14 at 60 fps advance(). Prints total MB allocated and the top self-allocating
 * functions. Run under V8 (Chrome's engine): `bun run bench:alloc`.
 * Pass --no-turbo-inlining --no-maglev-inlining to node for exact caller attribution.
 */
import { Session } from "node:inspector/promises"
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

interface ProfileNode {
  callFrame: { functionName: string; url: string; lineNumber: number }
  selfSize: number
  children: ProfileNode[]
}

let d: DraftState = createDraft(TEAMS[0]!, TEAMS[1]!)
while (!isComplete(d)) {
  const r = applyDraft(d, aiChoose(d))
  if (!r.ok) throw new Error(r.error)
  d = r.state
}
const m = createMatch(generateMap(), d, { seed: 7, aiCoach: ["blue", "red"], speed: 8 })
while (m.time() < 8 * 60) m.advance(1 / 60)

const s = new Session()
s.connect()
await s.post("HeapProfiler.enable")
await s.post("HeapProfiler.startSampling", {
  samplingInterval: 512,
  includeObjectsCollectedByMajorGC: true,
  includeObjectsCollectedByMinorGC: true,
})
while (m.time() < 14 * 60 && !m.snapshot().winner) m.advance(1 / 60)
const { profile } = (await s.post("HeapProfiler.stopSampling")) as {
  profile: { head: ProfileNode }
}

const self = new Map<string, number>()
let total = 0
const walk = (n: ProfileNode) => {
  const f = n.callFrame
  const name = `${f.functionName || "(anon)"} :${f.lineNumber + 1}`
  self.set(name, (self.get(name) ?? 0) + n.selfSize)
  total += n.selfSize
  for (const c of n.children) walk(c)
}
walk(profile.head)
const mb = (b: number) => (b / 1048576).toFixed(1)
console.log(`allocated ${mb(total)} MB over 6 game-minutes (${mb(total / 6)} MB/game-min)`)
for (const [k, v] of [...self].toSorted((a, b) => b[1] - a[1]).slice(0, 20))
  console.log(`${mb(v).padStart(7)} MB ${((v / total) * 100).toFixed(1).padStart(5)} %  ${k}`)
