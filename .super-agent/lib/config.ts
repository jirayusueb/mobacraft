// Loads router.json / worker.json / dsh.json and renders the dsh `--patch`
// overlays that turn the stock `headless` profile into the Router and Worker.
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"

export type MandateMode = "OBSERVE" | "AUTO"

export const SUPER_AGENT_DIR = resolve(import.meta.dir, "..")
export const REPO_ROOT = resolve(SUPER_AGENT_DIR, "..")

export interface ModelRoute {
  provider: string
  model: string
  reasoningEffort?: string
}

export interface DispatcherConfig {
  port: number
  batchWindowMs: number
  maxBatchSize: number
  allowlistedSenders: string[]
  mentionHandles: string[]
  ciEventTypes: string[]
  autoModeSenders: string[]
  activeStatuses: string[]
}

export interface RouterConfig {
  role: "router"
  model: ModelRoute
  promptFile: string
  permissionMode: string
  approvalPolicy: "ask" | "never"
  tools: { allow: string[]; deny: string[] }
  disableRows: string[]
  toolFsConfig: Record<string, boolean>
  replyMaxWords: number
  dispatcher: DispatcherConfig
}

export interface WorkerConfig {
  role: "worker"
  model: ModelRoute
  promptFile: string
  permissionMode: string
  approvalPolicy: "ask" | "never"
  defaultMandateMode: MandateMode
  worktreeRoot: string
  branchPrefix: string
  baseRef: string
  extraWritableDirs: string[]
  toolFsConfig: Record<string, boolean>
  protectedPaths: string[]
  verify: { setup: string[]; commands: string[]; maxRepairRounds: number; timeoutMs: number }
  watchdog: { stallMinutes: number; intervalSeconds: number; maxSupervisoryChecks: number }
}

export interface DshConfig {
  dshVersion: string
  binary: string
  binaryEnv: string
  profile: string
  dshHome: string
  sessionsDir: string
  extraPlugins: { id: string; name: string }[]
  flags: Record<string, string>
  permissionPresets: string[]
  loaderRows: Record<string, string>
}

export function expandHome(path: string): string {
  return path === "~" ? homedir() : path.startsWith("~/") ? join(homedir(), path.slice(2)) : path
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(join(SUPER_AGENT_DIR, file), "utf8")) as T
}

export interface Loaded {
  router: RouterConfig
  worker: WorkerConfig
  dsh: DshConfig
  routerPrompt: string
  workerPrompt: string
  policyVersion: string
  dbPath: string
  dshBinary: string
  sessionsDir: string
  generatedDir: string
  logsDir: string
  stateDir: string
}

let cached: Loaded | undefined

/** Load all configuration (memoized per process). Env overrides are for tests and smoke runs. */
export function loadConfig(): Loaded {
  if (cached) return cached
  const router = readJson<RouterConfig>("router.json")
  const worker = readJson<WorkerConfig>("worker.json")
  const dsh = readJson<DshConfig>("dsh.json")
  if (process.env.SUPER_AGENT_ROUTER_MODEL)
    router.model = parseRoute(process.env.SUPER_AGENT_ROUTER_MODEL)
  if (process.env.SUPER_AGENT_WORKER_MODEL)
    worker.model = parseRoute(process.env.SUPER_AGENT_WORKER_MODEL)
  const routerPrompt = readFileSync(join(SUPER_AGENT_DIR, router.promptFile), "utf8")
  const workerPrompt = readFileSync(join(SUPER_AGENT_DIR, worker.promptFile), "utf8")
  const policyVersion = computePolicyVersion()
  const stateDir = process.env.SUPER_AGENT_STATE_DIR ?? SUPER_AGENT_DIR
  cached = {
    router,
    worker,
    dsh,
    routerPrompt,
    workerPrompt,
    policyVersion,
    dbPath: process.env.SUPER_AGENT_DB ?? join(stateDir, "super_agent.db"),
    dshBinary: process.env[dsh.binaryEnv] ?? expandHome(dsh.binary),
    sessionsDir: expandHome(dsh.sessionsDir),
    generatedDir: join(SUPER_AGENT_DIR, "generated"),
    logsDir: join(stateDir, "logs"),
    stateDir,
  }
  return cached
}

