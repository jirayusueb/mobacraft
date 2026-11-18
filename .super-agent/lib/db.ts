// SQLite state store (bun:sqlite). Every process in the pipeline (dispatcher,
// router tool host, worker runners, watchdog, CLI) opens the same WAL database.
import { Database } from "bun:sqlite"
import { ensureParent, loadConfig, type MandateMode } from "./config.ts"

export type ThreadStatus =
  | "routing" // Router is triaging a batch that contains this thread
  | "triaged" // Router handled it without a worker (reply / ignore)
  | "queued" // mandate registered, worker process starting
  | "running" // worker dsh session is executing
  | "verifying" // worker (or runner) is running lint/typecheck/test gates
  | "idle" // worker run finished; session still subscribed to the thread
  | "stalled" // watchdog escalated
  | "needs_attention" // verification failed after the repair budget
  | "failed"
  | "closed"

export interface ThreadRow {
  thread_id: string
  worker_session_id: string | null
  status: ThreadStatus
  mandate_mode: MandateMode
  policy_version: string
  updated_at: number
  title: string | null
  mandate: string | null
  branch: string | null
  worktree: string | null
  base_commit: string | null
  runner_pid: number | null
  dsh_pid: number | null
  run_count: number
  last_progress_at: number | null
  last_event_summary: string | null
  supervisory_checks: number
  verify_status: string | null
  diff_summary: string | null
  last_error: string | null
  created_at: number
}

