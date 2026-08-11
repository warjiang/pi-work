import type { ComponentProps } from "react";
import { cn } from "../../lib/utils.js";

export function Empty({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border p-12 text-center", className)} {...props} />;
}

export function EmptyTitle({ className, ...props }: ComponentProps<"h3">) {
  return <h3 className={cn("text-sm font-medium", className)} {...props} />;
}

export function EmptyDescription({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("text-xs text-muted-foreground", className)} {...props} />;
}
