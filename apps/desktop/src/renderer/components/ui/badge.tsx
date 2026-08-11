import type { ComponentProps } from "react";
import { cn } from "../../lib/utils.js";

export function Badge({ className, ...props }: ComponentProps<"span">) {
  return <span className={cn("inline-flex items-center rounded-full bg-[var(--panel-muted)] px-2 py-1 text-[9px] text-[var(--muted)]", className)} {...props} />;
}
