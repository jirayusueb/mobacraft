/** §1 phase plans and §3b itemization. */
import {
  type LatePlan,
  type LaningPlan,
  type MidPlan,
  type Plans,
  type ShopTiming,
  buildById,
  buildsFor,
} from "@mobacraft/sim"
import { ItemSlot, itemName } from "../item-icon.tsx"
import { HeroGem } from "../ui.tsx"
import { RadioCards, Section, Select, Switch } from "./controls.tsx"
import { COPY } from "./copy.ts"
import { type SectionProps, heroIdOf, setPlayer, teamOf } from "./shared.ts"

const options = <T extends string>(rec: Record<T, readonly [string, string]>) =>
  (Object.keys(rec) as T[]).map((value) => ({ value, title: rec[value][0], body: rec[value][1] }))

export const PlansSection = ({ tactics, update }: SectionProps) => {
  const setPlan = <K extends keyof Plans>(k: K, v: Plans[K]) =>
    update((t) => ({ ...t, plans: { ...t.plans, [k]: v } }))
  return (
    <div className="flex flex-col gap-3">
      <RadioCards<LaningPlan>
        name="plan-laning"
        legend={COPY.plansHeading.laning}
        sub={COPY.plansWhen.laning}
        value={tactics.plans.laning}
        options={options(COPY.laning)}
        onChange={(v) => setPlan("laning", v)}
        columns={4}
      />
      <RadioCards<MidPlan>
        name="plan-mid"
        legend={COPY.plansHeading.mid}
        sub={COPY.plansWhen.mid}
        value={tactics.plans.mid}
        options={options(COPY.mid)}
        onChange={(v) => setPlan("mid", v)}
        columns={4}
      />
      <RadioCards<LatePlan>
        name="plan-late"
        legend={COPY.plansHeading.late}
        sub={`${COPY.plansWhen.late}. ${COPY.antiStall}`}
        value={tactics.plans.late}
        options={options(COPY.late)}
        onChange={(v) => setPlan("late", v)}
        columns={3}
      />
    </div>
  )
}

export const ItemsSection = ({ draft, you, tactics, update }: SectionProps) => {
  const team = teamOf(draft, you)
  return (
    <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-3 max-md:grid-cols-1">
      <Section title={COPY.buildsHeading} hint={COPY.adaptiveHint}>
        <ul className="flex flex-col gap-1.5">
          {team.players.map((p) => {
            const pt = tactics.players[p.id]
            if (!pt) return null
            const heroId = heroIdOf(draft, you, p.id)
            const build = buildById(pt.build)
            const presets = buildsFor(p.role)
            return (
              <li
                key={p.id}
                className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-1.5"
              >
                {heroId ? <HeroGem heroId={heroId} size={32} /> : null}
                <div className="w-[88px] min-w-0 shrink-0">
                  <p className="truncate text-[12px] font-semibold text-white">{p.name}</p>
                  <p className="truncate text-[10.5px] text-white/45" title={build.blurb}>
                    {build.blurb}
                  </p>
                </div>
                <Select
                  label={COPY.buildLabel(p.name)}
                  value={pt.build}
                  options={presets.map((b) => ({ value: b.id, label: b.name }))}
                  onChange={(id) => update((t) => setPlayer(t, p, (x) => ({ ...x, build: id })))}
                  className="w-[136px]"
                />
                <span className="flex flex-1 items-center gap-1">
                  <span className="sr-only">
                    {COPY.itemsSr(build.items.map(itemName).join(", "))}
                  </span>
                  {build.items.map((id, i) => (
                    // oxlint-disable-next-line react/no-array-index-key -- builds may repeat an item
                    <ItemSlot key={i} id={id} size={22} />
                  ))}
                </span>
                <Switch
                  label={COPY.adaptiveLabel(p.name)}
                  checked={pt.adaptive}
                  onChange={(v) => update((t) => setPlayer(t, p, (x) => ({ ...x, adaptive: v })))}
                >
                  <span className="text-[11px] text-white/60">{COPY.adaptive}</span>
                </Switch>
              </li>
            )
          })}
        </ul>
      </Section>
      <div className="flex flex-col gap-3">
        <RadioCards<ShopTiming>
          name="shop-timing"
          legend={COPY.shopHeading}
          value={tactics.shopTiming}
          options={options(COPY.shopTiming)}
          onChange={(v) => update((t) => ({ ...t, shopTiming: v }))}
          columns={1}
        />
        <Section title={COPY.spike} hint={COPY.spikeHint}>
          <Switch
            label={COPY.spike}
            checked={tactics.spike}
            onChange={(v) => update((t) => ({ ...t, spike: v }))}
          >
            {tactics.spike ? "On" : "Off"}
          </Switch>
        </Section>
      </div>
    </div>
  )
}
