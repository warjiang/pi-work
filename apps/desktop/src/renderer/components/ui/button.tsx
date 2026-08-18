import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils.js";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--radius-control)] text-[13px] font-medium transition-[color,background-color,border-color,box-shadow,transform] duration-[var(--dur-fast)] ease-[var(--ease-standard)] outline-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "border border-primary bg-primary text-primary-foreground hover:bg-primary/90 active:translate-y-px",
        destructive: "border border-destructive bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground",
        secondary: "border border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "border border-transparent bg-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        link: "border border-transparent bg-transparent text-primary underline-offset-4 hover:underline",
      },
      size: {
        compact: "h-8 px-2.5",
        default: "h-8 px-3",
        prominent: "h-9 px-4 text-sm",
        sm: "h-8 px-2.5",
        icon: "size-8 p-0",
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

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { asChild = false, className, variant, size, ...props },
  ref,
) {
  const Component = asChild ? Slot : "button";
  return <Component ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
});

export { buttonVariants };
