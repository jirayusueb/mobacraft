/** Keyed get-or-create cache: `build` runs once per key, results are shared. */
export class Memo<K, V> {
  readonly #entries = new Map<K, V>()
  readonly #build: (key: K) => V

  constructor(build: (key: K) => V) {
    this.#build = build
  }

  get(key: K): V {
    if (this.#entries.has(key)) return this.#entries.get(key) as V
    const value = this.#build(key)
    this.#entries.set(key, value)
    return value
  }

  get size(): number {
    return this.#entries.size
  }
}
