import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/utils.js";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-xs font-medium transition-colors outline-none disabled:pointer-events-none disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--panel)] [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "border border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-text)] hover:opacity-90",
        destructive: "border border-[var(--danger)] bg-[var(--danger)] text-white hover:opacity-90",
        outline: "border border-[var(--border)] bg-[var(--panel)] text-[var(--text)] hover:bg-[var(--hover)]",
        secondary: "border border-transparent bg-[var(--panel-muted)] text-[var(--text)] hover:bg-[var(--hover)]",
        ghost: "border border-transparent bg-transparent text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]",
      },
      size: {
        default: "h-8 px-3",
        sm: "h-7 px-2.5 text-[11px]",
        icon: "size-7 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement>
  & VariantProps<typeof buttonVariants>
  & { asChild?: boolean };

export function Button({ asChild = false, className, variant, size, ...props }: ButtonProps) {
  const Component = asChild ? Slot : "button";
  return <Component className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { buttonVariants };
