import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils.js";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, type, ...props }, ref) {
    return (
    <input
      ref={ref}
      type={type}
      className={cn(
        "h-8 w-full min-w-0 rounded-[var(--radius-field)] border border-input bg-background px-2.5 text-[13px] text-foreground outline-none transition-[color,background-color,border-color,box-shadow] duration-[var(--dur-fast)] ease-[var(--ease-standard)] placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
    );
  },
);
