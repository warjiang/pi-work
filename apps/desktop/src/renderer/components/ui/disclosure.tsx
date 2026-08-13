import type { ComponentProps } from "react";
import { cn } from "@/lib/utils.js";

export function Disclosure({ className, ...props }: ComponentProps<"details">) {
  return <details className={cn(className)} {...props} />;
}

export function DisclosureTrigger({ className, ...props }: ComponentProps<"summary">) {
  return <summary className={cn(className)} {...props} />;
}

export function DisclosureContent({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn(className)} {...props} />;
}
