import * as TogglePrimitive from "@radix-ui/react-toggle";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils.js";

export function Toggle({ className, ...props }: ComponentProps<typeof TogglePrimitive.Root>) {
  return (
    <TogglePrimitive.Root
      className={cn(
        "inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-2 text-[10px] text-[var(--muted)] outline-none hover:bg-[var(--hover)] hover:text-[var(--text)] data-[state=on]:bg-[var(--hover)] data-[state=on]:text-[var(--text)] focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
        className,
      )}
      {...props}
    />
  );
}
