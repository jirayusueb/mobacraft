import type { ReactElement, ReactNode } from "react"
import { Tooltip as AriaTooltip, TooltipTrigger, type TooltipProps } from "react-aria-components"
import { cn } from "../lib/cn.ts"
import { Kbd } from "./kbd.tsx"

interface Props extends Omit<TooltipProps, "children"> {
  readonly label: ReactNode
  /** Keyboard hint(s) shown after the label, e.g. "Q" or ["Shift", "?"]. */
  readonly shortcut?: string | readonly string[]
  readonly children: ReactElement
}

/** Hover/focus label for an icon button. The child must be a react-aria focusable (e.g. Button). */
export const Tooltip = ({
  label,
  shortcut,
  children,
  className,
  placement = "top",
  ...props
}: Props) => {
  const keys = shortcut === undefined ? [] : typeof shortcut === "string" ? [shortcut] : shortcut
  return (
    <TooltipTrigger delay={400} closeDelay={80}>
      {children}
      <AriaTooltip
        {...props}
        placement={placement}
        offset={10}
        className={cn(
          "flex items-center gap-2 rounded-xl border border-white/10 bg-neutral-950/90 py-1.5 pr-1.5 pl-2.5 text-xs font-medium text-white shadow-xl shadow-black/40 backdrop-blur-xl",
          keys.length === 0 && "pr-2.5",
          "data-[entering]:animate-in data-[entering]:fade-in data-[entering]:zoom-in-95 data-[entering]:duration-150",
          "data-[placement=top]:data-[entering]:slide-in-from-bottom-1 data-[placement=bottom]:data-[entering]:slide-in-from-top-1",
          "data-[exiting]:animate-out data-[exiting]:fade-out data-[exiting]:duration-75",
          "motion-reduce:animate-none",
          typeof className === "string" ? className : undefined,
        )}
      >
        {label}
        {keys.length > 0 ? (
          <span className="flex gap-0.5">
            {keys.map((k) => (
              <Kbd key={k}>{k}</Kbd>
            ))}
          </span>
        ) : null}
      </AriaTooltip>
    </TooltipTrigger>
  )
}
