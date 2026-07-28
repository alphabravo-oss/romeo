import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { type ReactNode, useRef } from "react";
import { Button, type ButtonProps } from "./button";
import { cn } from "./lib/cn";

export interface DialogProps {
  children: ReactNode;
  className?: string;
  closeLabel?: string;
  description?: ReactNode;
  footer?: ReactNode;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
  title: ReactNode;
  trigger?: ReactNode;
}

export function Dialog({
  children,
  className,
  closeLabel = "Close",
  description,
  footer,
  onOpenChange,
  open,
  title,
  trigger,
}: DialogProps) {
  const openerRef = useRef<HTMLElement | null>(null);
  const previousOpenRef = useRef(open);
  if (
    open === true &&
    previousOpenRef.current !== true &&
    typeof document !== "undefined"
  ) {
    openerRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
  }
  previousOpenRef.current = open;
  return (
    <DialogPrimitive.Root
      {...(onOpenChange ? { onOpenChange } : {})}
      {...(open === undefined ? {} : { open })}
    >
      {trigger ? (
        <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>
      ) : null}
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="rm-ui-overlay" />
        <DialogPrimitive.Content
          className={cn("rm-ui-dialog", className)}
          onCloseAutoFocus={(event) => {
            const opener = openerRef.current;
            openerRef.current = null;
            if (opener?.isConnected !== true) return;
            event.preventDefault();
            opener.focus();
          }}
          onOpenAutoFocus={() => {
            openerRef.current ??=
              document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;
          }}
        >
          <div className="rm-ui-dialog__header">
            <div>
              <DialogPrimitive.Title className="rm-ui-dialog__title">
                {title}
              </DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="rm-ui-dialog__description">
                  {description}
                </DialogPrimitive.Description>
              ) : null}
            </div>
            <DialogPrimitive.Close asChild>
              <Button aria-label={closeLabel} size="icon" variant="ghost">
                ×
              </Button>
            </DialogPrimitive.Close>
          </div>
          <div className="rm-ui-dialog__body">{children}</div>
          {footer ? <div className="rm-ui-dialog__footer">{footer}</div> : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function Sheet({
  side = "right",
  ...props
}: DialogProps & { side?: "left" | "right" }) {
  return (
    <Dialog
      {...props}
      className={cn("rm-ui-sheet", `rm-ui-sheet--${side}`, props.className)}
    />
  );
}

export interface AlertDialogProps {
  actionLabel?: string;
  actionProps?: ButtonProps;
  cancelLabel?: string;
  children: ReactNode;
  onConfirm: () => void | Promise<void>;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
  title: ReactNode;
  trigger?: ReactNode;
}

export function AlertDialog({
  actionLabel = "Continue",
  actionProps,
  cancelLabel = "Cancel",
  children,
  onConfirm,
  onOpenChange,
  open,
  title,
  trigger,
}: AlertDialogProps) {
  const openerRef = useRef<HTMLElement | null>(null);
  const previousOpenRef = useRef(open);
  if (
    open === true &&
    previousOpenRef.current !== true &&
    typeof document !== "undefined"
  ) {
    openerRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
  }
  previousOpenRef.current = open;
  return (
    <AlertDialogPrimitive.Root
      {...(onOpenChange ? { onOpenChange } : {})}
      {...(open === undefined ? {} : { open })}
    >
      {trigger ? (
        <AlertDialogPrimitive.Trigger asChild>
          {trigger}
        </AlertDialogPrimitive.Trigger>
      ) : null}
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className="rm-ui-overlay" />
        <AlertDialogPrimitive.Content
          className="rm-ui-alert-dialog"
          onCloseAutoFocus={(event) => {
            const opener = openerRef.current;
            openerRef.current = null;
            if (opener?.isConnected !== true) return;
            event.preventDefault();
            opener.focus();
          }}
          onOpenAutoFocus={() => {
            openerRef.current ??=
              document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;
          }}
        >
          <AlertDialogPrimitive.Title className="rm-ui-dialog__title">
            {title}
          </AlertDialogPrimitive.Title>
          <AlertDialogPrimitive.Description
            className="rm-ui-dialog__description"
            asChild
          >
            <div>{children}</div>
          </AlertDialogPrimitive.Description>
          <div className="rm-ui-dialog__footer">
            <AlertDialogPrimitive.Cancel asChild>
              <Button>{cancelLabel}</Button>
            </AlertDialogPrimitive.Cancel>
            <AlertDialogPrimitive.Action asChild>
              <Button
                variant="danger"
                {...actionProps}
                onClick={(event) => {
                  actionProps?.onClick?.(event);
                  if (!event.defaultPrevented) void onConfirm();
                }}
              >
                {actionLabel}
              </Button>
            </AlertDialogPrimitive.Action>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}

export function Popover({
  align = "center",
  children,
  className,
  trigger,
  ...props
}: React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Root> & {
  align?: "center" | "end" | "start";
  children: ReactNode;
  className?: string;
  trigger: ReactNode;
}) {
  return (
    <PopoverPrimitive.Root {...props}>
      <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align={align}
          className={cn("rm-ui-popover", className)}
        >
          {children}
          <PopoverPrimitive.Arrow className="rm-ui-overlay-arrow" />
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

export interface DropdownMenuItem {
  danger?: boolean;
  disabled?: boolean;
  label: ReactNode;
  onSelect?: () => void;
  separatorBefore?: boolean;
}

export function DropdownMenu({
  align = "end",
  items,
  trigger,
}: {
  align?: "center" | "end" | "start";
  items: readonly DropdownMenuItem[];
  trigger: ReactNode;
}) {
  return (
    <DropdownMenuPrimitive.Root>
      <DropdownMenuPrimitive.Trigger asChild>
        {trigger}
      </DropdownMenuPrimitive.Trigger>
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content align={align} className="rm-ui-menu">
          {items.map((item, index) => (
            <div key={index}>
              {item.separatorBefore ? (
                <DropdownMenuPrimitive.Separator className="rm-ui-separator" />
              ) : null}
              <DropdownMenuPrimitive.Item
                className={cn(
                  "rm-ui-menu__item",
                  item.danger && "rm-ui-menu__item--danger",
                )}
                {...(item.disabled ? { disabled: true } : {})}
                {...(item.onSelect ? { onSelect: item.onSelect } : {})}
              >
                {item.label}
              </DropdownMenuPrimitive.Item>
            </div>
          ))}
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}

export function Tooltip({
  children,
  content,
  delayDuration = 350,
}: {
  children: ReactNode;
  content: ReactNode;
  delayDuration?: number;
}) {
  return (
    <TooltipPrimitive.Provider delayDuration={delayDuration}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content className="rm-ui-tooltip" sideOffset={6}>
            {content}
            <TooltipPrimitive.Arrow className="rm-ui-overlay-arrow" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}

export {
  AlertDialogPrimitive,
  DialogPrimitive,
  DropdownMenuPrimitive,
  PopoverPrimitive,
  TooltipPrimitive,
};
