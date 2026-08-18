import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/lib/utils.js";

export const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      "group peer relative inline-flex h-8 w-10 shrink-0 cursor-pointer items-center rounded-[var(--radius-control)] border-0 bg-transparent shadow-none transition-colors focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  >
    <span className="pointer-events-none absolute inset-x-0.5 top-1.5 h-5 rounded-full bg-input shadow-sm transition-colors group-data-[state=checked]:bg-primary" />
    <SwitchPrimitive.Thumb
      className="pointer-events-none relative z-10 ml-1 block h-4 w-4 rounded-full bg-background shadow-sm ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0"
    />
  </SwitchPrimitive.Root>
));
Switch.displayName = SwitchPrimitive.Root.displayName;
