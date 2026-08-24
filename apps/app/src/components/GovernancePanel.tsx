import { Input, NativeSelect, Button } from "@romeo/ui";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import {
  createDataExportPackageMutationOptions,
  deleteDataExportPackageMutationOptions,
  executeDataExportMutationOptions,
  previewDataExportMutationOptions,
} from "../features/governance";
import type {
  DataExportPreview,
  DataExportRequest,
  DataExportScope,
  Workspace,
} from "../features/types";
import { useLocale } from "../lib/i18n";
import { useInventoriedServerTable } from "../lib/inventoried-server-table";
import type { InventoriedTableResourceRow } from "../lib/inventoried-table-resource-registry";
import { toast } from "../lib/toast";
import { LocalizedBytes, LocalizedDateTime } from "../lib/locale-format";
import { Section, StatRow } from "./console";
import { AdminDisclosure } from "./AdminDisclosure";
import { ChatLifecyclePanel } from "./ChatLifecyclePanel";
import { DataDeletionPanel } from "./DataDeletionPanel";
import { DataRightsTab, GovernanceReportsTab } from "./GovernanceReportTabs";
import { GovernanceRetentionTab } from "./GovernanceRetentionTab";
import { Tabs, type RoutedTabsState } from "./Tabs";
import { WorkspaceLifecyclePanel } from "./WorkspaceLifecyclePanel";
import { useConfirm } from "./ConfirmDialog";
import { type ColumnDef, DataTable, createColumnHelper } from "./DataTable";
import { OverflowMenu } from "./OverflowMenu";

export function GovernancePanel({
  activeChatId,
  onChatArchived,
  onChatDeleted,
  onWorkspaceArchived,
  tabState,
  workspace,
}: {
  activeChatId: string | undefined;
  onChatArchived: (chatId: string) => Promise<void>;
  onChatDeleted: (chatId: string) => Promise<void>;
  onWorkspaceArchived: (workspaceId: string) => Promise<void>;
  tabState?: RoutedTabsState;
  workspace: Workspace | undefined;
}) {
  const { t } = useLocale();
  return (
    <Section>
      <Tabs
        activeId={tabState?.activeId}
        onActiveIdChange={tabState?.onActiveIdChange}
        tabs={[
          {
            id: "retention",
            label: t("govRetentionAccess"),
            content: <GovernanceRetentionTab />,
          },
          {
            id: "exports",
            label: t("govDataExports"),
            content: <DataExportsTab workspace={workspace} />,
          },
          {
            id: "rights",
            label: t("govDataRightsCoverage"),
            content: <DataRightsTab />,
          },
          {
            id: "reports",
            label: t("govReports"),
            content: <GovernanceReportsTab />,
          },
        ]}
      />
      <AdminDisclosure
        description={t("govLifecycleHelp")}
        title={t("govLifecycleTitle")}
      >
        <WorkspaceLifecyclePanel
          onWorkspaceArchived={onWorkspaceArchived}
          workspace={workspace}
        />
        <ChatLifecyclePanel
          activeChatId={activeChatId}
          onChatArchived={onChatArchived}
          workspaceId={workspace?.id}
        />
        <DataDeletionPanel
          activeChatId={activeChatId}
          onChatDeleted={onChatDeleted}
        />
      </AdminDisclosure>
    </Section>
  );
}

