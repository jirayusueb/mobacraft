import type { MobaMap } from "@mobacraft/map"
import { ALL_CREATURE_KINDS, LANE_CREEP_KINDS } from "@mobacraft/sim"
import {
  Castle,
  Droplets,
  Gem,
  KeyRound,
  type LucideIcon,
  PawPrint,
  Shield,
  Skull,
  Sparkles,
  Store,
  Swords,
  TowerControl,
} from "lucide-react"
import { KIND_LABEL, LANE_LABEL, t } from "../strings.ts"

export type TeamId = "radiant" | "dire" | "neutral"

/** Everything the HUD shows about one pickable thing on the map. */
export interface Entity {
  readonly id: string
  /** Pick kind as reported by the engine (camps are `camp-<size>`). */
  readonly kind: string
  readonly team: TeamId
  readonly name: string
  readonly lane?: string
  readonly tier?: number
  readonly position: { readonly x: number; readonly z: number }
}

export const KIND_ICON: Record<string, LucideIcon> = {
  ancient: Gem,
  tower: TowerControl,
  "barracks-melee": Swords,
  "barracks-ranged": Shield,
  fountain: Droplets,
  shop: Store,
  "secret-shop": KeyRound,
  roshan: Skull,
  "creature:roshan": Skull,
  "radiant-siege": Shield,
  "dire-siege": Shield,
  rune: Sparkles,
  "camp-small": PawPrint,
  "camp-medium": PawPrint,
  "camp-large": PawPrint,
  "camp-ancient": PawPrint,
}
export const iconFor = (kind: string): LucideIcon =>
  KIND_ICON[kind] ?? (CREEP_KINDS.has(kind) ? Swords : NEUTRAL_KINDS.has(kind) ? PawPrint : Castle)

const CREEP_KINDS = new Set(LANE_CREEP_KINDS as readonly string[])
const NEUTRAL_KINDS = new Set(
  ALL_CREATURE_KINDS.filter((k) => !CREEP_KINDS.has(k)) as readonly string[],
)

/**
 * Entity for a picked creature. Creatures move and aren't in the static index,
 * so the card is built from the pick itself; the camera follows it instead of a fixed grid.
 */
export const creatureEntity = (picked: {
  id: string
  kind: string
  team: string
  name?: string
}): Entity | null =>
  picked.id.startsWith("creature-")
    ? {
        id: picked.id,
        // "roshan" is also the pit landmark's kind; keep the creature's copy distinct.
        kind: picked.kind === "roshan" ? "creature:roshan" : picked.kind,
        team: asTeam(picked.team),
        name: picked.name ?? picked.kind,
        position: { x: Number.NaN, z: Number.NaN },
      }
    : null

export const teamName = (team: TeamId) => t(`team.${team}`)

export const TEAM_TEXT: Record<TeamId, string> = {
  radiant: "text-radiant",
  dire: "text-dire",
  neutral: "text-neutral-team",
}
export const TEAM_BG: Record<TeamId, string> = {
  radiant: "bg-radiant",
  dire: "bg-dire",
  neutral: "bg-neutral-team",
}

const asTeam = (s: string): TeamId => (s === "radiant" || s === "dire" ? s : "neutral")

/** Index every structure, camp and landmark by id, with a player-facing name. */
export const indexEntities = (map: MobaMap): ReadonlyMap<string, Entity> => {
  const out = new Map<string, Entity>()
  const sideAt = (x: number, z: number): TeamId => {
    const i = Math.floor(z) * map.size + Math.floor(x)
    return map.side[i] === 1 ? "dire" : "radiant"
  }
  for (const s of map.structures) {
    const label = KIND_LABEL[s.kind] ?? s.kind
    const lane = s.lane ? LANE_LABEL[s.lane] : undefined
    const team = asTeam(s.team)
    const name =
      s.kind === "tower"
        ? `Tier ${s.tier ?? 1} Tower · ${lane ?? "Base"}`
        : s.kind === "barracks-melee" || s.kind === "barracks-ranged"
          ? `${label} · ${lane ?? "Base"}`
          : s.kind === "secret-shop"
            ? `${label} · ${teamName(sideAt(s.position.x, s.position.z))} side`
            : team === "neutral"
              ? label
              : `${teamName(team)} ${label}`
    out.set(s.id, {
      id: s.id,
      kind: s.kind,
      team,
      name,
      ...(lane ? { lane } : {}),
      ...(s.tier ? { tier: s.tier } : {}),
      position: s.position,
    })
  }
  for (const c of map.camps) {
    const kind = `camp-${c.kind}`
    out.set(c.id, {
      id: c.id,
      kind,
      team: c.team,
      name: `${KIND_LABEL[kind] ?? kind} · ${teamName(c.team)} jungle`,
      position: c.position,
    })
  }
  for (const l of map.landmarks) {
    const label = KIND_LABEL[l.kind] ?? l.kind
    const river = l.position.x + l.position.z < map.size ? "Top" : "Bot"
    out.set(l.id, {
      id: l.id,
      kind: l.kind,
      team: "neutral",
      name: l.kind === "rune" ? `${label} · ${river} river` : label,
      position: l.position,
    })
  }
  return out
}
