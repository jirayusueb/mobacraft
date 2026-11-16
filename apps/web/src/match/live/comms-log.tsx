/** Comms log — your side's shotcalling: coach relays, IGL calls, "no caller alive" (spec/06 §5). */
import type { DraftSide, MatchSnapshot } from "@mobacraft/sim"
import { cn } from "@mobacraft/ui"
import { Crown, Megaphone, RadioTower } from "lucide-react"
import { commsText, noCallerAlive } from "../hud-data.ts"
import { clockText } from "../ui.tsx"

const SHOWN = 4

export const CommsLog = ({ snap, you }: { snap: MatchSnapshot; you: DraftSide }) => {
  const mine = snap.comms.filter((c) => c.side === you).slice(-SHOWN)
  const silent = noCallerAlive(snap.heroes, you)
  const igl = snap.iglCall[you]
  return (
    <section
      aria-label="Team comms"
      className="pointer-events-none absolute bottom-[14.5rem] left-4 flex w-80 flex-col gap-1 max-lg:hidden"
    >
      <h2 className="flex items-center gap-1.5 text-[9.5px] font-semibold tracking-[0.2em] text-white/45 uppercase">
        <RadioTower className="size-3" aria-hidden /> Comms
        {igl ? (
          <span className="ml-auto rounded bg-white/10 px-1.5 tracking-wider text-white/70 normal-case">
            IGL call · {Math.ceil(igl.remaining)} s
          </span>
        ) : null}
      </h2>
      {silent ? (
        <output className="block rounded-lg border border-amber-300/30 bg-neutral-950/60 px-2 py-1 text-[11px] text-amber-200 backdrop-blur-xl">
          No caller alive — calls wait for the first respawn
        </output>
      ) : null}
      <ol className="flex flex-col gap-1" aria-live="polite">
        {mine.length === 0 ? (
          <li className="text-[11px] text-white/35">No calls yet.</li>
        ) : (
          mine.map((c, i) => (
            <li
              // oxlint-disable-next-line react/no-array-index-key -- append-only log
              key={`${c.t}-${i}`}
              className={cn(
                "flex items-start gap-1.5 rounded-lg border border-white/10 bg-neutral-950/55 px-2 py-1 text-[11px] leading-snug backdrop-blur-xl",
                i < mine.length - 1 && "opacity-65",
              )}
            >
              <span className="w-8 shrink-0 font-mono text-[10px] tabular-nums text-white/40">
                {clockText(c.t)}
              </span>
              {c.from === "coach" ? (
                <Megaphone className="mt-0.5 size-3 shrink-0 text-sky-200" aria-hidden />
              ) : (
                <Crown className="mt-0.5 size-3 shrink-0 text-amber-200" aria-hidden />
              )}
              <span className={cn("min-w-0", !c.caller && "text-amber-200")}>
                {commsText(c, snap.heroes)}
              </span>
            </li>
          ))
        )}
      </ol>
    </section>
  )
}
