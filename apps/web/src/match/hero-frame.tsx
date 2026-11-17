import { MAX_LEVEL } from "@mobacraft/sim"
/** Hero frames — one compact card per hero down each side of the screen. */
import { type HeroLine, MAX_ITEMS } from "@mobacraft/sim"
import { cn } from "@mobacraft/ui"
import { Bird, Coins, Crown, Package2, Skull } from "lucide-react"
import { INTENT_LABEL } from "../strings.ts"
import { goldK, inventorySummary, inventoryZones } from "./hud-data.ts"
import { ItemSlot, itemName } from "./item-icon.tsx"
import { HeroGem } from "./ui.tsx"

/** Sim XP_CURVE length; used only to draw the level ring's fill. */
/** Full duration of this death (spec/12 curve + modifiers) for the overlay's progress line. */
const respawnSpan = (h: HeroLine) => Math.max(h.respawnIn, h.respawnTotal ?? 0)
/** Ultimates unlock at this level in the sim. No cooldown data reaches the HUD. */
const ULT_LEVEL = 6

const INTENT_TONE: Record<string, string> = {
  fight: "bg-rose-400/20 text-rose-200",
  push: "bg-amber-300/20 text-amber-100",
  retreat: "bg-sky-300/15 text-sky-200",
  roshan: "bg-violet-400/20 text-violet-200",
  save: "bg-teal-300/20 text-teal-100",
  group: "bg-emerald-300/15 text-emerald-200",
  jungle: "bg-lime-300/10 text-lime-200/85",
  gank: "bg-rose-300/15 text-rose-100",
  ward: "bg-amber-200/15 text-amber-100",
  shop: "bg-cyan-300/15 text-cyan-100",
  lane: "bg-white/[0.07] text-white/60",
}

/** SVG ring around the gem showing level progress toward max level. */
const LevelRing = ({
  heroId,
  level,
  dead,
  side,
}: {
  heroId: string
  level: number
  dead: boolean
  side: "left" | "right"
}) => {
  const size = 42
  const r = 19.5
  const c = 2 * Math.PI * r
  const frac = Math.min(1, level / MAX_LEVEL)
  return (
    <span
      className="relative grid shrink-0 place-items-center"
      style={{ width: size, height: size }}
    >
      <svg className="absolute inset-0 -rotate-90" viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.1)"
          strokeWidth={2.5}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          className={cn(
            "transition-[stroke-dashoffset] duration-500 motion-reduce:transition-none",
            dead ? "stroke-white/30" : side === "left" ? "stroke-radiant" : "stroke-dire",
          )}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - frac)}
        />
      </svg>
      <HeroGem heroId={heroId} size={32} dim={dead} className="rounded-full" />
      <span className="absolute -bottom-1 left-1/2 grid h-4 min-w-4 -translate-x-1/2 place-items-center rounded-full bg-neutral-950 px-1 text-[9px] font-bold tabular-nums ring-1 ring-white/25">
        {level}
      </span>
    </span>
  )
}

