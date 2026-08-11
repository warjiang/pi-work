import type { ComponentProps } from "react";
import { Icon } from "./icon.js";
import { cn } from "../../lib/utils.js";

export function Spinner({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn("inline-flex size-4 items-center justify-center text-[var(--muted)]", className)}
      {...props}
    >
      <Icon name="refresh" size={14} className="animate-spin" />
    </span>
  );
}
