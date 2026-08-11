import * as SwitchPrimitive from "@radix-ui/react-switch";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils.js";

export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "inline-flex h-[18px] w-[30px] shrink-0 cursor-pointer items-center rounded-full bg-input p-0.5 outline-none transition-colors data-[state=checked]:bg-primary focus-visible:ring-2 focus-visible:ring-ring/35 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-3.5 rounded-full bg-foreground shadow-sm transition-transform data-[state=checked]:translate-x-3 data-[state=checked]:bg-primary-foreground" />
    </SwitchPrimitive.Root>
  );
}
