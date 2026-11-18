// dsh Host plugin mounted ONLY in the Worker overlay (generated/worker.patch.yml).
// Adds a monotonic ctx.tools.guard() over bash / file tools:
//   * always: rm -rf, git push --force, reset --hard, clean -f, history rewrites, sudo, publish ...
//   * [MANDATE MODE: OBSERVE]: additionally no push / merge / pull / PR creation / deploy.
//   * file tools may not touch orchestrator policy, prompts, state DB, hooks, CI workflows.
// The mandate mode comes from SUPER_AGENT_MANDATE_MODE, set by lib/worker-runner.ts from SQLite.
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { evaluateWorkerCall } from "./policy.mjs"

export const name = "super-agent-worker-guard"
export const inject = ["tools"]

const HERE = dirname(fileURLToPath(import.meta.url))
const workerConfig = JSON.parse(readFileSync(join(HERE, "..", "worker.json"), "utf8"))

function mandateMode() {
  // Fail closed: anything other than an explicit AUTO is OBSERVE.
  return process.env.SUPER_AGENT_MANDATE_MODE === "AUTO" ? "AUTO" : "OBSERVE"
}

export function apply(ctx) {
  ctx.tools.guard((execution) =>
    evaluateWorkerCall(execution.name, execution.arguments, mandateMode(), {
      protectedPaths: workerConfig.protectedPaths,
    }),
  )
}
