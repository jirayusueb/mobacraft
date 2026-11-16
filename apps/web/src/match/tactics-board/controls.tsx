/** Small native-control wrappers for the tactics board — keyboard accessible, visible focus. */
import { cn } from "@mobacraft/ui"
import type { ReactNode } from "react"

export const focusRing =
  "outline-none focus-visible:ring-2 focus-visible:ring-sky-300/90 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950"

export const Section = ({
  title,
  hint,
  children,
  className,
}: {
  title: string
  hint?: string
  children: ReactNode
  className?: string
}) => (
  <section
    className={cn("rounded-xl border border-white/[0.07] bg-black/25 p-3", className)}
    aria-label={title}
  >
    <div className="mb-2 flex items-start gap-2">
      <div className="min-w-0 flex-1">
        <h2 className="text-[13px] font-semibold text-white">{title}</h2>
        {hint ? <p className="mt-0.5 text-[11px] text-white/55">{hint}</p> : null}
      </div>
    </div>
    {children}
  </section>
)

export const Select = <T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (v: T) => void
  className?: string
}) => (
  <select
    aria-label={label}
    value={value}
    onChange={(e) => onChange(e.currentTarget.value as T)}
    className={cn(
      "h-8 cursor-pointer rounded-lg border border-white/15 bg-neutral-900/80 px-2 text-[12px] text-white hover:border-white/30",
      focusRing,
      className,
    )}
  >
    {options.map((o) => (
      <option key={o.value} value={o.value} className="bg-neutral-900">
        {o.label}
      </option>
    ))}
  </select>
)

/** A labelled on/off switch (native checkbox with role=switch). */
export const Switch = ({
  label,
  checked,
  onChange,
  children,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  children?: ReactNode
}) => (
  <label className="group inline-flex cursor-pointer items-center gap-2 text-[12px] text-white/80">
    <input
      type="checkbox"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      checked={checked}
      onChange={(e) => onChange(e.currentTarget.checked)}
      className="peer sr-only"
    />
    <span
      className={cn(
        "relative inline-block h-5 w-9 shrink-0 rounded-full ring-1 ring-white/15 ring-inset transition-colors motion-reduce:transition-none",
        "peer-focus-visible:ring-2 peer-focus-visible:ring-sky-300/90 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-neutral-950",
        checked ? "bg-radiant/70" : "bg-white/10",
      )}
      aria-hidden
    >
      <span
        className={cn(
          "absolute top-0.5 size-4 rounded-full bg-white shadow transition-[left] motion-reduce:transition-none",
          checked ? "left-[18px]" : "left-0.5",
        )}
      />
    </span>
    {children}
  </label>
)

/** A fieldset of radio cards: title + one-line explanation each. */
export const RadioCards = <T extends string>({
  name,
  legend,
  sub,
  value,
  options,
  onChange,
  columns = 2,
}: {
  name: string
  legend: string
  sub?: string
  value: T
  options: readonly { value: T; title: string; body: string }[]
  onChange: (v: T) => void
  columns?: 1 | 2 | 3 | 4
}) => (
  <fieldset className="min-w-0 rounded-xl border border-white/[0.07] bg-black/25 p-3">
    <legend className="sr-only">{legend}</legend>
    <div className="mb-2" aria-hidden>
      <p className="text-[13px] font-semibold text-white">{legend}</p>
      {sub ? <p className="text-[11px] text-white/50">{sub}</p> : null}
    </div>
    <div
      className={cn(
        "grid gap-1.5",
        columns === 1 && "grid-cols-1",
        columns === 2 && "grid-cols-2",
        columns === 3 && "grid-cols-3",
        columns === 4 && "grid-cols-4",
      )}
    >
      {options.map((o) => {
        const on = o.value === value
        return (
          <label
            key={o.value}
            className={cn(
              "relative flex cursor-pointer flex-col rounded-lg border px-2.5 py-2 transition-colors motion-reduce:transition-none",
              "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-sky-300/90",
              on
                ? "border-white/40 bg-white/[0.12]"
                : "border-white/[0.07] bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]",
            )}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={on}
              onChange={() => onChange(o.value)}
              className="sr-only"
            />
            <span className="flex items-center gap-1.5 text-[12px] font-semibold text-white">
              <span
                className={cn(
                  "grid size-3 place-items-center rounded-full ring-1 ring-inset",
                  on ? "ring-white" : "ring-white/35",
                )}
                aria-hidden
              >
                {on ? <span className="size-1.5 rounded-full bg-white" /> : null}
              </span>
              {o.title}
            </span>
            <span className="mt-0.5 text-[11px] leading-snug text-white/60">{o.body}</span>
          </label>
        )
      })}
    </div>
  </fieldset>
)
