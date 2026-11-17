/**
 * Crowd hull radii per unit (playtest fix: melee "blob").
 *
 * The crowd layer used one radius for every hero (0.4) while the rendered models
 * span 0.66–1.50 tiles wide, so big bodies visually stacked even though the sim saw
 * no overlap. These values are half the measured model footprints (min floors keep
 * small units from slipping through gaps), so what overlaps on screen overlaps in
 * the sim too. Sim-only data; the engine never reads it.
 */
import type { CreatureKind, HeroId } from "../kinds.ts"

export const HERO_HULL: Readonly<Record<HeroId, number>> = {
  ironwarden: 0.48,
  ashbringer: 0.44,
  gravejaw: 0.61,
  thornmaw: 0.57,
  hollowfang: 0.75,
  duskblade: 0.4,
  vexlash: 0.45,
  grimfeather: 0.44,
  ivyshade: 0.4,
  bonecaller: 0.4,
  embercall: 0.4,
  frostveil: 0.4,
  stormcaller: 0.4,
  voidmother: 0.4,
  lumenmaid: 0.4,
  mossmother: 0.4,
  chainwarden: 0.61,
  hexweaver: 0.4,
  rootfather: 0.58,
  goreclaw: 0.52,
}

const NEUTRAL_HULL: Readonly<Record<string, number>> = {
  kobold: 0.3,
  "kobold-foreman": 0.31,
  "fell-spirit": 0.3,
  ghost: 0.3,
  wolf: 0.54,
  "alpha-wolf": 0.7,
  satyr: 0.3,
  "satyr-trickster": 0.3,
  centaur: 0.63,
  "centaur-khan": 0.72,
  hellbear: 0.5,
  "hellbear-smasher": 0.65,
  "black-drake": 0.92,
  "black-dragon": 1.2,
  "rock-golem": 0.63,
  "granite-golem": 0.94,
}

/** Crowd radius of any unit kind. */
export const hullOf = (kind: CreatureKind | HeroId | "structure"): number =>
  kind === "roshan"
    ? 1.4
    : kind.toString().includes("siege")
      ? 0.45
      : kind in HERO_HULL
        ? HERO_HULL[kind as HeroId]!
        : kind in NEUTRAL_HULL
          ? NEUTRAL_HULL[kind]!
          : 0.4
