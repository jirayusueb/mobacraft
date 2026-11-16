import type { ComponentProps } from "react"
import {
  Dialog as AriaDialog,
  type DialogProps,
  DialogTrigger,
  Heading,
  type HeadingProps,
} from "react-aria-components"
import { cn } from "../lib/cn.ts"

export { DialogTrigger }

/** Accessible dialog content; place inside a Popover (or Modal). */
export const Dialog = ({ className, ...props }: DialogProps) => (
  <AriaDialog {...props} className={cn("relative p-4 outline-none", className)} />
)

export const DialogHeader = ({ className, ...props }: ComponentProps<"div">) => (
  <div {...props} className={cn("mb-3 flex items-center justify-between gap-3", className)} />
)

export const DialogTitle = ({ className, ...props }: HeadingProps) => (
  <Heading
    slot="title"
    {...props}
    className={cn("text-sm font-semibold tracking-tight text-white", className)}
  />
)
