import { describe, expect, test } from "bun:test"
import { Memo } from "./memo.ts"

describe("Memo", () => {
  test("builds once per key, including falsy results", () => {
    let calls = 0
    const m = new Memo((k: string) => {
      calls++
      return k === "none" ? undefined : { k }
    })
    const a = m.get("a")
    expect(m.get("a")).toBe(a)
    expect(m.get("none")).toBeUndefined()
    expect(m.get("none")).toBeUndefined()
    expect(calls).toBe(2)
    expect(m.size).toBe(2)
  })
})
