import {
  DRAFT_ORDER,
  type DraftSide,
  type DraftState,
  HEROES,
  type HeroDef,
  type Role,
  aiChoose,
  applyDraft,
  assignPlayer,
  currentAction,
  isComplete,
  masteryOf,
  openPlayers,
  unavailable,
} from "@mobacraft/sim"
import { Button, Panel, cn } from "@mobacraft/ui"
import { Ban, Check, Swords } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import type { FlowEvent } from "./flow.ts"
import { HeroGem, ROLE_ICON, ROLE_LABEL, TeamCrest } from "./ui.tsx"

const ROLES: readonly (Role | "all")[] = ["all", "carry", "mid", "offlane", "jungle", "support"]

const effectSummary = (h: HeroDef) => {
  const kinds = new Set([...h.skill.effects, ...h.ultimate.effects].map((e) => e.type))
  const tags: string[] = []
  if (kinds.has("stun") || kinds.has("root")) tags.push("Lockdown")
  if (kinds.has("heal") || kinds.has("hot")) tags.push("Healing")
  if (kinds.has("shield")) tags.push("Shields")
  if (kinds.has("dash")) tags.push("Mobile")
  if (h.ultimate.target.kind.includes("aoe")) tags.push("AoE ult")
  if (kinds.has("execute") || kinds.has("lifesteal")) tags.push("Duelist")
  return tags.slice(0, 3)
}

