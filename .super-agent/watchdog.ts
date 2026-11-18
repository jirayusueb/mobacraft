// External watchdog. Detects workers that are *stalled*, not merely dead:
//
//   progress signals checked per active thread (status queued/running/verifying):
//     a. SQLite last_progress_at (updated on every dsh NDJSON event and gate)
//     b. dsh Session log mtime under ~/.dsh/sessions/<cwd>/<session>/ (any model/tool event)
//     c. worktree file-state fingerprint (HEAD + porcelain status + diffstat)
//   liveness: runner pid and dsh pid.
//
// If none of (a)(b)(c) advanced for > stallMinutes (20), the watchdog does NOT just kill or
// restart. It records a supervisory check: it stops the stuck dsh turn (SIGINT to the dsh
// process, which persists the session), then queues an orchestrator message for the SAME
// worker session asking for a status report and a decision (continue / blocked). After
// maxSupervisoryChecks without progress it marks the thread `stalled` and posts a reply for a human.
// Dead runners with queued work are relaunched (that is liveness, handled separately).
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { ensureDir, loadConfig } from "./lib/config.ts"
import {
  addReply,
  audit,
  enqueueMessage,
  listThreads,
  now,
  pendingCount,
  updateThread,
  type ThreadRow,
} from "./lib/db.ts"
import { pidAlive, sessionActivity } from "./lib/dsh.ts"
import { worktreeFingerprint } from "./lib/git.ts"
import { ensureRunner, runnerState } from "./lib/launch.ts"

export interface WatchdogFinding {
  thread_id: string
  status: string
  idle_minutes: number
  runner: string
  dsh_alive: boolean
  session_log_age_minutes: number | null
  fingerprint_changed: boolean
  action: "ok" | "relaunched" | "supervisory_check" | "escalated_stalled" | "skipped"
  detail?: string
}

const FINGERPRINT_FILE = () => join(ensureDir(loadConfig().stateDir), "watchdog-fingerprints.json")

function loadFingerprints(): Record<string, { fp: string; at: number }> {
  const file = FINGERPRINT_FILE()
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {}
}

export function supervisoryMessage(thread: ThreadRow, idleMinutes: number): string {
  return [
    `[MANDATE MODE: ${thread.mandate_mode}]`,
    `SUPERVISORY CHECK from the orchestrator watchdog (origin: orchestrator, trusted).`,
    `No session, state, or file progress has been observed for ${idleMinutes} minutes on thread ${thread.thread_id}.`,
    `Your previous turn was interrupted. Do not repeat a command that hangs (watch for interactive prompts, servers that never exit, or waits on input; use run_in_background with job_output for long processes).`,
    `1. In at most 3 tool calls, state what you were doing and why it stalled.`,
    `2. Then either continue with a concrete, bounded next step, or finish with STATUS: blocked and the reason.`,
  ].join("\n")
}

export function checkOnce(
  options: { stallMinutes?: number; dryRun?: boolean } = {},
): WatchdogFinding[] {
  const cfg = loadConfig()
  const stallMs = (options.stallMinutes ?? cfg.worker.watchdog.stallMinutes) * 60_000
  const fingerprints = loadFingerprints()
  const findings: WatchdogFinding[] = []
  const at = now()

  for (const thread of listThreads()) {
    if (!["queued", "running", "verifying", "idle"].includes(thread.status)) continue
    const runner = runnerState(thread.thread_id)

    // Liveness: idle thread with queued follow-ups and no runner -> relaunch.
    if (thread.status === "idle") {
      if (runner === "dead" && pendingCount(thread.thread_id) > 0 && !options.dryRun)
        ensureRunner(thread.thread_id)
      continue
    }

    // Progress signals.
    const session = thread.worker_session_id
      ? sessionActivity(thread.worker_session_id)
      : { dir: null, lastWrite: null, locked: false }
    const fp = thread.worktree ? worktreeFingerprint(thread.worktree) : "none"
    const previous = fingerprints[thread.thread_id]
    const fingerprintChanged = !previous || previous.fp !== fp
    if (fingerprintChanged) fingerprints[thread.thread_id] = { fp, at }
    const lastProgress = Math.max(
      thread.last_progress_at ?? 0,
      session.lastWrite ?? 0,
      fingerprints[thread.thread_id].at,
      thread.updated_at,
    )
    const idleMs = at - lastProgress
    const finding: WatchdogFinding = {
      thread_id: thread.thread_id,
      status: thread.status,
      idle_minutes: Math.round(idleMs / 60_000),
      runner,
      dsh_alive: pidAlive(thread.dsh_pid),
      session_log_age_minutes: session.lastWrite
        ? Math.round((at - session.lastWrite) / 60_000)
        : null,
      fingerprint_changed: fingerprintChanged,
      action: "ok",
    }

    if (runner === "dead") {
      // Runner crashed mid-run. Relaunch; the runner resumes the same dsh session via --session-id.
      if (!options.dryRun) {
        enqueueMessage(
          thread.thread_id,
          "orchestrator",
          "The orchestrator restarted your supervisor process. Re-check the worktree state and continue the mandate.",
        )
        ensureRunner(thread.thread_id)
      }
      finding.action = "relaunched"
    } else if (idleMs > stallMs) {
      if (thread.supervisory_checks >= cfg.worker.watchdog.maxSupervisoryChecks) {
        finding.action = "escalated_stalled"
        if (!options.dryRun) {
          if (pidAlive(thread.dsh_pid)) process.kill(thread.dsh_pid!, "SIGTERM")
          updateThread(thread.thread_id, {
            status: "stalled",
            last_error: `no progress after ${thread.supervisory_checks} supervisory checks`,
          })
          addReply(
            thread.thread_id,
            "watchdog",
            `Worker stalled ${finding.idle_minutes} min after ${thread.supervisory_checks} supervisory checks. Needs a human.`,
          )
        }
      } else {
        finding.action = "supervisory_check"
        if (!options.dryRun) {
          enqueueMessage(
            thread.thread_id,
            "orchestrator",
            supervisoryMessage(thread, finding.idle_minutes),
          )
          updateThread(thread.thread_id, {
            supervisory_checks: thread.supervisory_checks + 1,
            last_progress_at: at,
          })
          // Interrupt the hung turn; dsh persists the session and the runner's loop picks up the queued check.
          if (pidAlive(thread.dsh_pid)) process.kill(thread.dsh_pid!, "SIGINT")
        }
      }
    }
    if (finding.action !== "ok") audit("watchdog", finding.action, thread.thread_id, finding)
    findings.push(finding)
  }
  if (!options.dryRun) writeFileSync(FINGERPRINT_FILE(), JSON.stringify(fingerprints, null, 2))
  return findings
}

if (import.meta.main) {
  const loop = process.argv.includes("--loop")
  const dryRun = process.argv.includes("--dry-run")
  const run = () =>
    console.log(
      JSON.stringify({ at: new Date().toISOString(), findings: checkOnce({ dryRun }) }, null, 2),
    )
  run()
  if (loop) setInterval(run, loadConfig().worker.watchdog.intervalSeconds * 1000)
}
