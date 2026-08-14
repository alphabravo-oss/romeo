import { Input, Button } from "@romeo/ui";
import Archive from "lucide-react/dist/esm/icons/archive.mjs";
import Download from "lucide-react/dist/esm/icons/download.mjs";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import {
  archiveWorkspaceMutationOptions,
  exportWorkspaceMutationOptions,
} from "../features/tenancy";
import type { Workspace } from "../features/types";
import { toast } from "../lib/toast";
import { useLocale } from "../lib/i18n";
import { downloadText } from "../lib/download";
import { safeUserErrorMessage } from "../lib/safe-user-error";

export function WorkspaceLifecyclePanel({
  workspace,
  onWorkspaceArchived,
}: {
  workspace: Workspace | undefined;
  onWorkspaceArchived: (workspaceId: string) => Promise<void>;
}) {
  const { t } = useLocale();
  const [confirmSlug, setConfirmSlug] = useState("");
  const [notice, setNotice] = useState<string>();
  const archiveMutation = useMutation(archiveWorkspaceMutationOptions());
  const exportMutation = useMutation(exportWorkspaceMutationOptions());
  const canArchive =
    workspace !== undefined &&
    confirmSlug === workspace.slug &&
    !archiveMutation.isPending;
  const canExport = workspace !== undefined && !exportMutation.isPending;

  async function handleExport() {
    if (workspace === undefined) return;
    setNotice(undefined);
    try {
      const document = await exportMutation.mutateAsync(workspace.id);
      downloadJson(`romeo-workspace-${workspace.slug}.json`, document);
      setNotice(t("lifecycleWorkspaceExportReady"));
      toast(t("lifecycleWorkspaceExported"), "success");
    } catch (caught) {
      setNotice(
        safeUserErrorMessage(caught, t("lifecycleUnableExportWorkspace")),
      );
      toast(t("lifecycleExportFailed"), "error");
    } finally {
      exportMutation.reset();
    }
  }

  async function handleArchive() {
    if (!canArchive || workspace === undefined) return;
    setNotice(undefined);
    try {
      const archived = await archiveMutation.mutateAsync(workspace.id);
      await onWorkspaceArchived(archived.id);
      setConfirmSlug("");
      setNotice(t("lifecycleWorkspaceArchivedNotice"));
      toast(t("lifecycleWorkspaceArchived"), "success");
    } catch (caught) {
      setNotice(
        safeUserErrorMessage(caught, t("lifecycleUnableArchiveWorkspace")),
      );
      toast(t("lifecycleWorkspaceArchiveFailed"), "error");
    }
  }

  return (
    <div className="mt-4 grid gap-2 text-sm">
      <div className="text-muted">{t("lifecycleWorkspaceLifecycle")}</div>
      <Button
        className="inline-flex items-center justify-center gap-2"
        disabled={!canExport}
        onClick={() => void handleExport()}
        type="button"
      >
        <Download aria-hidden="true" size={16} />
        {t("lifecycleExport")}
      </Button>
      <label className="text-muted" htmlFor="workspace-archive-confirm">
        {t("lifecycleConfirmSlug")}
      </label>
      <Input
        disabled={workspace === undefined || archiveMutation.isPending}
        id="workspace-archive-confirm"
        onChange={(event) => setConfirmSlug(event.currentTarget.value)}
        value={confirmSlug}
      />
      <Button
        className="inline-flex items-center justify-center gap-2"
        disabled={!canArchive}
        onClick={() => void handleArchive()}
        type="button"
      >
        <Archive aria-hidden="true" size={16} />
        {t("lifecycleArchiveWorkspace")}
      </Button>
      {notice ? (
        <div className="text-xs text-muted" role="status">
          {notice}
        </div>
      ) : null}
    </div>
  );
}

function downloadJson(fileName: string, document: unknown): void {
  downloadText(
    JSON.stringify(document, null, 2),
    fileName,
    "application/json;charset=utf-8",
  );
}