/** "provider/model" → route (used by SUPER_AGENT_*_MODEL overrides). */
export function parseRoute(value: string): ModelRoute {
  const slash = value.indexOf("/")
  if (slash <= 0) throw new Error(`model override must look like provider/model, got "${value}"`)
  return { provider: value.slice(0, slash), model: value.slice(slash + 1) }
}

/** Short content hash of every file that defines Router/Worker behavior. */
export function computePolicyVersion(): string {
  const hash = createHash("sha256")
  for (const file of [
    "router.json",
    "worker.json",
    "dsh.json",
    "prompts/router.md",
    "prompts/worker.md",
    "plugins/policy.mjs",
    "plugins/router-tools.mjs",
    "plugins/worker-guard.mjs",
  ]) {
    const path = join(SUPER_AGENT_DIR, file)
    hash.update(file)
    hash.update(existsSync(path) ? readFileSync(path) : "missing")
  }
  return `pv-${hash.digest("hex").slice(0, 12)}`
}

function modelRow(route: ModelRoute) {
  return {
    id: "agent-default-model",
    name: "@deepseek-ai/dsh-agent-default-model",
    config: route.reasoningEffort
      ? { provider: route.provider, model: route.model, reasoningEffort: route.reasoningEffort }
      : { provider: route.provider, model: route.model },
  }
}

function personaRow(prompt: string) {
  // dsh interpolates {{variable}} strictly; the prompts must not contain braces pairs.
  if (prompt.includes("{{"))
    throw new Error("prompt files must not contain '{{' (dsh system-prompt interpolation)")
  return {
    id: "system-prompt",
    name: "@deepseek-ai/dsh-system-prompt",
    config: { personaPrefix: prompt },
  }
}

function extraPluginRows(dsh: DshConfig) {
  return dsh.extraPlugins.map((plugin) => ({ id: plugin.id, name: expandHome(plugin.name) }))
}

/** Patch list for the Router tier (JSON is valid YAML, so the Loader reads it directly). */
export function routerPatch(cfg: Loaded): unknown[] {
  return [
    {
      insert: [
        ...extraPluginRows(cfg.dsh),
        { id: "super-agent-router-tools", name: join(SUPER_AGENT_DIR, "plugins/router-tools.mjs") },
      ],
    },
    modelRow(cfg.router.model),
    personaRow(cfg.routerPrompt),
    { id: "tool-fs", name: "@deepseek-ai/dsh-tool-fs", config: cfg.router.toolFsConfig },
    ...cfg.router.disableRows.map((id) => ({ id, disabled: true })),
  ]
}

/** Patch list for the Worker tier. */
export function workerPatch(cfg: Loaded): unknown[] {
  return [
    {
      insert: [
        ...extraPluginRows(cfg.dsh),
        { id: "super-agent-worker-guard", name: join(SUPER_AGENT_DIR, "plugins/worker-guard.mjs") },
      ],
    },
    modelRow(cfg.worker.model),
    personaRow(cfg.workerPrompt),
    { id: "tool-fs", name: "@deepseek-ai/dsh-tool-fs", config: cfg.worker.toolFsConfig },
  ]
}

/** Write generated/{router,worker}.patch.yml and return their paths. */
export function renderPatches(cfg = loadConfig()): { router: string; worker: string } {
  mkdirSync(cfg.generatedDir, { recursive: true })
  const header = (role: string) =>
    `# GENERATED by .super-agent/lib/config.ts from ${role}.json (${cfg.policyVersion}); do not edit.\n`
  const router = join(cfg.generatedDir, "router.patch.yml")
  const worker = join(cfg.generatedDir, "worker.patch.yml")
  writeFileSync(router, header("router") + JSON.stringify(routerPatch(cfg), null, 2) + "\n")
  writeFileSync(worker, header("worker") + JSON.stringify(workerPatch(cfg), null, 2) + "\n")
  return { router, worker }
}

export function ensureDir(path: string): string {
  mkdirSync(path, { recursive: true })
  return path
}

export function ensureParent(path: string): string {
  ensureDir(dirname(path))
  return path
}
