// Shared, dependency-free tool policy for the Super Agent dsh plugins.
// Imported by the dsh Host plugins (Electron Node, ESM) and by Bun tests.

/** Tools that mutate files or execute processes. Never callable by the Router. */
export const MUTATING_TOOLS = Object.freeze([
  "bash",
  "pwsh",
  "execute",
  "run_code",
  "write",
  "write_file",
  "edit",
  "edit_file",
  "apply_patch",
  "str_replace_editor",
  "terminal_open",
  "terminal_send",
  "terminal_signal",
  "terminal_close",
  "job_kill",
  "subagent",
  "subagent_fork",
  "workflow",
  "send_message",
  "create_goal",
  "update_goal",
  "plugin_manager",
  "working_directory",
  "schedule_create",
  "schedule_edit",
])

export const MANDATE_MODES = Object.freeze(["OBSERVE", "AUTO"])

/**
 * Router policy: an explicit allowlist, then an explicit denylist.
 * @param {string} name tool name
 * @param {{allow: string[], deny: string[]}} policy
 * @returns {string | undefined} denial reason
 */
export function evaluateRouterCall(name, policy) {
  if (policy.deny.includes(name) || MUTATING_TOOLS.includes(name)) {
    return `super-agent router policy: tool "${name}" is structurally denied for the Router (no shell, no file mutation). Dispatch the work with spawn_worker instead.`
  }
  if (!policy.allow.includes(name)) {
    return `super-agent router policy: tool "${name}" is not in the Router allowlist (${policy.allow.join(", ")}).`
  }
  return undefined
}

/**
 * Split a shell command into conservative "segments". Quotes, subshells and
 * command separators all start new segments, so `bash -c "rm -rf x"` yields a
 * segment `rm -rf x`. Over-matching (e.g. inside an echo) is acceptable: the
 * guard prefers a false denial to a destructive false allow.
 * @param {string} command
 * @returns {string[][]} token lists
 */
