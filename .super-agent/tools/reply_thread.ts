// reply_thread: store a concise user-facing reply (outbox table `replies`).
// A delivery adapter (GitHub comment, chat webhook) can drain undelivered rows.
import { addReply, audit, openDb } from "../lib/db.ts"
import { loadConfig } from "../lib/config.ts"
import { main, readArgs, requireString } from "./_args.ts"

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

export function replyThread(args: { thread_id: string; body: string }): Record<string, unknown> {
  const threadId = requireString(args.thread_id, "thread_id", 200)
  const body = requireString(args.body, "body", 2000)
  const limit = loadConfig().router.replyMaxWords
  const words = wordCount(body)
  if (words >= limit)
    throw new Error(`reply has ${words} words; replies must be under ${limit} words`)
  openDb()
  const id = addReply(threadId, "router", body)
  audit("reply_thread", "reply.queued", threadId, { id, words })
  return { thread_id: threadId, reply_id: id, words }
}

if (import.meta.main) await main(() => replyThread(readArgs<{ thread_id: string; body: string }>()))
