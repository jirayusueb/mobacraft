import { Terrain, type Team } from "@mobacraft/map"

/** Hand-picked cozy diorama palette (Quack-ish): warm greens, dusty paths, autumn Dire. */
export const TERRAIN_COLOR: Record<Team, Record<Terrain, number>> = {
  radiant: {
    [Terrain.Water]: 0x4f6f5c,
    [Terrain.Shore]: 0xd8c78f,
    [Terrain.Grass]: 0x86b04a,
    [Terrain.Lane]: 0xc2a46e,
    [Terrain.Plaza]: 0xcfc6ae,
    [Terrain.Forest]: 0x5d8a37,
  },
  dire: {
    [Terrain.Water]: 0x4a5e55,
    [Terrain.Shore]: 0xcdb985,
    [Terrain.Grass]: 0x9a9a4a,
    [Terrain.Lane]: 0xb09468,
    [Terrain.Plaza]: 0x8f8579,
    [Terrain.Forest]: 0x7d7a3a,
  },
}

export const CLIFF = {
  lip: 0x5f7f34,
  soil: 0x7a5a3c,
  soilDark: 0x6a4b33,
  stone: 0x5b5f66,
  stoneDark: 0x4a4e55,
}

export const CANOPY: Record<Team, readonly number[]> = {
  radiant: [0x4f8a3a, 0x5f9b3f, 0x3f7a35, 0x6aa84a, 0x467f33],
  dire: [0xc0612f, 0xd08a34, 0x9a432c, 0x8a8a3a, 0xb8733a],
}
export const TRUNK = 0x5a3e2b

export const TEAM = {
  radiant: { accent: 0x5fe07a, stone: 0xe6dcc3, roof: 0x3f9a5a },
  dire: { accent: 0xff5a3c, stone: 0x6b5a5e, roof: 0x9a2f2a },
  neutral: { accent: 0xb07cff, stone: 0xa89c86, roof: 0x6a4aa0 },
} as const

export const PROP = {
  flower: [0xf2a7c3, 0xfbe9f0, 0xf5d06a, 0xb9a2f0],
  rock: [0x8f9298, 0x7d8087, 0xa3a39e],
  bush: [0x4c7f36, 0x5a8f3c],
} as const

export const BACKGROUND = 0x15181a
