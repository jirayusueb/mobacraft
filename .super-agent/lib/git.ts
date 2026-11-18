// Git helpers for per-thread worktrees. Workers never receive these powers;
// only orchestrator code (spawn_worker, worker-runner) runs them.
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { ensureDir, expandHome, loadConfig, REPO_ROOT } from "./config.ts"

export function git(
  args: string[],
  cwd = REPO_ROOT,
): { code: number; stdout: string; stderr: string } {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" })
  return {
    code: result.status ?? 1,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
  }
}

export function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "thread"
  )
}

export function gitCommonDir(cwd = REPO_ROOT): string {
  return git(["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd).stdout
}

/** Create (or reuse) the thread's worktree + branch. Idempotent. */
export function ensureWorktree(threadId: string): {
  worktree: string
  branch: string
  baseCommit: string
} {
  const cfg = loadConfig()
  const root = ensureDir(
    expandHome(process.env.SUPER_AGENT_WORKTREE_ROOT ?? cfg.worker.worktreeRoot),
  )
  const name = slug(threadId)
  const worktree = join(root, name)
  const branch = `${cfg.worker.branchPrefix}${name}`
  const baseCommit = git(["rev-parse", cfg.worker.baseRef]).stdout
  if (!baseCommit) throw new Error(`cannot resolve base ref ${cfg.worker.baseRef}`)
  if (existsSync(join(worktree, ".git"))) {
    return {
      worktree,
      branch,
      baseCommit: git(["merge-base", "HEAD", baseCommit], worktree).stdout || baseCommit,
    }
  }
  const branchExists = git(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]).code === 0
  const result = branchExists
    ? git(["worktree", "add", worktree, branch])
    : git(["worktree", "add", "-b", branch, worktree, baseCommit])
  if (result.code !== 0) throw new Error(`git worktree add failed: ${result.stderr}`)
  return { worktree, branch, baseCommit }
}

/** `git diff --stat` + commit list of the branch relative to its base (includes uncommitted work). */
export function diffSummary(worktree: string, baseCommit: string): string {
  if (!existsSync(worktree)) return "(worktree missing)"
  const commits = git(["log", "--oneline", `${baseCommit}..HEAD`], worktree).stdout
  const committed = git(["diff", "--stat", `${baseCommit}..HEAD`], worktree).stdout
  const dirty = git(["status", "--short"], worktree).stdout
  return [
    `commits since ${baseCommit.slice(0, 8)}:\n${commits || "(none)"}`,
    `diffstat:\n${committed || "(no committed changes)"}`,
    `uncommitted:\n${dirty || "(clean)"}`,
  ].join("\n\n")
}

/** Fingerprint of the worktree's file state; changes when the worker edits anything. */
export function worktreeFingerprint(worktree: string): string {
  if (!existsSync(worktree)) return "missing"
  const head = git(["rev-parse", "HEAD"], worktree).stdout
  const status = git(["status", "--porcelain=v1", "-uall"], worktree).stdout
  const diff = git(["diff", "HEAD", "--stat"], worktree).stdout
  return Bun.hash(`${head}\n${status}\n${diff}`).toString(16)
}
