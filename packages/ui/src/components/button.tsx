import {
  Button as AriaButton,
  type ButtonProps as AriaButtonProps,
  composeRenderProps,
} from "react-aria-components"
import { tv, type VariantProps } from "tailwind-variants"

export const buttonVariants = tv({
  base: [
    "inline-flex shrink-0 cursor-pointer select-none items-center justify-center gap-2 whitespace-nowrap",
    "rounded-full font-medium text-white/90 outline-none transition",
    "data-[hovered]:bg-white/12 data-[hovered]:text-white data-[pressed]:scale-95 data-[pressed]:bg-white/18",
    "data-[focus-visible]:ring-2 data-[focus-visible]:ring-white/70 data-[focus-visible]:ring-offset-0",
    "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40",
    "[&_svg]:size-[18px] [&_svg]:shrink-0",
  ],
  variants: {
    variant: {
      /** Floating glass pill — the default HUD look. */
      glass: "border border-white/12 bg-black/45 shadow-lg shadow-black/30 backdrop-blur-md",
      /** Bare — for buttons that live inside a Toolbar pill. */
      ghost: "bg-transparent",
      accent: "bg-emerald-500/90 text-white data-[hovered]:bg-emerald-400",
    },
    size: {
      sm: "h-8 px-3 text-xs",
      md: "h-11 px-5 text-sm",
      icon: "size-10",
      "icon-lg": "size-12",
    },
    selected: { true: "bg-white/20 text-white" },
  },
  defaultVariants: { variant: "glass", size: "md" },
})

export interface ButtonProps
  extends AriaButtonProps, Omit<VariantProps<typeof buttonVariants>, "selected"> {
  readonly isSelected?: boolean
}

export const Button = ({ className, variant, size, isSelected, ...props }: ButtonProps) => (
  <AriaButton
    {...props}
    className={composeRenderProps(className, (cls) =>
      buttonVariants({ variant, size, selected: isSelected, className: cls }),
    )}
  />
)
