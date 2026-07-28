import { Input, Button } from "@romeo/ui";
import Archive from "lucide-react/dist/esm/icons/archive.mjs";
import Download from "lucide-react/dist/esm/icons/download.mjs";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { archiveWorkspace, exportWorkspace } from "../features";
import type { Workspace } from "../features/types";
import { toast } from "../lib/toast";
import { useLocale } from "../lib/i18n";

export function WorkspaceLifecyclePanel({
  workspace,
  onWorkspaceArchived,
}: {
  workspace: Workspace | undefined;
  onWorkspaceArchived: (workspaceId: string) => Promise<void>;
}) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const [confirmSlug, setConfirmSlug] = useState("");
  const [notice, setNotice] = useState<string>();
  const archiveMutation = useMutation({ mutationFn: archiveWorkspace });
  const exportMutation = useMutation({ mutationFn: exportWorkspace });
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
      await queryClient.invalidateQueries({ queryKey: ["auditLogs"] });
      setNotice(t("lifecycleWorkspaceExportReady"));
      toast(t("lifecycleWorkspaceExported"), "success");
    } catch (caught) {
      setNotice(
        caught instanceof Error
          ? caught.message
          : t("lifecycleUnableExportWorkspace"),
      );
      toast(t("lifecycleExportFailed"), "error");
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
        caught instanceof Error
          ? caught.message
          : t("lifecycleUnableArchiveWorkspace"),
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
      {notice ? <div className="text-xs text-muted">{notice}</div> : null}
    </div>
  );
}

function downloadJson(fileName: string, document: unknown): void {
  const blob = new Blob([JSON.stringify(document, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = documentGlobal().createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function documentGlobal(): Document {
  return globalThis.document;
}
