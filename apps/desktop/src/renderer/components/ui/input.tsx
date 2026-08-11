import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "../../lib/utils.js";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, type, ...props }, ref) {
    return (
    <input
      ref={ref}
      type={type}
      className={cn(
        "h-8 w-full min-w-0 rounded-md border border-input bg-background px-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/35 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
    );
  },
);
