/**
 * Tactics board (spec/06 §3a/3b/3c/5/6) — the coach's game plan between draft and match.
 * Every field starts from `defaultTactics`, so "Start match" is always valid.
 */
import {
  type DraftSide,
  type DraftState,
  type TeamTactics,
  aiTactics,
  defaultTactics,
  normalizeTactics,
} from "@mobacraft/sim"
import { Button, Panel, cn } from "@mobacraft/ui"
import { Bot, RotateCcw, Swords } from "lucide-react"
import { type KeyboardEvent, useCallback, useMemo, useRef, useState } from "react"
import type { FlowEvent } from "../flow.ts"
import { HeroGem, TeamCrest } from "../ui.tsx"
import { COPY, type TabId } from "./copy.ts"
import { LanesSection } from "./lanes.tsx"
import { ItemsSection, PlansSection } from "./plans-items.tsx"
import type { SectionProps } from "./shared.ts"
import { BehaviourSection, CommsSection, VisionSection } from "./vision-comms-behaviour.tsx"

const TABS: readonly TabId[] = ["lanes", "plans", "items", "vision", "comms", "behaviour"]

export const TacticsBoard = ({
  draft,
  you,
  dispatch,
}: {
  draft: DraftState
  you: DraftSide
  dispatch: (e: FlowEvent) => void
}) => {
  const them: DraftSide = you === "blue" ? "red" : "blue"
  const [tactics, setTactics] = useState<TeamTactics>(() => defaultTactics(draft, you))
  const [tab, setTab] = useState<TabId>("lanes")
  const [message, setMessage] = useState("")
  const theirs = useMemo(() => aiTactics(draft, them), [draft, them])
  const tabRefs = useRef(new Map<TabId, HTMLButtonElement | null>())

  const update = useCallback((f: (t: TeamTactics) => TeamTactics) => setTactics((t) => f(t)), [])
  const announce = useCallback((m: string) => setMessage(m), [])

  const yourTeam = you === "blue" ? draft.blue : draft.red
  const theirTeam = you === "blue" ? draft.red : draft.blue
  const props: SectionProps = { draft, you, tactics, update, announce }

  const onTabKey = (e: KeyboardEvent) => {
    const i = TABS.indexOf(tab)
    const to =
      e.key === "ArrowRight"
        ? TABS[(i + 1) % TABS.length]
        : e.key === "ArrowLeft"
          ? TABS[(i - 1 + TABS.length) % TABS.length]
          : e.key === "Home"
            ? TABS[0]
            : e.key === "End"
              ? TABS[TABS.length - 1]
              : undefined
    if (!to) return
    e.preventDefault()
    setTab(to)
    tabRefs.current.get(to)?.focus()
  }

  return (
    <div className="pointer-events-auto absolute inset-0 flex animate-in flex-col bg-black/55 p-4 backdrop-blur-[3px] duration-300 fade-in max-md:p-2">
      <p className="sr-only" aria-live="polite">
        {message}
      </p>
      {/* header */}
      <Panel className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-2.5">
        <TeamCrest team={yourTeam} size={30} />
        <div className="min-w-0">
          <h1 className="text-lg leading-tight font-semibold tracking-tight text-white">
            {COPY.title}
          </h1>
          <p className="truncate text-[11.5px] text-white/55">{COPY.subtitle}</p>
        </div>
        <div className="ml-auto flex items-center gap-3 max-md:hidden">
          <PickStrip draft={draft} side={you} />
          <span className="text-[11px] font-semibold text-white/40 uppercase">{COPY.vs}</span>
          <PickStrip draft={draft} side={them} />
        </div>
        <TeamCrest team={theirTeam} size={30} />
      </Panel>

      <Panel className="mx-auto mt-3 flex min-h-0 w-full max-w-6xl flex-1 flex-col p-3">
        <div className="flex items-center gap-3">
          <div role="tablist" aria-label={COPY.tabsLabel} className="flex gap-1 overflow-x-auto">
            {TABS.map((t) => (
              <button
                key={t}
                id={`tactics-tab-${t}`}
                ref={(el) => {
                  tabRefs.current.set(t, el)
                }}
                type="button"
                role="tab"
                aria-selected={tab === t}
                aria-controls={`tactics-panel-${t}`}
                tabIndex={tab === t ? 0 : -1}
                onClick={() => setTab(t)}
                onKeyDown={onTabKey}
                className={cn(
                  "h-8 shrink-0 rounded-full px-3.5 text-[12px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-sky-300/90",
                  tab === t ? "bg-white/15 text-white" : "text-white/55 hover:bg-white/[0.06]",
                )}
              >
                {COPY.tabs[t]}
              </button>
            ))}
          </div>
          <p className="ml-auto truncate text-[11.5px] text-white/50 max-lg:hidden">
            {COPY.tabHints[tab]}
          </p>
        </div>
        <div
          id={`tactics-panel-${tab}`}
          role="tabpanel"
          aria-labelledby={`tactics-tab-${tab}`}
          className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1"
        >
          {tab === "lanes" ? <LanesSection {...props} theirs={theirs} /> : null}
          {tab === "plans" ? <PlansSection {...props} /> : null}
          {tab === "items" ? <ItemsSection {...props} /> : null}
          {tab === "vision" ? <VisionSection {...props} /> : null}
          {tab === "comms" ? <CommsSection {...props} /> : null}
          {tab === "behaviour" ? <BehaviourSection {...props} /> : null}
        </div>
      </Panel>

      <div className="mx-auto mt-3 flex w-full max-w-6xl items-center gap-2">
        <Button
          size="sm"
          className="h-10 px-4"
          onPress={() => {
            setTactics(defaultTactics(draft, you))
            announce(COPY.resetDone)
          }}
        >
          <RotateCcw className="size-4!" aria-hidden />
          {COPY.reset}
        </Button>
        <Button
          size="sm"
          className="h-10 px-4"
          onPress={() => {
            setTactics(aiTactics(draft, you))
            announce(COPY.aiDone)
          }}
        >
          <Bot className="size-4!" aria-hidden />
          {COPY.ai}
        </Button>
        <Button
          size="sm"
          variant="accent"
          className="ml-auto h-10 px-5"
          onPress={() =>
            dispatch({ _tag: "tactics-set", tactics: normalizeTactics(draft, you, tactics) })
          }
        >
          <Swords className="size-4!" aria-hidden />
          {COPY.start}
        </Button>
      </div>
    </div>
  )
}

const PickStrip = ({ draft, side }: { draft: DraftState; side: DraftSide }) => (
  <span className="flex gap-1" aria-hidden>
    {draft.picks[side].map((p) => (
      <HeroGem key={p.heroId} heroId={p.heroId} size={24} />
    ))}
  </span>
)
