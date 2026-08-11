import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils.js";
import { Button, type ButtonProps } from "./button.js";

const attachmentVariants = cva(
  "group/attachment relative flex max-w-full min-w-0 shrink-0 items-center rounded-lg border border-border bg-card text-card-foreground transition-colors",
  {
    variants: {
      size: {
        default: "min-w-48 gap-2 p-2 text-sm",
        sm: "min-w-40 gap-2 p-1.5 text-xs",
      },
    },
    defaultVariants: {
      size: "default",
    },
  },
);

export function Attachment({
  className,
  size,
  ...props
}: ComponentProps<"div"> & VariantProps<typeof attachmentVariants>) {
  return <div data-slot="attachment" className={cn(attachmentVariants({ size }), className)} {...props} />;
}

export function AttachmentGroup({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="attachment-group"
      className={cn("flex min-w-0 snap-x gap-2 overflow-x-auto overscroll-x-contain py-1", className)}
      {...props}
    />
  );
}

export function AttachmentMedia({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="attachment-media"
      className={cn("flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-muted-foreground", className)}
      {...props}
    />
  );
}

export function AttachmentContent({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="attachment-content" className={cn("min-w-0 flex-1 leading-tight", className)} {...props} />;
}

export function AttachmentTitle({ className, ...props }: ComponentProps<"span">) {
  return <span data-slot="attachment-title" className={cn("block truncate font-medium", className)} {...props} />;
}

export function AttachmentDescription({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="attachment-description"
      className={cn("mt-1 block truncate text-xs text-muted-foreground", className)}
      {...props}
    />
  );
}

export function AttachmentActions({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="attachment-actions" className={cn("flex shrink-0 items-center", className)} {...props} />;
}

export function AttachmentAction({ className, size = "icon", variant = "ghost", ...props }: ButtonProps) {
  return (
    <Button
      data-slot="attachment-action"
      className={cn("size-6", className)}
      size={size}
      variant={variant}
      {...props}
    />
  );
}
