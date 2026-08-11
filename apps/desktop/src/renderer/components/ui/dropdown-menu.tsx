import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import type { ComponentProps } from "react";
import { Icon } from "./icon.js";
import { cn } from "../../lib/utils.js";

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuGroup = DropdownMenuPrimitive.Group;
export const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;
export const DropdownMenuSub = DropdownMenuPrimitive.Sub;

export function DropdownMenuContent({ className, sideOffset = 4, ...props }: ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          "z-50 min-w-36 overflow-hidden rounded-[var(--radius-overlay)] border border-border bg-popover p-1 text-popover-foreground shadow-xl data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({ className, inset, ...props }: ComponentProps<typeof DropdownMenuPrimitive.Item> & { inset?: boolean }) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        "flex h-8 cursor-default select-none items-center gap-2 rounded-[var(--radius-control)] px-2 text-xs outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:opacity-50 [&_svg]:size-3.5 [&_svg]:shrink-0",
        inset && "pl-8",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuCheckboxItem({ className, children, checked, ...props }: ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      checked={checked ?? false}
      className={cn(
        "relative flex min-h-8 cursor-default select-none items-center rounded-[var(--radius-control)] py-1.5 pl-7 pr-2 text-xs outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      <span className="absolute left-2 flex size-3.5 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <Icon name="check" size={14} />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  );
}

export function DropdownMenuRadioItem({ className, children, ...props }: ComponentProps<typeof DropdownMenuPrimitive.RadioItem>) {
  return (
    <DropdownMenuPrimitive.RadioItem
      className={cn(
        "relative flex min-h-8 cursor-default select-none items-center rounded-[var(--radius-control)] py-1.5 pl-7 pr-2 text-xs outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      <span className="absolute left-2 flex size-3.5 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <Icon name="check" size={14} />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  );
}

export function DropdownMenuLabel({ className, inset, ...props }: ComponentProps<typeof DropdownMenuPrimitive.Label> & { inset?: boolean }) {
  return (
    <DropdownMenuPrimitive.Label
      className={cn("px-2 py-1.5 text-xs font-medium text-muted-foreground", inset && "pl-8", className)}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({ className, ...props }: ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return <DropdownMenuPrimitive.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />;
}

export function DropdownMenuSubTrigger({ className, inset, children, ...props }: ComponentProps<typeof DropdownMenuPrimitive.SubTrigger> & { inset?: boolean }) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      className={cn(
        "flex min-h-9 cursor-default select-none items-center gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-xs outline-none data-[state=open]:bg-accent data-[state=open]:text-accent-foreground data-[disabled]:pointer-events-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:opacity-50",
        inset && "pl-8",
        className,
      )}
      {...props}
    >
      {children}
      <Icon name="forward" size={14} className="ml-auto" />
    </DropdownMenuPrimitive.SubTrigger>
  );
}

export function DropdownMenuSubContent({ className, sideOffset = 6, ...props }: ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.SubContent
        sideOffset={sideOffset}
        className={cn(
          "min-w-44 overflow-hidden rounded-[var(--radius-overlay)] border border-border bg-popover p-1 text-popover-foreground shadow-xl data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}
