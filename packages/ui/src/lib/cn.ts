import { type ClassValue, clsx } from "clsx"
import { composeRenderProps } from "react-aria-components"
import { twMerge } from "tailwind-merge"

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))

/** Merge a static class string with react-aria's render-prop className. */
export const composeTw = <T>(
  className: string | ((v: T) => string) | undefined,
  tw: string | ((v: T) => string),
) => composeRenderProps(className, (cls, v: T) => cn(typeof tw === "function" ? tw(v) : tw, cls))
