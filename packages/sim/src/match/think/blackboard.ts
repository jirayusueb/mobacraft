/**
 * Hero Think — Layer 4, the team Blackboard (spec/09). Shared, deterministic team
 * memory: target locks from initiators, and reservations ("claims") so heroes split
 * camps/lanes/ganks/saves instead of piling onto the same one.
 * Keys: `camp:<id>`, `lane:<id>`, `gank:<enemyId>`, `save:<allyId>`.
 */
export const CLAIM_TTL = 8
export const LOCK_TTL = 4
export const LOCK_RADIUS = 12
/** Target-score bonus for heroes near a locked target. */
export const LOCK_BONUS = 0.5

export interface Claim {
  readonly key: string
  readonly by: string
  readonly until: number
}
export interface TargetLock {
  readonly target: string
  readonly by: string
  readonly until: number
}

/** How many heroes may hold the same key. */
const capacity = (key: string) => (key.startsWith("gank:") ? 2 : 1)

export class Blackboard {
  readonly #claims = new Map<string, Claim[]>()
  #lock: TargetLock | null = null

  /** Holders of `key` other than `heroId` that are still valid at `t`. */
  othersOn(key: string, heroId: string, t: number): number {
    return (this.#claims.get(key) ?? []).filter((c) => c.by !== heroId && c.until > t).length
  }

  /** Free for this hero (it already holds it, or there is room). */
  isFree(key: string, heroId: string, t: number): boolean {
    return this.othersOn(key, heroId, t) < capacity(key)
  }

  /**
   * Claim `key` for `heroId` (renewing if held); releases the hero's other claims of
   * the same kind, so a hero holds one camp, one lane, one gank, one save at a time.
   */
  claim(key: string, heroId: string, t: number): boolean {
    if (!this.isFree(key, heroId, t)) return false
    const kind = key.slice(0, key.indexOf(":") + 1)
    for (const [k, list] of this.#claims)
      if (k !== key && k.startsWith(kind))
        this.#claims.set(
          k,
          list.filter((c) => c.by !== heroId),
        )
    const list = (this.#claims.get(key) ?? []).filter((c) => c.by !== heroId && c.until > t)
    list.push({ key, by: heroId, until: t + CLAIM_TTL })
    this.#claims.set(key, list)
    return true
  }

  /** Drop every claim held by a hero (death, retreat). */
  release(heroId: string, prefix = ""): void {
    for (const [k, list] of this.#claims)
      if (k.startsWith(prefix))
        this.#claims.set(
          k,
          list.filter((c) => c.by !== heroId),
        )
  }

  /** Current holder ids of a key. */
  holders(key: string, t: number): readonly string[] {
    return (this.#claims.get(key) ?? []).filter((c) => c.until > t).map((c) => c.by)
  }

  setLock(target: string, by: string, t: number): void {
    this.#lock = { target, by, until: t + LOCK_TTL }
  }

  lock(t: number): TargetLock | null {
    if (this.#lock && this.#lock.until <= t) this.#lock = null
    return this.#lock
  }

  clearLockOn(target: string): void {
    if (this.#lock?.target === target) this.#lock = null
  }
}
