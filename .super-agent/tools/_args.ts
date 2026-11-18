// Shared CLI contract for Router tool scripts: `bun <tool>.ts --args-json '<json>'`.
// Prints exactly one JSON line: {"ok": true, ...} or {"ok": false, "error": "..."}.
export function readArgs<T>(): T {
  const index = process.argv.indexOf("--args-json")
  const raw = index >= 0 ? process.argv[index + 1] : process.argv[2]
  if (!raw) throw new Error("missing --args-json")
  return JSON.parse(raw) as T
}

export async function main(
  fn: () => Promise<Record<string, unknown>> | Record<string, unknown>,
): Promise<void> {
  try {
    const value = await fn()
    console.log(JSON.stringify({ ok: true, ...value }))
    process.exit(0)
  } catch (error) {
    console.log(JSON.stringify({ ok: false, error: (error as Error).message ?? String(error) }))
    process.exit(1)
  }
}

export function requireString(value: unknown, field: string, max = 20000): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${field} must be a non-empty string`)
  if (value.length > max) throw new Error(`${field} exceeds ${max} characters`)
  return value.trim()
}
