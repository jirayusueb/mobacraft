/** §3c vision priority, §5 IGL picker, §6 behaviour sliders. */
import { TARGET_PRIORITIES, type TargetPriority, type VisionZone } from "@mobacraft/sim"
import { Slider, cn } from "@mobacraft/ui"
import { ChevronDown, ChevronUp, Crown, Eye } from "lucide-react"
import { useRef } from "react"
import { HeroGem, ROLE_LABEL } from "../ui.tsx"
import { Section, Select, focusRing } from "./controls.tsx"
import { COPY } from "./copy.ts"
import {
  type SectionProps,
  followChance,
  heroIdOf,
  heroName,
  relayDelay,
  setPlayer,
  teamOf,
} from "./shared.ts"

// --- vision ------------------------------------------------------------------------

export const VisionSection = ({ tactics, update, announce }: SectionProps) => {
  const refs = useRef(new Map<string, HTMLButtonElement | null>())
  const move = (zone: VisionZone, dir: -1 | 1) => {
    const i = tactics.vision.indexOf(zone)
    const j = i + dir
    if (i < 0 || j < 0 || j >= tactics.vision.length) return
    update((t) => {
      const v = [...t.vision]
      const a = v.indexOf(zone)
      const b = a + dir
      if (a < 0 || b < 0 || b >= v.length) return t
      ;[v[a], v[b]] = [v[b]!, v[a]!]
      return { ...t, vision: v }
    })
    announce(COPY.moved(COPY.zones[zone][0], j + 1))
    // Keep focus on the same control after the row moves; fall back to the other arrow at the ends.
    requestAnimationFrame(() => {
      const atEdge = j === 0 || j === tactics.vision.length - 1
      const key = `${zone}:${atEdge ? -dir : dir}`
      refs.current.get(key)?.focus()
    })
  }
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)] gap-3 max-md:grid-cols-1">
      <Section title={COPY.visionHeading} hint={COPY.visionHint}>
        <ol className="flex flex-col gap-1.5">
          {tactics.vision.map((zone, i) => (
            <li
              key={zone}
              className="flex items-center gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] p-2"
            >
              <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-white/10 text-[13px] font-bold text-white tabular-nums">
                {i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] font-semibold text-white">
                  {COPY.zones[zone][0]}
                </span>
                <span className="block text-[11px] text-white/55">{COPY.zones[zone][1]}</span>
              </span>
              <span className="flex gap-1">
                {([-1, 1] as const).map((dir) => {
                  const disabled = dir === -1 ? i === 0 : i === tactics.vision.length - 1
                  const Icon = dir === -1 ? ChevronUp : ChevronDown
                  const label = dir === -1 ? COPY.moveUp : COPY.moveDown
                  return (
                    <button
                      key={dir}
                      type="button"
                      ref={(el) => {
                        refs.current.set(`${zone}:${dir}`, el)
                      }}
                      aria-label={label(COPY.zones[zone][0])}
                      disabled={disabled}
                      onClick={() => move(zone, dir)}
                      className={cn(
                        "grid size-8 place-items-center rounded-lg bg-white/[0.06] text-white/80 hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-25",
                        focusRing,
                      )}
                    >
                      <Icon className="size-4" aria-hidden />
                    </button>
                  )
                })}
              </span>
            </li>
          ))}
        </ol>
      </Section>
      <Section title={COPY.tabs.vision} hint={COPY.wardStock}>
        <p className="flex items-center gap-2 text-[12px] text-white/70">
          <Eye className="size-4 text-sky-200" aria-hidden />
          {COPY.tabHints.vision}
        </p>
      </Section>
    </div>
  )
}

// --- comms (IGL) ------------------------------------------------------------------

