/**
 * Memory harness (spec/02 budgets). Drives a match the way the web client does:
 * 60 fps frames calling advance/units/fx/structures, snapshot at 6 Hz, fog at 20 Hz.
 * Reports retained heap after GC over game time, the snapshot payload size, and the
 * bytes allocated per real second of play.
 *   bun run bench:memory -- [gameMinutes=30] [speed=8] [seed=7]   (from packages/sim)
 */
import v8 from "node:v8"
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

const minutes = Number(process.argv[2] ?? 30)
const speed = Number(process.argv[3] ?? 8)
const seed = Number(process.argv[4] ?? 7)

const autoDraft = (): DraftState => {
  let d = createDraft(TEAMS[0]!, TEAMS[1]!)
  while (!isComplete(d)) {
    const r = applyDraft(d, aiChoose(d))
    if (!r.ok) throw new Error(r.error)
    d = r.state
  }
  return d
}

// Run under V8 (what Chrome runs): bun build → node --expose-gc. See bench/README.
const gc = (globalThis as { gc?: () => void }).gc
if (!gc) throw new Error("run with node --expose-gc (bun run bench:memory)")
const used = () => v8.getHeapStatistics().used_heap_size + process.memoryUsage().arrayBuffers
const gcHeap = () => {
  gc()
  return used()
}
const mb = (b: number) => (b / 1024 / 1024).toFixed(2)

const map = generateMap()
const base = gcHeap()
const m = createMatch(map, autoDraft(), { seed, aiCoach: ["blue", "red"], speed })
const afterCreate = gcHeap()

const FRAME = 1 / 60
let frame = 0
let lastSnap = m.snapshot()
const rows: string[] = []
let nextReport = 0
let wall = performance.now()
/** Bytes allocated by one call, averaged over n calls without an intervening GC. */
const allocOf = (f: () => unknown, n = 50) => {
  gc()
  const h0 = used()
  for (let i = 0; i < n; i++) f()
  return (used() - h0) / n
}
const kb = (b: number) => (b / 1024).toFixed(1).padStart(6)
let sampled = false
const callRows: string[] = []
while (!lastSnap.winner && m.time() < minutes * 60) {
  if (!sampled && m.time() >= 12 * 60) {
    sampled = true
    callRows.push(
      `per call @12 min: snapshot ${kb(allocOf(m.snapshot))} KB  units ${kb(allocOf(m.units))} KB  ` +
        `fog ${kb(allocOf(() => m.fog("blue")))} KB  structures ${kb(allocOf(m.structures))} KB  ` +
        `advance(1/60) ${kb(allocOf(() => m.advance(FRAME), 20))} KB`,
    )
  }
  m.advance(FRAME)
  m.units()
  m.fx()
  m.structures()
  if (frame % 3 === 0) m.fog("blue")
  if (frame % 10 === 0) lastSnap = m.snapshot()
  frame++
  if (m.time() >= nextReport) {
    const s = m.snapshot()
    const json = JSON.stringify({ ...s, fog: undefined }).length
    rows.push(
      `${(m.time() / 60).toFixed(1).padStart(5)} min  heap ${mb(gcHeap()).padStart(7)} MB  ` +
        `snapshot ${(json / 1024).toFixed(1).padStart(6)} KB  feed ${s.feed.length}  ` +
        `comms ${s.comms.length}  history ${s.history.length}  purchases ${s.purchases.length}`,
    )
    nextReport += 5 * 60
  }
}
wall = performance.now() - wall
const end = gcHeap()

console.log(`map+modules ${mb(base)} MB, match created +${mb(afterCreate - base)} MB`)
for (const r of rows) console.log(r)
for (const r of callRows) console.log(r)
console.log(
  `end ${(m.time() / 60).toFixed(1)} min, retained ${mb(end - base)} MB over baseline, ` +
    `${frame} frames in ${(wall / 1000).toFixed(1)} s (${(wall / frame).toFixed(3)} ms/frame)`,
)
