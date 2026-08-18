import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils.js";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn(
          "min-h-16 w-full resize-y rounded-[var(--radius-field)] border border-input bg-background px-2.5 py-1.5 text-[13px] text-foreground outline-none transition-[color,background-color,border-color,box-shadow] duration-[var(--dur-fast)] ease-[var(--ease-standard)] placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      />
    );
  },
);
