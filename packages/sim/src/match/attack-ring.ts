/**
 * Dynamic attack rings & slot reservation (spec/09 §3 + review §4–5).
 *
 * Each attacked target owns two concentric rings of slots. Melee attackers reserve
 * the cheapest free slot and path to `target + offset` instead of the target centre.
 * Slots only steer the approach — attacking never requires a slot.
 * Pure and deterministic; the match drives it with ids and positions.
 */

export const RING1_GAP = 0.7
export const RING2_GAP = 0.85
/** Arc length per slot (tiles) — a hero body (Ø 0.8) plus a sliver. */
export const SLOT_ARC = 0.84
/** Weight of the arc term in slot cost (`dist + ARC_WEIGHT · r · |Δθ|`). */
export const ARC_WEIGHT = 0.6
/** Attackers reserve within this distance (micro range) and release beyond RELEASE_AT. */
export const RESERVE_AT = 3
export const RELEASE_AT = 4
/** A swapped pair cannot be preempted again for this long (no cascades). */
export const PREEMPT_FREEZE = 1
/** Units with range below this use rings. */
export const MELEE_RANGE = 2.5

export interface Pos {
  readonly x: number
  readonly z: number
}

/** Hull-adjusted attack reach: big targets are hit from their edge. */
export const reach = (range: number, targetRadius: number) =>
  range + 0.3 + Math.max(0, targetRadius - 0.4)

export interface RingGeometry {
  readonly r1: number
  readonly n1: number
  readonly r2: number
  readonly n2: number
}

const slotsOn = (r: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, Math.floor((2 * Math.PI * r) / SLOT_ARC)))

export const ringGeometry = (targetRadius: number): RingGeometry => {
  const r1 = targetRadius + RING1_GAP
  const r2 = r1 + RING2_GAP
  return { r1, n1: slotsOn(r1, 4, 12), r2, n2: slotsOn(r2, 6, 16) }
}

export interface Slot {
  readonly ring: 1 | 2
  readonly index: number
}

interface Ring {
  readonly geo: RingGeometry
  /** Holder attacker id per slot, ring 1 then ring 2. */
  readonly holders: (string | undefined)[]
}

const angleOf = (ring: 1 | 2, index: number, geo: RingGeometry) =>
  (index / (ring === 1 ? geo.n1 : geo.n2)) * Math.PI * 2 + (ring === 2 ? Math.PI / geo.n2 : 0)

const wrap = (a: number) => {
  let x = a % (Math.PI * 2)
  if (x > Math.PI) x -= Math.PI * 2
  if (x < -Math.PI) x += Math.PI * 2
  return x
}

export class AttackRings {
  readonly #rings = new Map<string, Ring>()
  /** attacker id → { target, slot } */
  readonly #held = new Map<string, { target: string; slot: Slot }>()
  readonly #frozenUntil = new Map<string, number>()
  /** Orbit direction (+1 ccw / −1 cw) fixed at reservation, so approach never flip-flops. */
  readonly #orbit = new Map<string, number>()

  orbitSign(attackerId: string): number {
    return this.#orbit.get(attackerId) ?? 1
  }

  /** World offset of a slot relative to its target. */
  offset(targetId: string, slot: Slot): Pos {
    const ring = this.#rings.get(targetId)!
    const r = slot.ring === 1 ? ring.geo.r1 : ring.geo.r2
    const a = angleOf(slot.ring, slot.index, ring.geo)
    return { x: Math.cos(a) * r, z: Math.sin(a) * r }
  }

  slotOf(attackerId: string): { target: string; slot: Slot } | undefined {
    return this.#held.get(attackerId)
  }

  /** Slot world position for an attacker (undefined when it holds none). */
  goalOf(attackerId: string, target: Pos): Pos | undefined {
    const h = this.#held.get(attackerId)
    if (!h) return undefined
    const o = this.offset(h.target, h.slot)
    return { x: target.x + o.x, z: target.z + o.z }
  }

