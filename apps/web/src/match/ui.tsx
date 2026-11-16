/** Small shared pieces for the Match Day screens. */
import { HERO_BY_ID, type Role, type TeamDef } from "@mobacraft/sim"
import { cn } from "@mobacraft/ui"
import { Crosshair, Leaf, Shield, Sparkles, Swords, type LucideIcon } from "lucide-react"

export const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`

export const ROLE_ICON: Record<Role, LucideIcon> = {
  carry: Crosshair,
  mid: Sparkles,
  offlane: Shield,
  jungle: Leaf,
  support: Swords,
}
export const ROLE_LABEL: Record<Role, string> = {
  carry: "Carry",
  mid: "Mid",
  offlane: "Offlane",
  jungle: "Jungle",
  support: "Support",
}

/** Hero token: a faceted gem in the hero's palette with initials — stands in for a portrait. */
export const HeroGem = ({
  heroId,
  size = 40,
  dim = false,
  className,
}: {
  heroId: string
  size?: number
  dim?: boolean
  className?: string
}) => {
  const h = HERO_BY_ID.get(heroId)
  if (!h) return null
  const initials = h.name.slice(0, 2)
  return (
    <span
      className={cn(
        "relative inline-grid shrink-0 place-items-center overflow-hidden rounded-xl ring-1 ring-white/15 ring-inset",
        dim && "opacity-35 grayscale",
        className,
      )}
      style={{
        width: size,
        height: size,
        background: `linear-gradient(140deg, ${hex(h.look.accent)} 0%, ${hex(h.look.body)} 58%, #0c0b10 100%)`,
      }}
      aria-hidden
    >
      <span
        className="absolute inset-[22%] rotate-45 rounded-[3px] opacity-80"
        style={{ background: hex(h.look.glow), boxShadow: `0 0 ${size / 3}px ${hex(h.look.glow)}` }}
      />
      <span
        className="relative text-[11px] font-bold tracking-tight text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]"
        style={{ fontSize: size * 0.3 }}
      >
        {initials}
      </span>
    </span>
  )
}

export const TeamCrest = ({ team, size = 36 }: { team: TeamDef; size?: number }) => (
  <span
    className="inline-grid shrink-0 place-items-center rounded-xl font-black tracking-tight text-black/80 ring-1 ring-white/20 ring-inset"
    style={{ width: size, height: size, background: hex(team.color), fontSize: size * 0.32 }}
    aria-hidden
  >
    {team.tag}
  </span>
)

/** 1..20 rating as a small bar. */
export const Rating = ({ value, label }: { value: number; label: string }) => (
  <span
    className="flex items-center gap-1.5 text-[10px] text-white/55"
    title={`${label} ${value}/20`}
  >
    <span className="w-9 uppercase tracking-wider">{label}</span>
    <span className="h-1 w-12 overflow-hidden rounded-full bg-white/10">
      <span
        className="block h-full rounded-full bg-white/70"
        style={{ width: `${(value / 20) * 100}%` }}
      />
    </span>
    <span className="w-4 text-right tabular-nums text-white/75">{value}</span>
  </span>
)

export const clockText = (seconds: number) => {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, "0")}`
}
