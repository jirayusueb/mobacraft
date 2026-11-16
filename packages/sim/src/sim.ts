import type { LaneId, MobaMap, Team, Vec2 } from "@mobacraft/map"
import { type CreatureKind, type LaneRole, NEUTRALS_BY_CAMP } from "./kinds.ts"
import type { Population } from "./population.ts"

/**
 * Creep simulation — pure, deterministic, no rendering.
 *
 * Interface:
 *   createCreepSim(map, options?) → { step(dt), creatures(), stats() }
 *
 * Behaviour (map milestone — no combat yet):
 *   - Every `waveInterval` seconds each team spawns a wave in every lane:
 *     3 melee + 1 ranged, plus a siege engine every 5th wave. Waves march along
 *     their lane from their own base to the enemy base, in a loose column.
 *   - Opposing waves meet and *clash* for `clashSeconds` (they face each other
 *     and hold position), then march on; units despawn on reaching the enemy base.
 *   - Neutral camps hold their roster idle around the campfire; Roshan sits in his pit.
 *
 * Invariants: same map + options + same sequence of step(dt) → identical output.
 * `creatures()` returns a fresh read-only snapshot; ids are stable for a unit's life.
 */

export interface Creature {
  readonly id: number
  readonly kind: CreatureKind
  readonly team: Team | "neutral"
  /** World position on the ground plane (tiles). */
  readonly x: number
  readonly z: number
  /** Facing, radians; 0 looks toward +z. */
  readonly heading: number
  readonly state: "marching" | "clashing" | "idle"
  readonly lane?: LaneId
  /** Camp or landmark id for neutrals / Roshan. */
  readonly home?: string
}

export interface SimOptions {
  /** Seconds between waves. Dota uses 30. */
  readonly waveInterval?: number
  /** Lane march speed, tiles / s. */
  readonly speed?: number
  readonly clashSeconds?: number
  /** Cap per lane per team so long sessions stay bounded. */
  readonly maxWavesInFlight?: number
}

interface Walker {
  id: number
  kind: CreatureKind
  team: Team
  lane: LaneId
  role: LaneRole
  /** Arc length travelled along this team's lane direction, tiles. */
  s: number
  /** Lateral offset from the lane centreline, tiles. */
  side: number
  /** Distance behind the wave leader, tiles. */
  rank: number
  wave: number
  clash: number
  clashed: boolean
}

const ROSTER: readonly LaneRole[] = ["melee", "melee", "melee", "ranged"]

const polyline = (path: readonly Vec2[]) => {
  const cum = [0]
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!
    const b = path[i]!
    cum.push(cum[i - 1]! + Math.hypot(b.x - a.x, b.z - a.z))
  }
  const length = cum[cum.length - 1]!
  /** Point + unit tangent at arc length s (clamped). */
  const at = (s: number) => {
    const t = Math.min(length, Math.max(0, s))
    let i = 1
    while (i < cum.length - 1 && cum[i]! < t) i++
    const a = path[i - 1]!
    const b = path[i]!
    const seg = cum[i]! - cum[i - 1]! || 1
    const k = (t - cum[i - 1]!) / seg
    return {
      x: a.x + (b.x - a.x) * k,
      z: a.z + (b.z - a.z) * k,
      tx: (b.x - a.x) / seg,
      tz: (b.z - a.z) / seg,
    }
  }
  return { length, at }
}

