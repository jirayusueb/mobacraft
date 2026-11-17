/**
 * Lane creep wave spawner — spec/12 §3: 30 s scheduler, 7:30 scaling tiers,
 * siege every 10th wave, super/mega templates from barracks state, object pool.
 */
import type { LaneId, Team } from "@mobacraft/map"

export const WAVE_PERIOD = 30
export const WAVES_PER_TIER = 15
export const SIEGE_EVERY = 10
export const MAX_MELEE = 6
export const MAX_RANGED = 3
export const TIER_STAT_STEP = 0.1
const EPS = 1e-6

/** Wave indices whose spawn time k·30 lies in (prev, now]; wave 0 when prev < 0. */
export const wavesDue = (prev: number, now: number): number[] => {
  if (now < prev) return []
  // EPS absorbs float drift from scaled tick clocks (e.g. 0.1 × 2 accumulations).
  const first = prev < 0 ? 0 : Math.floor((prev + EPS) / WAVE_PERIOD) + 1
  const last = Math.floor((now + EPS) / WAVE_PERIOD)
  const out: number[] = []
  for (let k = Math.max(0, first); k <= last; k++) out.push(k)
  return out
}

export const waveSpawnTime = (wave: number) => wave * WAVE_PERIOD

export type CreepRole = "melee" | "ranged" | "siege"
export type CreepTemplate = "normal" | "super" | "mega"

export interface WaveComposition {
  readonly wave: number
  readonly tier: number
  readonly melee: number
  readonly ranged: number
  readonly siege: number
  readonly statMul: number
}

export const waveComposition = (wave: number): WaveComposition => {
  const tier = Math.floor(wave / WAVES_PER_TIER)
  return {
    wave,
    tier,
    melee: Math.min(MAX_MELEE, 3 + tier),
    ranged: Math.min(MAX_RANGED, 1 + Math.floor(tier / 2)),
    siege: wave > 0 && wave % SIEGE_EVERY === 0 ? 1 : 0,
    statMul: 1 + TIER_STAT_STEP * tier,
  }
}

export type BarracksKind = "melee" | "ranged"

/** Which of each team's barracks are destroyed. Key: `${team}:${lane}:${kind}`. */
export class BarracksState {
  readonly #down = new Set<string>()
  destroy(team: Team, lane: LaneId, kind: BarracksKind) {
    this.#down.add(`${team}:${lane}:${kind}`)
  }
  isDown(team: Team, lane: LaneId, kind: BarracksKind) {
    return this.#down.has(`${team}:${lane}:${kind}`)
  }
  allDown(team: Team) {
    for (const lane of ["top", "mid", "bot"] as const)
      for (const kind of ["melee", "ranged"] as const)
        if (!this.isDown(team, lane, kind)) return false
    return true
  }
}

const enemyOf = (t: Team): Team => (t === "radiant" ? "dire" : "radiant")

/** Template for `attacker`'s `role` creeps in `lane`, from the defender's barracks. */
export const creepTemplate = (
  rax: BarracksState,
  attacker: Team,
  lane: LaneId,
  role: CreepRole,
): CreepTemplate => {
  const def = enemyOf(attacker)
  if (rax.allDown(def)) return "mega"
  const kind: BarracksKind = role === "melee" ? "melee" : "ranged"
  return rax.isDown(def, lane, kind) ? "super" : "normal"
}

// --- object pool ---------------------------------------------------------------------

/**
 * Generic free-list pool for records the caller resets in place (the match pools
 * its full creep bodies with this). `created` stays flat once the pool is warm.
 */
export class RecyclePool<T> {
  readonly #free: T[] = []
  created = 0
  reused = 0
  constructor(private readonly make: () => T) {}
  acquire(): T {
    const x = this.#free.pop()
    if (x !== undefined) {
      this.reused++
      return x
    }
    this.created++
    return this.make()
  }
  release(x: T) {
    this.#free.push(x)
  }
  get available() {
    return this.#free.length
  }
}

export interface PooledCreep {
  id: number
  active: boolean
  team: Team
  lane: LaneId
  role: CreepRole
  template: CreepTemplate
  wave: number
  hp: number
  maxHp: number
  damage: number
  /** Distance along the lane. */
  s: number
}

const BASE_HP: Record<CreepRole, number> = { melee: 550, ranged: 300, siege: 875 }
const BASE_DMG: Record<CreepRole, number> = { melee: 21, ranged: 24, siege: 40 }
export const TEMPLATE_MUL: Readonly<Record<CreepTemplate, { hp: number; dmg: number }>> = {
  normal: { hp: 1, dmg: 1 },
  super: { hp: 1.5, dmg: 1.6 },
  mega: { hp: 2.2, dmg: 2.4 },
}

export class CreepPool {
  readonly #free: PooledCreep[] = []
  #nextId = 1
  created = 0
  reused = 0
  inUse = 0

  constructor(prewarm: number) {
    for (let i = 0; i < prewarm; i++) this.#free.push(this.#make())
  }

  #make(): PooledCreep {
    this.created++
    return {
      id: this.#nextId++,
      active: false,
      team: "radiant",
      lane: "mid",
      role: "melee",
      template: "normal",
      wave: 0,
      hp: 0,
      maxHp: 0,
      damage: 0,
      s: 0,
    }
  }

  acquire(): PooledCreep {
    const c = this.#free.pop()
    if (c) this.reused++
    this.inUse++
    const out = c ?? this.#make()
    out.active = true
    return out
  }

  release(c: PooledCreep) {
    if (!c.active) return
    c.active = false
    this.inUse--
    this.#free.push(c)
  }

  get available() {
    return this.#free.length
  }
}

/** Spawns one wave for one team/lane from the pool (records reset in place). */
export const spawnWave = (
  pool: CreepPool,
  rax: BarracksState,
  team: Team,
  lane: LaneId,
  wave: number,
): PooledCreep[] => {
  const comp = waveComposition(wave)
  const roles: CreepRole[] = [
    ...Array<CreepRole>(comp.melee).fill("melee"),
    ...Array<CreepRole>(comp.ranged).fill("ranged"),
    ...Array<CreepRole>(comp.siege).fill("siege"),
  ]
  return roles.map((role) => {
    const template = creepTemplate(rax, team, lane, role)
    const m = TEMPLATE_MUL[template]
    const c = pool.acquire()
    c.team = team
    c.lane = lane
    c.role = role
    c.template = template
    c.wave = wave
    c.maxHp = BASE_HP[role] * m.hp * comp.statMul
    c.hp = c.maxHp
    c.damage = BASE_DMG[role] * m.dmg * comp.statMul
    c.s = 0
    return c
  })
}