export function splitSegments(command) {
  return command
    .split(/[;&|\n`()"'{}]|\$\(/)
    .map((segment) => segment.trim().split(/\s+/).filter(Boolean))
    .filter((tokens) => tokens.length > 0)
}

const WRAPPERS = new Set([
  "sudo",
  "env",
  "command",
  "exec",
  "nohup",
  "xargs",
  "time",
  "nice",
  "doas",
])

/** Drop leading wrappers and VAR=value assignments. */
function stripWrappers(tokens) {
  let index = 0
  while (
    index < tokens.length &&
    (WRAPPERS.has(tokens[index]) ||
      /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index]) ||
      (index > 0 && tokens[index].startsWith("-") && WRAPPERS.has(tokens[index - 1])))
  ) {
    index += 1
  }
  return tokens.slice(index)
}

function shortFlags(tokens) {
  return tokens.filter((token) => /^-[A-Za-z]+$/.test(token)).join("")
}

const PROTECTED_BRANCHES =
  /^(?:\+?(?:refs\/heads\/)?(?:main|master|release|production)(?::.*)?|.*:(?:refs\/heads\/)?(?:main|master|release|production))$/

/**
 * Rules for one segment. Returns a reason when the segment is denied.
 * @param {string[]} raw
 * @param {"OBSERVE" | "AUTO"} mode
 */
function evaluateSegment(raw, mode) {
  const tokens = stripWrappers(raw)
  if (tokens.length === 0) return undefined
  const [cmd, ...rest] = tokens
  const base = cmd.split("/").pop()
  const flags = shortFlags(rest)
  const has = (...names) => rest.some((token) => names.includes(token))

  if (raw[0] === "sudo" || raw[0] === "doas") return "privilege escalation (sudo/doas) is denied"
  if (base === "rm") {
    const recursive = /[rR]/.test(flags) || has("--recursive")
    const force = /f/.test(flags) || has("--force")
    if (recursive && force)
      return "`rm -rf` (recursive + force delete) is denied; delete specific files explicitly"
    if (
      recursive &&
      rest.some(
        (token) =>
          token === "/" ||
          token === "~" ||
          token === "." ||
          token === ".." ||
          token === "*" ||
          token === "$HOME",
      )
    ) {
      return "recursive delete of a root, home, or current directory is denied"
    }
  }
  if (base === "find" && has("-delete")) return "`find -delete` is denied"
  if (base === "mkfs" || base?.startsWith("mkfs.")) return "filesystem formatting is denied"
  if (base === "dd" && rest.some((token) => token.startsWith("of=/dev/")))
    return "raw device writes are denied"
  if (
    (base === "chmod" || base === "chown") &&
    (/R/.test(flags) || has("--recursive")) &&
    rest.some((token) => token === "/" || token === "777" || token === "~")
  ) {
    return "recursive permission changes on broad targets are denied"
  }
  if (base === "git") {
    const sub = rest.find((token) => !token.startsWith("-"))
    const subIndex = rest.indexOf(sub ?? "")
    const after = subIndex >= 0 ? rest.slice(subIndex + 1) : []
    const afterFlags = shortFlags(after)
    const afterHas = (...names) =>
      after.some((token) => names.some((name) => token === name || token.startsWith(`${name}=`)))
    switch (sub) {
      case "push": {
        if (
          afterHas(
            "--force",
            "--force-with-lease",
            "--force-if-includes",
            "--mirror",
            "--delete",
            "--prune",
          ) ||
          /[fd]/.test(afterFlags)
        ) {
          return "`git push --force` / delete / mirror is denied in every mandate mode"
        }
        if (after.some((token) => token.startsWith("+") || token.startsWith(":")))
          return "force or delete refspecs are denied"
        if (after.some((token) => PROTECTED_BRANCHES.test(token)))
          return "pushing directly to a protected branch (main/master/release/production) is denied"
        if (mode === "OBSERVE")
          return "[MANDATE MODE: OBSERVE] forbids `git push`; leave the branch local and report a diff summary"
        return undefined
      }
      case "merge":
      case "pull":
        if (mode === "OBSERVE")
          return `[MANDATE MODE: OBSERVE] forbids \`git ${sub}\`; work only on the mandate branch`
        return undefined
      case "reset":
        if (afterHas("--hard", "--merge", "--keep"))
          return "`git reset --hard` discards work and is denied"
        return undefined
      case "clean":
        if (/f/.test(afterFlags) || afterHas("--force"))
          return "`git clean -f` deletes untracked files and is denied"
        return undefined
      case "branch":
        if (/D/.test(afterFlags) || (/d/.test(afterFlags) && afterHas("--force")))
          return "force-deleting branches is denied"
        return undefined
      case "checkout":
      case "restore":
        if (after.includes(".") || afterHas("--force") || /f/.test(afterFlags))
          return "discarding working-tree changes wholesale is denied"
        return undefined
      case "stash":
        if (after[0] === "drop" || after[0] === "clear") return "dropping stashes is denied"
        return undefined
      case "worktree":
        if (after[0] === "remove" || after[0] === "prune")
          return "worktree removal is reserved for the orchestrator"
        return undefined
      case "filter-branch":
      case "filter-repo":
      case "update-ref":
      case "reflog":
        return `\`git ${sub}\` rewrites history and is denied`
      case "config":
        if (after.some((token) => /^(?:core\.hooksPath|alias\.|credential\.)/.test(token)))
          return "changing hooks, aliases, or credentials in git config is denied"
        return undefined
      default:
        return undefined
    }
  }
  if (base === "gh") {
    const [area, action] = rest
    if (
      area === "pr" &&
      (action === "merge" || (mode === "OBSERVE" && (action === "create" || action === "ready")))
    ) {
      return `\`gh pr ${action}\` is denied in [MANDATE MODE: ${mode}]`
    }
    if (area === "release" || (area === "repo" && (action === "delete" || action === "edit")))
      return `\`gh ${area} ${action}\` is denied`
    if (area === "api" && rest.some((token) => /^-X$|^--method$/.test(token)))
      return "mutating `gh api` calls are denied"
  }
  if (
    (base === "npm" || base === "bun" || base === "pnpm" || base === "yarn") &&
    rest[0] === "publish"
  )
    return "package publishing is denied"
  if (base === "vercel" && (mode === "OBSERVE" || has("--prod"))) return "deployments are denied"
  return undefined
}

/**
 * Worker bash/file policy.
 * @param {string} name tool name
 * @param {any} args parsed tool arguments
 * @param {"OBSERVE" | "AUTO"} mode
 * @param {{protectedPaths?: string[]}} [options]
 * @returns {string | undefined} denial reason
 */
export function evaluateWorkerCall(name, args, mode, options = {}) {
  const protectedPaths = options.protectedPaths ?? []
  if (name === "bash" || name === "pwsh" || name === "execute" || name === "terminal_send") {
    const command = String(args?.command ?? args?.input ?? args?.text ?? "")
    if (/:\(\)\s*\{\s*:\|:&\s*\};:/.test(command.replace(/\s+/g, "")))
      return "super-agent worker guard: fork bomb denied"
    if (/\b(?:curl|wget)\b[^\n|]*\|\s*(?:sudo\s+)?(?:ba|z|da)?sh\b/.test(command)) {
      return "super-agent worker guard: piping downloads into a shell is denied"
    }
    for (const segment of splitSegments(command)) {
      const reason = evaluateSegment(segment, mode)
      if (reason) return `super-agent worker guard: ${reason}. Command: ${command.slice(0, 200)}`
    }
    return undefined
  }
  if (
    ["write", "edit", "apply_patch", "write_file", "edit_file", "str_replace_editor"].includes(name)
  ) {
    const target = String(args?.file_path ?? args?.path ?? args?.patch ?? "")
    for (const prefix of protectedPaths) {
      if (prefix && target.includes(prefix)) {
        return `super-agent worker guard: ${name} on protected path "${prefix}" is denied (orchestrator state and policy are read-only for workers).`
      }
    }
    if (/(^|\/)\.git\//.test(target))
      return `super-agent worker guard: direct edits under .git/ are denied`
  }
  return undefined
}
