import {
  Button as AriaButton,
  type ButtonProps as AriaButtonProps,
  composeRenderProps,
  ToggleButton as AriaToggleButton,
  type ToggleButtonProps as AriaToggleButtonProps,
} from "react-aria-components"
import { tv, type VariantProps } from "tailwind-variants"
import { glass } from "./panel.tsx"

export const buttonVariants = tv({
  base: [
    "relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap select-none",
    "rounded-full font-medium text-white/85 outline-none",
    "transition-[background-color,color,transform,box-shadow] duration-150 ease-out motion-reduce:transition-none",
    "data-[hovered]:bg-white/10 data-[hovered]:text-white",
    "data-[pressed]:scale-[0.96] data-[pressed]:bg-white/15 motion-reduce:data-[pressed]:scale-100",
    "data-[focus-visible]:ring-2 data-[focus-visible]:ring-sky-300/90 data-[focus-visible]:ring-offset-2 data-[focus-visible]:ring-offset-neutral-950",
    "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-35 data-[disabled]:data-[hovered]:bg-transparent",
    "data-[selected]:bg-white/20 data-[selected]:text-white data-[selected]:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)] data-[selected]:data-[hovered]:bg-white/25",
    "[&_svg]:size-[18px] [&_svg]:shrink-0",
  ],
  variants: {
    variant: {
      /** Floating glass pill — the default HUD look. */
      glass: `${glass} data-[hovered]:bg-neutral-900/70`,
      /** Bare — for buttons that live inside a Toolbar pill. */
      ghost: "bg-transparent",
      accent: "bg-emerald-500/90 text-white data-[hovered]:bg-emerald-400",
    },
    size: {
      sm: "h-8 px-3 text-xs",
      md: "h-12 px-5 text-sm",
      icon: "size-10",
      "icon-sm": "size-7 [&_svg]:size-4",
      "icon-lg": "size-12",
    },
    selected: {
      true: "bg-white/90 text-neutral-900 data-[hovered]:bg-white data-[hovered]:text-neutral-900",
    },
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

export interface ToggleButtonProps
  extends AriaToggleButtonProps, Omit<VariantProps<typeof buttonVariants>, "selected"> {}

/** On/off button (aria-pressed); selected state renders as a lit, outlined chip. */
export const ToggleButton = ({ className, variant, size, ...props }: ToggleButtonProps) => (
  <AriaToggleButton
    {...props}
    className={composeRenderProps(className, (cls) =>
      buttonVariants({ variant, size, className: cls }),
    )}
  />
)
