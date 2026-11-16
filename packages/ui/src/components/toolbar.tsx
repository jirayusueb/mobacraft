import {
  Separator as AriaSeparator,
  Toolbar as AriaToolbar,
  type SeparatorProps,
  type ToolbarProps,
} from "react-aria-components"
import { cn, composeTw } from "../lib/cn.ts"

/** Glass pill grouping several ghost buttons; arrow keys move between them (react-aria). */
export const Toolbar = ({ className, ...props }: ToolbarProps) => (
  <AriaToolbar
    {...props}
    className={composeTw(
      className,
      "flex items-center gap-0.5 rounded-full border border-white/12 bg-black/45 p-1 shadow-lg shadow-black/30 backdrop-blur-md",
    )}
  />
)

export const Separator = ({ className, ...props }: SeparatorProps) => (
  <AriaSeparator
    orientation="vertical"
    {...props}
    className={cn("mx-1 h-6 w-px bg-white/15", className)}
  />
)
