import type { ComponentProps } from "react";
import { cn } from "../../lib/utils.js";

export function Spinner({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn("inline-block size-3 animate-spin rounded-full border-2 border-[var(--border-strong)] border-t-[var(--text)]", className)}
      {...props}
    />
  );
}
