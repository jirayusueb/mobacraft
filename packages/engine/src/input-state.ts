/** Small stateful helpers for the map view's frame loop — no DOM, no three.js. */

/** Keys currently held down, normalised to lower case. */
export class HeldKeys {
  readonly #down = new Set<string>()

  press(key: string): void {
    this.#down.add(key.toLowerCase())
  }

  release(key: string): void {
    this.#down.delete(key.toLowerCase())
  }

  clear(): void {
    this.#down.clear()
  }

  /** 1 if either key is held, else 0. */
  either(a: string, b: string): 0 | 1 {
    return this.#down.has(a) || this.#down.has(b) ? 1 : 0
  }

  /** Screen-space pan intent from WASD / arrow keys, each axis in -1..1. */
  panAxes(): { readonly right: number; readonly up: number } {
    return {
      right: this.either("d", "arrowright") - this.either("a", "arrowleft"),
      up: this.either("w", "arrowup") - this.either("s", "arrowdown"),
    }
  }
}

/** Frames-per-second averaged over a fixed window. */
export class FpsMeter {
  readonly #window: number
  #acc = 0
  #frames = 0
  #fps: number

  constructor(window = 0.5, initial = 60) {
    this.#window = window
    this.#fps = initial
  }

  get fps(): number {
    return this.#fps
  }

  /** Records one frame of `dt` seconds; returns true when a new reading is ready. */
  tick(dt: number): boolean {
    this.#acc += dt
    this.#frames++
    if (this.#acc < this.#window) return false
    this.#fps = Math.round(this.#frames / this.#acc)
    this.#acc = 0
    this.#frames = 0
    return true
  }
}
