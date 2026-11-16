import {
  Label,
  Slider as AriaSlider,
  SliderOutput,
  type SliderProps,
  SliderThumb,
  SliderTrack,
} from "react-aria-components"
import { composeTw } from "../lib/cn.ts"

interface Props extends SliderProps<number> {
  readonly label?: string
  readonly formatValue?: (v: number) => string
}

export const Slider = ({ label, formatValue, className, ...props }: Props) => (
  <AriaSlider {...props} className={composeTw(className, "flex w-full flex-col gap-2")}>
    {label ? (
      <div className="flex justify-between text-xs text-white/70">
        <Label>{label}</Label>
        <SliderOutput>
          {({ state }) =>
            formatValue ? formatValue(state.getThumbValue(0)) : state.getThumbValueLabel(0)
          }
        </SliderOutput>
      </div>
    ) : null}
    <SliderTrack className="relative h-5 w-full">
      {({ state }) => (
        <>
          <div className="absolute top-1/2 h-1.5 w-full -translate-y-1/2 rounded-full bg-white/15" />
          <div
            className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-white/70"
            style={{ width: `${state.getThumbPercent(0) * 100}%` }}
          />
          <SliderThumb className="top-1/2 size-4 cursor-grab rounded-full border-2 border-white bg-neutral-900 shadow outline-none transition data-[dragging]:scale-110 data-[focus-visible]:ring-2 data-[focus-visible]:ring-white/70" />
        </>
      )}
    </SliderTrack>
  </AriaSlider>
)
