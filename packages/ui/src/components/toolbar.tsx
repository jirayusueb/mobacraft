import {
  Separator as AriaSeparator,
  Toolbar as AriaToolbar,
  type SeparatorProps,
  type ToolbarProps,
} from "react-aria-components"
import { cn, composeTw } from "../lib/cn.ts"
import { glass } from "./panel.tsx"

/** Glass pill grouping several ghost buttons; arrow keys move between them (react-aria). */
export const Toolbar = ({ className, ...props }: ToolbarProps) => (
  <AriaToolbar
    {...props}
    className={composeTw(className, `flex h-12 items-center gap-0.5 rounded-full p-1 ${glass}`)}
  />
)

export const Separator = ({ className, ...props }: SeparatorProps) => (
  <AriaSeparator
    orientation="vertical"
    {...props}
    className={cn("mx-1.5 h-5 w-px shrink-0 bg-white/15", className)}
  />
)
