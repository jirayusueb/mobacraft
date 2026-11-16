import type { ComponentProps } from "react"
import { cn } from "../lib/cn.ts"

/** Keyboard key cap, e.g. <Kbd>Q</Kbd>. */
export const Kbd = ({ className, ...props }: ComponentProps<"kbd">) => (
  <kbd
    {...props}
    className={cn(
      "inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-white/15 border-b-white/25 bg-white/10 px-1.5",
      "font-sans text-[10px] leading-none font-semibold text-white/85 tabular-nums shadow-[inset_0_-1px_0_rgba(0,0,0,0.35)]",
      className,
    )}
  />
)
