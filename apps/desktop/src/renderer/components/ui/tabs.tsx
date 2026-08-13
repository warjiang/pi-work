import * as TabsPrimitive from "@radix-ui/react-tabs";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils.js";

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn("inline-flex items-center gap-1 rounded-full bg-secondary p-1", className)} {...props} />;
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "inline-flex h-8 items-center justify-center rounded-[var(--radius-control)] px-3 text-sm font-medium text-muted-foreground outline-none hover:text-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm",
        className,
      )}
      {...props}
    />
  );
}