export const createCreepSim = (map: MobaMap, options: SimOptions = {}) => {
  const waveInterval = options.waveInterval ?? 30
  const speed = options.speed ?? 2.4
  const clashSeconds = options.clashSeconds ?? 6
  const maxWaves = options.maxWavesInFlight ?? 3

  const lanes = new Map(map.lanes.map((l) => [l.id, polyline(l.path)]))
  let nextId = 1
  let clock = 0
  let wave = 0
  // First wave spawns immediately so the map is alive on open.
  let untilWave = 0
  const walkers: Walker[] = []

  // --- static neutrals ------------------------------------------------------------
  const statics: Creature[] = []
  for (const camp of map.camps) {
    const roster = NEUTRALS_BY_CAMP[camp.kind]
    // Pick one pair (leader + minion) per camp, deterministically by camp id.
    const h = [...camp.id].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7)
    const pair = (h % 2) * 2
    const leader = roster[pair]!
    const minion = roster[pair + 1]!
    const count = camp.kind === "small" ? 3 : camp.kind === "ancient" ? 3 : 2
    const kinds = [leader, ...Array.from({ length: count - 1 }, () => minion)]
    kinds.forEach((kind, i) => {
      const a = (i / kinds.length) * Math.PI * 2 + (h % 628) / 100
      const r = i === 0 ? 0.9 : 1.4
      const x = camp.position.x + Math.cos(a) * r
      const z = camp.position.z + Math.sin(a) * r
      statics.push({
        id: nextId++,
        kind,
        team: "neutral",
        x,
        z,
        heading: Math.atan2(camp.position.x - x, camp.position.z - z) + Math.PI,
        state: "idle",
        home: camp.id,
      })
    })
  }
  const roshan = map.landmarks.find((l) => l.kind === "roshan")
  if (roshan) {
    // Stand at the lair's cave mouth (toward the map centre / river), facing out,
    // so he reads clearly instead of hiding inside the ring of boulders.
    const dx = map.size / 2 - roshan.position.x
    const dz = map.size / 2 - roshan.position.z
    const len = Math.hypot(dx, dz) || 1
    const out = 2.3
    statics.push({
      id: nextId++,
      kind: "roshan",
      team: "neutral",
      x: roshan.position.x + (dx / len) * out,
      z: roshan.position.z + (dz / len) * out,
      heading: Math.atan2(dx, dz),
      state: "idle",
      home: roshan.id,
    })
  }

  const spawnWave = () => {
    wave++
    const roles: LaneRole[] = wave % 5 === 0 ? [...ROSTER, "siege"] : [...ROSTER]
    for (const team of ["radiant", "dire"] as const) {
      for (const lane of lanes.keys()) {
        const inFlight = new Set(
          walkers.filter((w) => w.team === team && w.lane === lane).map((w) => w.wave),
        )
        if (inFlight.size >= maxWaves) continue
        roles.forEach((role, i) => {
          walkers.push({
            id: nextId++,
            kind: `${team}-${role}`,
            team,
            lane,
            role,
            s: 0,
            side: role === "melee" ? (i - 1) * 0.55 : 0,
            rank: role === "melee" ? 0 : role === "ranged" ? 1.1 : 2.2,
            wave,
            clash: 0,
            clashed: false,
          })
        })
      }
    }
  }

  /** World position of a walker: radiant walks the path forward, dire walks it backward. */
  const place = (w: Walker) => {
    const lane = lanes.get(w.lane)!
    const s = w.team === "radiant" ? w.s - w.rank : lane.length - (w.s - w.rank)
    const p = lane.at(s)
    const dir = w.team === "radiant" ? 1 : -1
    const tx = p.tx * dir
    const tz = p.tz * dir
    return { x: p.x - tz * w.side, z: p.z + tx * w.side, heading: Math.atan2(tx, tz), lane }
  }

  const step = (dt: number) => {
    if (dt <= 0) return
    clock += dt
    untilWave -= dt
    while (untilWave <= 0) {
      spawnWave()
      untilWave += waveInterval
    }
    // Clash detection: the front of each wave vs the nearest enemy front in the same lane.
    for (const w of walkers) {
      if (w.clash > 0) {
        w.clash -= dt
        continue
      }
      w.s += speed * dt
      if (w.clashed) continue
      const me = place(w)
      for (const e of walkers) {
        if (e.team === w.team || e.lane !== w.lane || e.clashed) continue
        const them = place(e)
        if (Math.hypot(me.x - them.x, me.z - them.z) < 1.6) {
          // Freeze both waves in place.
          for (const u of walkers) {
            if (u.lane === w.lane && (u.wave === w.wave || u.wave === e.wave) && !u.clashed) {
              u.clash = clashSeconds
              u.clashed = true
            }
          }
          break
        }
      }
    }
    // Despawn units that reached the far end.
    for (let i = walkers.length - 1; i >= 0; i--) {
      const w = walkers[i]!
      if (w.s - w.rank > lanes.get(w.lane)!.length) walkers.splice(i, 1)
    }
  }

  const creatures = (): readonly Creature[] => {
    const moving = walkers.map((w): Creature => {
      const p = place(w)
      return {
        id: w.id,
        kind: w.kind,
        team: w.team,
        x: p.x,
        z: p.z,
        heading: p.heading,
        state: w.clash > 0 ? "clashing" : "marching",
        lane: w.lane,
      }
    })
    return [...moving, ...statics]
  }

  return {
    step,
    creatures,
    stats: () => ({ clock, wave, lane: walkers.length, neutral: statics.length }),
  }
}

export type CreepSim = ReturnType<typeof createCreepSim>

/** Explore-mode population: the ambient creep sim behind the Population seam. */
export const creepPopulation = (map: MobaMap, options: SimOptions = {}): Population => {
  const sim = createCreepSim(map, options)
  return {
    advance: (dt) => sim.step(dt),
    time: () => sim.stats().clock,
    units: () =>
      sim.creatures().map((c) => ({
        id: `creature-${c.id}`,
        kind: c.kind,
        team: c.team,
        x: c.x,
        z: c.z,
        heading: c.heading,
      })),
    fx: () => [],
  }
}