function DataExportsTab({ workspace }: { workspace: Workspace | undefined }) {
  const { t } = useLocale();
  const packagesTable = useInventoriedServerTable(
    "governance_export_packages",
    { refetchInterval: governanceExportRefetchInterval },
  );
  const { ask, dialog } = useConfirm();
  const [scope, setScope] = useState<DataExportScope>("org");
  const [workspaceId, setWorkspaceId] = useState("");
  const [includeContent, setIncludeContent] = useState(false);
  const [preview, setPreview] = useState<DataExportPreview>();

  function buildRequest(): DataExportRequest | undefined {
    if (scope === "workspace" && workspaceId.trim().length === 0) {
      toast(t("govWorkspaceIdRequired"), "error");
      return undefined;
    }
    return {
      scope,
      ...(scope === "workspace" ? { workspaceId: workspaceId.trim() } : {}),
      ...(includeContent ? { includeContent: true } : {}),
    };
  }

  const previewMutation = useMutation(previewDataExportMutationOptions());
  const executeMutation = useMutation(executeDataExportMutationOptions());
  const createMutation = useMutation(createDataExportPackageMutationOptions());
  const deleteMutation = useMutation(deleteDataExportPackageMutationOptions());

  async function handlePreview(request: DataExportRequest) {
    try {
      const result = await previewMutation.mutateAsync(request);
      setPreview(result);
      toast(t("govExportPreviewReady"), "success");
    } catch {
      toast(t("govCouldNotPreviewExport"), "error");
    } finally {
      previewMutation.reset();
    }
  }

  async function handleExecute(request: DataExportRequest) {
    try {
      await executeMutation.mutateAsync(request);
      toast(t("govExportExecuted"), "success");
    } catch {
      toast(t("govCouldNotExecuteExport"), "error");
    } finally {
      executeMutation.reset();
    }
  }

  async function handleCreate(request: DataExportRequest) {
    try {
      const created = await createMutation.mutateAsync(request);
      toast(
        `${t("govPackage")} ${created.packageId} ${t("govQueued")}`,
        "success",
      );
    } catch {
      toast(t("govCouldNotCreateExportPackage"), "error");
    }
  }

  async function handleDelete(packageId: string) {
    try {
      await deleteMutation.mutateAsync({
        packageId,
        confirmPackageId: packageId,
      });
      toast(t("govPackageDeleted"), "success");
    } catch {
      toast(t("govCouldNotDeletePackage"), "error");
    }
  }

  const packages = packagesTable.rows;
  const columns: ColumnDef<DataExportPackageRow, any>[] = [
    exportPackageColumn.accessor("packageId", {
      header: t("govPackage"),
      cell: (cell) => {
        const entry = cell.row.original;
        return entry.state === "artifact_ready" &&
          entry.artifact !== undefined ? (
          <a
            className="rm-mono font-medium underline underline-offset-2"
            download
            href={entry.artifact.downloadUrl}
            translate="no"
          >
            {cell.getValue()}
          </a>
        ) : (
          <span className="rm-mono font-medium" translate="no">
            {cell.getValue()}
          </span>
        );
      },
    }),
    exportPackageColumn.accessor("request.scope", {
      header: t("govScope"),
      cell: (cell) => cell.getValue(),
    }),
    exportPackageColumn.accessor((entry) => entry.request.workspaceId ?? "—", {
      id: "workspaceId",
      header: t("govWorkspaceId"),
      cell: (cell) => (
        <span className="rm-mono" translate="no">
          {cell.getValue()}
        </span>
      ),
    }),
    exportPackageColumn.accessor((entry) => entry.artifact?.sizeBytes ?? 0, {
      id: "sizeBytes",
      header: t("govSize"),
      cell: (cell) => <LocalizedBytes value={cell.getValue()} />,
    }),
    exportPackageColumn.accessor("state", {
      header: t("govStatus"),
      cell: (cell) => (
        <span aria-live="polite" role="status">
          {exportJobStatus(cell.getValue(), cell.row.original.percent, t)}
        </span>
      ),
    }),
    exportPackageColumn.accessor("createdAt", {
      header: t("govCreatedAt"),
      cell: (cell) => <LocalizedDateTime value={cell.getValue()} />,
    }),
    exportPackageColumn.display({
      id: "actions",
      header: "",
      enableSorting: false,
      enableHiding: false,
      cell: (cell) => {
        const entry = cell.row.original;
        return (
          <OverflowMenu
            label={t("govPackageActions")}
            items={[
              {
                label: t("govDownloadContent"),
                disabled: entry.state !== "artifact_ready",
                onClick: () => {
                  if (entry.artifact !== undefined)
                    window.location.assign(entry.artifact.downloadUrl);
                },
              },
              {
                label: t("govDelete"),
                tone: "danger",
                disabled: deleteMutation.isPending,
                onClick: () => {
                  void (async () => {
                    const confirmed = await ask({
                      title: `${t("govDeleteExportPackage")} ${entry.packageId}?`,
                      body: t("govCannotUndo"),
                      confirmLabel: t("govDelete"),
                      tone: "danger",
                    });
                    if (!confirmed) return;
                    await handleDelete(entry.packageId);
                  })();
                },
              },
            ]}
          />
        );
      },
    }),
  ];

  return (
    <div className="grid gap-4 text-sm">
      {dialog}
      <StatRow
        items={[
          {
            label: t("govPackages"),
            value: packagesTable.summary.total ?? packagesTable.estimatedTotal,
          },
          {
            label: t("govOrgScope"),
            value: packagesTable.summary.orgScopeTotal ?? packages.length,
          },
          {
            label: t("govWorkspaceScope"),
            value: packagesTable.summary.workspaceScopeTotal ?? 0,
          },
          {
            label: t("govWithContent"),
            value: packagesTable.summary.withContentTotal ?? 0,
          },
        ]}
      />

      <div className="grid gap-2 rounded-md border border-border p-2">
        <div className="font-medium">{t("govNewExportDsar")}</div>
        <label className="text-muted" htmlFor="export-scope">
          {t("govScope")}
        </label>
        <NativeSelect
          id="export-scope"
          onChange={(event) =>
            setScope(event.currentTarget.value as DataExportScope)
          }
          value={scope}
        >
          <option value="org">org</option>
          <option value="workspace">workspace</option>
        </NativeSelect>
        {scope === "workspace" ? (
          <>
            <label className="text-muted" htmlFor="export-workspace">
              {t("govWorkspaceId")}
            </label>
            <Input
              id="export-workspace"
              onChange={(event) => setWorkspaceId(event.currentTarget.value)}
              placeholder={workspace?.id ?? "ws_..."}
              value={workspaceId}
            />
          </>
        ) : null}
        <label className="flex items-center gap-2 text-muted">
          <Input
            checked={includeContent}
            onChange={(event) => setIncludeContent(event.currentTarget.checked)}
            type="checkbox"
          />
          {t("govIncludeMessageContent")}
        </label>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={previewMutation.isPending}
            onClick={() => {
              const request = buildRequest();
              if (request) void handlePreview(request);
            }}
            type="button"
          >
            {previewMutation.isPending ? t("govPreviewing") : t("govPreview")}
          </Button>
          <Button
            disabled={executeMutation.isPending}
            onClick={() => {
              const request = buildRequest();
              if (request) void handleExecute(request);
            }}
            type="button"
          >
            {executeMutation.isPending ? t("govExecuting") : t("govExecute")}
          </Button>
          <Button
            variant="primary"
            disabled={createMutation.isPending}
            onClick={() => {
              const request = buildRequest();
              if (request) void handleCreate(request);
            }}
            type="button"
          >
            {createMutation.isPending
              ? t("govCreating")
              : t("govCreatePackage")}
          </Button>
        </div>
        {preview ? (
          <div className="rounded-md border border-border p-2 text-muted">
            <div className="font-medium">
              {t("govPreview")} — {preview.request.scope}
            </div>
            <div>
              {t("govChats")} {preview.counts.chats} · {t("govMessages")}{" "}
              {preview.counts.messages} · {t("govFiles")}{" "}
              {preview.counts.fileObjects}
            </div>
            {preview.warnings.length > 0 ? (
              <div>
                {t("govWarnings")}: {preview.warnings.join(", ")}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="grid gap-2">
        <div className="font-medium">{t("govPackages")}</div>
        <DataTable
          columns={columns}
          data={packagesTable.rows}
          empty={t("govNoExportPackages")}
          getRowId={(entry) => entry.packageId}
          minTableWidth={880}
          serverState={packagesTable.serverState}
        />
      </div>
    </div>
  );
}

type DataExportPackageRow =
  InventoriedTableResourceRow<"governance_export_packages">;
const exportPackageColumn = createColumnHelper<DataExportPackageRow>();

function governanceExportRefetchInterval(
  rows: DataExportPackageRow[] | undefined,
): number | false {
  return rows?.some((job) => job.state === "queued" || job.state === "running")
    ? 1_000
    : false;
}

function exportJobStatus(
  state: DataExportPackageRow["state"],
  percent: number,
  t: ReturnType<typeof useLocale>["t"],
): string {
  if (state === "queued") return t("govQueued");
  if (state === "running") return `${t("govRunning")} ${percent}%`;
  if (state === "artifact_ready") return t("govReady");
  if (state === "expired") return t("govExpired");
  return t("govFailed");
}