export const CommsSection = ({ draft, you, tactics, update }: SectionProps) => {
  const team = teamOf(draft, you)
  return (
    <Section title={COPY.iglHeading} hint={COPY.iglHint}>
      <fieldset>
        <legend className="sr-only">{COPY.iglHeading}</legend>
        <div className="grid grid-cols-5 gap-2 max-lg:grid-cols-3 max-md:grid-cols-2">
          {team.players.map((p) => {
            const on = tactics.igl === p.id
            const heroId = heroIdOf(draft, you, p.id)
            return (
              <label
                key={p.id}
                className={cn(
                  "relative flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border p-2.5 text-center transition-colors motion-reduce:transition-none",
                  "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-sky-300/90",
                  on
                    ? "border-amber-200/60 bg-amber-200/[0.09]"
                    : "border-white/[0.07] bg-white/[0.03] hover:border-white/20",
                )}
              >
                <input
                  type="radio"
                  name="igl"
                  value={p.id}
                  checked={on}
                  onChange={() => update((t) => ({ ...t, igl: p.id }))}
                  className="sr-only"
                  aria-label={`${p.name}, ${COPY.leadership} ${p.leadership}/20, ${COPY.relay} ${COPY.seconds(relayDelay(p.leadership))}`}
                />
                {on ? (
                  <span className="absolute top-1.5 right-1.5 flex items-center gap-0.5 rounded bg-amber-200/20 px-1 text-[9px] font-bold text-amber-200">
                    <Crown className="size-2.5" aria-hidden />
                    {COPY.iglBadge}
                  </span>
                ) : null}
                {heroId ? <HeroGem heroId={heroId} size={38} /> : null}
                <span className="text-[12.5px] font-semibold text-white">{p.name}</span>
                <span className="text-[10.5px] text-white/45">
                  {ROLE_LABEL[p.role]} · {heroName(heroId)}
                </span>
                <span className="mt-1 w-full" aria-hidden>
                  <span className="flex justify-between text-[10px] text-white/55">
                    <span>{COPY.leadership}</span>
                    <span className="font-semibold text-white tabular-nums">{p.leadership}</span>
                  </span>
                  <span className="mt-0.5 block h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                    <span
                      className={cn(
                        "block h-full rounded-full",
                        on ? "bg-amber-200" : "bg-white/60",
                      )}
                      style={{ width: `${(p.leadership / 20) * 100}%` }}
                    />
                  </span>
                </span>
                <span
                  className="grid w-full grid-cols-2 gap-1 text-[10px] text-white/50"
                  aria-hidden
                >
                  <span>
                    {COPY.relay}
                    <span className="block text-[12px] font-semibold text-white tabular-nums">
                      {COPY.seconds(relayDelay(p.leadership))}
                    </span>
                  </span>
                  <span>
                    {COPY.compliance}
                    <span className="block text-[12px] font-semibold text-white tabular-nums">
                      ~{COPY.percent(followChance(p.leadership))}
                    </span>
                  </span>
                </span>
              </label>
            )
          })}
        </div>
      </fieldset>
      <p className="mt-2 text-[10.5px] text-white/45">{COPY.backupNote}</p>
    </Section>
  )
}

// --- behaviour ----------------------------------------------------------------------

const TARGET_OPTIONS = TARGET_PRIORITIES.map((t) => ({ value: t, label: COPY.targets[t] }))
const SLIDERS = ["aggression", "farm", "ultDiscipline"] as const

export const BehaviourSection = ({ draft, you, tactics, update }: SectionProps) => {
  const team = teamOf(draft, you)
  return (
    <Section
      title={COPY.tabs.behaviour}
      hint={SLIDERS.map((k) => `${COPY[k]}: ${COPY.sliderHints[k]}`).join(" ")}
    >
      <ul className="flex flex-col gap-1.5">
        {team.players.map((p) => {
          const pt = tactics.players[p.id]
          if (!pt) return null
          const heroId = heroIdOf(draft, you, p.id)
          return (
            <li
              key={p.id}
              className="grid grid-cols-[150px_repeat(3,minmax(0,1fr))_140px] items-center gap-4 rounded-xl border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5 max-lg:grid-cols-[130px_repeat(3,minmax(0,1fr))_120px] max-lg:gap-3"
            >
              <span className="flex min-w-0 items-center gap-2">
                {heroId ? <HeroGem heroId={heroId} size={30} /> : null}
                <span className="min-w-0">
                  <span className="block truncate text-[12px] font-semibold text-white">
                    {p.name}
                  </span>
                  <span className="block truncate text-[10.5px] text-white/45">
                    {heroName(heroId)}
                  </span>
                </span>
              </span>
              {SLIDERS.map((k) => (
                <Slider
                  key={k}
                  label={COPY[k]}
                  aria-label={`${COPY[k]} for ${p.name}`}
                  minValue={0}
                  maxValue={100}
                  step={5}
                  value={pt.behavior[k]}
                  onChange={(v) =>
                    update((t) =>
                      setPlayer(t, p, (x) => ({ ...x, behavior: { ...x.behavior, [k]: v } })),
                    )
                  }
                  className="gap-0"
                />
              ))}
              <span className="flex flex-col gap-1">
                <span className="text-xs text-white/70" aria-hidden>
                  {COPY.target}
                </span>
                <Select<TargetPriority>
                  label={COPY.targetLabel(p.name)}
                  value={pt.behavior.target}
                  options={TARGET_OPTIONS}
                  onChange={(target) =>
                    update((t) =>
                      setPlayer(t, p, (x) => ({ ...x, behavior: { ...x.behavior, target } })),
                    )
                  }
                />
              </span>
            </li>
          )
        })}
      </ul>
    </Section>
  )
}
