// Ensures exactly one detached worker-runner per thread.
import { join } from "node:path"
import { ensureDir, loadConfig, SUPER_AGENT_DIR } from "./config.ts"
import { audit, getThread, openDb, updateThread } from "./db.ts"
import { pidAlive, spawnDetached } from "./dsh.ts"

/** Start the thread's runner unless a live one already owns it. Returns the runner pid or null if already running. */
export function ensureRunner(threadId: string): number | null {
  const db = openDb()
  let claimed = false
  db.transaction(() => {
    const thread = getThread(threadId)
    if (!thread) throw new Error(`unknown thread ${threadId}`)
    if (runnerState(threadId) !== "dead") return
    // Placeholder pid -1 marks "launching" so concurrent callers do not double-spawn.
    updateThread(threadId, { runner_pid: -1 })
    claimed = true
  })()
  if (!claimed) return null
  const cfg = loadConfig()
  const logPath = join(
    ensureDir(join(cfg.logsDir, "runners")),
    `${threadId.replace(/[^\w.-]+/g, "_")}.log`,
  )
  const pid = spawnDetached(join(SUPER_AGENT_DIR, "lib/worker-runner.ts"), [threadId], logPath)
  updateThread(threadId, { runner_pid: pid })
  audit("launcher", "runner.spawn", threadId, { pid, logPath })
  return pid
}

/** pidAlive treats -1 (launching) as dead; give a launching claim a grace period. */
export function runnerState(threadId: string): "alive" | "launching" | "dead" {
  const thread = getThread(threadId)
  if (!thread) return "dead"
  if (thread.runner_pid === -1)
    return Date.now() - thread.updated_at < 10_000 ? "launching" : "dead"
  return pidAlive(thread.runner_pid) ? "alive" : "dead"
}
