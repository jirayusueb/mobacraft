import {
  Button,
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Kbd,
  Popover,
  Tooltip,
} from "@mobacraft/ui"
import { CircleHelp } from "lucide-react"
import { CONTROLS, t } from "../strings.ts"

/** '?' button opening a popover that lists every control. */
export const HelpPopover = ({
  isOpen,
  onOpenChange,
}: {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}) => (
  <DialogTrigger isOpen={isOpen} onOpenChange={onOpenChange}>
    <Tooltip label={t("hud.help")} shortcut="?">
      <Button variant="ghost" size="icon" aria-label={t("hud.help")} isSelected={isOpen}>
        <CircleHelp />
      </Button>
    </Tooltip>
    <Popover placement="top" showArrow className="w-72">
      <Dialog>
        <DialogHeader>
          <DialogTitle>{t("hud.help")}</DialogTitle>
          <span className="text-[11px] text-white/45">{t("hud.title")}</span>
        </DialogHeader>
        <ul className="space-y-0.5 text-xs">
          {CONTROLS.map((c) => (
            <li
              key={c.action}
              className="flex items-center justify-between gap-4 rounded-lg px-1.5 py-1 odd:bg-white/[0.03]"
            >
              <span className="text-white/75">{c.action}</span>
              <span className="flex gap-1">
                {c.keys.map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </Dialog>
    </Popover>
  </DialogTrigger>
)
