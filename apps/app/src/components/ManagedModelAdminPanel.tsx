import { Button, EmptyState, Input, StatusBadge } from "@romeo/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import ArrowLeft from "lucide-react/dist/esm/icons/arrow-left.mjs";
import Copy from "lucide-react/dist/esm/icons/copy.mjs";
import Download from "lucide-react/dist/esm/icons/download.mjs";
import Upload from "lucide-react/dist/esm/icons/upload.mjs";
import Pin from "lucide-react/dist/esm/icons/pin.mjs";
import { useCallback, useMemo, useRef } from "react";

import {
  cloneAgent,
  exportAgentDefinition,
  importAgentDefinition,
} from "../features/managed-models";
import type {
  Agent,
  ManagedModelExportDocument,
} from "../features/managed-models";
import type { BaseModel, Provider } from "../features/providers/types";
import { updateWorkspaceDefaultAgent } from "../features/tenancy";
import { downloadText } from "../lib/download";
import { useLocale } from "../lib/i18n";
import { LocalizedDateTime } from "../lib/locale-format";
import { toast } from "../lib/toast";
import { AgentStudioPanel, type AgentStudioTab } from "./AgentStudioPanel";
import { CreateManagedModelDialog } from "./CreateManagedModelDialog";
import { ManagedModelAvatar } from "./ManagedModelAvatar";
import { PanelStats } from "./PanelStats";
import { createColumnHelper, DataTable } from "./DataTable";

const managedModelColumn = createColumnHelper<Agent>();

