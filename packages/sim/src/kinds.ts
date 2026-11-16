import type { CampKind, Team } from "@mobacraft/map"

/** Lane creep roles. Every wave is 3 melee + 1 ranged; every 5th wave adds a siege engine. */
export type LaneRole = "melee" | "ranged" | "siege"
export type LaneCreepKind = `${Team}-${LaneRole}`

/** Neutral creeps, grouped by the camp size they live in (classic Dota roster, simplified). */
export const NEUTRALS_BY_CAMP = {
  small: ["kobold", "kobold-foreman", "fell-spirit", "ghost"],
  medium: ["wolf", "alpha-wolf", "satyr", "satyr-trickster"],
  large: ["centaur", "centaur-khan", "hellbear", "hellbear-smasher"],
  ancient: ["black-drake", "black-dragon", "rock-golem", "granite-golem"],
} as const satisfies Record<CampKind, readonly string[]>

export type NeutralKind = (typeof NEUTRALS_BY_CAMP)[CampKind][number]

/** Every creature the game can show. Model kits implement exactly this set. */
export type CreatureKind = LaneCreepKind | NeutralKind | "roshan"

export const LANE_CREEP_KINDS: readonly LaneCreepKind[] = [
  "radiant-melee",
  "radiant-ranged",
  "radiant-siege",
  "dire-melee",
  "dire-ranged",
  "dire-siege",
]

export const ALL_CREATURE_KINDS: readonly CreatureKind[] = [
  ...LANE_CREEP_KINDS,
  ...Object.values(NEUTRALS_BY_CAMP).flat(),
  "roshan",
]

export const CREATURE_NAME: Record<CreatureKind, string> = {
  "radiant-melee": "Radiant Melee Creep",
  "radiant-ranged": "Radiant Ranged Creep",
  "radiant-siege": "Radiant Catapult",
  "dire-melee": "Dire Melee Creep",
  "dire-ranged": "Dire Ranged Creep",
  "dire-siege": "Dire Catapult",
  kobold: "Kobold",
  "kobold-foreman": "Kobold Foreman",
  "fell-spirit": "Fell Spirit",
  ghost: "Ghost",
  wolf: "Giant Wolf",
  "alpha-wolf": "Alpha Wolf",
  satyr: "Satyr Mindstealer",
  "satyr-trickster": "Satyr Trickster",
  centaur: "Centaur Courser",
  "centaur-khan": "Centaur Conqueror",
  hellbear: "Hellbear",
  "hellbear-smasher": "Hellbear Smasher",
  "black-drake": "Black Drake",
  "black-dragon": "Black Dragon",
  "rock-golem": "Rock Golem",
  "granite-golem": "Granite Golem",
  roshan: "Roshan",
}
