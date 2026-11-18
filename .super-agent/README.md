# Super Agent (Router / Worker) for dsh

A two-tier setup built on the installed DeepSeek Harness CLI (`dsh` 0.2.2-rc.3, headless profile). A fast **Router** triages events and starts work. Isolated **Workers** do the work, each in its own git worktree and `dsh` session. Shared state lives in SQLite (`super_agent.db`).

```
webhook / CI / chat ──POST /events──▶ dispatcher.ts ─(Stage 1: code filter)─┐
                                           │                                 │ rejected → stored, no LLM
                                           │ active worker on thread?        │
                                           ├── yes → pending_messages ──▶ worker-runner (dsh --session-id …)
                                           └── no  → 500 ms batch ──▶ router-runner (dsh headless, Router overlay)
                                                                         │ spawn_worker / reply_thread
                                                                         ▼
                                       tools/spawn_worker.ts → SQLite mandate + git worktree
                                                                         ▼
                                       lib/worker-runner.ts (detached) → dsh headless (Worker overlay)
                                         → orchestrator-run gates (fmt, lint, typecheck, test) → repair loop → diff summary
watchdog.ts ── checks SQLite progress, dsh session log mtime, worktree fingerprint ──▶ supervisory check / escalate
```

## How it maps onto the real `dsh`

The facts below came from `dsh --help`, `dsh headless --help`, `dsh headless --dump-config` and `~/.dsh/`. They are recorded in [dsh.json](dsh.json) and checked again by `cli.ts doctor`.

| Need                      | Real mechanism                                                                                                                                                                            |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Binary                    | `…/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh`, which is not on `PATH`. Override it with `SUPER_AGENT_DSH_BIN`.                                                          |
| One-shot agent run        | `dsh headless … --json -`: the task goes in on stdin and NDJSON events (`session`, `tool_call`, `tool_result`, `final`) come out on stdout.                                               |
| Per-role config           | `--patch <overlay.yml>`: Loader patch rows, rendered into `generated/` from `router.json` and `worker.json`.                                                                              |
| Model                     | The `agent-default-model` row. Router uses `claude/claude-haiku-5-5`, Worker uses `claude/claude-opus-5-5`.                                                                               |
| Claude routes in headless | The headless profile turns off the GUI credential store, so the overlay inserts the installed `dsh-plugin-subscriptions` plugin, which reads its own OAuth token file.                    |
| Persona prompt            | The `system-prompt` row, `personaPrefix` field. Its source is `prompts/*.md`.                                                                                                             |
| Custom tools              | `plugins/router-tools.mjs` is a Cordis Host plugin. It calls `ctx.tools.register` to add `spawn_worker`, `reply_thread` and `list_threads`. Each one runs a fixed Bun script in `tools/`. |
| Resume a worker           | `--session-id <id>`. Sessions persist under `~/.dsh/sessions/<cwd-key>/<id>/`.                                                                                                            |
| Sandbox                   | `--permission-mode read-only` for the Router. `--permission-mode workspace-write --add-dir <git-common-dir> --add-dir ~/.bun/install/cache` for Workers.                                  |
| MCP                       | Not needed: the dispatch tools are native. If you want them, `@deepseek-ai/dsh-mcp-client` rows (`serverName`, `transport`, …) can be added to the same overlays.                         |

### How the Router is kept away from the shell (three layers)

1. **Rows removed.** The overlay disables `tool-bash`, `tool-pwsh`, `tool-jobs`, `tool-subagent*`, `tool-workflow`, `tool-web`, `tool-goal` and `tool-working-directory`. `tool-fs` is configured with `write: false, edit: false, applyPatch: false`.
2. **Catalog mask.** On `agent/created`, `agent.ctx.tools.restrict({ allow })` hides every tool not on the allowlist. A live probe listed exactly `spawn_worker, reply_thread, list_threads, read, grep, glob`.
3. **Final deny.** `ctx.tools.guard()` rejects `bash`, `execute`, `write_file`, `edit_file`, etc. No later listener can override this. The Router also runs under the `read-only` sandbox.

### Worker guardrails

- `plugins/worker-guard.mjs` adds a `ctx.tools.guard()` over bash and file tools. Rules live in `plugins/policy.mjs`.
  - **Always denied:** `rm -rf` (any flag order, including inside `bash -c "…"`), `git push --force` / `-f` / `+ref` / `--force-with-lease`, pushes to main, master, release or production, `reset --hard`, `clean -f`, `branch -D`, history rewrites, `sudo`, `curl | sh` and publish.
  - **Protected paths:** orchestrator policy, prompts, the state DB, hooks and CI workflows.
