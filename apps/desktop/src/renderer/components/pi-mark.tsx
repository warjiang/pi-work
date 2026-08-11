import { cn } from "../lib/utils.js";

const appIconUrl = new URL("../../../resources/icons/source/app-icon.svg", import.meta.url).href;

export function PiMark({
  className,
  size = "default",
}: {
  className?: string;
  size?: "compact" | "default" | "hero";
}) {
  return (
    <img
      aria-hidden="true"
      className={cn("pi-mark", `pi-mark-${size}`, className)}
      src={appIconUrl}
    />
  );
}
