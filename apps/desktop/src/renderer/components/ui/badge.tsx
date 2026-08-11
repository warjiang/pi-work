import type { ComponentProps } from "react";
import { cn } from "../../lib/utils.js";

export function Badge({ className, ...props }: ComponentProps<"span">) {
  return <span className={cn("inline-flex items-center rounded-md bg-secondary px-2 py-1 text-xs text-secondary-foreground", className)} {...props} />;
}