- **`[MANDATE MODE: OBSERVE]`** is the default and is always used for CI or bot triggers. On top of the rules above, it blocks `git push`, `merge`, `pull`, `gh pr create` and deploys. The Worker creates a branch, implements, verifies, commits locally and reports a diff summary.
- **`[MANDATE MODE: AUTO]`** is granted only when two things hold:
  - the _dispatcher_ gives the thread an AUTO ceiling, which happens only for senders in `autoModeSenders`, and
  - the Router requests AUTO.

  Anything else falls back to OBSERVE. The mode reaches the guard through `SUPER_AGENT_MANDATE_MODE`, which the runner sets from SQLite.

- **Verification loop.** The Worker prompt requires the gates, and the runner also re-runs them itself: `bunx oxfmt --check`, `bunx oxlint --deny-warnings`, `bun run typecheck`, `bun run test`. If they fail, the failure output goes back to the same session, for up to 2 repair rounds; after that the thread becomes `needs_attention`.

## Files

| Path                               | Role                                                                                                                          |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `router.json`, `prompts/router.md` | Router model, tool allow/deny lists, disabled rows, dispatcher settings (allowlist, mention handles, CI types, 500 ms window) |
| `worker.json`, `prompts/worker.md` | Worker model, sandbox, protected paths, verify gates, watchdog thresholds                                                     |
| `dsh.json`                         | Facts discovered from the local `dsh` install                                                                                 |
| `plugins/`                         | dsh Host plugins: Router tools and guard, Worker guard, shared policy                                                         |
| `dispatcher.ts`                    | HTTP intake, Stage 1 filter, pass-through, debounced batching; launches everything detached                                   |
| `tools/spawn_worker.ts`            | Records the mandate in SQLite, creates the worktree and branch, starts the detached runner                                    |
| `lib/worker-runner.ts`             | Per-thread supervisor: dsh run or resume, gates, repair loop, diff summary                                                    |
| `lib/router-runner.ts`             | One Router `dsh` run per batch, with untrusted payloads fenced and escaped                                                    |
| `watchdog.ts`                      | Stall detection based on progress, not just whether the process is alive                                                      |
| `cli.ts`                           | `doctor`, `render`, `simulate-event`, `status`, `watchdog`, `serve`, `smoke`, `cleanup`                                       |

SQLite tables:

- `threads`, with `thread_id`, `worker_session_id`, `status`, `mandate_mode`, `policy_version` and `updated_at`, plus branch, worktree and progress fields
- `events`, `pending_messages`, `batches`, `runs`, `replies` (the outbox) and `audit`

`policy_version` is a content hash of every config, prompt and plugin file, so each thread records which policy it ran under.

## Usage

```sh
bun .super-agent/cli.ts doctor                       # verify binary, flags, overlays, models
bun .super-agent/cli.ts simulate-event --thread demo-1 --mention --body "Add a test for X" --wait
bun .super-agent/cli.ts status [--thread demo-1]
bun .super-agent/cli.ts watchdog [--loop] [--dry-run]
bun .super-agent/cli.ts serve --port 8787            # POST JSON events to /events
bun .super-agent/cli.ts smoke                        # end-to-end OBSERVE dry run (real dsh)
bun test ./.super-agent/tests/pipeline.test.ts       # policy, filter, batching, pass-through
```

Event shape: `{ "event_id"?, "source"?, "type", "sender", "thread_id", "body"?, "mentions"?, "payload"? }`.

Environment overrides:

- `SUPER_AGENT_STATE_DIR` / `SUPER_AGENT_DB`: separate state, e.g. for tests
- `SUPER_AGENT_ROUTER_MODEL` / `SUPER_AGENT_WORKER_MODEL`: `provider/model`
- `SUPER_AGENT_DRY_RUN=1`: the Worker only plans and the gates are skipped
- `SUPER_AGENT_SKIP_GATES=1`
- `SUPER_AGENT_WORKTREE_ROOT`

Worktrees default to `~/.super-agent/worktrees/mobacraft/<thread>` on branch `super-agent/<thread>`. They are removed with `cli.ts cleanup --thread <id>`, never by the Worker.

## Watchdog semantics

For each `queued`, `running` or `verifying` thread, the watchdog compares three signals:

- SQLite `last_progress_at`, updated on every dsh event and gate
- the mtime of the dsh session log
- a worktree fingerprint (HEAD, porcelain status and diffstat)

| Condition                                      | Action                                                                                                                                                                                             |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runner process dead                            | Relaunch. The runner resumes the same session with `--session-id`.                                                                                                                                 |
| No progress on any signal for more than 20 min | **Supervisory check**: SIGINT the stuck `dsh` turn (the session is persisted), then queue a trusted orchestrator message to the _same_ session asking for a status report and a bounded next step. |
| Still no progress after 2 checks               | Mark the thread `stalled` and post a reply asking for a human.                                                                                                                                     |

## Limits

- Replies go into the `replies` outbox table. No adapter for GitHub or chat delivery is wired up yet.
- The Claude routes depend on the Subscriptions plugin's login, which you do in the Desktop app. If you sign out, set `SUPER_AGENT_*_MODEL` to another configured route.
- `workspace-write` is a file sandbox. Network access stays available so that installs work.
