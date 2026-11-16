import { Terrain, type Team } from "@mobacraft/map"

/** Hand-picked cozy diorama palette (Quack-ish): warm greens, dusty paths, autumn Dire. */
export const TERRAIN_COLOR: Record<Team, Record<Terrain, number>> = {
  // Muted olive meadow (Quack), not lime: grading noise in terrain.ts adds warm/cool/dry variance.
  radiant: {
    [Terrain.Water]: 0x4f6f5c,
    [Terrain.Shore]: 0xcdb98a,
    [Terrain.Grass]: 0x8fa048,
    [Terrain.Lane]: 0xbfa274,
    [Terrain.Plaza]: 0xcbc2ab,
    [Terrain.Forest]: 0x6e8a3c,
  },
  dire: {
    [Terrain.Water]: 0x4a5e55,
    [Terrain.Shore]: 0xc4ae80,
    [Terrain.Grass]: 0x9d9348,
    [Terrain.Lane]: 0xad9068,
    [Terrain.Plaza]: 0x928878,
    [Terrain.Forest]: 0x80763a,
  },
}

export const CLIFF = {
  lip: 0x6e7f3a,
  soil: 0x6b4a32,
  soilDark: 0x5a3d2a,
  stone: 0x4a4440,
  stoneDark: 0x3a3532,
}

/** Ground grading targets mixed by low-frequency noise in the terrain shader. */
export const GROUND_GRADE = { warm: 0xa7b455, cool: 0x6e8a3c, dry: 0xb9ae6a } as const

export const CANOPY: Record<Team, readonly number[]> = {
  radiant: [0x557f38, 0x628f3e, 0x46713a, 0x6e9a48, 0x4d7634],
  dire: [0xb0603a, 0xc08a3e, 0x8f4a32, 0x8a843e, 0xa8723f],
}
export const TRUNK = 0x5a3e2b

export const TEAM = {
  radiant: {
    accent: 0x5fe07a,
    stone: 0xece5d3,
    stoneDark: 0xc9bea4,
    roof: 0x4f7a4a,
    roofDark: 0x38583a,
    wood: 0x8a6a48,
    cloth: 0xe8f6e4,
    /** Lime-washed wall panels between timber framing. */
    plaster: 0xf4efe2,
    /** Roof horns / spikes (Dire only, but every team carries the key). */
    spike: 0xd8ccb0,
  },
  dire: {
    accent: 0xff5a3c,
    stone: 0x5e4f52,
    stoneDark: 0x433a3d,
    roof: 0x8a3a2e,
    roofDark: 0x5a231d,
    wood: 0x3e2d29,
    cloth: 0x2a1c1c,
    plaster: 0x7a6662,
    spike: 0xcfc1a4,
  },
  neutral: {
    accent: 0xb07cff,
    stone: 0xa89c86,
    stoneDark: 0x8a8070,
    roof: 0x6a4aa0,
    roofDark: 0x4e3678,
    wood: 0x7a5a3c,
    cloth: 0xe6dcf6,
    plaster: 0xe2d8c2,
    spike: 0xd8ccb0,
  },
} as const

export const WINDOW = 0xffd27a

export const PROP = {
  flower: [0xf2a7c3, 0xfbe9f0, 0xf5d06a, 0xb9a2f0],
  rock: [0x8f9298, 0x7d8087, 0xa3a39e],
  bush: [0x4c7f36, 0x5a8f3c],
} as const

export const BACKGROUND = 0x15181a
