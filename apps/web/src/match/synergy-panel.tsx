/**
 * Draft synergy & counter read-outs (spec/06 §2): a candidate's fit with your picks and
 * matchups against theirs, team synergy meters, and the full 20×20 matrix dialog.
 */
import {
  ALL_HERO_IDS,
  type DraftSide,
  type DraftState,
  HERO_BY_ID,
  TAG_LABEL,
  counterOf,
  heroTags,
  matchup,
  synergy,
  synergyOf,
  teamSynergy,
} from "@mobacraft/sim"
import { Button, cn } from "@mobacraft/ui"
import { Grid3x3, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { HeroGem } from "./ui.tsx"

const tone = (n: number) => (n > 0 ? "text-radiant" : n < 0 ? "text-dire" : "text-white/45")
const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`)

export const TagChips = ({ heroId }: { heroId: string }) => (
  <span className="flex flex-wrap gap-1">
    {heroTags(heroId).map((t) => (
      <span
        key={t}
        className="rounded-md bg-white/[0.07] px-1.5 py-px text-[10px] font-medium text-white/70"
      >
        {TAG_LABEL[t]}
      </span>
    ))}
  </span>
)

/** Candidate vs the current board: one row per allied pick (synergy) and enemy pick (matchup). */
export const CandidateFit = ({
  heroId,
  state,
  you,
}: {
  heroId: string
  state: DraftState
  you: DraftSide
}) => {
  const them: DraftSide = you === "blue" ? "red" : "blue"
  const allies = state.picks[you].map((p) => p.heroId).filter((id) => id !== heroId)
  const enemies = state.picks[them].map((p) => p.heroId)
  if (allies.length === 0 && enemies.length === 0) return null
  const rows = [
    ...allies.map((id) => ({ id, kind: "with" as const, ...synergyOf(heroId, id) })),
    ...enemies.map((id) => {
      const mine = counterOf(heroId, id)
      const theirs = counterOf(id, heroId)
      return {
        id,
        kind: "vs" as const,
        score: mine.score - theirs.score,
        reasons: [...mine.reasons, ...theirs.reasons.map((r) => `They: ${r.toLowerCase()}`)],
      }
    }),
  ].filter((r) => r.score !== 0)
  const total = rows.reduce((s, r) => s + r.score, 0)
  return (
    <div className="mt-2 rounded-lg bg-white/[0.03] p-2 text-[11px]">
      <p className="flex items-center gap-1.5 text-white/55">
        Draft fit{" "}
        <span className={cn("font-semibold tabular-nums", tone(total))}>{signed(total)}</span>
        {rows.length === 0 ? (
          <span className="text-white/40">— neutral with every pick</span>
        ) : null}
      </p>
      <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
        {rows.map((r) => (
          <li
            key={`${r.kind}-${r.id}`}
            className="flex items-center gap-1"
            title={r.reasons.join(" · ")}
          >
            <span className="text-white/40">{r.kind === "with" ? "with" : "vs"}</span>
            <HeroGem heroId={r.id} size={16} />
            <span className={cn("font-semibold tabular-nums", tone(r.score))}>
              {signed(r.score)}
            </span>
            <span className="max-w-44 truncate text-white/50">{r.reasons[0]}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Team synergy 0..15 as a labelled meter. */
export const SynergyMeter = ({ heroIds, label }: { heroIds: readonly string[]; label: string }) => {
  const v = teamSynergy(heroIds)
  return (
    <div className="mt-1" title={`${label}: ${v}/15 — up to +6% ability power in the match`}>
      <div className="flex justify-between text-[10px] tracking-wider text-white/45 uppercase">
        <span>Synergy</span>
        <span className="tabular-nums text-white/75">{v}/15</span>
      </div>
      <meter
        className="mt-0.5 block h-1 w-full [&::-webkit-meter-bar]:rounded-full [&::-webkit-meter-bar]:border-0 [&::-webkit-meter-bar]:bg-white/10 [&::-webkit-meter-optimum-value]:rounded-full [&::-webkit-meter-optimum-value]:bg-amber-300/80"
        aria-label={`${label} team synergy`}
        min={0}
        max={15}
        value={v}
      />
    </div>
  )
}

const cellBg = (n: number, max: number) => {
  if (n === 0) return "transparent"
  const a = Math.min(1, Math.abs(n) / max) * 0.75 + 0.1
  return n > 0 ? `rgba(95,224,122,${a})` : `rgba(255,106,77,${a})`
}

/** Full heatmap dialog: synergy (row with column) or matchup (row vs column). */
export const MatrixDialog = () => {
  const [mode, setMode] = useState<"synergy" | "matchup">("matchup")
  const [focus, setFocus] = useState<[string, string] | null>(null)
  const ids = ALL_HERO_IDS
  const value = (a: string, b: string) => (mode === "synergy" ? synergy(a, b) : matchup(a, b))
  const max = mode === "synergy" ? 3 : 6
  const detail = focus
    ? mode === "synergy"
      ? synergyOf(focus[0], focus[1]).reasons
      : [
          ...counterOf(focus[0], focus[1]).reasons,
          ...counterOf(focus[1], focus[0]).reasons.map((r) => `Reverse: ${r.toLowerCase()}`),
        ]
    : []
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  const close = () => setOpen(false)
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 rounded-full px-2.5 text-[11px]"
        onPress={() => setOpen(true)}
      >
        <Grid3x3 className="size-3.5!" aria-hidden />
        Matrix
      </Button>
      <dialog
        ref={ref}
        onClose={close}
        aria-labelledby="matrix-title"
        className="m-auto max-h-[92vh] w-full max-w-4xl overflow-auto rounded-2xl border border-white/10 bg-neutral-950/95 p-4 text-white shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-sm"
      >
        {open ? (
          <>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 id="matrix-title" className="text-sm font-semibold tracking-tight">
                Synergy &amp; counter matrix
              </h2>
              <div className="flex items-center gap-1">
                {(["matchup", "synergy"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={mode === m}
                    onClick={() => setMode(m)}
                    className={cn(
                      "h-7 rounded-full px-3 text-[11px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-sky-300/90",
                      mode === m ? "bg-white/15 text-white" : "text-white/55 hover:bg-white/[0.06]",
                    )}
                  >
                    {m === "matchup" ? "Row vs column" : "Row with column"}
                  </button>
                ))}
                <Button variant="ghost" size="icon-sm" aria-label="Close" onPress={close}>
                  <X />
                </Button>
              </div>
            </div>
            <p className="mb-2 text-[11px] text-white/55">
              {mode === "matchup"
                ? "Green: the row hero has the edge over the column hero (±8% damage in fights)."
                : "Green: the pair works well together (team synergy, up to +6% ability power)."}{" "}
              Tags are derived from each hero's abilities.
            </p>
            <div className="overflow-auto">
              <table className="border-separate border-spacing-px text-[10px]">
                <thead>
                  <tr>
                    <th scope="col">
                      <span className="sr-only">Hero</span>
                    </th>
                    {ids.map((id) => (
                      <th key={id} scope="col" className="p-0">
                        <span className="sr-only">{HERO_BY_ID.get(id)?.name}</span>
                        <HeroGem heroId={id} size={22} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ids.map((a) => (
                    <tr key={a}>
                      <th
                        scope="row"
                        className="pr-1 text-right font-medium whitespace-nowrap text-white/70"
                      >
                        {HERO_BY_ID.get(a)?.name}
                      </th>
                      {ids.map((b) => {
                        const v = a === b ? 0 : value(a, b)
                        const on = focus?.[0] === a && focus?.[1] === b
                        return (
                          <td key={b} className="p-0">
                            <button
                              type="button"
                              disabled={a === b}
                              onClick={() => setFocus([a, b])}
                              aria-label={`${HERO_BY_ID.get(a)?.name} ${mode === "matchup" ? "versus" : "with"} ${HERO_BY_ID.get(b)?.name}: ${signed(v)}`}
                              className={cn(
                                "grid size-[22px] place-items-center rounded-[3px] font-semibold tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-sky-300/90",
                                a === b ? "bg-white/[0.03]" : "hover:ring-1 hover:ring-white/50",
                                on && "ring-2 ring-white",
                              )}
                              style={{ background: a === b ? undefined : cellBg(v, max) }}
                            >
                              {v === 0 || a === b ? "" : signed(v)}
                            </button>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div
              className="mt-3 min-h-12 rounded-lg bg-white/[0.04] p-2 text-[11px] text-white/70"
              aria-live="polite"
            >
              {focus ? (
                <div className="flex flex-wrap items-center gap-2">
                  <HeroGem heroId={focus[0]} size={20} />
                  <span className="font-semibold">{HERO_BY_ID.get(focus[0])?.name}</span>
                  <TagChips heroId={focus[0]} />
                  <span className="text-white/40">{mode === "matchup" ? "vs" : "with"}</span>
                  <HeroGem heroId={focus[1]} size={20} />
                  <span className="font-semibold">{HERO_BY_ID.get(focus[1])?.name}</span>
                  <TagChips heroId={focus[1]} />
                  <span className="basis-full text-white/55">
                    {detail.length ? detail.join(" · ") : "No interaction between their tags."}
                  </span>
                </div>
              ) : (
                "Select a cell to see why."
              )}
            </div>
          </>
        ) : null}
      </dialog>
    </>
  )
}
