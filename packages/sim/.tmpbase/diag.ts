import { generateMap } from "@mobacraft/map"
const which = process.argv[2]!
const mod = await import(which === "base" ? "./src/index.ts" : "../src/index.ts")
const map = generateMap()
const autoDraft = () => {
  let d = mod.createDraft(mod.TEAMS[0], mod.TEAMS[1])
  while (!mod.isComplete(d)) d = mod.applyDraft(d, mod.aiChoose(d)).state
  return d
}
for (const seed of [7, 11]) {
  const t0 = performance.now()
  const s = mod.createMatch(map, autoDraft(), { seed, aiCoach: ["blue", "red"] }).runToEnd()
  console.log(which, seed, "time", (s.time / 60).toFixed(1), "winner", s.winner, "kills", JSON.stringify(s.kills), "towers", JSON.stringify(s.towers), "ms", Math.round(performance.now() - t0))
}
