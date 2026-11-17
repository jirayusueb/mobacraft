/** Item slots for hero frames — a lucide glyph per item id, with name + cost on hover/focus. */
import { lookupItem } from "@mobacraft/sim"
import { cn } from "@mobacraft/ui"
import {
  BookOpen,
  BowArrow,
  CircleDot,
  Clover,
  Crosshair,
  Diamond,
  Droplet,
  Dumbbell,
  Eye,
  EyeOff,
  Feather,
  Flame,
  Footprints,
  Gem,
  Ghost,
  Heart,
  type LucideIcon,
  MoonStar,
  Orbit,
  Package,
  Shield,
  ShieldHalf,
  Sparkles,
  Sprout,
  Star,
  Swords,
  Sword,
  Target,
  TreePine,
  WandSparkles,
  Wind,
  Zap,
} from "lucide-react"

export const ITEM_ICON: Readonly<Record<string, LucideIcon>> = {
  boots: Footprints,
  blade: Sword,
  bow: BowArrow,
  fang: Droplet,
  plate: ShieldHalf,
  heart: Heart,
  tome: BookOpen,
  staff: WandSparkles,
  charm: MoonStar,
  "aegis-cloak": Shield,
  // components
  steel: Swords,
  plating: Dumbbell,
  orb: CircleDot,
  // situational / actives (spec/10)
  nullstone: Diamond,
  pipe: Orbit,
  blink: Zap,
  mkb: Crosshair,
  bkb: Gem,
  rapier: Star,
  force: Wind,
  eul: Feather,
  manta: Ghost,
  glimmer: EyeOff,
  tango: TreePine,
  // neutral drops
  "n-trinket": Sparkles,
  "n-charm-luck": Clover,
  "n-belt-vigor": Heart,
  "n-grove-veil": Sprout,
  "n-psi-blade": Sword,
  "n-vampire-fang": Droplet,
  "n-spy-goggles": Eye,
  "n-stone-guard": Shield,
  "n-apex-power": Flame,
  "n-seer-stone": Target,
  // slot-free buffs
  "aghs-blessing": Sparkles,
  "moon-shard": MoonStar,
}

/** Tint per item so a row of six reads at a glance. */
const ITEM_TINT: Readonly<Record<string, string>> = {
  boots: "text-amber-200",
  blade: "text-slate-100",
  bow: "text-lime-200",
  fang: "text-rose-300",
  plate: "text-sky-200",
  heart: "text-emerald-300",
  tome: "text-orange-300",
  staff: "text-violet-300",
  charm: "text-indigo-200",
  "aegis-cloak": "text-cyan-200",
  steel: "text-zinc-300",
  plating: "text-slate-300",
  orb: "text-violet-200",
  nullstone: "text-fuchsia-200",
  pipe: "text-teal-200",
  blink: "text-sky-300",
  mkb: "text-amber-300",
  bkb: "text-yellow-300",
  rapier: "text-orange-200",
  force: "text-cyan-300",
  eul: "text-sky-100",
  manta: "text-blue-300",
  glimmer: "text-purple-300",
  tango: "text-green-300",
  "aghs-blessing": "text-sky-300",
  "moon-shard": "text-indigo-300",
}

/** Items with painted icons in `public/items/<id>.webp`; others keep the lucide glyph. */
const ITEM_ART: ReadonlySet<string> = new Set([
  "boots",
  "blade",
  "bow",
  "fang",
  "plate",
  "heart",
  "tome",
  "staff",
  "charm",
  "aegis-cloak",
])

/**
 * Hover text for an item. Never throws: an id the catalogue does not know yet
 * (new item families land in the sim before the HUD) falls back to the raw id
 * instead of crashing the whole match screen.
 */
/** Display name for an item id; unknown ids fall back to the id (never throws). */
export const BUFF_NAME: Readonly<Record<string, string>> = {
  "aghs-blessing": "Aghanim's Blessing",
  "moon-shard": "Moon Shard (consumed)",
}

export const itemName = (id: string): string => {
  if (BUFF_NAME[id]) return BUFF_NAME[id]
  try {
    return lookupItem(id).name
  } catch {
    return id
  }
}

export const itemText = (id: string) => {
  if (BUFF_NAME[id]) return `${BUFF_NAME[id]} · permanent, no slot`
  try {
    const it = lookupItem(id)
    return `${it.name} · ${it.cost.toLocaleString()} gold`
  } catch {
    return id
  }
}

/**
 * One inventory slot. Uses the native `title` tooltip so a column of 30 slots
 * doesn't add 30 tab stops; the full inventory is spelled out on the hero
 * button's accessible name instead.
 */
export const ItemSlot = ({
  id,
  size = 18,
  dim = false,
  muteLeft = 0,
}: {
  id: string | null | undefined
  size?: number
  /** Inert zone (backpack/stash/courier): drawn faded. */
  dim?: boolean
  /** Backpack-swap mute seconds left (spec/10): grey overlay + countdown. */
  muteLeft?: number
}) => {
  if (!id) {
    return (
      <span
        className="inline-block shrink-0 rounded-[5px] border border-dashed border-white/10"
        style={{ width: size, height: size }}
        aria-hidden
      />
    )
  }
  const title = muteLeft > 0 ? `${itemText(id)} · muted ${Math.ceil(muteLeft)} s` : itemText(id)
  const overlay =
    muteLeft > 0 ? (
      <span className="absolute inset-0 grid place-items-center bg-neutral-950/70 text-[8px] leading-none font-bold tabular-nums text-white/90">
        {Math.ceil(muteLeft)}
      </span>
    ) : null
  if (ITEM_ART.has(id))
    return (
      <span
        className={cn(
          "relative inline-block shrink-0 overflow-hidden rounded-[5px] bg-[#1c1d22] ring-1 ring-white/10 ring-inset",
          dim && "opacity-45 grayscale",
        )}
        style={{ width: size, height: size }}
        title={title}
        aria-hidden
      >
        <img
          src={`${import.meta.env.BASE_URL}items/${id}.webp`}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          draggable={false}
          className="absolute inset-0 size-full scale-110 object-cover"
        />
        {overlay}
      </span>
    )
  const Icon = ITEM_ICON[id] ?? Package
  return (
    <span
      className={cn(
        "relative inline-grid shrink-0 place-items-center rounded-[5px] bg-white/[0.09] ring-1 ring-white/10 ring-inset",
        id.startsWith("n-") && "ring-emerald-300/40",
        dim && "opacity-45",
      )}
      style={{ width: size, height: size }}
      title={title}
      aria-hidden
    >
      <Icon
        className={cn(
          ITEM_TINT[id] ?? (id.startsWith("n-") ? "text-emerald-200" : "text-white/70"),
        )}
        style={{ width: size * 0.62, height: size * 0.62 }}
        strokeWidth={2.25}
      />
      {overlay}
    </span>
  )
}
