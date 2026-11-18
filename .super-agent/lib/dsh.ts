// Thin wrapper over the installed `dsh` launcher. Every invocation is
//   dsh headless --patch <overlay> --permission-mode <preset> --approval-policy <policy>
//              [--add-dir <abs>]... [--session-id <id>] --json -
// with the task on stdin and NDJSON events on stdout (flags verified against
// `dsh headless --help`, dsh 0.2.2-rc.3).
import { spawn, type ChildProcess } from "node:child_process"
import { closeSync, existsSync, openSync, readdirSync, statSync, writeSync } from "node:fs"
import { join } from "node:path"
import { loadConfig, type Loaded } from "./config.ts"

export interface DshInvocation {
  overlay: string
  permissionMode: string
  approvalPolicy: "ask" | "never"
  addDirs?: string[]
  sessionId?: string | null
  cwd: string
  env?: Record<string, string>
}

export function dshArgv(cfg: Loaded, inv: DshInvocation): string[] {
  const f = cfg.dsh.flags
  const argv = [
    cfg.dsh.profile,
    f.patch,
    inv.overlay,
    f.permissionMode,
    inv.permissionMode,
    f.approvalPolicy,
    inv.approvalPolicy,
  ]
  for (const dir of inv.addDirs ?? []) argv.push(f.addDir, dir)
  if (inv.sessionId) argv.push(f.sessionId, inv.sessionId)
  argv.push(f.json, f.stdinTask)
  return argv
}

export interface HeadlessEvent {
  type: string
  [key: string]: unknown
}

export interface DshRunResult {
  exitCode: number | null
  sessionId: string | null
  finalReason: string | null
  finalText: string
  toolCalls: { tool: string; input: unknown }[]
  toolErrors: { callId: string; error: unknown; result: string }[]
}

/**
 * Start dsh asynchronously. stdout (NDJSON) and stderr are teed to `logPath`
 * line-by-line; `onEvent` sees every parsed event. Resolves when dsh exits.
 */
export function runDsh(
  inv: DshInvocation,
  task: string,
  logPath: string,
  onEvent?: (event: HeadlessEvent) => void,
  onSpawn?: (child: ChildProcess) => void,
): Promise<DshRunResult> {
  const cfg = loadConfig()
  const argv = dshArgv(cfg, inv)
  const logFd = openSync(logPath, "a")
  writeSync(
    logFd,
    JSON.stringify({
      type: "super-agent/launch",
      at: Date.now(),
      cwd: inv.cwd,
      argv: [cfg.dshBinary, ...argv],
    }) + "\n",
  )
  const child = spawn(cfg.dshBinary, argv, {
    cwd: inv.cwd,
    env: { ...process.env, ...inv.env },
    stdio: ["pipe", "pipe", "pipe"],
  })
  onSpawn?.(child)
  const result: DshRunResult = {
    exitCode: null,
    sessionId: null,
    finalReason: null,
    finalText: "",
    toolCalls: [],
    toolErrors: [],
  }
  let buffer = ""
  const handleLine = (line: string) => {
    if (!line.trim()) return
    writeSync(logFd, line + "\n")
    let event: HeadlessEvent
    try {
      event = JSON.parse(line) as HeadlessEvent
    } catch {
      return
    }
    if (event.type === "session" && typeof event.sessionId === "string")
      result.sessionId = event.sessionId
    if (event.type === "tool_call")
      result.toolCalls.push({ tool: String(event.tool), input: event.input })
    if (event.type === "tool_result" && event.status === "error") {
      result.toolErrors.push({
        callId: String(event.callId),
        error: event.error ?? null,
        result: String(event.result ?? ""),
      })
    }
    if (event.type === "final") {
      const reason = event.reason as { kind?: string } | null
      result.finalReason = reason?.kind ?? null
      result.finalText = String(event.text ?? "")
      if (typeof event.sessionId === "string") result.sessionId = event.sessionId
    }
    onEvent?.(event)
  }
  child.stdout!.setEncoding("utf8")
  child.stdout!.on("data", (chunk: string) => {
    buffer += chunk
    let index: number
    while ((index = buffer.indexOf("\n")) >= 0) {
      handleLine(buffer.slice(0, index))
      buffer = buffer.slice(index + 1)
    }
  })
  child.stderr!.setEncoding("utf8")
  child.stderr!.on("data", (chunk: string) => {
    writeSync(
      logFd,
      JSON.stringify({ type: "super-agent/stderr", text: chunk.slice(0, 8000) }) + "\n",
    )
  })
  child.stdin!.end(task)
  return new Promise((resolvePromise) => {
    child.on("close", (code) => {
      if (buffer) handleLine(buffer)
      result.exitCode = code
      writeSync(logFd, JSON.stringify({ type: "super-agent/exit", at: Date.now(), code }) + "\n")
      closeSync(logFd)
      resolvePromise(result)
    })
    child.on("error", (error) => {
      writeSync(
        logFd,
        JSON.stringify({ type: "super-agent/spawn-error", message: error.message }) + "\n",
      )
    })
  })
}

/** Launch a Bun script fully detached (own process group, stdio to a log file). */
export function spawnDetached(
  script: string,
  args: string[],
  logPath: string,
  env: Record<string, string> = {},
): number {
  const out = openSync(logPath, "a")
  const child = spawn(process.execPath, [script, ...args], {
    cwd: loadConfig().stateDir,
    detached: true,
    stdio: ["ignore", out, out],
    env: { ...process.env, ...env },
  })
  child.unref()
  closeSync(out)
  return child.pid ?? -1
}

export function pidAlive(pid: number | null | undefined): boolean {
  if (!pid || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM"
  }
}

/** Locate a persisted dsh Session directory under $DSH_HOME/sessions/<cwd-key>/<sessionId>. */
export function findSessionDir(
  sessionId: string,
  sessionsDir = loadConfig().sessionsDir,
): string | null {
  if (!existsSync(sessionsDir)) return null
  for (const bucket of readdirSync(sessionsDir)) {
    const candidate = join(sessionsDir, bucket, sessionId)
    if (existsSync(candidate)) return candidate
  }
  return null
}

/** Newest mtime among a Session directory's files (the JSONL log grows on every event). */
export function sessionActivity(sessionId: string): {
  dir: string | null
  lastWrite: number | null
  locked: boolean
} {
  const dir = findSessionDir(sessionId)
  if (!dir) return { dir: null, lastWrite: null, locked: false }
  let lastWrite = 0
  let locked = false
  for (const file of readdirSync(dir)) {
    if (file === "session.lock") locked = true
    lastWrite = Math.max(lastWrite, statSync(join(dir, file)).mtimeMs)
  }
  return { dir, lastWrite: lastWrite || null, locked }
}
