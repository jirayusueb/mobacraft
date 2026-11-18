// Event dispatcher (Bun + SQLite).
//
//   POST /events  (JSON event or array)  ->  202 immediately; never blocks on an LLM.
//
// Per event:
//   1. normalize + persist to `events` (idempotent on event_id)
//   2. Stage 1 deterministic filter (CI allowlist / allowlisted sender + direct mention /
//      follow-up on an active thread). Rejected events never reach a model.
//   3. Pass-through: if an active worker already subscribes to thread_id, queue the event
//      for that worker session (`dsh headless --session-id ...`) WITHOUT waking the Router.
//   4. Otherwise add to the group batch; after `batchWindowMs` (500 ms) of debounce, or at
//      `maxBatchSize`, one detached Router process triages the whole batch.
// All dsh invocations are detached child processes; the HTTP handler only does SQLite writes.
import { join } from "node:path"
import { ensureDir, loadConfig, SUPER_AGENT_DIR } from "./lib/config.ts"
import {
  audit,
  enqueueMessage,
  getThread,
  insertEvent,
  now,
  openDb,
  upsertThread,
  updateThread,
} from "./lib/db.ts"
import { normalize, stage1, type IncomingEvent, type NormalizedEvent } from "./lib/filter.ts"
import { ensureRunner } from "./lib/launch.ts"
import { spawnDetached } from "./lib/dsh.ts"

export type Route = "rejected" | "duplicate" | "pass_through" | "batched"

export interface DispatchOutcome {
  event_id: string
  thread_id: string
  route: Route
  reason: string
  batch_id?: string
}

export interface DispatcherOptions {
  /** Called instead of spawning a detached Router (tests). */
  launchRouter?: (batchId: string) => void
  /** Called instead of spawning a detached worker runner (tests). */
  launchWorker?: (threadId: string) => void
}

export class Dispatcher {
  private pending: NormalizedEvent[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly cfg = loadConfig()

  constructor(private readonly options: DispatcherOptions = {}) {
    openDb()
  }

  private activeWorker(threadId: string): boolean {
    const thread = getThread(threadId)
    return (
      !!thread &&
      this.cfg.router.dispatcher.activeStatuses.includes(thread.status) &&
      !!thread.mandate
    )
  }

  /** Synchronous apart from SQLite; safe to call from a request handler. */
  ingest(raw: IncomingEvent): DispatchOutcome {
    const event = normalize(raw)
    const active = this.activeWorker(event.thread_id)
    const verdict = stage1(event, raw.mentions, this.cfg.router.dispatcher, active)
    const route: Route = !verdict.pass ? "rejected" : active ? "pass_through" : "batched"
    const inserted = insertEvent({ ...event, stage1: verdict.reason, route, batch_id: null })
    if (!inserted)
      return {
        event_id: event.event_id,
        thread_id: event.thread_id,
        route: "duplicate",
        reason: "event_id already seen",
      }
    if (!verdict.pass) {
      audit("dispatcher", "stage1.reject", event.thread_id, {
        event_id: event.event_id,
        reason: verdict.reason,
      })
      return { event_id: event.event_id, thread_id: event.thread_id, route, reason: verdict.reason }
    }

    if (route === "pass_through") {
      const thread = getThread(event.thread_id)!
      enqueueMessage(
        event.thread_id,
        `${event.source}:${event.type} from ${event.sender}`,
        `<untrusted_payload event_id="${event.event_id}">\n${event.body}\n</untrusted_payload>`,
      )
      updateThread(event.thread_id, { last_event_summary: `queued follow-up ${event.event_id}` })
      audit("dispatcher", "pass_through", event.thread_id, {
        event_id: event.event_id,
        session: thread.worker_session_id,
      })
      if (this.options.launchWorker) this.options.launchWorker(event.thread_id)
      else ensureRunner(event.thread_id)
      return {
        event_id: event.event_id,
        thread_id: event.thread_id,
        route,
        reason: `active worker ${thread.worker_session_id ?? "(starting)"}`,
      }
    }

    // New or inactive thread: record the trusted ceiling, then batch for the Router.
    const existing = getThread(event.thread_id)
    const ceiling = verdict.ceiling
    const merged =
      existing?.status === "routing" && existing.mandate_mode === "OBSERVE" ? "OBSERVE" : ceiling
    upsertThread(event.thread_id, {
      status: "routing",
      mandate_mode: merged,
      title: existing?.title ?? null,
    })
    this.pending.push(event)
    if (this.pending.length >= this.cfg.router.dispatcher.maxBatchSize) this.flush()
    else {
      if (this.timer) clearTimeout(this.timer)
      this.timer = setTimeout(() => this.flush(), this.cfg.router.dispatcher.batchWindowMs)
    }
    return { event_id: event.event_id, thread_id: event.thread_id, route, reason: verdict.reason }
  }

  /** Close the current batch and hand it to a detached Router. Returns the batch id. */
  flush(): string | null {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.pending.length === 0) return null
    const events = this.pending
    this.pending = []
    const batchId = `batch-${now()}-${Math.random().toString(36).slice(2, 8)}`
    const db = openDb()
    const threadIds = [...new Set(events.map((e) => e.thread_id))]
    db.transaction(() => {
      db.query(
        "INSERT INTO batches (batch_id, thread_ids, event_count, status, created_at) VALUES (?, ?, ?, 'pending', ?)",
      ).run(batchId, JSON.stringify(threadIds), events.length, now())
      for (const event of events)
        db.query("UPDATE events SET batch_id = ? WHERE event_id = ?").run(batchId, event.event_id)
    })()
    audit("dispatcher", "batch.flush", null, { batchId, events: events.length, threads: threadIds })
    if (this.options.launchRouter) this.options.launchRouter(batchId)
    else launchRouterDetached(batchId)
    return batchId
  }

  pendingSize(): number {
    return this.pending.length
  }
}

export function launchRouterDetached(batchId: string): number {
  const cfg = loadConfig()
  const log = join(ensureDir(join(cfg.logsDir, "router")), `${batchId}.runner.log`)
  const pid = spawnDetached(join(SUPER_AGENT_DIR, "lib/router-runner.ts"), [batchId], log)
  openDb().query("UPDATE batches SET router_pid = ? WHERE batch_id = ?").run(pid, batchId)
  return pid
}

export function serve(port = loadConfig().router.dispatcher.port) {
  const dispatcher = new Dispatcher()
  const server = Bun.serve({
    port,
    hostname: "127.0.0.1",
    async fetch(request) {
      const url = new URL(request.url)
      if (request.method === "GET" && url.pathname === "/health")
        return Response.json({ ok: true, pending: dispatcher.pendingSize() })
      if (request.method !== "POST" || url.pathname !== "/events")
        return new Response("not found", { status: 404 })
      let body: unknown
      try {
        body = await request.json()
      } catch {
        return Response.json({ error: "invalid JSON" }, { status: 400 })
      }
      const events = Array.isArray(body) ? body : [body]
      const outcomes: (DispatchOutcome | { error: string })[] = []
      for (const event of events) {
        try {
          outcomes.push(dispatcher.ingest(event as IncomingEvent))
        } catch (error) {
          outcomes.push({ error: (error as Error).message })
        }
      }
      return Response.json({ accepted: outcomes }, { status: 202 })
    },
  })
  console.log(`super-agent dispatcher listening on http://127.0.0.1:${server.port}/events`)
  return { server, dispatcher }
}

if (import.meta.main) {
  const portArg = process.argv.indexOf("--port")
  serve(portArg >= 0 ? Number(process.argv[portArg + 1]) : undefined)
}