const HeroFrame = ({
  h,
  side,
  respawnTotal,
  onPick,
}: {
  h: HeroLine
  side: "left" | "right"
  respawnTotal: number
  onPick: (id: string) => void
}) => {
  const dead = !h.alive
  const ult = h.level >= ULT_LEVEL
  // Main slots in their real positions (muted ones included); older snapshots
  // without `main` fall back to the effective list.
  const slots = Array.from({ length: MAX_ITEMS }, (_, i) => (h.main ? h.main[i] : h.items[i]))
  const zones = inventoryZones(h)
  const inv = inventorySummary(h, itemName)
  const respawnFrac = respawnTotal > 0 ? Math.min(1, h.respawnIn / respawnTotal) : 0
  return (
    <button
      type="button"
      onClick={() => onPick(h.id)}
      className={cn(
        "relative flex w-full items-center gap-2 overflow-hidden rounded-xl border border-white/10 bg-neutral-950/60 p-1.5 pr-2 text-left outline-none backdrop-blur-xl transition hover:bg-neutral-900/75 focus-visible:ring-2 focus-visible:ring-sky-300/90 motion-reduce:transition-none",
        h.aegis && "border-amber-300/40",
        h.protected && "ring-1 ring-sky-200/40",
      )}
      aria-label={[
        `${h.playerName}, ${h.heroName}, level ${h.level}`,
        `${h.kills} kills ${h.deaths} deaths ${h.assists} assists`,
        dead
          ? `dead, respawning in ${Math.ceil(h.respawnIn)} seconds${h.buyback?.ready ? `, buyback ready (${h.buyback.cost} gold)` : ""}`
          : `${Math.round(h.hp * 100)}% health, ${INTENT_LABEL[h.intent] ?? h.intent}`,
        ult ? "ultimate unlocked" : "",
        h.aegis ? "holds the Aegis" : "",
        h.protected ? "spawn protected" : "",
        h.igl ? "in-game leader" : "",
        h.following === false ? "freelancing, ignoring the current call" : "",
        `${goldK(h.netWorth ?? h.gold)} net worth`,
        inv,
      ]
        .filter(Boolean)
        .join("; ")}
    >
      <LevelRing heroId={h.heroId} level={h.level} dead={dead} side={side} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          {h.igl ? (
            <Crown className="size-3 shrink-0 fill-amber-300/40 text-amber-300" aria-hidden />
          ) : null}
          <span className={cn("truncate text-[12px] font-semibold", dead && "text-white/50")}>
            {h.playerName}
          </span>
          {h.following === false && !dead ? (
            <span
              className="rounded-[4px] border border-dashed border-white/35 px-1 text-[8.5px] leading-[12px] font-semibold tracking-wider text-white/70 italic"
              title="Freelancing — ignoring the current call"
              aria-hidden
            >
              FREE
            </span>
          ) : null}
          {ult ? (
            <span
              className="rounded-[4px] bg-amber-300/20 px-1 text-[8.5px] leading-[14px] font-bold tracking-wider text-amber-200"
              title="Ultimate unlocked (level 6+)"
              aria-hidden
            >
              ULT
            </span>
          ) : null}
          {h.aegis ? (
            <span
              className="rounded-[4px] bg-amber-300 px-1 text-[8.5px] leading-[14px] font-bold tracking-wider text-black"
              title="Holds the Aegis"
              aria-hidden
            >
              AEGIS
            </span>
          ) : null}
          <span className="ml-auto font-mono text-[10px] tabular-nums text-white/60" aria-hidden>
            {h.kills}/{h.deaths}/{h.assists}
          </span>
        </span>
        <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-white/10" aria-hidden>
          <span
            className={cn(
              "block h-full rounded-full transition-[width] duration-150 motion-reduce:transition-none",
              h.hp < 0.3 ? "bg-amber-300" : side === "left" ? "bg-radiant" : "bg-dire",
            )}
            style={{ width: `${dead ? 0 : Math.round(h.hp * 100)}%` }}
          />
        </span>
        <span className="mt-0.5 block h-1 overflow-hidden rounded-full bg-white/10" aria-hidden>
          <span
            className="block h-full rounded-full bg-sky-400/80 transition-[width] duration-150 motion-reduce:transition-none"
            style={{ width: `${dead || !h.maxMana ? 0 : Math.round((h.mana / h.maxMana) * 100)}%` }}
          />
        </span>
        <span className="mt-1 flex items-center gap-[3px]" aria-hidden>
          {slots.map((id, i) => (
            // oxlint-disable-next-line react/no-array-index-key -- inventory slots are positional
            <ItemSlot key={i} id={id} size={16} muteLeft={h.mainMute?.[i] ?? 0} />
          ))}
          {zones.neutral ? (
            <span className="ml-0.5 border-l border-white/10 pl-1">
              <ItemSlot id={zones.neutral} size={14} />
            </span>
          ) : null}
          <span className="ml-auto flex items-center gap-0.5 text-[10px] font-semibold tabular-nums text-amber-200/90">
            <Coins className="size-2.5" />
            {goldK(h.netWorth ?? h.gold)}
          </span>
        </span>
        {zones.any ? (
          <span className="mt-0.5 flex items-center gap-[3px]" aria-hidden>
            {zones.backpack.map((id, i) => (
              // oxlint-disable-next-line react/no-array-index-key -- backpack slots are positional
              <ItemSlot key={`b${i}`} id={id} size={11} dim />
            ))}
            {zones.buffs.map((id) => (
              <ItemSlot key={id} id={id} size={11} />
            ))}
            {zones.tango > 0 ? (
              <span className="flex items-center gap-px text-[8.5px] font-semibold tabular-nums text-green-300/80">
                <ItemSlot id="tango" size={11} />
                {zones.tango}
              </span>
            ) : null}
            {zones.stash.length > 0 ? (
              <span
                className="ml-auto flex items-center gap-0.5 text-[8.5px] text-white/55"
                title={`Stash: ${zones.stash.map(itemName).join(", ")}`}
              >
                <Package2 className="size-2.5" />
                {zones.stash.length}
              </span>
            ) : null}
            {zones.inTransit.length > 0 ? (
              <span
                className={cn(
                  "flex items-center gap-0.5 text-[8.5px] text-cyan-200/90",
                  zones.stash.length === 0 && "ml-auto",
                )}
                title={`On the courier: ${zones.inTransit.map(itemName).join(", ")}`}
              >
                <Bird className="size-2.5" />
                {zones.inTransit.length}
              </span>
            ) : null}
          </span>
        ) : null}
      </span>
      {/* intent chip, pinned top-right over the frame edge */}
      {!dead ? (
        <span
          className={cn(
            "absolute top-0 right-9 rounded-b-md px-1.5 text-[8.5px] leading-[13px] font-semibold tracking-wider uppercase",
            INTENT_TONE[h.intent] ?? INTENT_TONE["lane"],
          )}
          aria-hidden
        >
          {INTENT_LABEL[h.intent] ?? h.intent}
        </span>
      ) : null}
      {/* death overlay */}
      {dead ? (
        <span
          className="absolute inset-0 flex animate-in items-center justify-end gap-2 bg-[linear-gradient(90deg,transparent_10%,rgba(10,10,12,0.82)_55%)] pr-3 duration-300 fade-in motion-reduce:animate-none"
          aria-hidden
        >
          <Skull className="size-3.5 text-white/45" />
          <span className="flex flex-col items-end leading-tight">
            <span className="text-[10px] tracking-wider text-white/50 uppercase">Respawn</span>
            {h.buyback ? (
              <span
                className={cn(
                  "text-[8.5px] tabular-nums",
                  h.buyback.ready
                    ? "text-amber-200/90"
                    : h.buyback.cooldown > 0
                      ? "text-white/35"
                      : "text-white/30 line-through",
                )}
                title={
                  h.buyback.cooldown > 0
                    ? `Buyback on cooldown: ${Math.ceil(h.buyback.cooldown)} s`
                    : `Buyback costs ${h.buyback.cost} gold`
                }
              >
                {h.buyback.cooldown > 0
                  ? `BB ${Math.ceil(h.buyback.cooldown)}s`
                  : `BB ${goldK(h.buyback.cost)}`}
              </span>
            ) : null}
          </span>
          <span className="w-6 text-right font-mono text-lg leading-none font-bold tabular-nums text-white">
            {Math.ceil(h.respawnIn)}
          </span>
          <span className="absolute inset-x-0 bottom-0 h-0.5 bg-white/5">
            <span
              className="block h-full bg-white/45 transition-[width] duration-150 motion-reduce:transition-none"
              style={{ width: `${respawnFrac * 100}%` }}
            />
          </span>
        </span>
      ) : null}
    </button>
  )
}

export const HeroColumn = ({
  heroes,
  side,
  label,
  onPick,
}: {
  heroes: readonly HeroLine[]
  side: "left" | "right"
  label: string
  onPick: (id: string) => void
}) => {
  return (
    <ul
      aria-label={label}
      className={cn(
        "pointer-events-auto absolute flex w-60 flex-col gap-1.5 max-md:hidden max-lg:w-52",
        side === "left" ? "top-24 left-4" : "right-4 bottom-24",
      )}
    >
      {heroes.map((h) => (
        <li key={h.id}>
          <HeroFrame h={h} side={side} respawnTotal={respawnSpan(h)} onPick={onPick} />
        </li>
      ))}
    </ul>
  )
}
