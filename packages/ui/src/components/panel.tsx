import type { ComponentProps } from "react"
import { cn } from "../lib/cn.ts"

/** The floating dark-glass surface every HUD element sits on. */
export const glass =
  "border border-white/10 bg-neutral-950/55 shadow-[0_8px_24px_-6px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-xl backdrop-saturate-150"

export const Panel = ({ className, ...props }: ComponentProps<"div">) => (
  <div {...props} className={cn("rounded-2xl", glass, className)} />
)