export interface EventRow {
  id: number
  event_id: string
  thread_id: string
  source: string
  type: string
  sender: string
  body: string
  payload: string
  stage1: string
  route: string
  batch_id: string | null
  received_at: number
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS threads (
  thread_id          TEXT PRIMARY KEY,
  worker_session_id  TEXT,
  status             TEXT NOT NULL,
  mandate_mode       TEXT NOT NULL DEFAULT 'OBSERVE' CHECK (mandate_mode IN ('OBSERVE','AUTO')),
  policy_version     TEXT NOT NULL,
  updated_at         INTEGER NOT NULL,
  title              TEXT,
  mandate            TEXT,
  branch             TEXT,
  worktree           TEXT,
  base_commit        TEXT,
  runner_pid         INTEGER,
  dsh_pid            INTEGER,
  run_count          INTEGER NOT NULL DEFAULT 0,
  last_progress_at   INTEGER,
  last_event_summary TEXT,
  supervisory_checks INTEGER NOT NULL DEFAULT 0,
  verify_status      TEXT,
  diff_summary       TEXT,
  last_error         TEXT,
  created_at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS threads_status ON threads(status);

CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id    TEXT NOT NULL UNIQUE,
  thread_id   TEXT NOT NULL,
  source      TEXT NOT NULL,
  type        TEXT NOT NULL,
  sender      TEXT NOT NULL,
  body        TEXT NOT NULL,
  payload     TEXT NOT NULL,
  stage1      TEXT NOT NULL,
  route       TEXT NOT NULL,
  batch_id    TEXT,
  received_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS events_thread ON events(thread_id);

CREATE TABLE IF NOT EXISTS pending_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id   TEXT NOT NULL,
  origin      TEXT NOT NULL,
  body        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  consumed_at INTEGER
);
CREATE INDEX IF NOT EXISTS pending_thread ON pending_messages(thread_id, consumed_at);

CREATE TABLE IF NOT EXISTS batches (
  batch_id          TEXT PRIMARY KEY,
  thread_ids        TEXT NOT NULL,
  event_count       INTEGER NOT NULL,
  status            TEXT NOT NULL,
  router_session_id TEXT,
  router_pid        INTEGER,
  router_log        TEXT,
  router_tool_calls TEXT,
  created_at        INTEGER NOT NULL,
  finished_at       INTEGER,
  error             TEXT
);

CREATE TABLE IF NOT EXISTS replies (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id  TEXT NOT NULL,
  author     TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  delivered  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id   TEXT NOT NULL,
  kind        TEXT NOT NULL,
  session_id  TEXT,
  pid         INTEGER,
  log_path    TEXT,
  started_at  INTEGER NOT NULL,
  finished_at INTEGER,
  exit_code   INTEGER,
  final_reason TEXT,
  final_text  TEXT
);
CREATE INDEX IF NOT EXISTS runs_thread ON runs(thread_id);

CREATE TABLE IF NOT EXISTS audit (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         INTEGER NOT NULL,
  actor      TEXT NOT NULL,
  thread_id  TEXT,
  action     TEXT NOT NULL,
  detail     TEXT
);
`

const handles = new Map<string, Database>()

export function openDb(path = loadConfig().dbPath): Database {
  const existing = handles.get(path)
  if (existing) return existing
  const db = new Database(ensureParent(path), { create: true, strict: true })
  db.exec("PRAGMA journal_mode = WAL;")
  db.exec("PRAGMA busy_timeout = 5000;")
  db.exec("PRAGMA foreign_keys = ON;")
  db.exec(SCHEMA)
  handles.set(path, db)
  return db
}

export const now = (): number => Date.now()

export function audit(
  actor: string,
  action: string,
  threadId: string | null,
  detail?: unknown,
): void {
  openDb()
    .query("INSERT INTO audit (at, actor, thread_id, action, detail) VALUES (?, ?, ?, ?, ?)")
    .run(now(), actor, threadId, action, detail === undefined ? null : JSON.stringify(detail))
}

export function getThread(threadId: string): ThreadRow | null {
  return openDb()
    .query<ThreadRow, [string]>("SELECT * FROM threads WHERE thread_id = ?")
    .get(threadId)
}

export function listThreads(status?: string): ThreadRow[] {
  const db = openDb()
  return status
    ? db
        .query<ThreadRow, [string]>(
          "SELECT * FROM threads WHERE status = ? ORDER BY updated_at DESC",
        )
        .all(status)
    : db.query<ThreadRow, []>("SELECT * FROM threads ORDER BY updated_at DESC").all()
}

/** Insert a thread if missing; returns the row. */
export function upsertThread(
  threadId: string,
  fields: Partial<ThreadRow> & { status: ThreadStatus },
): ThreadRow {
  const db = openDb()
  const { policyVersion } = loadConfig()
  const at = now()
  db.query(
    `INSERT INTO threads (thread_id, status, mandate_mode, policy_version, updated_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(thread_id) DO NOTHING`,
  ).run(
    threadId,
    fields.status,
    fields.mandate_mode ?? "OBSERVE",
    fields.policy_version ?? policyVersion,
    at,
    at,
  )
  updateThread(threadId, fields)
  return getThread(threadId)!
}

const THREAD_COLUMNS = new Set([
  "worker_session_id",
  "status",
  "mandate_mode",
  "policy_version",
  "title",
  "mandate",
  "branch",
  "worktree",
  "base_commit",
  "runner_pid",
  "dsh_pid",
  "run_count",
  "last_progress_at",
  "last_event_summary",
  "supervisory_checks",
  "verify_status",
  "diff_summary",
  "last_error",
])

export function updateThread(threadId: string, fields: Partial<ThreadRow>): void {
  const entries = Object.entries(fields).filter(
    ([key, value]) => THREAD_COLUMNS.has(key) && value !== undefined,
  )
  const sets = entries.map(([key]) => `${key} = ?`)
  sets.push("updated_at = ?")
  const values = entries.map(([, value]) => value as string | number | null)
  openDb()
    .query(`UPDATE threads SET ${sets.join(", ")} WHERE thread_id = ?`)
    .run(...values, now(), threadId)
}

/** Atomically move a thread between statuses; returns false if it was not in `from`. */
export function transition(
  threadId: string,
  from: ThreadStatus[],
  to: ThreadStatus,
  extra: Partial<ThreadRow> = {},
): boolean {
  const db = openDb()
  let ok = false
  db.transaction(() => {
    const row = getThread(threadId)
    if (!row || !from.includes(row.status)) return
    updateThread(threadId, { ...extra, status: to })
    ok = true
  })()
  return ok
}

export function insertEvent(event: Omit<EventRow, "id">): boolean {
  const result = openDb()
    .query(
      `INSERT OR IGNORE INTO events (event_id, thread_id, source, type, sender, body, payload, stage1, route, batch_id, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      event.event_id,
      event.thread_id,
      event.source,
      event.type,
      event.sender,
      event.body,
      event.payload,
      event.stage1,
      event.route,
      event.batch_id,
      event.received_at,
    )
  return result.changes > 0
}

export function eventsForThread(threadId: string): EventRow[] {
  return openDb()
    .query<EventRow, [string]>("SELECT * FROM events WHERE thread_id = ? ORDER BY id")
    .all(threadId)
}

export function eventsForBatch(batchId: string): EventRow[] {
  return openDb()
    .query<EventRow, [string]>("SELECT * FROM events WHERE batch_id = ? ORDER BY id")
    .all(batchId)
}

export function enqueueMessage(threadId: string, origin: string, body: string): void {
  openDb()
    .query("INSERT INTO pending_messages (thread_id, origin, body, created_at) VALUES (?, ?, ?, ?)")
    .run(threadId, origin, body, now())
}

/** Claim every unconsumed message for a thread (atomic). */
export function claimMessages(threadId: string): { origin: string; body: string }[] {
  const db = openDb()
  let rows: { id: number; origin: string; body: string }[] = []
  db.transaction(() => {
    rows = db
      .query<{ id: number; origin: string; body: string }, [string]>(
        "SELECT id, origin, body FROM pending_messages WHERE thread_id = ? AND consumed_at IS NULL ORDER BY id",
      )
      .all(threadId)
    const at = now()
    for (const row of rows)
      db.query("UPDATE pending_messages SET consumed_at = ? WHERE id = ?").run(at, row.id)
  })()
  return rows.map(({ origin, body }) => ({ origin, body }))
}

export function pendingCount(threadId: string): number {
  return (
    openDb()
      .query<{ n: number }, [string]>(
        "SELECT COUNT(*) AS n FROM pending_messages WHERE thread_id = ? AND consumed_at IS NULL",
      )
      .get(threadId)?.n ?? 0
  )
}

export function addReply(threadId: string, author: string, body: string): number {
  const result = openDb()
    .query("INSERT INTO replies (thread_id, author, body, created_at) VALUES (?, ?, ?, ?)")
    .run(threadId, author, body, now())
  return Number(result.lastInsertRowid)
}

export function startRun(threadId: string, kind: string, logPath: string): number {
  const result = openDb()
    .query("INSERT INTO runs (thread_id, kind, log_path, started_at) VALUES (?, ?, ?, ?)")
    .run(threadId, kind, logPath, now())
  return Number(result.lastInsertRowid)
}

export function updateRun(
  runId: number,
  fields: Partial<{
    session_id: string
    pid: number
    finished_at: number
    exit_code: number
    final_reason: string
    final_text: string
  }>,
): void {
  const entries = Object.entries(fields).filter(([, value]) => value !== undefined)
  if (entries.length === 0) return
  openDb()
    .query(`UPDATE runs SET ${entries.map(([key]) => `${key} = ?`).join(", ")} WHERE id = ?`)
    .run(...entries.map(([, value]) => value as string | number), runId)
}
