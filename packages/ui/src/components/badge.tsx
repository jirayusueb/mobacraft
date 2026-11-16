import type { ComponentProps } from "react"
import { tv, type VariantProps } from "tailwind-variants"

export const badgeVariants = tv({
  base: "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] leading-4 font-semibold tracking-wider whitespace-nowrap uppercase [&_svg]:size-3",
  variants: {
    tone: {
      default: "bg-white/10 text-white/80",
      radiant: "bg-radiant/15 text-radiant",
      dire: "bg-dire/15 text-dire",
      neutral: "bg-neutral-team/15 text-neutral-team",
    },
    /** Leading coloured dot (uses currentColor). */
    dot: { true: "before:size-1.5 before:rounded-full before:bg-current before:content-['']" },
  },
  defaultVariants: { tone: "default" },
})

export interface BadgeProps extends ComponentProps<"span">, VariantProps<typeof badgeVariants> {}

export const Badge = ({ className, tone, dot, ...props }: BadgeProps) => (
  <span {...props} className={badgeVariants({ tone, dot, className })} />
)
