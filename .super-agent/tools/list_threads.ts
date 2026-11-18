// list_threads: read-only view of thread state for the Router.
import { listThreads } from "../lib/db.ts"
import { main, readArgs } from "./_args.ts"

if (import.meta.main) {
  await main(() => {
    const { status } = readArgs<{ status?: string }>()
    const threads = listThreads(status).map((t) => ({
      thread_id: t.thread_id,
      status: t.status,
      mandate_mode: t.mandate_mode,
      worker_session_id: t.worker_session_id,
      title: t.title,
      updated_at: new Date(t.updated_at).toISOString(),
    }))
    return { threads: threads.slice(0, 50), total: threads.length }
  })
}
