import { Badge, Button, cn, Panel, Tooltip } from "@mobacraft/ui"
import { Crosshair, X } from "lucide-react"
import { createElement } from "react"
import { KIND_BLURB, KIND_TYPE, t } from "../strings.ts"
import { type Entity, iconFor, TEAM_BG, TEAM_TEXT, teamName } from "./entity.ts"

const TeamIcon = ({ entity, size = "md" }: { entity: Entity; size?: "sm" | "md" }) => (
  <span
    className={cn(
      "relative grid shrink-0 place-items-center rounded-xl ring-1 ring-white/10 ring-inset",
      size === "md" ? "size-10" : "size-7 rounded-lg",
      TEAM_TEXT[entity.team],
    )}
  >
    <span className={cn("absolute inset-0 rounded-[inherit] opacity-15", TEAM_BG[entity.team])} />
    {createElement(iconFor(entity.kind), {
      className: size === "md" ? "size-5" : "size-4",
      "aria-hidden": true,
    })}
  </span>
)

const TierPips = ({ tier }: { tier: number }) => (
  <span className="flex items-center gap-1" aria-label={`Tier ${tier} of 4`}>
    {[1, 2, 3, 4].map((n) => (
      <span
        key={n}
        className={cn("h-1.5 w-3 rounded-full", n <= tier ? "bg-white/85" : "bg-white/15")}
      />
    ))}
  </span>
)

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex items-center justify-between gap-3 py-1.5">
    <dt className="text-white/50">{label}</dt>
    <dd className="flex items-center gap-1.5 font-medium text-white/90">{children}</dd>
  </div>
)

/** Pinned card for the selected thing: icon, name, blurb, stats, close. */
export const SelectedCard = ({
  entity,
  exiting,
  onClose,
  onCenter,
}: {
  entity: Entity
  exiting: boolean
  onClose: () => void
  onCenter: () => void
}) => (
  <section aria-label={entity.name}>
    <Panel
      className={cn(
        "w-64 overflow-hidden p-0 max-md:w-56",
        exiting
          ? "animate-out fade-out slide-out-to-right-2 fill-mode-forwards duration-150"
          : "animate-in fade-in slide-in-from-right-3 duration-200 ease-out",
        "motion-reduce:animate-none",
      )}
    >
      <div className={cn("h-0.5 w-full opacity-80", TEAM_BG[entity.team])} />
      <div className="p-3.5">
        <div className="flex items-start gap-3">
          <TeamIcon entity={entity} />
          <div className="min-w-0 flex-1 pt-0.5">
            <Badge tone={entity.team} dot>
              {teamName(entity.team)}
            </Badge>
            <h2 className="mt-1 text-[15px] leading-5 font-semibold tracking-tight text-white">
              {entity.name}
            </h2>
          </div>
          <Tooltip label={t("hud.card.close")} shortcut="Esc" placement="left">
            <Button
              variant="ghost"
              size="icon-sm"
              className="-mt-1 -mr-1.5 text-white/60"
              aria-label={t("hud.card.close")}
              onPress={onClose}
            >
              <X />
            </Button>
          </Tooltip>
        </div>
        <p className="mt-2.5 text-[12.5px] leading-relaxed text-white/70">
          {KIND_BLURB[entity.kind] ?? ""}
        </p>
        <dl className="mt-3 divide-y divide-white/[0.07] border-t border-white/[0.07] text-xs">
          <Row label={t("hud.card.team")}>
            <span className={cn("size-2 rounded-full", TEAM_BG[entity.team])} />
            {teamName(entity.team)}
          </Row>
          <Row label={t("hud.card.type")}>{KIND_TYPE[entity.kind] ?? "—"}</Row>
          {entity.lane ? <Row label={t("hud.card.lane")}>{entity.lane}</Row> : null}
          {entity.tier ? (
            <Row label={t("hud.card.tier")}>
              <TierPips tier={entity.tier} />
              <span className="tabular-nums">{entity.tier}</span>
            </Row>
          ) : null}
          <Row label={t("hud.card.grid")}>
            <span className="font-mono text-[11px] text-white/75 tabular-nums">
              {Math.round(entity.position.x)}, {Math.round(entity.position.z)}
            </span>
          </Row>
        </dl>
        <Button
          size="sm"
          variant="ghost"
          className="mt-2 w-full bg-white/[0.06]"
          onPress={onCenter}
        >
          <Crosshair className="size-3.5!" aria-hidden />
          {t("hud.card.center")}
        </Button>
      </div>
    </Panel>
  </section>
)

/** Transient, compact chip for whatever the pointer is over. */
export const HoverChip = ({ entity }: { entity: Entity }) => (
  <Panel
    aria-hidden
    className="flex w-fit max-w-64 animate-in items-center gap-2.5 rounded-full py-1 pr-3.5 pl-1 duration-150 fade-in slide-in-from-top-1 motion-reduce:animate-none"
  >
    <TeamIcon entity={entity} size="sm" />
    <span className="min-w-0">
      <span
        className={cn(
          "block text-[10px] font-semibold tracking-wider uppercase",
          TEAM_TEXT[entity.team],
        )}
      >
        {teamName(entity.team)}
      </span>
      <span className="block truncate text-[12.5px] leading-4 font-medium text-white">
        {entity.name}
      </span>
    </span>
  </Panel>
)
