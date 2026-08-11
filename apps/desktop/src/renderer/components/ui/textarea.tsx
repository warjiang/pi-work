import type { TextareaHTMLAttributes } from "react";
import { cn } from "../../lib/utils.js";

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "min-h-16 w-full resize-y rounded-md border border-[var(--border)] bg-[var(--panel)] px-2.5 py-2 text-xs outline-none placeholder:text-[var(--faint)] focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
