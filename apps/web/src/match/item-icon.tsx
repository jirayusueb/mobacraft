/** Item slots for hero frames — a lucide glyph per item id, with name + cost on hover/focus. */
import { itemById } from "@mobacraft/sim"
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

export const itemText = (id: string) => {
  const it = itemById(id)
  return `${it.name} · ${it.cost.toLocaleString()} gold`
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
