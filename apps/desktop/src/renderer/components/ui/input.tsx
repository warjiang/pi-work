import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "../../lib/utils.js";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, type, ...props }, ref) {
    return (
    <input
      ref={ref}
      type={type}
      className={cn(
        "h-8 w-full min-w-0 rounded-md border border-[var(--border)] bg-[var(--panel)] px-2.5 text-xs outline-none placeholder:text-[var(--faint)] focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
    );
  },
);
