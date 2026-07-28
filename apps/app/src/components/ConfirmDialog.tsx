import { useCallback, useRef, useState } from "react";
import { AlertDialog } from "@romeo/ui";

import { useLocale } from "../lib/i18n";

export type ConfirmTone = "default" | "danger";

export interface ConfirmOptions {
  title: string;
  body?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
}

/**
 * Controlled confirm modal. Prefer `useConfirm()` for the common
 * promise-based flow; reach for this directly only when you already manage
 * open/close state yourself.
 *
 * role="dialog" + aria-modal, Escape cancels, backdrop click cancels, focus
 * is trapped. `tone="danger"` styles the confirm button destructive.
 */
export function ConfirmDialog(props: {
  open: boolean;
  title: string;
  body?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
  onConfirm: () => void;
  onCancel: () => void;
}): React.ReactNode {
  const { t } = useLocale();
  const {
    open,
    title,
    body,
    confirmLabel = t("confirm"),
    cancelLabel = t("cancel"),
    tone = "default",
    onConfirm,
    onCancel,
  } = props;

  return (
    <AlertDialog
      actionLabel={confirmLabel}
      actionProps={{ variant: tone === "danger" ? "danger" : "primary" }}
      cancelLabel={cancelLabel}
      onConfirm={onConfirm}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onCancel();
      }}
      open={open}
      title={title}
    >
      {body ?? t("confirmDefaultBody")}
    </AlertDialog>
  );
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

/**
 * Provider-free confirm pattern. Returns `ask` (an async predicate) and a
 * `dialog` node the caller renders once — no context, no AppProviders wiring.
 *
 *   const { ask, dialog } = useConfirm()
 *   async function handleDelete(id: string) {
 *     if (await ask({ title: 'Delete template?', body: 'This cannot be undone.', confirmLabel: 'Delete', tone: 'danger' })) {
 *       await deleteMutation.mutateAsync(id)
 *     }
 *   }
 *   return (<section>… {dialog}</section>)
 */
export function useConfirm(): {
  ask: (opts: ConfirmOptions) => Promise<boolean>;
  dialog: React.ReactNode;
} {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const pendingRef = useRef<PendingConfirm | null>(null);
  pendingRef.current = pending;

  const ask = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setPending({ ...opts, resolve });
      }),
    [],
  );

  const settle = useCallback((value: boolean) => {
    const current = pendingRef.current;
    setPending(null);
    current?.resolve(value);
  }, []);

  const dialog = (
    <ConfirmDialog
      open={pending !== null}
      title={pending?.title ?? ""}
      {...(pending?.body !== undefined ? { body: pending.body } : {})}
      {...(pending?.confirmLabel !== undefined
        ? { confirmLabel: pending.confirmLabel }
        : {})}
      {...(pending?.cancelLabel !== undefined
        ? { cancelLabel: pending.cancelLabel }
        : {})}
      tone={pending?.tone ?? "default"}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  );

  return { ask, dialog };
}
