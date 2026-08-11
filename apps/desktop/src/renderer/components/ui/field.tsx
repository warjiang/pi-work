import type { ComponentProps } from "react";
import { cn } from "../../lib/utils.js";

export function FieldGroup({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-3", className)} {...props} />;
}

export function Field({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-1.5", className)} {...props} />;
}

export function FieldLabel({ className, ...props }: ComponentProps<"label">) {
  return <label className={cn("text-[11px] font-medium", className)} {...props} />;
}

export function FieldDescription({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("text-[10px] text-[var(--muted)]", className)} {...props} />;
}
