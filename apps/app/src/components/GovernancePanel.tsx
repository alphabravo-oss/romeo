import { Input, NativeSelect, Button } from "@romeo/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  createDataExportPackage,
  deleteDataExportPackage,
  downloadDataExportPackageContent,
  executeDataExport,
  listDataExportPackages,
  previewDataExport,
} from "../features";
import type {
  DataExportPackageList,
  DataExportPreview,
  DataExportRequest,
  DataExportScope,
  Workspace,
} from "../features/types";
import { downloadCsv } from "../lib/csv";
import { useLocale } from "../lib/i18n";
import { toast } from "../lib/toast";
import { LocalizedBytes, LocalizedDateTime } from "../lib/locale-format";
import { Section, StatRow } from "./console";
import { AdminDisclosure } from "./AdminDisclosure";
import { ChatLifecyclePanel } from "./ChatLifecyclePanel";
import { DataDeletionPanel } from "./DataDeletionPanel";
import { DataRightsTab, GovernanceReportsTab } from "./GovernanceReportTabs";
import { GovernanceRetentionTab } from "./GovernanceRetentionTab";
import { Tabs } from "./Tabs";
import { WorkspaceLifecyclePanel } from "./WorkspaceLifecyclePanel";
import { useConfirm } from "./ConfirmDialog";
import { type ColumnDef, DataTable, createColumnHelper } from "./DataTable";
import { OverflowMenu } from "./OverflowMenu";

export function GovernancePanel({
  activeChatId,
  onChatArchived,
  onChatDeleted,
  onWorkspaceArchived,
  workspace,
}: {
  activeChatId: string | undefined;
  onChatArchived: (chatId: string) => Promise<void>;
  onChatDeleted: (chatId: string) => Promise<void>;
  onWorkspaceArchived: (workspaceId: string) => Promise<void>;
  workspace: Workspace | undefined;
}) {
  const { t } = useLocale();
  return (
    <Section>
      <div className="rm-card-title">{t("govGovernance")}</div>
      <Tabs
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
  const queryClient = useQueryClient();
  const { ask, dialog } = useConfirm();
  const packagesQuery = useQuery({
    queryKey: ["dataExportPackages"],
    queryFn: listDataExportPackages,
  });
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

  const previewMutation = useMutation({
    mutationFn: previewDataExport,
    onSuccess: (result) => {
      setPreview(result);
      toast(t("govExportPreviewReady"), "success");
    },
    onError: () => toast(t("govCouldNotPreviewExport"), "error"),
  });
  const executeMutation = useMutation({
    mutationFn: executeDataExport,
    onSuccess: () => toast(t("govExportExecuted"), "success"),
    onError: () => toast(t("govCouldNotExecuteExport"), "error"),
  });
  const createMutation = useMutation({
    mutationFn: createDataExportPackage,
    onSuccess: async (created) => {
      toast(
        `${t("govPackage")} ${created.packageId} ${t("govCreated")}`,
        "success",
      );
      await queryClient.invalidateQueries({ queryKey: ["dataExportPackages"] });
    },
    onError: () => toast(t("govCouldNotCreateExportPackage"), "error"),
  });
  const deleteMutation = useMutation({
    mutationFn: deleteDataExportPackage,
    onSuccess: async () => {
      toast(t("govPackageDeleted"), "success");
      await queryClient.invalidateQueries({ queryKey: ["dataExportPackages"] });
    },
    onError: () => toast(t("govCouldNotDeletePackage"), "error"),
  });
  const downloadMutation = useMutation({
    mutationFn: downloadDataExportPackageContent,
    onError: () => toast(t("govCouldNotDownloadPackage"), "error"),
  });

  const list = packagesQuery.data;
  const packages = list?.packages ?? [];
  const columns: ColumnDef<DataExportPackageRow, any>[] = [
    exportPackageColumn.accessor("packageId", {
      header: t("govPackage"),
      cell: (cell) => (
        <span className="rm-mono font-medium" translate="no">
          {cell.getValue()}
        </span>
      ),
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
    exportPackageColumn.accessor("artifact.sizeBytes", {
      header: t("govSize"),
      cell: (cell) => <LocalizedBytes value={cell.getValue()} />,
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
                disabled: downloadMutation.isPending,
                onClick: () => {
                  void (async () => {
                    const content = await downloadMutation.mutateAsync(
                      entry.packageId,
                    );
                    downloadCsv(
                      content,
                      `romeo-data-export-${entry.packageId}.json`,
                    );
                  })();
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
                    deleteMutation.mutate({
                      packageId: entry.packageId,
                      confirmPackageId: entry.packageId,
                    });
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
          { label: t("govPackages"), value: packages.length },
          {
            label: t("govOrgScope"),
            value: packages.filter((entry) => entry.request.scope === "org")
              .length,
          },
          {
            label: t("govWorkspaceScope"),
            value: packages.filter(
              (entry) => entry.request.scope === "workspace",
            ).length,
          },
          {
            label: t("govWithContent"),
            value: packages.filter((entry) => entry.request.includeContent)
              .length,
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
              if (request) previewMutation.mutate(request);
            }}
            type="button"
          >
            {previewMutation.isPending ? t("govPreviewing") : t("govPreview")}
          </Button>
          <Button
            disabled={executeMutation.isPending}
            onClick={() => {
              const request = buildRequest();
              if (request) executeMutation.mutate(request);
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
              if (request) createMutation.mutate(request);
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
          data={packages}
          empty={
            packagesQuery.isLoading ? t("govLoading") : t("govNoExportPackages")
          }
          getRowId={(entry) => entry.packageId}
          minTableWidth={780}
        />
      </div>
    </div>
  );
}

type DataExportPackageRow = DataExportPackageList["packages"][number];
const exportPackageColumn = createColumnHelper<DataExportPackageRow>();
