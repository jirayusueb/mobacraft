/**
 * Live tactics drawer (toggle T) — spec/06 §1, §3, §6 during the match:
 * phase plans (relayed by the IGL, 20 s team cooldown), per-player standing
 * orders (free, no cooldown), live lane swaps (laning only, 60 s cooldown),
 * shop timing / spike, and ward priority. Values are read back from the sim
 * (`match.tactics(you)`) on every HUD refresh.
 */
import {
  type DraftSide,
  type Match,
  type MatchSnapshot,
  PHASES,
  type Phase,
  type TargetPriority,
  TARGET_PRIORITIES,
  type TeamTactics,
  type VisionZone,
} from "@mobacraft/sim"
import { Button, Slider, cn, glass } from "@mobacraft/ui"
import { ArrowDown, ArrowLeftRight, ArrowUp, X } from "lucide-react"
import { useState } from "react"
import { PHASE_LABEL } from "../../strings.ts"
import { Select, Switch } from "../tactics-board/controls.tsx"
import { COPY } from "../tactics-board/copy.ts"
import { HeroGem } from "../ui.tsx"

const PLAN_OPTIONS: Record<Phase, readonly string[]> = {
  laning: ["standard", "aggressive", "roam", "scale"],
  mid: ["group", "split", "pickoff", "farm"],
  late: ["siege", "roshan", "defend"],
}
const planCopy = (phase: Phase, plan: string): readonly [string, string] =>
  (COPY[phase] as Record<string, readonly [string, string]>)[plan] ?? [plan, ""]

const SLIDERS = ["aggression", "farm", "ultDiscipline"] as const
const TARGET_OPTIONS = TARGET_PRIORITIES.map((t) => ({ value: t, label: COPY.targets[t] }))

const H3 = ({ children }: { children: React.ReactNode }) => (
  <h3 className="mb-1.5 text-[10px] font-semibold tracking-[0.16em] text-white/55 uppercase">
    {children}
  </h3>
)

