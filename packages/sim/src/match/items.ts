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
  /** Fraction of magic damage ignored, e.g. 0.2. */
  readonly magicResist?: number
  /** Magic resist granted to the holder and allies within 6 tiles (one per team counts). */
  readonly auraMagicResist?: number
  /** Basic attacks can't miss (pierces Evasion). */
  readonly trueStrike?: boolean
  /** The first engage ability each fight reaches 10 tiles. */
  readonly blink?: boolean
  /** Lost when the holder dies. */
  readonly dropOnDeath?: boolean
  /** Seconds of Spell Immunity when a fight starts (60 s cooldown). */
  readonly spellImmunity?: number
  /** Max mana (spec/09). */
  readonly mana?: number
  /** Mana regen per second (spec/09). */
  readonly manaRegen?: number
  /** Activated ability, fired by Hero Think's combat layer (spec/09 L3). */
  readonly active?: { readonly kind: ItemActive; readonly cooldown: number }
}

export type ItemActive = "bkb" | "blink" | "force" | "eul"

export const ITEMS: readonly Item[] = [
  { id: "boots", name: "Wanderer's Boots", cost: 400, speed: 0.35 },
  { id: "blade", name: "Gravesteel Blade", cost: 1100, damage: 22 },
  { id: "bow", name: "Whisperwood Bow", cost: 1200, damage: 14, attackSpeed: 0.25 },
  { id: "fang", name: "Vampire Fang", cost: 1300, damage: 14, lifesteal: 0.15 },
  { id: "plate", name: "Barrow Plate", cost: 1150, hp: 220, armor: 5 },
  { id: "heart", name: "Treant Heart", cost: 1500, hp: 420 },
  { id: "tome", name: "Ember Tome", cost: 1200, power: 0.25, mana: 100 },
  { id: "staff", name: "Voidglass Staff", cost: 1600, power: 0.35, hp: 120, mana: 200 },
  { id: "charm", name: "Moon Charm", cost: 900, hp: 150, power: 0.12, mana: 150 },
  {
    id: "aegis-cloak",
    name: "Warden's Cloak",
    cost: 1400,
    hp: 260,
    armor: 4,
    power: 0.1,
    mana: 100,
  },
  { id: "nullstone", name: "Nullstone Amulet", cost: 1300, hp: 150, magicResist: 0.2 },
  // Situational items bought by the rule engine (spec/07 §4b, builds.ts).
  { id: "pipe", name: "Pipe of Insight", cost: 1700, hp: 150, auraMagicResist: 0.25 },
  {
    id: "blink",
    name: "Blink Dagger",
    cost: 1600,
    blink: true,
    active: { kind: "blink", cooldown: 14 },
  },
  { id: "mkb", name: "Monkey King Bar", cost: 2200, damage: 30, trueStrike: true },
  { id: "rapier", name: "Divine Rapier", cost: 3600, damage: 110, dropOnDeath: true },
  {
    id: "bkb",
    name: "Black King Bar",
    cost: 2400,
    damage: 10,
    hp: 100,
    spellImmunity: 6,
    active: { kind: "bkb", cooldown: 60 },
  },
  // Hero Think defensive actives (spec/09).
  {
    id: "force",
    name: "Force Staff",
    cost: 1500,
    hp: 150,
    manaRegen: 1,
    active: { kind: "force", cooldown: 20 },
  },
  {
    id: "eul",
    name: "Eul's Scepter",
    cost: 1650,
    manaRegen: 1.5,
    power: 0.1,
    active: { kind: "eul", cooldown: 25 },
  },
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
