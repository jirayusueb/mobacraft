/** §3a — lane assignments, click-to-swap, and per-lane matchup preview. */
import {
  LANE_SLOTS,
  type LanePreview,
  type LaneSlot,
  type TeamTactics,
  lanePreview,
  laneOfSlot,
  masteryOf,
  swapPlayers,
  swapSides,
} from "@mobacraft/sim"
import { Button, cn } from "@mobacraft/ui"
import { ArrowLeftRight, Repeat } from "lucide-react"
import { useMemo, useState } from "react"
import { HeroGem, ROLE_ICON, ROLE_LABEL } from "../ui.tsx"
import { Section, Select, focusRing } from "./controls.tsx"
import { COPY } from "./copy.ts"
import { type SectionProps, heroIdOf, heroName, setPlayer, teamOf } from "./shared.ts"

const SLOT_OPTIONS = LANE_SLOTS.map((s) => ({ value: s, label: COPY.slots[s] }))

const VERDICT_STYLE: Record<LanePreview["verdict"], string> = {
  favoured: "border-radiant/45 bg-radiant/[0.08] text-radiant",
  even: "border-white/20 bg-white/[0.05] text-white/80",
  unfavoured: "border-dire/45 bg-dire/[0.08] text-dire",
}

const LANE_NAME: Record<LanePreview["lane"], string> = { top: "Top", mid: "Mid", bot: "Bot" }

export const LanesSection = ({
  draft,
  you,
  tactics,
  update,
  announce,
  theirs,
}: SectionProps & { theirs: TeamTactics }) => {
  const [pending, setPending] = useState<string | null>(null)
  const team = teamOf(draft, you)
  const them = you === "blue" ? "red" : "blue"
  const preview = useMemo(
    () => lanePreview(draft, you, tactics, theirs),
    [draft, you, tactics, theirs],
  )

  const pickForSwap = (id: string) => {
    if (pending === null) {
      setPending(id)
      const p = team.players.find((x) => x.id === id)
      if (p) announce(COPY.swapPending(p.name))
      return
    }
    if (pending === id) {
      setPending(null)
      return
    }
    const a = team.players.find((x) => x.id === pending)
    const b = team.players.find((x) => x.id === id)
    update((t) => swapPlayers(t, pending, id))
    setPending(null)
    if (a && b) announce(COPY.swapDone(a.name, b.name))
  }

  const safeLane = laneOfSlot("safe", you)!
  const offLane = laneOfSlot("off", you)!

  return (
    <div className="grid min-h-0 grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] gap-3 max-md:grid-cols-1">
      <Section title={COPY.rosterHeading} hint={COPY.swapHint}>
        <div className="mb-2 flex items-center gap-2">
          <p className="min-w-0 flex-1 text-[11px] font-medium text-sky-200">
            {pending
              ? COPY.swapPending(team.players.find((p) => p.id === pending)?.name ?? "")
              : null}
          </p>
          <Button
            size="sm"
            onPress={() => {
              update(swapSides)
              setPending(null)
              announce(COPY.swapSides)
            }}
          >
            <Repeat className="size-3.5!" aria-hidden />
            {COPY.swapSides}
          </Button>
        </div>
        <ul className="flex flex-col gap-1.5">
          {team.players.map((p) => {
            const pt = tactics.players[p.id]
            const heroId = heroIdOf(draft, you, p.id)
            const RoleIcon = ROLE_ICON[p.role]
            const selected = pending === p.id
            if (!pt) return null
            return (
              <li
                key={p.id}
                className={cn(
                  "flex items-center gap-2 rounded-xl border p-1.5 transition-colors motion-reduce:transition-none",
                  selected
                    ? "border-sky-300/70 bg-sky-300/10"
                    : "border-white/[0.06] bg-white/[0.02]",
                )}
              >
                <button
                  type="button"
                  aria-pressed={selected}
                  aria-label={COPY.selectForSwap(p.name, heroName(heroId), COPY.slots[pt.slot])}
                  onClick={() => pickForSwap(p.id)}
                  className={cn(
                    "flex min-w-0 flex-1 items-center gap-2 rounded-lg p-0.5 text-left hover:bg-white/[0.05]",
                    focusRing,
                  )}
                >
                  {heroId ? <HeroGem heroId={heroId} size={36} /> : null}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-semibold text-white">
                      {p.name}
                    </span>
                    <span className="flex items-center gap-1 truncate text-[11px] text-white/55">
                      <RoleIcon className="size-3 shrink-0" aria-hidden />
                      {ROLE_LABEL[p.role]} · {heroName(heroId)}
                      {heroId ? (
                        <span className="text-white/40">
                          {Math.round(masteryOf(p, heroId) * 100)}%
                        </span>
                      ) : null}
                    </span>
                  </span>
                  <ArrowLeftRight
                    className={cn("size-3.5 shrink-0", selected ? "text-sky-200" : "text-white/30")}
                    aria-hidden
                  />
                </button>
                <Select<LaneSlot>
                  label={COPY.slotLabel(p.name)}
                  value={pt.slot}
                  options={SLOT_OPTIONS}
                  onChange={(slot) => update((t) => setPlayer(t, p, (x) => ({ ...x, slot })))}
                  className="w-[104px]"
                />
              </li>
            )
          })}
        </ul>
        <p className="mt-2 text-[10.5px] text-white/45">
          {COPY.sideLanes(LANE_NAME[safeLane], LANE_NAME[offLane])}
        </p>
      </Section>

      <Section title={COPY.matchupHeading} hint={COPY.matchupHint}>
        <ul className="flex flex-col gap-2">
          {preview.map((l) => (
            <li
              key={l.slot}
              className={cn("rounded-xl border px-3 py-2", VERDICT_STYLE[l.verdict])}
              aria-label={`${COPY.slots[l.slot]}: ${COPY.verdict[l.verdict]}, ${COPY.score} ${l.score}`}
            >
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-semibold text-white">
                  {COPY.slots[l.slot]}
                  <span className="ml-1 font-normal text-white/45">({LANE_NAME[l.lane]})</span>
                </span>
                <span className="ml-auto rounded-md bg-black/30 px-1.5 py-0.5 text-[11px] font-bold tracking-wide uppercase">
                  {COPY.verdict[l.verdict]}
                </span>
                <span className="w-10 text-right text-[12px] font-semibold tabular-nums">
                  {l.score > 0 ? "+" : ""}
                  {l.score.toFixed(1)}
                </span>
              </div>
              <div className="mt-1.5 flex items-center gap-2" aria-hidden>
                <GemRow ids={l.ours} label={COPY.ours} />
                <span className="text-[10px] font-semibold text-white/40 uppercase">{COPY.vs}</span>
                <GemRow ids={l.theirs} label={COPY.theirs} end />
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[10.5px] text-white/45">
          {COPY.predictedNote(teamOf(draft, them).name)}
        </p>
      </Section>
    </div>
  )
}

const GemRow = ({ ids, label, end }: { ids: readonly string[]; label: string; end?: boolean }) => (
  <span className={cn("flex min-w-0 flex-1 items-center gap-1.5", end && "flex-row-reverse")}>
    <span className="text-[9.5px] font-semibold tracking-wider text-white/40 uppercase">
      {label}
    </span>
    {ids.length === 0 ? (
      <span className="text-[11px] text-white/35 italic">{COPY.emptyLane}</span>
    ) : (
      ids.map((id) => (
        <span key={id} className="flex items-center gap-1" title={heroName(id)}>
          <HeroGem heroId={id} size={26} />
          <span className="truncate text-[11px] text-white/75">{heroName(id)}</span>
        </span>
      ))
    )}
  </span>
)
