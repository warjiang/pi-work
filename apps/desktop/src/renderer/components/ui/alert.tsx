import type { ComponentProps } from "react";
import { cn } from "../../lib/utils.js";

export function Alert({ className, ...props }: ComponentProps<"div">) {
  return <div role="alert" className={cn("relative rounded-lg border border-border bg-background p-3 text-sm text-foreground", className)} {...props} />;
}

export function AlertTitle({ className, ...props }: ComponentProps<"h5">) {
  return <h5 className={cn("font-medium", className)} {...props} />;
}

export function AlertDescription({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("text-xs leading-5 text-muted-foreground", className)} {...props} />;
}
