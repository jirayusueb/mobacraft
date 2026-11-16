import {
  OverlayArrow,
  Popover as AriaPopover,
  type PopoverProps as AriaPopoverProps,
} from "react-aria-components"
import { composeTw } from "../lib/cn.ts"
import { glass } from "./panel.tsx"

export interface PopoverProps extends AriaPopoverProps {
  /** Draw a small arrow pointing at the trigger. */
  readonly showArrow?: boolean
}

/** Glass popover anchored to its trigger (pair with DialogTrigger + Dialog). */
export const Popover = ({
  className,
  children,
  showArrow = false,
  offset,
  ...props
}: PopoverProps) => (
  <AriaPopover
    offset={offset ?? (showArrow ? 14 : 10)}
    {...props}
    className={composeTw(
      className,
      [
        "rounded-2xl text-white outline-none",
        glass,
        "bg-neutral-950/80",
        "data-[entering]:animate-in data-[entering]:fade-in data-[entering]:zoom-in-95 data-[entering]:duration-150",
        "data-[exiting]:animate-out data-[exiting]:fade-out data-[exiting]:zoom-out-95 data-[exiting]:duration-100",
        "data-[placement=top]:data-[entering]:slide-in-from-bottom-1 data-[placement=bottom]:data-[entering]:slide-in-from-top-1",
      ].join(" "),
    )}
  >
    {(values) => (
      <>
        {showArrow ? (
          <OverlayArrow className="group">
            <svg
              viewBox="0 0 12 12"
              className="block size-3 fill-neutral-950/80 stroke-white/10 group-data-[placement=bottom]:rotate-180 group-data-[placement=left]:-rotate-90 group-data-[placement=right]:rotate-90"
              aria-hidden
            >
              <path d="M0 0 L6 6 L12 0" />
            </svg>
          </OverlayArrow>
        ) : null}
        {typeof children === "function" ? children(values) : children}
      </>
    )}
  </AriaPopover>
)
