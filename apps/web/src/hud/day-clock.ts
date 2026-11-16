/** Real milliseconds per full in-game day while the cycle plays. */
export const DAY_MS = 90_000

/**
 * Advances time of day (0..1) from wall-clock timestamps. Pure state, no DOM:
 * the HUD feeds it `requestAnimationFrame` times and reads back the new time.
 */
export class DayClock {
  #tod: number
  #last: number

  constructor(timeOfDay: number, now: number) {
    this.#tod = timeOfDay
    this.#last = now
  }

  get timeOfDay(): number {
    return this.#tod
  }

  /** Advance to `now` (ms). Returns how many midnights were crossed (0 or more). */
  tick(now: number): number {
    const next = this.#tod + (now - this.#last) / DAY_MS
    this.#last = now
    const days = Math.floor(next)
    this.#tod = next - days
    return days
  }
}
