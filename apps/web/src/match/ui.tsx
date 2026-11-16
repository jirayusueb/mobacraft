/** Small shared pieces for the Match Day screens. */
import { HERO_BY_ID, type Role, type TeamDef } from "@mobacraft/sim"
import { cn } from "@mobacraft/ui"
import { Crosshair, Leaf, Shield, Sparkles, Swords, type LucideIcon } from "lucide-react"
import { useState } from "react"

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

/** Portrait art lives in `public/heroes/<id>.webp` (256px, low-poly toy style). */
const portraitUrl = (heroId: string) => `${import.meta.env.BASE_URL}heroes/${heroId}.webp`

/**
 * Hero token: the hero's portrait over a gradient in their palette.
 * Small tokens zoom toward the face so they stay recognisable at 16–24px;
 * if the image fails to load the original gem-with-initials shows instead.
 */
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
  const [failed, setFailed] = useState(false)
  const h = HERO_BY_ID.get(heroId)
  if (!h) return null
  const initials = h.name.slice(0, 2)
  const zoom = size <= 24 ? 1.5 : size <= 40 ? 1.25 : 1.08
  if (!failed)
    return (
      <span
        className={cn(
          "relative inline-block shrink-0 overflow-hidden rounded-xl ring-1 ring-white/15 ring-inset",
          dim && "opacity-35 grayscale",
          className,
        )}
        style={{
          width: size,
          height: size,
          background: `linear-gradient(140deg, ${hex(h.look.accent)} 0%, ${hex(h.look.body)} 100%)`,
        }}
        aria-hidden
      >
        <img
          src={portraitUrl(heroId)}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailed(true)}
          className="absolute inset-0 size-full object-cover"
          style={{ transform: `scale(${zoom})`, transformOrigin: "50% 30%" }}
        />
      </span>
    )
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

/** Team emblem from `public/teams/<id>.webp`; falls back to the coloured tag badge. */
export const TeamCrest = ({ team, size = 36 }: { team: TeamDef; size?: number }) => {
  const [failed, setFailed] = useState(false)
  if (!failed)
    return (
      <span
        className="relative inline-block shrink-0 overflow-hidden rounded-xl ring-1 ring-white/20 ring-inset"
        style={{ width: size, height: size, background: hex(team.color) }}
        aria-hidden
      >
        <img
          src={`${import.meta.env.BASE_URL}teams/${team.id}.webp`}
          alt=""
          width={size}
          height={size}
          decoding="async"
          draggable={false}
          onError={() => setFailed(true)}
          className="absolute inset-0 size-full object-cover"
        />
      </span>
    )
  return (
    <span
      className="inline-grid shrink-0 place-items-center rounded-xl font-black tracking-tight text-black/80 ring-1 ring-white/20 ring-inset"
      style={{ width: size, height: size, background: hex(team.color), fontSize: size * 0.32 }}
      aria-hidden
    >
      {team.tag}
    </span>
  )
}

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
