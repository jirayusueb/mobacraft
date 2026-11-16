/** Coach bar — the five calls with active highlight, remaining time and cooldown sweep. */
import { CALL_COOLDOWN, CALL_DURATION, type CoachCall, type MatchSnapshot } from "@mobacraft/sim"
import { Button, Kbd, Panel, Tooltip, cn } from "@mobacraft/ui"
import { Flag, type LucideIcon, Shield, Skull, Sprout, Users } from "lucide-react"

export const CALLS: readonly {
  id: CoachCall
  label: string
  key: string
  icon: LucideIcon
  hint: string
}[] = [
  {
    id: "group",
    label: "Group up",
    key: "1",
    icon: Users,
    hint: "All five gather and take the next objective together.",
  },
  {
    id: "push",
    label: "Push",
    key: "2",
    icon: Flag,
    hint: "Commit to towers now — accept riskier dives.",
  },
  { id: "roshan", label: "Roshan", key: "3", icon: Skull, hint: "Go kill Roshan for the Aegis." },
  {
    id: "farm",
    label: "Farm",
    key: "4",
    icon: Sprout,
    hint: "Spread out, clear jungle camps, catch up on gold.",
  },
  {
    id: "safe",
    label: "Play safe",
    key: "5",
    icon: Shield,
    hint: "Back off earlier, avoid even fights.",
  },
]

/** Circular sweep drawn behind an icon (0 = empty, 1 = full). */
const Sweep = ({ frac, className }: { frac: number; className?: string }) => {
  const r = 9
  const c = 2 * Math.PI * r
  return (
    <svg
      className={cn("absolute -inset-[5px] -rotate-90", className)}
      viewBox="0 0 24 24"
      aria-hidden
    >
      <circle
        cx={12}
        cy={12}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.18}
        strokeWidth={2}
      />
      <circle
        cx={12}
        cy={12}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.max(0, Math.min(1, frac)))}
        className="transition-[stroke-dashoffset] duration-150 motion-reduce:transition-none"
      />
    </svg>
  )
}

export const CoachBar = ({
  state,
  winner,
  roshanAlive,
  onCall,
}: {
  state: MatchSnapshot["calls"]["blue"]
  winner: boolean
  roshanAlive: boolean
  onCall: (c: CoachCall) => void
}) => {
  const cooling = state.cooldown > 0
  const cdFrac = state.cooldown / CALL_COOLDOWN
  const status = state.active
    ? `${CALLS.find((c) => c.id === state.active)?.label} · ${Math.ceil(state.remaining)}s`
    : cooling
      ? `Next call in ${Math.ceil(state.cooldown)}s`
      : "Call ready"

  return (
    <Panel className="relative flex items-center gap-1 overflow-hidden rounded-full p-1">
      {/* cooldown bar along the pill's bottom edge */}
      {cooling ? (
        <span className="absolute inset-x-4 bottom-0 h-[2px] rounded-full bg-white/5" aria-hidden>
          <span
            className="block h-full rounded-full bg-amber-200/60 transition-[width] duration-150 motion-reduce:transition-none"
            style={{ width: `${(1 - cdFrac) * 100}%` }}
          />
        </span>
      ) : null}
      <span className="px-2.5 text-[10px] font-semibold tracking-[0.2em] text-white/45 uppercase max-md:hidden">
        Coach
      </span>
      {CALLS.map((c) => {
        const active = state.active === c.id
        const Icon = c.icon
        const blockedRosh = c.id === "roshan" && !roshanAlive
        return (
          <Tooltip
            key={c.id}
            label={blockedRosh ? "Roshan is down — wait for the respawn." : c.hint}
            shortcut={c.key}
          >
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "h-10 gap-2 rounded-full px-3",
                active &&
                  "bg-amber-300/20 text-amber-50 shadow-[inset_0_0_0_1px_rgba(252,211,77,0.45)] data-[hovered]:bg-amber-300/25",
              )}
              isDisabled={(cooling && !active) || winner || blockedRosh}
              aria-label={`${c.label}${active ? `, active, ${Math.ceil(state.remaining)} seconds left` : ""}`}
              aria-keyshortcuts={c.key}
              onPress={() => onCall(c.id)}
            >
              <span className="relative grid place-items-center">
                {active ? (
                  <Sweep frac={state.remaining / CALL_DURATION} className="text-amber-300" />
                ) : null}
                <Icon className="size-4!" aria-hidden />
              </span>
              <span className="max-lg:hidden">{c.label}</span>
              {active ? (
                <span className="font-mono text-[11px] tabular-nums text-amber-200">
                  {Math.ceil(state.remaining)}s
                </span>
              ) : (
                <Kbd className="h-4 min-w-4 px-1 text-[9px] opacity-60 max-xl:hidden">{c.key}</Kbd>
              )}
            </Button>
          </Tooltip>
        )
      })}
      <span
        className={cn(
          "flex w-[74px] items-center justify-center gap-1 px-2 text-center font-mono text-[11px] tabular-nums",
          cooling ? "text-white/50" : "text-emerald-200/80",
        )}
        aria-live="off"
        title={status}
      >
        <span className="sr-only">{status}</span>
        <span aria-hidden>{cooling ? `↻ ${Math.ceil(state.cooldown)}s` : "ready"}</span>
      </span>
    </Panel>
  )
}
