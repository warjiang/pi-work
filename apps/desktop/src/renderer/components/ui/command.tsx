import { Command as CommandPrimitive } from "cmdk";
import type { ComponentProps } from "react";
import { Icon } from "./icon.js";
import { cn } from "../../lib/utils.js";

export function Command({ className, ...props }: ComponentProps<typeof CommandPrimitive>) {
  return <CommandPrimitive className={cn("flex h-full w-full flex-col overflow-hidden rounded-[var(--radius-control)] bg-popover text-popover-foreground", className)} {...props} />;
}

export function CommandInput({ className, ...props }: ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div className="flex items-center gap-2 border-b border-border px-2.5" cmdk-input-wrapper="">
      <Icon name="search" size={14} className="shrink-0 text-muted-foreground" />
      <CommandPrimitive.Input
        className={cn("h-9 w-full min-w-0 bg-transparent py-2 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50", className)}
        {...props}
      />
    </div>
  );
}

export function CommandList({ className, ...props }: ComponentProps<typeof CommandPrimitive.List>) {
  return <CommandPrimitive.List className={cn("max-h-64 overflow-y-auto overflow-x-hidden p-1", className)} {...props} />;
}

export function CommandEmpty({ className, ...props }: ComponentProps<typeof CommandPrimitive.Empty>) {
  return <CommandPrimitive.Empty className={cn("py-5 text-center text-xs text-muted-foreground", className)} {...props} />;
}

export function CommandGroup({ className, ...props }: ComponentProps<typeof CommandPrimitive.Group>) {
  return <CommandPrimitive.Group className={cn("overflow-hidden p-0 text-foreground", className)} {...props} />;
}

export function CommandItem({ className, ...props }: ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      className={cn(
        "flex h-9 cursor-default select-none items-center rounded-[var(--radius-control)] px-2.5 text-sm outline-none data-[disabled=true]:pointer-events-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground data-[disabled=true]:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
