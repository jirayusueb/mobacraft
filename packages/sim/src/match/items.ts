/** Items — bought automatically from a role-based build order when a hero is at base or has gold to spare. */
import type { Role } from "./heroes.ts"

export interface Item {
  readonly id: string
  readonly name: string
  readonly cost: number
  readonly hp?: number
  readonly damage?: number
  readonly armor?: number
  /** Fraction, e.g. 0.15 = +15%. */
  readonly attackSpeed?: number
  readonly speed?: number
  /** Multiplies ability damage and healing. */
  readonly power?: number
  readonly lifesteal?: number
}

export const ITEMS: readonly Item[] = [
  { id: "boots", name: "Wanderer's Boots", cost: 400, speed: 0.35 },
  { id: "blade", name: "Gravesteel Blade", cost: 1100, damage: 22 },
  { id: "bow", name: "Whisperwood Bow", cost: 1200, damage: 14, attackSpeed: 0.25 },
  { id: "fang", name: "Vampire Fang", cost: 1300, damage: 14, lifesteal: 0.15 },
  { id: "plate", name: "Barrow Plate", cost: 1150, hp: 220, armor: 5 },
  { id: "heart", name: "Treant Heart", cost: 1500, hp: 420 },
  { id: "tome", name: "Ember Tome", cost: 1200, power: 0.25 },
  { id: "staff", name: "Voidglass Staff", cost: 1600, power: 0.35, hp: 120 },
  { id: "charm", name: "Moon Charm", cost: 900, hp: 150, power: 0.12 },
  { id: "aegis-cloak", name: "Warden's Cloak", cost: 1400, hp: 260, armor: 4, power: 0.1 },
]

export const itemById = (id: string): Item => {
  const i = ITEMS.find((x) => x.id === id)
  if (!i) throw new Error(`Unknown item ${id}`)
  return i
}

export const BUILD: Readonly<Record<Role, readonly string[]>> = {
  carry: ["boots", "bow", "blade", "fang", "blade", "heart"],
  mid: ["boots", "tome", "charm", "staff", "tome", "heart"],
  offlane: ["boots", "plate", "heart", "blade", "aegis-cloak", "plate"],
  jungle: ["boots", "fang", "plate", "blade", "heart", "blade"],
  support: ["boots", "charm", "aegis-cloak", "tome", "heart", "staff"],
}

export const MAX_ITEMS = 6
