import appIconUrl from "@resources/icons/source/app-icon.svg?url";
import { cn } from "@/lib/utils.js";

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
