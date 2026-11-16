/** Announcer — one big centred banner at a time for the match's headline moments. */
import type { DraftSide } from "@mobacraft/sim"
import { cn } from "@mobacraft/ui"
import {
  Castle,
  Droplet,
  Flame,
  Hourglass,
  type LucideIcon,
  ShieldPlus,
  Siren,
  Skull,
  Swords,
  TowerControl,
} from "lucide-react"
import { useEffect, useState } from "react"
import type { Banner, BannerKind } from "./hud-data.ts"
import { HeroGem } from "./ui.tsx"

const ICON: Record<BannerKind, LucideIcon> = {
  "first-blood": Droplet,
  multi: Flame,
  tower: TowerControl,
  rax: Castle,
  roshan: Skull,
  aegis: ShieldPlus,
  wipe: Swords,
  ancient: Siren,
  phase: Hourglass,
}

/** Visible time per banner; shortened when more are waiting. */
const SHOW_MS = 2600
const SHOW_MS_BUSY = 1500
const OUT_MS = 280
const MAX_QUEUE = 4

/** Add banners to a queue, keeping the most important when it overflows. */
export const enqueue = (queue: readonly Banner[], add: readonly Banner[]): Banner[] => {
  if (add.length === 0) return queue as Banner[]
  const [head, ...rest] = queue
  const pending = [...rest, ...add]
  const kept =
    pending.length <= MAX_QUEUE
      ? pending
      : pending
          .toSorted((a, b) => b.priority - a.priority || a.id - b.id)
          .slice(0, MAX_QUEUE)
          .toSorted((a, b) => a.id - b.id)
  return head ? [head, ...kept] : kept
}

export const Announcer = ({
  queue,
  you,
  onDone,
}: {
  queue: readonly Banner[]
  you: DraftSide
  /** Called when the head banner has finished its exit. */
  onDone: (id: number) => void
}) => {
  const current = queue[0]
  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-[17%] flex justify-center px-4"
      aria-live="polite"
      aria-atomic="true"
    >
      {current ? (
        <BannerCard
          key={current.id}
          banner={current}
          you={you}
          busy={queue.length > 1}
          onDone={onDone}
        />
      ) : null}
    </div>
  )
}

const BannerCard = ({
  banner: current,
  you,
  busy,
  onDone,
}: {
  banner: Banner
  you: DraftSide
  busy: boolean
  onDone: (id: number) => void
}) => {
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    const show = busy ? SHOW_MS_BUSY : SHOW_MS
    const a = setTimeout(() => setLeaving(true), show)
    const b = setTimeout(() => onDone(current.id), show + OUT_MS)
    return () => {
      clearTimeout(a)
      clearTimeout(b)
    }
  }, [current, busy, onDone])

  const tone = current.side === "neutral" ? "neutral" : current.side === you ? "ally" : "enemy"
  const Icon = ICON[current.kind]

  return (
    <div
      className={cn(
        "relative flex max-w-[min(36rem,92vw)] items-center gap-4 overflow-hidden rounded-2xl border px-6 py-3 shadow-[0_18px_48px_-12px_rgba(0,0,0,0.7)] backdrop-blur-xl",
        "bg-neutral-950/70",
        tone === "ally" && "border-radiant/40",
        tone === "enemy" && "border-dire/40",
        tone === "neutral" && "border-violet-300/35",
        leaving
          ? "animate-out fade-out zoom-out-95 fill-mode-forwards duration-300"
          : "animate-in fade-in zoom-in-90 slide-in-from-top-3 duration-300 ease-out",
        "motion-reduce:animate-none motion-reduce:transition-none",
        leaving && "motion-reduce:opacity-0",
      )}
    >
      {/* team wash */}
      <span
        className={cn(
          "absolute inset-0 -z-10 opacity-60",
          tone === "ally" && "bg-[linear-gradient(100deg,rgba(95,224,122,0.28),transparent_65%)]",
          tone === "enemy" && "bg-[linear-gradient(100deg,rgba(255,106,77,0.28),transparent_65%)]",
          tone === "neutral" &&
            "bg-[linear-gradient(100deg,rgba(183,148,255,0.28),transparent_65%)]",
        )}
        aria-hidden
      />
      <span className="relative shrink-0">
        {current.heroId ? (
          <HeroGem heroId={current.heroId} size={48} />
        ) : (
          <span
            className={cn(
              "grid size-12 place-items-center rounded-xl ring-1 ring-white/15 ring-inset",
              tone === "ally" && "bg-radiant/20 text-radiant",
              tone === "enemy" && "bg-dire/20 text-dire",
              tone === "neutral" && "bg-violet-400/20 text-violet-200",
            )}
          >
            <Icon className="size-6" aria-hidden />
          </span>
        )}
        {current.heroId ? (
          <span className="absolute -right-1.5 -bottom-1.5 grid size-6 place-items-center rounded-full bg-neutral-950 ring-1 ring-white/20">
            <Icon className="size-3.5 text-amber-200" aria-hidden />
          </span>
        ) : null}
      </span>
      <span className="min-w-0">
        <span
          className={cn(
            "block text-[10px] font-semibold tracking-[0.28em] uppercase",
            tone === "ally" && "text-radiant",
            tone === "enemy" && "text-dire",
            tone === "neutral" && "text-violet-200",
          )}
        >
          {tone === "ally" ? "Your team" : tone === "enemy" ? "Opponent" : "Neutral"}
        </span>
        <span className="block text-3xl leading-tight font-black tracking-tight text-white uppercase drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)] max-md:text-2xl">
          {current.title}
        </span>
        <span className="block truncate text-[13px] text-white/75">{current.detail}</span>
      </span>
    </div>
  )
}
