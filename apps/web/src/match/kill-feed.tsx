/** Kill feed — killer → victim with hero gems; objectives and calls get an icon instead. */
import type { DraftSide, FeedEntry, HeroLine } from "@mobacraft/sim"
import { cn } from "@mobacraft/ui"
import {
  ArrowLeftRight,
  ChevronRight,
  Crown,
  Castle,
  Droplet,
  EyeOff,
  Hourglass,
  type LucideIcon,
  Megaphone,
  ShieldPlus,
  Skull,
  TowerControl,
} from "lucide-react"
import { aegisCarrier, parseAegis, parseKill } from "./hud-data.ts"
import { HeroGem, clockText } from "./ui.tsx"

const KIND_ICON: Partial<Record<FeedEntry["kind"], LucideIcon>> = {
  tower: TowerControl,
  rax: Castle,
  roshan: Skull,
  aegis: ShieldPlus,
  call: Megaphone,
  ancient: Crown,
  phase: Hourglass,
  ward: EyeOff,
  swap: ArrowLeftRight,
}

const Who = ({ h }: { h: HeroLine }) => (
  <span className="flex min-w-0 items-center gap-1">
    <HeroGem heroId={h.heroId} size={20} className="rounded-md" />
    <span className="truncate font-semibold">{h.playerName}</span>
  </span>
)

const FeedRow = ({
  f,
  heroes,
  you,
}: {
  f: FeedEntry
  heroes: readonly HeroLine[]
  you: DraftSide
}) => {
  const kill = parseKill(f, heroes)
  const tone = f.side === "neutral" ? "neutral" : f.side === you ? "ally" : "enemy"
  const Icon = KIND_ICON[f.kind]
  const subject = f.kind === "roshan" ? aegisCarrier(f, heroes) : parseAegis(f, heroes)
  return (
    <li
      className={cn(
        "flex animate-in items-center gap-1.5 rounded-lg border border-white/10 bg-neutral-950/60 px-2 py-1 text-[11.5px] backdrop-blur-xl duration-300 fade-in slide-in-from-right-2 motion-reduce:animate-none",
        "border-l-2",
        tone === "ally" && "border-l-radiant",
        tone === "enemy" && "border-l-dire",
        tone === "neutral" && "border-l-violet-400",
        (f.kind === "call" || f.kind === "swap" || f.kind === "ward") &&
          "bg-neutral-950/40 text-white/60",
        (f.kind === "phase" || f.kind === "time-warning") &&
          "font-semibold tracking-wide text-white/90",
        f.kind === "ancient" && "py-1.5 text-[13px] font-semibold",
      )}
    >
      <span className="w-8 shrink-0 font-mono text-[10px] tabular-nums text-white/40">
        {clockText(f.t)}
      </span>
      {kill && (kill.killer || kill.victim) ? (
        <>
          <span className="sr-only">{f.text}</span>
          <span className="flex min-w-0 flex-1 items-center gap-1" aria-hidden>
            {f.kind === "first-blood" ? (
              <Droplet className="size-3.5 shrink-0 text-rose-300" />
            ) : null}
            {kill.killer ? <Who h={kill.killer} /> : <Skull className="size-3.5 text-white/40" />}
            <ChevronRight
              className={cn(
                "size-3.5 shrink-0",
                tone === "ally" ? "text-radiant" : tone === "enemy" ? "text-dire" : "text-white/50",
              )}
            />
            {kill.victim ? (
              <span className="min-w-0 opacity-70">
                <Who h={kill.victim} />
              </span>
            ) : null}
          </span>
        </>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          {subject ? (
            <HeroGem heroId={subject.heroId} size={20} className="rounded-md" />
          ) : Icon ? (
            <Icon
              className={cn(
                "size-3.5 shrink-0",
                f.kind === "roshan" || f.kind === "aegis" ? "text-violet-300" : "text-white/55",
              )}
              aria-hidden
            />
          ) : null}
          <span className="min-w-0">{f.text}</span>
        </span>
      )}
    </li>
  )
}

export const KillFeed = ({
  feed,
  heroes,
  you,
}: {
  feed: readonly FeedEntry[]
  heroes: readonly HeroLine[]
  you: DraftSide
}) => (
  <ol
    className="pointer-events-none absolute top-24 right-4 flex w-72 flex-col gap-1 max-lg:hidden"
    aria-live="polite"
    aria-label="Match feed"
  >
    {feed
      .slice(-6)
      .toReversed()
      .map((f) => (
        <FeedRow key={`${f.t}-${f.text}`} f={f} heroes={heroes} you={you} />
      ))}
  </ol>
)
