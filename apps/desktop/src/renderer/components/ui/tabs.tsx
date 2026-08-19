import * as TabsPrimitive from "@radix-ui/react-tabs";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils.js";

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn("inline-flex items-center gap-px rounded-[var(--radius-control)] border border-border bg-secondary p-0.5", className)} {...props} />;
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "inline-flex h-8 items-center justify-center rounded-[calc(var(--radius-control)-1px)] px-2.5 text-[13px] font-medium text-muted-foreground outline-none transition-[color,background-color,box-shadow] duration-[var(--dur-fast)] hover:text-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-[0_1px_1px_color-mix(in_srgb,var(--foreground)_4%,transparent)]",
        className,
      )}
      {...props}
    />
  );
}