export const TacticsDrawer = ({
  match,
  snap,
  tactics,
  you,
  onChange,
  onClose,
}: {
  match: Match
  snap: MatchSnapshot
  tactics: TeamTactics
  you: DraftSide
  /** Ask the HUD to re-read snapshot + tactics now. */
  onChange: () => void
  onClose: () => void
}) => {
  const [pending, setPending] = useState<Partial<Record<Phase, string>>>({})
  const [swapA, setSwapA] = useState<string | null>(null)
  const [status, setStatus] = useState("")
  const mine = snap.heroes.filter((h) => h.side === you)
  const planCd = snap.planCooldown[you]
  const swapCd = snap.swapCooldown[you]
  const swapBlocked =
    snap.winner !== null
      ? "The match is over."
      : snap.phase !== "laning"
        ? "Lane swaps are only possible during the laning phase."
        : swapCd > 0
          ? `Lane swap ready in ${Math.ceil(swapCd)} s.`
          : null
  const nameOf = (pid: string) => mine.find((h) => h.playerId === pid)?.playerName ?? pid

  const choosePlan = (phase: Phase, plan: string) => {
    if (tactics.plans[phase] === plan) return
    if (match.setPlan(you, phase, plan)) {
      setPending((p) => ({ ...p, [phase]: plan }))
      setStatus(`${PHASE_LABEL[phase]} plan → ${planCopy(phase, plan)[0]}: relayed by your IGL.`)
    } else setStatus(`Plan change on cooldown (${Math.ceil(planCd)} s).`)
    onChange()
  }

  const pickSwap = (pid: string) => {
    if (swapBlocked) return
    if (!swapA) {
      setSwapA(pid)
      setStatus(COPY.swapPending(nameOf(pid)))
      return
    }
    if (swapA === pid) {
      setSwapA(null)
      setStatus("Swap cancelled.")
      return
    }
    const ok = match.swapLanes(you, swapA, pid)
    setStatus(ok ? COPY.swapDone(nameOf(swapA), nameOf(pid)) : "Swap not allowed right now.")
    setSwapA(null)
    onChange()
  }

  const moveZone = (i: number, d: -1 | 1) => {
    const v = [...tactics.vision]
    const j = i + d
    if (j < 0 || j >= v.length) return
    ;[v[i], v[j]] = [v[j]!, v[i]!]
    match.setTeamTactics(you, { vision: v })
    setStatus(COPY.moved(COPY.zones[v[j] as VisionZone][0], j + 1))
    onChange()
  }

  return (
    <section
      aria-label="Live tactics"
      className={cn(
        "pointer-events-auto rounded-2xl",
        glass,
        "flex max-h-[calc(100vh-11rem)] w-[min(26rem,calc(100vw-2rem))] flex-col overflow-hidden",
      )}
    >
      <header className="flex items-center gap-2 border-b border-white/[0.07] px-3 py-2">
        <h2 className="text-[12px] font-semibold tracking-[0.18em] text-white/80 uppercase">
          Live tactics
        </h2>
        <span className="text-[10.5px] text-white/45">
          Sliders are standing orders — no cooldown
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto"
          aria-label="Close live tactics"
          aria-keyshortcuts="T"
          onPress={onClose}
        >
          <X />
        </Button>
      </header>
      <output className="sr-only" aria-live="polite">
        {status}
      </output>
      <div className="flex flex-col gap-4 overflow-y-auto px-3 py-2.5 text-[11.5px]">
        {/* plans */}
        <section aria-label="Phase plans">
          <H3>
            Phase plans{" "}
            <span className="font-normal tracking-normal text-white/40 normal-case">
              {planCd > 0 ? `· next change in ${Math.ceil(planCd)} s` : "· relayed by your IGL"}
            </span>
          </H3>
          <div className="flex flex-col gap-1.5">
            {PHASES.map((ph) => {
              const cur = tactics.plans[ph]
              const want = pending[ph] !== cur ? pending[ph] : undefined
              return (
                <fieldset
                  key={ph}
                  className={cn(
                    "rounded-lg border border-white/[0.07] px-2 py-1.5",
                    ph === snap.phase && "border-white/20 bg-white/[0.03]",
                  )}
                >
                  <legend className="px-1 text-[10.5px] text-white/60">
                    {COPY.plansHeading[ph]}
                    {ph === snap.phase ? " · now" : ""}
                    {want ? ` · relaying ${planCopy(ph, want)[0]}…` : ""}
                  </legend>
                  <div className="flex flex-wrap gap-1">
                    {PLAN_OPTIONS[ph].map((plan) => {
                      const [label, hint] = planCopy(ph, plan)
                      const on = cur === plan
                      return (
                        <Button
                          key={plan}
                          variant="ghost"
                          size="sm"
                          className={cn(
                            "h-7 rounded-md px-2 text-[11px]",
                            on && "bg-white/85 text-neutral-950 data-[hovered]:bg-white",
                            want === plan && "ring-1 ring-white/40",
                          )}
                          aria-pressed={on}
                          aria-description={hint}
                          isDisabled={!on && (planCd > 0 || snap.winner !== null)}
                          onPress={() => choosePlan(ph, plan)}
                        >
                          {label}
                        </Button>
                      )
                    })}
                  </div>
                </fieldset>
              )
            })}
          </div>
        </section>

        {/* lane swap */}
        <section aria-label="Lane swap">
          <H3>
            Lane swap{" "}
            <span className="font-normal tracking-normal text-white/40 normal-case">
              · {swapBlocked ?? (swapA ? COPY.swapPending(nameOf(swapA)) : COPY.swapHint)}
            </span>
          </H3>
          <ul className="flex flex-wrap gap-1">
            {mine.map((h) => (
              <li key={h.id}>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-8 gap-1.5 rounded-lg border border-white/10 px-1.5 text-[11px]",
                    swapA === h.playerId && "border-sky-300/70 bg-sky-300/15",
                  )}
                  isDisabled={swapBlocked !== null}
                  aria-pressed={swapA === h.playerId}
                  aria-label={COPY.selectForSwap(h.playerName, h.heroName, COPY.slots[h.slot])}
                  onPress={() => pickSwap(h.playerId)}
                >
                  <HeroGem heroId={h.heroId} size={18} className="rounded-md" />
                  {h.playerName}
                  <span className="text-white/45">{COPY.slotShort[h.slot]}</span>
                </Button>
              </li>
            ))}
            {swapA ? (
              <li>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 rounded-lg px-2 text-[11px]"
                  onPress={() => setSwapA(null)}
                >
                  <ArrowLeftRight className="size-3.5!" aria-hidden /> Cancel
                </Button>
              </li>
            ) : null}
          </ul>
        </section>

        {/* behaviour */}
        <section aria-label="Player behaviour">
          <H3>Standing orders</H3>
          <ul className="flex flex-col gap-2">
            {mine.map((h) => {
              const pt = tactics.players[h.playerId]
              if (!pt) return null
              return (
                <li key={h.id} className="rounded-lg border border-white/[0.06] px-2 py-1.5">
                  <div className="mb-0.5 flex items-center gap-1.5">
                    <HeroGem heroId={h.heroId} size={18} className="rounded-md" />
                    <span className="font-semibold">{h.playerName}</span>
                    <span className="text-white/45">{h.heroName}</span>
                    <Select<TargetPriority>
                      label={COPY.targetLabel(h.playerName)}
                      value={pt.behavior.target}
                      options={TARGET_OPTIONS}
                      className="ml-auto h-7 text-[11px]"
                      onChange={(target) => {
                        match.setBehavior(you, h.playerId, { target })
                        onChange()
                      }}
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-2.5">
                    {SLIDERS.map((k) => (
                      <Slider
                        key={k}
                        label={COPY[k]}
                        aria-label={`${COPY[k]} for ${h.playerName}`}
                        minValue={0}
                        maxValue={100}
                        step={5}
                        value={pt.behavior[k]}
                        onChange={(v) => {
                          match.setBehavior(you, h.playerId, { [k]: v })
                          onChange()
                        }}
                        className="gap-0 text-[10.5px]"
                      />
                    ))}
                  </div>
                </li>
              )
            })}
          </ul>
        </section>

        {/* items */}
        <section aria-label="Itemization">
          <H3>{COPY.shopHeading}</H3>
          <div className="flex flex-col gap-2">
            <Select
              label={COPY.shopHeading}
              value={tactics.shopTiming}
              options={(["on-item", "on-low"] as const).map((v) => ({
                value: v,
                label: `${COPY.shopTiming[v][0]} — ${COPY.shopTiming[v][1]}`,
              }))}
              className="w-full"
              onChange={(shopTiming) => {
                match.setTeamTactics(you, { shopTiming })
                onChange()
              }}
            />
            <Switch
              label={COPY.spike}
              checked={tactics.spike}
              onChange={(spike) => {
                match.setTeamTactics(you, { spike })
                onChange()
              }}
            >
              <span>
                {COPY.spike}
                <span className="block text-[10.5px] text-white/45">{COPY.spikeHint}</span>
              </span>
            </Switch>
          </div>
        </section>

        {/* vision */}
        <section aria-label={COPY.visionHeading}>
          <H3>{COPY.visionHeading}</H3>
          <ol className="flex flex-col gap-1">
            {tactics.vision.map((z, i) => (
              <li
                key={z}
                className="flex items-center gap-1.5 rounded-lg border border-white/[0.06] px-2 py-1"
              >
                <span className="w-4 font-mono text-white/40 tabular-nums">{i + 1}</span>
                <span className="flex-1">{COPY.zones[z][0]}</span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={COPY.moveUp(COPY.zones[z][0])}
                  isDisabled={i === 0}
                  onPress={() => moveZone(i, -1)}
                >
                  <ArrowUp />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={COPY.moveDown(COPY.zones[z][0])}
                  isDisabled={i === tactics.vision.length - 1}
                  onPress={() => moveZone(i, 1)}
                >
                  <ArrowDown />
                </Button>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </section>
  )
}