  #ring(targetId: string, targetRadius: number): Ring {
    let ring = this.#rings.get(targetId)
    if (!ring) {
      const geo = ringGeometry(targetRadius)
      ring = { geo, holders: Array.from({ length: geo.n1 + geo.n2 }) }
      this.#rings.set(targetId, ring)
    }
    return ring
  }

  #flat(ring: Ring, s: Slot) {
    return s.ring === 1 ? s.index : ring.geo.n1 + s.index
  }

  /**
   * Reserve (or keep) the cheapest free slot around `target` for `attacker`.
   * `reachRange` is the attacker's hull-adjusted reach; ring 2 is preferred when it
   * reaches ring 2. Returns the held slot or undefined when both rings are full.
   */
  request(
    attackerId: string,
    attacker: Pos,
    targetId: string,
    target: Pos,
    targetRadius: number,
    reachRange: number,
  ): Slot | undefined {
    const cur = this.#held.get(attackerId)
    if (cur && cur.target === targetId) return cur.slot
    if (cur) this.release(attackerId)
    const ring = this.#ring(targetId, targetRadius)
    const { geo } = ring
    const toward = Math.atan2(attacker.z - target.z, attacker.x - target.x)
    const order: (1 | 2)[] = reachRange >= geo.r2 ? [2, 1] : [1, 2]
    for (const which of order) {
      const n = which === 1 ? geo.n1 : geo.n2
      const r = which === 1 ? geo.r1 : geo.r2
      let best = -1
      let bestCost = Infinity
      for (let i = 0; i < n; i++) {
        if (ring.holders[this.#flat(ring, { ring: which, index: i })] !== undefined) continue
        const a = angleOf(which, i, geo)
        const sx = target.x + Math.cos(a) * r
        const sz = target.z + Math.sin(a) * r
        const cost =
          Math.hypot(sx - attacker.x, sz - attacker.z) + ARC_WEIGHT * r * Math.abs(wrap(a - toward))
        if (cost < bestCost - 1e-9) {
          bestCost = cost
          best = i
        }
      }
      if (best >= 0) {
        const slot: Slot = { ring: which, index: best }
        ring.holders[this.#flat(ring, slot)] = attackerId
        this.#held.set(attackerId, { target: targetId, slot })
        const d = wrap(angleOf(which, best, geo) - toward)
        this.#orbit.set(attackerId, d < 0 ? -1 : 1)
        return slot
      }
    }
    return undefined
  }

  /**
   * Preemption (review §4): `arriver` is already in reach of `targetId` but holds a
   * ring-2 slot or none. It takes the ring-1 slot whose holder is not yet in reach
   * and is farther from that slot than the arriver; the holder gets the arriver's
   * old slot (or none). Both are frozen for PREEMPT_FREEZE seconds.
   * `pos(id)` and `inReach(id)` describe the current holders. Returns the victim id.
   */
  preempt(
    arriverId: string,
    arriver: Pos,
    targetId: string,
    target: Pos,
    now: number,
    pos: (id: string) => Pos | undefined,
    inReach: (id: string) => boolean,
  ): string | undefined {
    const ring = this.#rings.get(targetId)
    if (!ring) return undefined
    if ((this.#frozenUntil.get(arriverId) ?? -1) > now) return undefined
    const mine = this.#held.get(arriverId)
    if (mine && mine.target === targetId && mine.slot.ring === 1) return undefined
    let victim: string | undefined
    let victimIdx = -1
    let worst = 0
    for (let i = 0; i < ring.geo.n1; i++) {
      const id = ring.holders[i]
      if (id === undefined || id === arriverId) continue
      if ((this.#frozenUntil.get(id) ?? -1) > now || inReach(id)) continue
      const p = pos(id)
      if (!p) continue
      const o = this.offset(targetId, { ring: 1, index: i })
      const sx = target.x + o.x
      const sz = target.z + o.z
      const holderGap = Math.hypot(p.x - sx, p.z - sz)
      const margin = holderGap - Math.hypot(arriver.x - sx, arriver.z - sz)
      if (margin > worst) {
        worst = margin
        victim = id
        victimIdx = i
      }
    }
    if (victim === undefined) return undefined
    const old = mine && mine.target === targetId ? mine.slot : undefined
    if (mine && mine.target !== targetId) this.release(arriverId)
    const taken: Slot = { ring: 1, index: victimIdx }
    ring.holders[victimIdx] = arriverId
    this.#held.set(arriverId, { target: targetId, slot: taken })
    if (old) {
      ring.holders[this.#flat(ring, old)] = victim
      this.#held.set(victim, { target: targetId, slot: old })
    } else this.#held.delete(victim)
    this.#frozenUntil.set(arriverId, now + PREEMPT_FREEZE)
    this.#frozenUntil.set(victim, now + PREEMPT_FREEZE)
    return victim
  }

  release(attackerId: string) {
    const h = this.#held.get(attackerId)
    if (!h) return
    const ring = this.#rings.get(h.target)
    if (ring) {
      const k = this.#flat(ring, h.slot)
      if (ring.holders[k] === attackerId) ring.holders[k] = undefined
    }
    this.#held.delete(attackerId)
    this.#orbit.delete(attackerId)
  }

  /** Drop a target's rings (it died); every holder loses its slot. */
  dropTarget(targetId: string) {
    const ring = this.#rings.get(targetId)
    if (!ring) return
    for (const id of ring.holders) if (id !== undefined) this.#held.delete(id)
    this.#rings.delete(targetId)
  }

  /** Free slot count on a ring (for tests and debug). */
  free(targetId: string, which: 1 | 2): number {
    const ring = this.#rings.get(targetId)
    if (!ring) return which === 1 ? Infinity : Infinity
    const [a, b] = which === 1 ? [0, ring.geo.n1] : [ring.geo.n1, ring.geo.n1 + ring.geo.n2]
    let n = 0
    for (let i = a; i < b; i++) if (ring.holders[i] === undefined) n++
    return n
  }
}
