import type { ReactElement, ReactNode } from "react"
import { Tooltip as AriaTooltip, TooltipTrigger, type TooltipProps } from "react-aria-components"
import { cn } from "../lib/cn.ts"

interface Props extends Omit<TooltipProps, "children"> {
  readonly label: ReactNode
  /** Keyboard hint shown after the label, e.g. "Q". */
  readonly shortcut?: string
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
}: Props) => (
  <TooltipTrigger delay={350} closeDelay={0}>
    {children}
    <AriaTooltip
      {...props}
      placement={placement}
      offset={10}
      className={cn(
        "flex items-center gap-2 rounded-lg border border-white/10 bg-black/80 px-2.5 py-1.5 text-xs text-white shadow-xl backdrop-blur",
        "data-[entering]:animate-in data-[entering]:fade-in data-[entering]:zoom-in-95",
        "data-[exiting]:animate-out data-[exiting]:fade-out",
        typeof className === "string" ? className : undefined,
      )}
    >
      {label}
      {shortcut ? (
        <kbd className="rounded bg-white/15 px-1.5 font-mono text-[10px] text-white/80">
          {shortcut}
        </kbd>
      ) : null}
    </AriaTooltip>
  </TooltipTrigger>
)
