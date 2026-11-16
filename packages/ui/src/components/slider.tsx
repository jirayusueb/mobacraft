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
  /** CSS background for the track (e.g. a gradient); defaults to a plain fill. */
  readonly trackBackground?: string
}

export const Slider = ({ label, formatValue, trackBackground, className, ...props }: Props) => (
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
    <SliderTrack className="group relative h-6 w-full cursor-pointer">
      {({ state }) => (
        <>
          <div
            className="absolute top-1/2 h-1.5 w-full -translate-y-1/2 rounded-full bg-white/15 ring-1 ring-white/10 ring-inset"
            style={trackBackground ? { background: trackBackground } : undefined}
          />
          {trackBackground ? null : (
            <div
              className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-white/75"
              style={{ width: `${state.getThumbPercent(0) * 100}%` }}
            />
          )}
          <SliderThumb className="top-1/2 size-4 cursor-grab rounded-full border-2 border-white bg-neutral-900 shadow-[0_1px_4px_rgba(0,0,0,0.6)] outline-none transition-transform duration-150 data-[dragging]:scale-125 data-[dragging]:cursor-grabbing data-[focus-visible]:ring-2 data-[focus-visible]:ring-sky-300/90 data-[focus-visible]:ring-offset-2 data-[focus-visible]:ring-offset-neutral-950 data-[hovered]:scale-110 motion-reduce:transition-none" />
        </>
      )}
    </SliderTrack>
  </AriaSlider>
)
