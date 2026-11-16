/**
 * TeamKnowledge — spec/08 §3, the strict information-isolation layer.
 * Hero AI and coach code read the enemy ONLY through this module: live
 * references while the fog lights them, frozen GhostSnapshots once they
 * step into the dark. Truth stays inside match.ts.
 */
import type { Team, Vec2 } from "@mobacraft/map"
import { type FogStatic, type TeamFog, isVisibleToTeam } from "./fog.ts"

export interface GhostSnapshot {
  readonly id: string
  /** Sim tick of the last recompute that lit this unit. */
  lastSeenTick: number
  pos: Vec2
  vel: Vec2
  hpFrac: number
  level: number
  itemsAtSeen: readonly string[]
}

export interface KnowledgeUnit {
  id: string
  pos: Vec2
  vel: Vec2
  hpFrac: number
  level: number
  items: readonly string[]
  alive: boolean
}

export class TeamKnowledge {
  readonly team: Team
  readonly #fog: TeamFog
  readonly #staticFog: FogStatic
  readonly #ghosts = new Map<string, GhostSnapshot>()
  /** Live references for units the fog lights this tick (truth from the match). */
  readonly #live = new Map<string, KnowledgeUnit>()

  constructor(team: Team, fog: TeamFog, staticFog: FogStatic) {
    this.team = team
    this.#fog = fog
    this.#staticFog = staticFog
  }

  /** Called by the match at the top of each tick for every enemy unit. */
  observe(unit: KnowledgeUnit, tick: number): void {
    if (!unit.alive || !isVisibleToTeam(this.#fog, this.#staticFog, unit.pos)) return
    this.#live.set(unit.id, unit)
    const g = this.#ghosts.get(unit.id)
    if (g) {
      g.lastSeenTick = tick
      g.pos = unit.pos
      g.vel = unit.vel
      g.hpFrac = unit.hpFrac
      g.level = unit.level
      g.itemsAtSeen = unit.items
    } else {
      this.#ghosts.set(unit.id, {
        id: unit.id,
        lastSeenTick: tick,
        pos: unit.pos,
        vel: unit.vel,
        hpFrac: unit.hpFrac,
        level: unit.level,
        itemsAtSeen: unit.items,
      })
    }
  }

  /** Live enemy reference — only valid while the fog lights it. */
  visible(id: string): KnowledgeUnit | undefined {
    return this.#live.get(id)
  }

  allVisible(): readonly KnowledgeUnit[] {
    return [...this.#live.values()]
  }

  /** Frozen last-known state; `lastSeenTick` stops advancing when the unit goes dark. */
  ghost(id: string): GhostSnapshot | undefined {
    return this.#ghosts.get(id)
  }

  clearTick(): void {
    this.#live.clear()
  }

  /** Sanity accessor for tests/debug: does this team's fog light `p` right now? */
  lit(p: Vec2): boolean {
    return isVisibleToTeam(this.#fog, this.#staticFog, p)
  }

  get ghostCount(): number {
    return this.#ghosts.size
  }
}
