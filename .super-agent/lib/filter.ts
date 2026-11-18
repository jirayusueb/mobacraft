// Stage 1: deterministic, code-only event filter. Runs before any LLM is invoked.
import type { DispatcherConfig, MandateMode } from "./config.ts"

export interface IncomingEvent {
  event_id?: string
  source?: string // github | ci | chat | cli ...
  type: string // issue_comment | ci.failure | message ...
  sender: string
  thread_id: string
  body?: string
  mentions?: string[]
  payload?: unknown // raw webhook payload, stored but never trusted
}

export interface NormalizedEvent {
  event_id: string
  source: string
  type: string
  sender: string
  thread_id: string
  body: string
  payload: string
  received_at: number
}

export type Stage1Verdict =
  | {
      pass: true
      reason: "ci_event" | "direct_mention" | "active_thread_followup"
      ceiling: MandateMode
    }
  | { pass: false; reason: string }

const MAX_BODY = 8000

export function normalize(event: IncomingEvent, receivedAt = Date.now()): NormalizedEvent {
  if (!event || typeof event !== "object") throw new Error("event must be an object")
  for (const field of ["type", "sender", "thread_id"] as const) {
    if (typeof event[field] !== "string" || !event[field].trim())
      throw new Error(`event.${field} is required`)
  }
  const body = typeof event.body === "string" ? event.body.slice(0, MAX_BODY) : ""
  const thread_id = event.thread_id.trim().slice(0, 200)
  const event_id =
    typeof event.event_id === "string" && event.event_id
      ? event.event_id.slice(0, 200)
      : `evt-${Bun.hash(`${thread_id}|${event.sender}|${event.type}|${body}|${receivedAt}`).toString(16)}`
  return {
    event_id,
    source: (event.source ?? "unknown").slice(0, 50),
    type: event.type.trim(),
    sender: event.sender.trim(),
    thread_id,
    body,
    payload: JSON.stringify(event.payload ?? null).slice(0, 64_000),
    received_at: receivedAt,
  }
}

function mentioned(
  event: NormalizedEvent,
  mentions: string[] | undefined,
  handles: string[],
): boolean {
  const lowered = handles.map((h) => h.toLowerCase())
  if (
    mentions?.some(
      (m) => lowered.includes(m.toLowerCase()) || lowered.includes(`@${m.toLowerCase()}`),
    )
  )
    return true
  const body = event.body.toLowerCase()
  return lowered.some((handle) =>
    new RegExp(`(^|\\s)${handle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(body),
  )
}

/**
 * Pass rules (any one):
 *  - CI event type from the CI allowlist (no human sender needed),
 *  - allowlisted sender that directly mentions the agent handle,
 *  - allowlisted sender posting on a thread that already has an active worker.
 * The mandate-mode ceiling is AUTO only for senders in autoModeSenders; everything
 * proactive (CI, bots) is capped at OBSERVE.
 */
export function stage1(
  event: NormalizedEvent,
  mentions: string[] | undefined,
  cfg: DispatcherConfig,
  threadHasActiveWorker: boolean,
): Stage1Verdict {
  if (cfg.ciEventTypes.includes(event.type))
    return { pass: true, reason: "ci_event", ceiling: "OBSERVE" }
  if (!cfg.allowlistedSenders.includes(event.sender))
    return { pass: false, reason: `sender ${event.sender} not allowlisted` }
  const ceiling: MandateMode = cfg.autoModeSenders.includes(event.sender) ? "AUTO" : "OBSERVE"
  if (mentioned(event, mentions, cfg.mentionHandles))
    return { pass: true, reason: "direct_mention", ceiling }
  if (threadHasActiveWorker) return { pass: true, reason: "active_thread_followup", ceiling }
  return { pass: false, reason: "no direct mention and no active worker on thread" }
}