export const DraftScreen = ({
  draft,
  you,
  dispatch,
}: {
  draft: DraftState
  you: DraftSide
  dispatch: (e: FlowEvent) => void
}) => {
  const [state, setState] = useState(draft)
  const [hovered, setHovered] = useState<string | null>(null)
  const [role, setRole] = useState<Role | "all">("all")
  /** The hero most recently banned or picked — its slot plays a short lock-in flash. */
  const [locked, setLocked] = useState<string | null>(null)
  const action = currentAction(state)
  const yourTurn = action?.side === you
  const taken = unavailable(state)
  const them: DraftSide = you === "blue" ? "red" : "blue"
  const yourTeam = you === "blue" ? state.blue : state.red
  const theirTeam = you === "blue" ? state.red : state.blue

  // Opponent's coach acts after a short "thinking" beat.
  useEffect(() => {
    if (!action || action.side === you) return
    const id = setTimeout(() => {
      const heroId = aiChoose(state)
      const r = applyDraft(state, heroId)
      if (r.ok) {
        setState(r.state)
        setLocked(heroId)
      }
    }, 900)
    return () => clearTimeout(id)
  }, [state, action, you])

  const commit = (heroId: string) => {
    if (!yourTurn) return
    const r = applyDraft(state, heroId)
    if (r.ok) {
      setState(r.state)
      setLocked(heroId)
      setHovered(null)
    }
  }

  const pool = useMemo(
    () => HEROES.filter((h) => role === "all" || (h.roles as readonly Role[]).includes(role)),
    [role],
  )
  const preview = hovered ? HEROES.find((h) => h.id === hovered) : undefined
  const previewPlayer =
    preview && action?.kind === "pick" && yourTurn
      ? assignPlayer(state, you, preview.id)
      : undefined
  const done = isComplete(state)
  const yourTags = new Set(
    state.picks[you].flatMap((p) => {
      const h = HEROES.find((x) => x.id === p.heroId)
      return h ? effectSummary(h) : []
    }),
  )
  const adds = preview ? effectSummary(preview).filter((t) => !yourTags.has(t)) : []
  const stepLabel = action
    ? `${action.side === you ? "Your" : `${theirTeam.tag}'s`} ${action.kind === "ban" ? "ban" : "pick"}`
    : "Draft complete"

  return (
    <div className="pointer-events-auto absolute inset-0 flex animate-in flex-col bg-black/55 p-4 backdrop-blur-[3px] duration-300 fade-in max-md:p-2">
      {/* top: phase track */}
      <Panel className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-2.5">
        <TeamCrest team={yourTeam} size={28} />
        <div
          className="flex flex-1 items-center justify-center gap-1 overflow-x-auto"
          aria-label="Draft order"
        >
          {DRAFT_ORDER.map((a, i) => (
            <span
              // oxlint-disable-next-line react/no-array-index-key -- the draft order is a fixed sequence
              key={i}
              className={cn(
                "grid h-6 min-w-6 place-items-center rounded-md px-1 text-[10px] font-semibold",
                i < state.step
                  ? "bg-white/15 text-white/60"
                  : i === state.step
                    ? "bg-white text-black"
                    : "bg-white/[0.04] text-white/35",
                a.side === you
                  ? "ring-1 ring-radiant/40 ring-inset"
                  : "ring-1 ring-dire/40 ring-inset",
              )}
              title={`${a.side === you ? "You" : theirTeam.tag} ${a.kind}`}
            >
              {a.kind === "ban" ? <Ban className="size-3" aria-hidden /> : i - 3}
            </span>
          ))}
        </div>
        <TeamCrest team={theirTeam} size={28} />
      </Panel>

      <div className="mx-auto mt-3 grid min-h-0 w-full max-w-6xl flex-1 grid-cols-[220px_1fr_220px] gap-3 max-lg:grid-cols-[180px_1fr_180px] max-md:grid-cols-1">
        <SideColumn side={you} state={state} title={yourTeam.name} locked={locked} you />

        {/* centre: pool */}
        <Panel className="flex min-h-0 flex-col p-3">
          <div className="flex items-center gap-3">
            <h1
              className={cn(
                "text-lg font-semibold tracking-tight",
                yourTurn ? "text-white" : "text-white/60",
              )}
              aria-live="polite"
            >
              {stepLabel}
              {!yourTurn && action ? (
                <span className="ml-2 animate-pulse text-xs font-normal text-white/45">
                  thinking…
                </span>
              ) : null}
            </h1>
            <div className="ml-auto flex gap-1" role="tablist" aria-label="Filter by role">
              {ROLES.map((r) => (
                <button
                  key={r}
                  type="button"
                  role="tab"
                  aria-selected={role === r}
                  onClick={() => setRole(r)}
                  className={cn(
                    "h-7 rounded-full px-2.5 text-[11px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-sky-300/90",
                    role === r ? "bg-white/15 text-white" : "text-white/55 hover:bg-white/[0.06]",
                  )}
                >
                  {r === "all" ? "All" : ROLE_LABEL[r]}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-3 grid min-h-0 flex-1 auto-rows-min grid-cols-5 gap-2 overflow-y-auto pr-1 max-xl:grid-cols-4 max-md:grid-cols-3">
            {pool.map((h) => {
              const gone = taken.has(h.id)
              const comfort = Math.max(...openPlayers(state, you).map((p) => masteryOf(p, h.id)), 0)
              return (
                <button
                  key={h.id}
                  type="button"
                  disabled={gone || !yourTurn}
                  onMouseEnter={() => setHovered(h.id)}
                  onFocus={() => setHovered(h.id)}
                  onClick={() => commit(h.id)}
                  aria-label={`${h.name}, ${h.title}${gone ? ", unavailable" : ""}`}
                  className={cn(
                    "group relative flex flex-col items-center rounded-xl border p-2 text-center outline-none transition focus-visible:ring-2 focus-visible:ring-sky-300/90",
                    gone
                      ? "cursor-not-allowed border-transparent opacity-30"
                      : "border-white/[0.07] bg-white/[0.03] enabled:hover:border-white/30 enabled:hover:bg-white/[0.08]",
                    !yourTurn && !gone && "cursor-wait",
                  )}
                >
                  <HeroGem heroId={h.id} size={46} dim={gone} />
                  <span className="mt-1.5 text-[12px] leading-tight font-semibold text-white">
                    {h.name}
                  </span>
                  <span className="mt-0.5 flex gap-0.5">
                    {(h.roles as readonly Role[]).map((r) => {
                      const Icon = ROLE_ICON[r]
                      return (
                        <Icon key={r} className="size-3 text-white/45" aria-label={ROLE_LABEL[r]} />
                      )
                    })}
                  </span>
                  {comfort >= 0.75 && !gone ? (
                    <span
                      className="absolute top-1 right-1 rounded bg-radiant/20 px-1 text-[9px] font-bold text-radiant"
                      title="Comfort pick for one of your players"
                    >
                      ★
                    </span>
                  ) : null}
                </button>
              )
            })}
          </div>

          {/* hero detail */}
          <div className="mt-3 min-h-[88px] rounded-xl border border-white/[0.07] bg-black/25 p-3">
            {preview ? (
              <div className="flex gap-3">
                <HeroGem heroId={preview.id} size={56} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-white">
                    {preview.name}{" "}
                    <span className="font-normal text-white/50">· {preview.title}</span>
                  </p>
                  <p className="mt-0.5 text-[11px] text-white/55">
                    {preview.attack === "melee" ? "Melee" : "Ranged"} ·{" "}
                    {effectSummary(preview).join(" · ")}
                  </p>
                  <p className="mt-1.5 text-[12px] text-white/75">
                    <span className="font-medium text-white">{preview.skill.name}</span> ·{" "}
                    <span className="font-medium text-amber-200">{preview.ultimate.name}</span>{" "}
                    (ult)
                  </p>
                  {state.picks[you].length > 0 && !taken.has(preview.id) ? (
                    <p className="mt-1 text-[11px] text-white/55">
                      {adds.length > 0 ? (
                        <>
                          Adds to your lineup:{" "}
                          <span className="font-medium text-radiant">{adds.join(", ")}</span>
                        </>
                      ) : (
                        "Doubles up on what your lineup already has."
                      )}
                    </p>
                  ) : null}
                </div>
                {previewPlayer ? (
                  <div className="shrink-0 text-right text-[11px] text-white/55">
                    Goes to <span className="font-semibold text-white">{previewPlayer.name}</span>
                    <br />
                    mastery {Math.round(masteryOf(previewPlayer, preview.id) * 100)}%
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="text-[12px] text-white/45">
                Hover a hero to see their kit. ★ marks a comfort pick for one of your players. Bans
                come first, then snake picks.
              </p>
            )}
          </div>
        </Panel>

        <SideColumn side={them} state={state} title={theirTeam.name} locked={locked} />
      </div>

      <div className="mx-auto mt-3 flex w-full max-w-6xl justify-end">
        <Button
          size="sm"
          className="h-10 px-5"
          isDisabled={!done}
          onPress={() =>
            dispatch({ _tag: "drafted", draft: state, seed: (Date.now() & 0xffff) + 1 })
          }
        >
          <Swords className="size-4!" aria-hidden />
          {done ? "Start match" : "Finish the draft"}
        </Button>
      </div>
    </div>
  )
}

const SideColumn = ({
  side,
  state,
  title,
  locked,
  you,
}: {
  side: DraftSide
  state: DraftState
  title: string
  locked: string | null
  you?: boolean
}) => {
  const team = side === "blue" ? state.blue : state.red
  const bans = state.bans.filter((b) => b.side === side)
  const picks = state.picks[side]
  return (
    <Panel className="flex flex-col gap-2 p-3 max-md:hidden">
      <p
        className={cn(
          "text-[11px] font-semibold tracking-[0.2em] uppercase",
          you ? "text-radiant" : "text-dire",
        )}
      >
        {you ? "You" : "Opponent"}
      </p>
      <p className="-mt-1 text-sm font-semibold text-white">{title}</p>
      <div className="flex gap-1.5" aria-label="Bans">
        {[0, 1].map((i) => (
          <span
            key={i}
            className="relative grid size-9 place-items-center rounded-lg border border-dashed border-white/15 bg-black/20"
          >
            {bans[i] ? (
              <>
                <HeroGem heroId={bans[i].heroId} size={34} dim />
                {bans[i].heroId === locked ? <LockFlash key={locked} ban /> : null}
              </>
            ) : (
              <Ban className="size-3.5 text-white/25" aria-hidden />
            )}
          </span>
        ))}
      </div>
      <ul className="mt-1 flex flex-col gap-1.5">
        {team.players.map((p) => {
          const pick = picks.find((x) => x.playerId === p.id)
          const Icon = ROLE_ICON[p.role]
          return (
            <li
              key={p.id}
              className="relative flex items-center gap-2 overflow-hidden rounded-xl border border-white/[0.06] bg-black/20 p-1.5"
            >
              {pick && pick.heroId === locked ? (
                <LockFlash key={locked} side={side} you={you} />
              ) : null}
              {pick ? (
                <HeroGem
                  key={pick.heroId}
                  heroId={pick.heroId}
                  size={34}
                  className={cn(
                    pick.heroId === locked &&
                      "animate-in duration-500 ease-out zoom-in-50 fade-in motion-reduce:animate-none",
                  )}
                />
              ) : (
                <span className="grid size-[34px] place-items-center rounded-xl bg-white/[0.04]">
                  <Icon className="size-3.5 text-white/35" aria-hidden />
                </span>
              )}
              <span className="min-w-0">
                <span className="block truncate text-[12px] font-semibold text-white">
                  {p.name}
                </span>
                <span className="block truncate text-[10.5px] text-white/50">
                  {pick ? HEROES.find((h) => h.id === pick.heroId)?.name : ROLE_LABEL[p.role]}
                  {pick ? (
                    <span className="ml-1 text-white/35">
                      {Math.round(masteryOf(p, pick.heroId) * 100)}%
                    </span>
                  ) : null}
                </span>
              </span>
              {pick ? <Check className="ml-auto size-3.5 text-white/40" aria-hidden /> : null}
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}

/**
 * Lock-in flash: a team-tinted sweep that fades out once. Mounted (keyed) when a
 * slot receives the hero just chosen; reduced motion shows a static outline instead.
 */
const LockFlash = ({ ban, you }: { ban?: boolean; side?: DraftSide; you?: boolean }) => (
  <span
    className={cn(
      "pointer-events-none absolute inset-0 rounded-[inherit] ring-2 ring-inset",
      "animate-out fade-out fill-mode-forwards delay-500 duration-1000 motion-reduce:animate-none motion-reduce:opacity-60",
      ban
        ? "bg-white/10 ring-white/50"
        : you
          ? "bg-[linear-gradient(90deg,rgba(95,224,122,0.35),transparent)] ring-radiant/70"
          : "bg-[linear-gradient(90deg,rgba(255,106,77,0.35),transparent)] ring-dire/70",
    )}
    aria-hidden
  />
)
