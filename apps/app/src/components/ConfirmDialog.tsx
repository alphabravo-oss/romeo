import { AlertDialog, Field, Input } from "@romeo/ui";
import { useCallback, useEffect, useRef, useState } from "react";

import { useLocale } from "../lib/i18n";
import { matchesConfirmationPhrase } from "./confirm-typed";

export type ConfirmTone = "default" | "danger";

export interface ConfirmOptions {
  title: string;
  body?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
  /** When set, the confirm button stays disabled until this phrase is typed. */
  confirmPhrase?: string;
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
  confirmPhrase?: string;
  onConfirm: () => void;
  onCancel: () => void;
}): React.ReactNode {
  const { t } = useLocale();
  const [typed, setTyped] = useState("");
  const {
    open,
    title,
    body,
    confirmLabel = t("confirm"),
    cancelLabel = t("cancel"),
    tone = "default",
    confirmPhrase,
    onConfirm,
    onCancel,
  } = props;
  const phraseSatisfied =
    confirmPhrase === undefined ||
    matchesConfirmationPhrase(typed, confirmPhrase);

  useEffect(() => {
    if (!open) setTyped("");
  }, [open]);

  return (
    <AlertDialog
      actionLabel={confirmLabel}
      actionProps={{
        disabled: !phraseSatisfied,
        variant: tone === "danger" ? "danger" : "primary",
      }}
      cancelLabel={cancelLabel}
      onConfirm={onConfirm}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onCancel();
      }}
      open={open}
      title={title}
    >
      <div className="grid gap-3">
        <div>{body ?? t("confirmDefaultBody")}</div>
        {confirmPhrase !== undefined ? (
          <Field label={`${t("confirmTypeToProceed")}: ${confirmPhrase}`}>
            <Input
              autoComplete="off"
              name="confirmPhrase"
              onChange={(event) => setTyped(event.currentTarget.value)}
              value={typed}
            />
          </Field>
        ) : null}
      </div>
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
      {...(pending?.confirmPhrase !== undefined
        ? { confirmPhrase: pending.confirmPhrase }
        : {})}
      tone={pending?.tone ?? "default"}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  );

  return { ask, dialog };
}
