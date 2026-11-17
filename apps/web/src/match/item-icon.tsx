/** Item slots for hero frames — a lucide glyph per item id, with name + cost on hover/focus. */
import { lookupItem } from "@mobacraft/sim"
import { cn } from "@mobacraft/ui"
import {
  BookOpen,
  BowArrow,
  Droplet,
  Footprints,
  Heart,
  type LucideIcon,
  MoonStar,
  Package,
  Shield,
  ShieldHalf,
  Sword,
  WandSparkles,
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
}

/** Items with painted icons in `public/items/<id>.webp`; others keep the lucide glyph. */
const ITEM_ART: ReadonlySet<string> = new Set(Object.keys(ITEM_ICON))

/**
 * Hover text for an item. Never throws: an id the catalogue does not know yet
 * (new item families land in the sim before the HUD) falls back to the raw id
 * instead of crashing the whole match screen.
 */
/** Display name for an item id; unknown ids fall back to the id (never throws). */
export const itemName = (id: string): string => {
  try {
    return lookupItem(id).name
  } catch {
    return id
  }
}

export const itemText = (id: string) => {
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
export const ItemSlot = ({ id, size = 18 }: { id: string | undefined; size?: number }) => {
  if (!id) {
    return (
      <span
        className="inline-block shrink-0 rounded-[5px] border border-dashed border-white/10"
        style={{ width: size, height: size }}
        aria-hidden
      />
    )
  }
  if (ITEM_ART.has(id))
    return (
      <span
        className="relative inline-block shrink-0 overflow-hidden rounded-[5px] bg-[#1c1d22] ring-1 ring-white/10 ring-inset"
        style={{ width: size, height: size }}
        title={itemText(id)}
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
      </span>
    )
  const Icon = ITEM_ICON[id] ?? Package
  return (
    <span
      className="inline-grid shrink-0 place-items-center rounded-[5px] bg-white/[0.09] ring-1 ring-white/10 ring-inset"
      style={{ width: size, height: size }}
      title={itemText(id)}
      aria-hidden
    >
      <Icon
        className={cn(ITEM_TINT[id] ?? "text-white/70")}
        style={{ width: size * 0.62, height: size * 0.62 }}
        strokeWidth={2.25}
      />
    </span>
  )
}
