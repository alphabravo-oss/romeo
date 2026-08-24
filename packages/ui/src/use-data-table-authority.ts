import { useEffect, useState } from "react";

import type { DataTableAuthority } from "./table-authority";
import {
  readTableSavedViews,
  type TableSavedView,
  writeTableSavedViews,
} from "./table-preferences";

export function useDataTableAuthority(input: {
  authority: DataTableAuthority | undefined;
  initialPageSize: number;
  operationFailureMessage: string;
  preferenceKey: string;
  serverAuthorityUnavailableMessage: string;
  validColumnIds: ReadonlySet<string>;
}) {
  const [localViews, setLocalViews] = useState<TableSavedView[]>(() =>
    input.authority === undefined
      ? readTableSavedViews(
          input.preferenceKey,
          input.validColumnIds,
          input.initialPageSize,
        )
      : [],
  );
  const [operationError, setOperationError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [pendingDeletion, setPendingDeletion] = useState<{
    restore?: () => Promise<void>;
    timer: ReturnType<typeof setTimeout>;
    view: TableSavedView;
  }>();
  const authoritativeViews = input.authority?.savedViews ?? localViews;
  const savedViews = pendingDeletion
    ? authoritativeViews.filter(
        (view) => viewIdentity(view) !== viewIdentity(pendingDeletion.view),
      )
    : authoritativeViews;

  useEffect(
    () => () => {
      if (pendingDeletion) clearTimeout(pendingDeletion.timer);
    },
    [pendingDeletion],
  );

  async function run(operation: () => Promise<void>): Promise<void> {
    setPending(true);
    setOperationError(undefined);
    try {
      await operation();
    } catch {
      setOperationError(
        input.authority?.error ?? input.operationFailureMessage,
      );
    } finally {
      setPending(false);
    }
  }

  async function saveView(view: TableSavedView): Promise<void> {
    if (input.authority !== undefined) {
      await run(() => input.authority!.saveView(view));
      return;
    }
    setLocalViews((current) => {
      const next = [
        ...current.filter(
          (saved) =>
            saved.name.toLocaleLowerCase() !== view.name.toLocaleLowerCase(),
        ),
        view,
      ].sort((left, right) => left.name.localeCompare(right.name));
      writeTableSavedViews(input.preferenceKey, next);
      return next;
    });
  }

  function commitLocalDeleteView(view: TableSavedView): void {
    setLocalViews((current) => {
      const next = current.filter((saved) => saved.name !== view.name);
      writeTableSavedViews(input.preferenceKey, next);
      return next;
    });
  }

  function deleteView(view: TableSavedView): void {
    if (pendingDeletion) {
      clearTimeout(pendingDeletion.timer);
    }
    if (input.authority !== undefined) {
      void run(async () => {
        const receipt = await input.authority!.deleteView(view);
        const timer = setTimeout(() => {
          setPendingDeletion((current) =>
            current?.timer === timer ? undefined : current,
          );
        }, 5_000);
        setPendingDeletion({
          ...(receipt === undefined ? {} : { restore: receipt.restore }),
          timer,
          view,
        });
      });
      return;
    }
    const timer = setTimeout(() => {
      setPendingDeletion((current) =>
        current?.timer === timer ? undefined : current,
      );
      commitLocalDeleteView(view);
    }, 5_000);
    setPendingDeletion({ timer, view });
  }

  function undoDeleteView(): void {
    if (!pendingDeletion) return;
    clearTimeout(pendingDeletion.timer);
    const restore = pendingDeletion.restore;
    setPendingDeletion(undefined);
    if (restore !== undefined) void run(restore);
  }

  return {
    deleteView,
    error:
      operationError ??
      (input.authority?.status === "error"
        ? (input.authority.error ?? input.serverAuthorityUnavailableMessage)
        : undefined),
    exportView: (view: TableSavedView, estimatedRows: number) =>
      input.authority === undefined
        ? Promise.resolve()
        : run(() => input.authority!.exportView(view, estimatedRows)),
    pending:
      pending ||
      input.authority?.pending === true ||
      input.authority?.status === "loading",
    pendingDeletedView: pendingDeletion?.view,
    saveView,
    savedViews,
    setDefaultView: (view: TableSavedView, isDefault: boolean) =>
      input.authority === undefined
        ? Promise.resolve()
        : run(() => input.authority!.setDefaultView(view, isDefault)),
    setViewVisibility: (
      view: TableSavedView,
      visibility: "private" | "workspace",
    ) =>
      input.authority === undefined
        ? Promise.resolve()
        : run(() => input.authority!.setViewVisibility(view, visibility)),
    undoDeleteView,
    statusMessage: input.authority?.statusMessage,
  };
}

function viewIdentity(view: TableSavedView): string {
  return view.id ?? `name:${view.name.toLocaleLowerCase()}`;
}