export function ManagedModelAdminPanel({
  agents,
  activeTab,
  models,
  onNavigationChange,
  onTabChange,
  providers,
  selectedAgentId,
  workspaceDefaultAgentId,
  workspaceId,
}: {
  agents: Agent[];
  activeTab: AgentStudioTab;
  models: BaseModel[];
  onNavigationChange: (agentId: string | null) => void;
  onTabChange: (tab: AgentStudioTab) => void;
  providers: Provider[];
  selectedAgentId: string | undefined;
  workspaceDefaultAgentId: string | undefined;
  workspaceId: string | undefined;
}) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const importInputRef = useRef<HTMLInputElement>(null);
  const cloneMutation = useMutation({ mutationFn: cloneAgent });
  const exportMutation = useMutation({ mutationFn: exportAgentDefinition });
  const importMutation = useMutation({ mutationFn: importAgentDefinition });
  const defaultMutation = useMutation({
    mutationFn: updateWorkspaceDefaultAgent,
  });
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId);
  const modelById = useMemo(
    () => new Map(models.map((model) => [model.id, model])),
    [models],
  );
  const providerById = useMemo(
    () => new Map(providers.map((provider) => [provider.id, provider])),
    [providers],
  );

  const handleWorkspaceDefault = useCallback(
    async (agentId: string) => {
      if (!workspaceId) return;
      try {
        await defaultMutation.mutateAsync({
          workspaceId,
          agentId: workspaceDefaultAgentId === agentId ? null : agentId,
        });
        await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
        toast(t("managedModelDefaultUpdated"), "success");
      } catch {
        toast(t("managedModelDefaultFailed"), "error");
      }
    },
    [defaultMutation, queryClient, t, workspaceDefaultAgentId, workspaceId],
  );
  const handleClone = useCallback(
    async (agent: Agent) => {
      try {
        const cloned = await cloneMutation.mutateAsync({
          agentId: agent.id,
          includeKnowledgeBindings: true,
          name: `${agent.name} copy`,
        });
        if (workspaceId)
          await queryClient.invalidateQueries({
            queryKey: ["agents", workspaceId],
          });
        onNavigationChange(cloned.id);
        toast(t("managedModelCloned"), "success");
      } catch {
        toast(t("managedModelCloneFailed"), "error");
      }
    },
    [cloneMutation, onNavigationChange, queryClient, t, workspaceId],
  );
  const handleExport = useCallback(
    async (agent: Agent) => {
      try {
        const document = await exportMutation.mutateAsync(agent.id);
        downloadText(
          JSON.stringify(document, null, 2),
          `${portableFileName(agent.name)}.romeo-assistant.json`,
          "application/json;charset=utf-8",
        );
        toast(t("managedModelExported"), "success");
      } catch {
        toast(t("managedModelExportFailed"), "error");
      }
    },
    [exportMutation, t],
  );

  const columns = useMemo(
    () => [
      managedModelColumn.accessor("name", {
        header: t("managedModelName"),
        cell: ({ row }) => (
          <div className="flex min-w-0 items-center gap-2">
            <ManagedModelAvatar agent={row.original} size={32} />
            <span className="block min-w-0">
              <strong className="block truncate">{row.original.name}</strong>
              <small className="block truncate text-muted">
                {row.original.description || t("managedModelNoDescription")}
              </small>
            </span>
          </div>
        ),
      }),
      managedModelColumn.accessor(
        (agent) =>
          modelById.get(agent.baseModelId)?.displayName ?? t("unknown"),
        {
          id: "baseModel",
          header: t("managedModelBaseModel"),
        },
      ),
      managedModelColumn.accessor(
        (agent) => {
          if (!agent.publishedVersionId) return t("draft");
          const model = modelById.get(agent.baseModelId);
          const provider = model
            ? providerById.get(model.providerId)
            : undefined;
          return model?.enabled &&
            model.available !== false &&
            provider?.enabled !== false
            ? t("managedModelReady")
            : t("managedModelBlocked");
        },
        {
          id: "status",
          header: t("managedModelStatus"),
          cell: ({ getValue }) => (
            <StatusBadge
              tone={
                getValue() === t("managedModelReady")
                  ? "success"
                  : getValue() === t("managedModelBlocked")
                    ? "danger"
                    : "neutral"
              }
            >
              {getValue()}
            </StatusBadge>
          ),
        },
      ),
      managedModelColumn.accessor((agent) => agent.tags?.join(", ") ?? "", {
        id: "tags",
        header: t("managedModelTags"),
        cell: ({ getValue }) => getValue() || "—",
      }),
      managedModelColumn.accessor((agent) => agent.grantCount ?? 0, {
        id: "access",
        header: t("managedModelAccess"),
      }),
      managedModelColumn.accessor("updatedAt", {
        header: t("managedModelUpdated"),
        cell: ({ getValue }) => <LocalizedDateTime value={getValue()} />,
      }),
      managedModelColumn.display({
        id: "actions",
        header: t("managedModelActions"),
        cell: ({ row }) => (
          <div className="flex justify-end gap-1">
            <Button
              disabled={
                defaultMutation.isPending ||
                row.original.publishedVersionId === undefined
              }
              onClick={() => void handleWorkspaceDefault(row.original.id)}
              size="sm"
              title={t("managedModelWorkspaceDefault")}
              variant="ghost"
            >
              <Pin
                aria-hidden="true"
                fill={
                  workspaceDefaultAgentId === row.original.id
                    ? "currentColor"
                    : "none"
                }
                size={14}
              />
              {t("managedModelDefault")}
            </Button>
            <Button
              disabled={cloneMutation.isPending}
              onClick={() => void handleClone(row.original)}
              size="sm"
              variant="ghost"
            >
              <Copy aria-hidden="true" size={14} />
              {t("clone")}
            </Button>
            <Button
              disabled={exportMutation.isPending}
              onClick={() => void handleExport(row.original)}
              size="sm"
              variant="ghost"
            >
              <Download aria-hidden="true" size={14} />
              {t("managedModelExport")}
            </Button>
          </div>
        ),
      }),
    ],
    [
      cloneMutation.isPending,
      defaultMutation.isPending,
      exportMutation.isPending,
      handleClone,
      handleExport,
      handleWorkspaceDefault,
      modelById,
      providerById,
      t,
      workspaceDefaultAgentId,
    ],
  );

  async function invalidateAgentLists() {
    if (!workspaceId) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["agents", workspaceId] }),
      queryClient.invalidateQueries({
        queryKey: ["agentGallery", workspaceId],
      }),
    ]);
  }

  async function handleImport(file: File) {
    if (!workspaceId) return;
    if (file.size > 5 * 1024 * 1024) {
      toast(t("managedModelImportTooLarge"), "error");
      return;
    }
    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (!isManagedModelExportDocument(parsed))
        throw new Error("Invalid assistant export");
      const imported = await importMutation.mutateAsync({
        workspaceId,
        document: parsed,
      });
      await invalidateAgentLists();
      onNavigationChange(imported.id);
      toast(t("managedModelImported"), "success");
    } catch {
      toast(t("managedModelImportFailed"), "error");
    }
  }

  if (selectedAgentId) {
    return (
      <div className="grid min-w-0 gap-4">
        <Button
          className="w-fit"
          onClick={() => onNavigationChange(null)}
          variant="ghost"
        >
          <ArrowLeft aria-hidden="true" size={16} />
          {t("managedModelBackToModels")}
        </Button>
        {selectedAgent ? (
          <AgentStudioPanel
            activeAgent={selectedAgent}
            activeTab={activeTab}
            isAdmin
            models={models}
            onAgentCreated={onNavigationChange}
            onAgentDeleted={() => onNavigationChange(null)}
            onTabChange={onTabChange}
            providers={providers}
            showCreateAction={false}
            workspaceId={workspaceId}
          />
        ) : (
          <EmptyState title={t("managedModelNotFound")}>
            {t("managedModelNotFoundDescription")}
          </EmptyState>
        )}
      </div>
    );
  }

  return (
    <section className="rm-panel rm-managed-model-list-page p-4">
      <div className="rm-card-header rm-managed-model-list-header">
        <div>
          <div className="rm-card-title">{t("curatedModels")}</div>
          <p className="text-sm text-muted">{t("curatedModelsDescription")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            accept="application/json,.json"
            aria-label={t("managedModelImport")}
            className="rm-ui-visually-hidden"
            name="assistantImport"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) void handleImport(file);
            }}
            ref={importInputRef}
            type="file"
          />
          <Button
            disabled={!workspaceId}
            onClick={() => importInputRef.current?.click()}
            pending={importMutation.isPending}
            variant="secondary"
          >
            <Upload aria-hidden="true" size={15} />
            {t("managedModelImport")}
          </Button>
          <CreateManagedModelDialog
            models={models}
            onCreated={onNavigationChange}
            providers={providers}
            workspaceId={workspaceId}
          />
        </div>
      </div>
      <div className="mt-4 grid gap-4">
        <PanelStats
          items={[
            { label: t("curatedModels"), value: agents.length },
            {
              label: t("published"),
              value: agents.filter((agent) => agent.publishedVersionId).length,
            },
            {
              label: t("drafts"),
              value: agents.filter((agent) => !agent.publishedVersionId).length,
            },
          ]}
        />
        <DataTable
          columns={columns}
          data={agents}
          empty={t("managedModelEmpty")}
          getRowId={(agent) => agent.id}
          minTableWidth={1_020}
          onRowActivate={(agent) => onNavigationChange(agent.id)}
          preferenceKey="admin-managed-models"
          rowAriaLabel={(agent) => t("managedModelOpen", { name: agent.name })}
          searchVisibility="always"
        />
      </div>
    </section>
  );
}

function isManagedModelExportDocument(
  value: unknown,
): value is ManagedModelExportDocument {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== 1) return false;
  const agent = candidate.agent;
  if (typeof agent !== "object" || agent === null) return false;
  const definition = agent as Record<string, unknown>;
  return (
    typeof definition.name === "string" &&
    typeof definition.baseModelId === "string" &&
    typeof definition.systemPrompt === "string"
  );
}

function portableFileName(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .toLocaleLowerCase()
      .slice(0, 80) || "assistant"
  );
}
