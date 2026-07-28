import X from "lucide-react/dist/esm/icons/x.mjs";
import type { ReactNode } from "react";
import { Button, DialogPrimitive } from "@romeo/ui";

type OverlayVariant = "command" | "confirm" | "dialog" | "drawer" | "shortcuts";

export function OverlayShell({
  ariaLabel,
  children,
  labelledBy,
  onClose,
  open,
  variant,
}: {
  ariaLabel?: string;
  children: ReactNode;
  labelledBy?: string;
  onClose: () => void;
  open: boolean;
  variant: OverlayVariant;
}): ReactNode {
  return (
    <DialogPrimitive.Root
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
      open={open}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="rm-ui-overlay" />
        <DialogPrimitive.Content
          {...(ariaLabel ? { "aria-label": ariaLabel } : {})}
          {...(labelledBy ? { "aria-labelledby": labelledBy } : {})}
          className={`rm-ui-dialog rm-overlay-${variant}`}
          onOpenAutoFocus={(event) => {
            if (variant === "drawer") event.preventDefault();
          }}
        >
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function OverlayHeader({
  closeLabel,
  description,
  onClose,
  title,
  titleId,
}: {
  closeLabel: string;
  description?: string;
  onClose: () => void;
  title: string;
  titleId: string;
}) {
  return (
    <header className="rm-ui-dialog__header">
      <div className="min-w-0">
        <DialogPrimitive.Title asChild>
          <h2 className="rm-ui-dialog__title" id={titleId}>
            {title}
          </h2>
        </DialogPrimitive.Title>
        {description ? (
          <p className="rm-ui-dialog__description">{description}</p>
        ) : null}
      </div>
      <DialogPrimitive.Close asChild>
        <Button
          aria-label={closeLabel}
          className="rm-icon-button"
          onClick={onClose}
          size="icon"
          variant="ghost"
        >
          <X aria-hidden="true" size={16} />
        </Button>
      </DialogPrimitive.Close>
    </header>
  );
}
