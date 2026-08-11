import type { ComponentProps } from "react";
import { cn } from "../../lib/utils.js";

export function Alert({ className, ...props }: ComponentProps<"div">) {
  return <div role="alert" className={cn("relative rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3 text-xs", className)} {...props} />;
}

export function AlertTitle({ className, ...props }: ComponentProps<"h5">) {
  return <h5 className={cn("font-medium", className)} {...props} />;
}

export function AlertDescription({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("text-[11px] leading-5 text-[var(--muted)]", className)} {...props} />;
}
