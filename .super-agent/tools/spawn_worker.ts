// spawn_worker: registers a mandate in SQLite and launches a detached dsh Worker.
//
// Invoked (a) by the Router through plugins/router-tools.mjs, or (b) by hand:
//   bun .super-agent/tools/spawn_worker.ts --args-json '{"thread_id":"t1","title":"...","mandate":"..."}'
//
// Mode resolution (fail closed): requested AUTO is honoured only if the thread's
// trusted ceiling (set by the dispatcher from sender allowlists, never by payload
// text) is AUTO. Everything else is OBSERVE.
//
// The resulting worker process tree is:
//   bun lib/worker-runner.ts <thread>   (detached, own process group)
//     └─ dsh headless --patch generated/worker.patch.yml --permission-mode workspace-write
//          --approval-policy never --add-dir <git-common-dir> --add-dir ~/.bun/install/cache
//          [--session-id <id>] --json -        (cwd = thread worktree, task on stdin)
import { loadConfig, type MandateMode } from "../lib/config.ts"
import { addReply, audit, enqueueMessage, getThread, openDb, upsertThread } from "../lib/db.ts"
import { ensureWorktree } from "../lib/git.ts"
import { ensureRunner } from "../lib/launch.ts"
import { main, readArgs, requireString } from "./_args.ts"

export interface SpawnArgs {
  thread_id: string
  title: string
  mandate: string
  mandate_mode?: MandateMode
  event_ids?: string[]
}

/** Trusted ceiling is stored on the thread by the dispatcher before routing (column mandate_mode). */
export function resolveMode(
  requested: MandateMode | undefined,
  ceiling: MandateMode | undefined,
): MandateMode {
  return requested === "AUTO" && ceiling === "AUTO" ? "AUTO" : "OBSERVE"
}

export async function spawnWorker(args: SpawnArgs): Promise<Record<string, unknown>> {
  const cfg = loadConfig()
  const threadId = requireString(args.thread_id, "thread_id", 200)
  const title = requireString(args.title, "title", 200).slice(0, 80)
  const mandate = requireString(args.mandate, "mandate")
  openDb()

  const existing = getThread(threadId)
  if (
    existing &&
    ["queued", "running", "verifying", "idle"].includes(existing.status) &&
    existing.mandate
  ) {
    // One worker per thread: fold the new mandate into the existing session instead.
    enqueueMessage(threadId, "router", `Additional mandate from the Router: ${title}\n${mandate}`)
    const pid = ensureRunner(threadId)
    audit("spawn_worker", "mandate.appended", threadId, { pid })
    return {
      thread_id: threadId,
      action: "appended_to_existing_worker",
      worker_session_id: existing.worker_session_id,
      status: existing.status,
    }
  }

  const ceiling = (existing?.mandate_mode ?? "OBSERVE") as MandateMode
  const mode = resolveMode(args.mandate_mode, ceiling)
  const { worktree, branch, baseCommit } = ensureWorktree(threadId)
  upsertThread(threadId, {
    status: "queued",
    mandate_mode: mode,
    policy_version: cfg.policyVersion,
    title,
    mandate,
    branch,
    worktree,
    base_commit: baseCommit,
    worker_session_id: null,
    supervisory_checks: 0,
    last_error: null,
    last_progress_at: Date.now(),
  })
  audit("spawn_worker", "mandate.registered", threadId, {
    title,
    requested: args.mandate_mode ?? null,
    ceiling,
    mode,
    events: args.event_ids ?? [],
    policyVersion: cfg.policyVersion,
  })
  const pid = ensureRunner(threadId)
  addReply(threadId, "router", `Worker dispatched [${mode}] on branch ${branch}.`)
  return {
    thread_id: threadId,
    action: "spawned",
    mandate_mode: mode,
    branch,
    worktree,
    base_commit: baseCommit,
    runner_pid: pid,
    policy_version: cfg.policyVersion,
    note: "worker_session_id is recorded in SQLite once the dsh session event arrives",
  }
}

if (import.meta.main) await main(() => spawnWorker(readArgs<SpawnArgs>()))
