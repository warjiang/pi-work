import type { ComponentProps } from "react";
import { cn } from "@/lib/utils.js";

export function Badge({ className, ...props }: ComponentProps<"span">) {
  return <span className={cn("inline-flex items-center rounded-full bg-secondary px-3 py-1 text-[13px] font-medium text-secondary-foreground", className)} {...props} />;
}
