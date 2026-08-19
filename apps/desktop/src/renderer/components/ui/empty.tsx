import type { ComponentProps } from "react";
import { cn } from "@/lib/utils.js";

export function Empty({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex flex-col items-center justify-center gap-1.5 border-y border-border px-5 py-8 text-center", className)} {...props} />;
}

export function EmptyTitle({ className, ...props }: ComponentProps<"h3">) {
  return <h3 className={cn("text-[15px] font-semibold leading-[22px]", className)} {...props} />;
}

export function EmptyDescription({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("max-w-[56ch] text-[13px] leading-[20px] text-muted-foreground", className)} {...props} />;
}
