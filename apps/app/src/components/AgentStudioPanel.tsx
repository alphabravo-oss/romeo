import { useBlocker } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { AlertDialog, Button } from "@romeo/ui";
import Download from "lucide-react/dist/esm/icons/download.mjs";

import {
  diffAgentVersions,
  deleteAgent,
  exportAgentDefinition,
  listAgentVersions,
  publishAgent,
  rollbackAgentVersion,
  updateAgent,
} from "../features/managed-models";
import { useLocale } from "../lib/i18n";
import { downloadText } from "../lib/download";
import { toast } from "../lib/toast";
import type {
  Agent,
  AgentVersion,
  AgentVersionDiff,
} from "../features/managed-models/types";
import type { BaseModel, Provider } from "../features/providers/types";
import { AgentAccessPanel } from "./AgentAccessPanel";
import { AgentDraftForm, type AgentDraftInput } from "./AgentDraftForm";
import { canPublishAgent } from "./agent-publish-gate";
import { useConfirm } from "./ConfirmDialog";
import { CreateManagedModelDialog } from "./CreateManagedModelDialog";
import { AgentTestConsole } from "./AgentTestConsole";
import { AgentVersionPanel } from "./AgentVersionPanel";
import { ManagedModelCustomizationPanel } from "./ManagedModelCustomizationPanel";
import { ManagedModelAvatar } from "./ManagedModelAvatar";
import { ManagedModelKnowledgePanel } from "./ManagedModelKnowledgePanel";
import { ManagedModelToolPanel } from "./ManagedModelToolPanel";
import { VoicePanel } from "./VoicePanel";
import {
  agentStudioTabLabel,
  agentStudioTabs,
  changedPublishedFields,
  equivalentEditorLocation,
  type AgentStudioTab,
} from "./agent-studio-model";

export {
  resolveAgentStudioTab,
  type AgentStudioTab,
} from "./agent-studio-model";

const emptyVersions: AgentVersion[] = [];

export function AgentStudioPanel({
  activeAgent,
  activeTab = "overview",
  models,
  onTabChange,
  providers,
  isAdmin,
  onAgentCreated,
  onAgentDeleted,
  showCreateAction = true,
  workspaceId,
}: {
  activeAgent: Agent | undefined;
  activeTab?: AgentStudioTab;
  models: BaseModel[];
  onTabChange?: (tab: AgentStudioTab) => void;
  providers: Provider[];
  isAdmin: boolean;
  onAgentCreated: (agentId: string) => void;
  onAgentDeleted?: () => void;
  showCreateAction?: boolean;
  workspaceId: string | undefined;
}) {
  const queryClient = useQueryClient();
  const { t } = useLocale();
  const [leftVersionId, setLeftVersionId] = useState("");
  const [rightVersionId, setRightVersionId] = useState("");
  const [diff, setDiff] = useState<AgentVersionDiff>();
  const [notice, setNotice] = useState<string>();
  const [isDraftDirty, setIsDraftDirty] = useState(false);
  const { ask, dialog } = useConfirm();

  const versionsQuery = useQuery({
    queryKey: ["agentVersions", activeAgent?.id],
    queryFn: () => listAgentVersions(activeAgent!.id),
    enabled: activeAgent !== undefined,
  });
  const versions = versionsQuery.data ?? emptyVersions;
  const publishedVersion = versions.find(
    (version) => version.id === activeAgent?.publishedVersionId,
  );
  const draftChanges = useMemo(
    () => changedPublishedFields(activeAgent, publishedVersion),
    [activeAgent, publishedVersion],
  );

  const saveMutation = useMutation({ mutationFn: updateAgent });
  const publishMutation = useMutation({ mutationFn: publishAgent });
  const rollbackMutation = useMutation({ mutationFn: rollbackAgentVersion });
  const diffMutation = useMutation({ mutationFn: diffAgentVersions });
  const deleteMutation = useMutation({ mutationFn: deleteAgent });
  const exportMutation = useMutation({ mutationFn: exportAgentDefinition });

  useEffect(() => {
    setNotice(undefined);
    setDiff(undefined);
    setIsDraftDirty(false);
  }, [activeAgent?.id]);

  useEffect(() => {
    setLeftVersionId(versions[1]?.id ?? versions[0]?.id ?? "");
    setRightVersionId(versions[0]?.id ?? "");
  }, [activeAgent?.id, versions]);

  useBlocker({
    disabled: !isDraftDirty,
    enableBeforeUnload: isDraftDirty,
    shouldBlockFn: async ({ current, next }) => {
      if (equivalentEditorLocation(current, next)) return false;
      return !(await ask({
        title: t("agentUnsavedChangesTitle"),
        body: t("agentUnsavedChangesDescription"),
        confirmLabel: t("agentDiscardChanges"),
        tone: "danger",
      }));
    },
  });

  async function handleSave(input: AgentDraftInput): Promise<Agent> {
    try {
      const saved = await saveMutation.mutateAsync(input);
      await invalidateAgentData(saved.id);
      toast(t("agentSaved"), "success");
      return saved;
    } catch (caught) {
      toast(t("agentCouldNotSave"), "error");
      throw caught;
    }
  }

  async function handlePublish() {
    if (
      !activeAgent ||
      !canPublishAgent({
        hasActiveAgent: true,
        isDraftDirty,
        isPublishing: publishMutation.isPending,
      })
    )
      return;
    if (
      !(await ask({
        title: t("agentPublishTitle"),
        body: t("agentPublishBody"),
        confirmLabel: t("agentPublish"),
        tone: "danger",
      }))
    )
      return;
    try {
      const version = await publishMutation.mutateAsync(activeAgent.id);
      setNotice(`${t("agentPublishedVersion")} ${version.version}.`);
      await invalidateAgentData(activeAgent.id);
      toast(t("agentPublishedToast"), "success");
    } catch {
      toast(t("agentCouldNotPublish"), "error");
    }
  }

  async function handleRollback(versionId: string) {
    if (!activeAgent || isDraftDirty) return;
    try {
      const rolledBack = await rollbackMutation.mutateAsync({
        agentId: activeAgent.id,
        versionId,
      });
      setNotice(t("agentRolledBackNotice"));
      await invalidateAgentData(rolledBack.id);
      toast(t("agentRolledBack"), "success");
    } catch {
      toast(t("agentCouldNotRollback"), "error");
    }
  }

  async function handleDiff() {
    if (!activeAgent || !leftVersionId || !rightVersionId) return;
    const result = await diffMutation.mutateAsync({
      agentId: activeAgent.id,
      leftVersionId,
      rightVersionId,
    });
    setDiff(result);
  }

  async function handleDelete() {
    if (!activeAgent || !workspaceId) return;
    try {
      await deleteMutation.mutateAsync(activeAgent.id);
      await queryClient.invalidateQueries({
        queryKey: ["agents", workspaceId],
      });
      onAgentDeleted?.();
      toast(t("agentDeleted"), "success");
    } catch {
      toast(t("agentCouldNotDelete"), "error");
    }
  }

  async function handleExport() {
    if (!activeAgent) return;
    try {
      const document = await exportMutation.mutateAsync(activeAgent.id);
      downloadText(
        JSON.stringify(document, null, 2),
        `${portableFileName(activeAgent.name)}.romeo-assistant.json`,
        "application/json;charset=utf-8",
      );
      toast(t("managedModelExported"), "success");
    } catch {
      toast(t("managedModelExportFailed"), "error");
    }
  }

  async function invalidateAgentData(agentId: string) {
    await Promise.all([
      workspaceId
        ? queryClient.invalidateQueries({ queryKey: ["agents", workspaceId] })
        : Promise.resolve(),
      queryClient.invalidateQueries({ queryKey: ["agentVersions", agentId] }),
      queryClient.invalidateQueries({ queryKey: ["agentReadiness", agentId] }),
      workspaceId
        ? queryClient.invalidateQueries({
            queryKey: ["agentGallery", workspaceId],
          })
        : Promise.resolve(),
    ]);
  }

  return (
    <section className="rm-panel rm-managed-model-editor p-4">
      <div className="rm-managed-model-editor__header">
        <div className="flex min-w-0 items-center gap-3">
          {activeAgent ? (
            <ManagedModelAvatar agent={activeAgent} size={56} />
          ) : null}
          <div className="min-w-0 flex-1">
            <div className="rm-card-title truncate">
              {activeAgent?.name ?? t("agentStudio")}
            </div>
            <p className="text-sm text-muted">
              {activeAgent?.description || t("managedModelEditorDescription")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {activeAgent ? (
            <Button
              onClick={() => void handleExport()}
              pending={exportMutation.isPending}
              variant="secondary"
            >
              <Download aria-hidden="true" size={15} />
              {t("managedModelExport")}
            </Button>
          ) : null}
          {activeAgent ? (
            <AlertDialog
              actionLabel={t("agentDelete")}
              actionProps={{
                pending: deleteMutation.isPending,
                variant: "danger",
              }}
              cancelLabel={t("cancel")}
              onConfirm={handleDelete}
              title={t("agentDeleteTitle")}
              trigger={<Button variant="danger">{t("agentDelete")}</Button>}
            >
              {t("agentDeleteDescription")}
            </AlertDialog>
          ) : null}
          {showCreateAction ? (
            <CreateManagedModelDialog
              models={models}
              onCreated={onAgentCreated}
              providers={providers}
              workspaceId={workspaceId}
            />
          ) : null}
        </div>
      </div>
      <nav
        aria-label={t("agentEditorSections")}
        className="rm-agent-editor-tabs"
      >
        {agentStudioTabs.map((tab) => (
          <Button
            aria-current={activeTab === tab ? "page" : undefined}
            key={tab}
            onClick={() => onTabChange?.(tab)}
            size="sm"
            variant={activeTab === tab ? "secondary" : "ghost"}
          >
            {t(agentStudioTabLabel(tab))}
          </Button>
        ))}
      </nav>

      <div hidden={activeTab !== "overview"}>
        <div className="grid gap-4">
          <section className="rm-managed-model-section">
            <div className="rm-managed-model-section__header">
              <div>
                <h3>{t("managedModelIdentityBehavior")}</h3>
                <p>{t("managedModelIdentityBehaviorDescription")}</p>
              </div>
            </div>
            <AgentDraftForm
              activeAgent={activeAgent}
              formId="managed-model-draft-form"
              isSaving={saveMutation.isPending}
              models={models}
              onDirtyChange={setIsDraftDirty}
              onNotice={setNotice}
              onSave={handleSave}
              providers={providers}
              showSubmit={false}
            />
          </section>

          <section className="rm-managed-model-section">
            <div className="rm-managed-model-section__header">
              <div>
                <h3>{t("managedModelPublishing")}</h3>
                <p>{t("managedModelPublishingDescription")}</p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="grid gap-1">
                <span className="text-sm text-muted">
                  {t("agentPublished")}
                </span>
                <span className="break-all text-sm">
                  {activeAgent?.publishedVersionId ?? t("agentDraftOnly")}
                </span>
              </div>
              <div className="grid gap-1">
                <span className="text-sm text-muted">
                  {t("agentDraftPublishedChanges")}
                </span>
                <span className="text-sm">
                  {publishedVersion
                    ? draftChanges.length === 0
                      ? t("agentDraftMatchesPublished")
                      : draftChanges.join(", ")
                    : t("agentFirstPublication")}
                </span>
              </div>
            </div>
          </section>
        </div>
      </div>

      <div hidden={activeTab !== "behavior"}>
        {isAdmin ? (
          <ManagedModelCustomizationPanel activeAgent={activeAgent} />
        ) : (
          <div className="rm-empty">{t("agentAdminBehaviorOnly")}</div>
        )}
      </div>

      <div hidden={activeTab !== "capabilities"}>
        <AgentTestConsole activeAgent={activeAgent} workspaceId={workspaceId} />
      </div>

      <div hidden={activeTab !== "knowledge"}>
        <ManagedModelKnowledgePanel
          activeAgent={activeAgent}
          workspaceId={workspaceId}
        />
      </div>

      <div hidden={activeTab !== "tools"}>
        <ManagedModelToolPanel activeAgent={activeAgent} />
      </div>

      <div hidden={activeTab !== "voice"}>
        <AgentVoiceTab activeAgent={activeAgent} workspaceId={workspaceId} />
      </div>

      <div hidden={activeTab !== "access"}>
        <AgentAccessPanel activeAgent={activeAgent} onNotice={setNotice} />
      </div>

      <div hidden={activeTab !== "versions"}>
        <AgentVersionPanel
          activeAgent={activeAgent}
          diff={diff}
          isComparing={diffMutation.isPending}
          isRollbackBlocked={isDraftDirty}
          isRollingBack={rollbackMutation.isPending}
          leftVersionId={leftVersionId}
          onCompare={() => void handleDiff()}
          onLeftVersionChange={setLeftVersionId}
          onRightVersionChange={setRightVersionId}
          onRollback={(versionId) => void handleRollback(versionId)}
          rightVersionId={rightVersionId}
          versions={versions}
        />
      </div>

      {notice ? <div className="mt-3 text-sm text-muted">{notice}</div> : null}

      <div className="rm-managed-model-savebar">
        <div className="min-w-0 text-sm">
          <strong>
            {isDraftDirty ? t("agentUnsavedChanges") : t("agentDraftSaved")}
          </strong>
          <span className="ml-2 text-muted">
            {isDraftDirty
              ? t("agentPublishBlockedByDraft")
              : publishedVersion && draftChanges.length === 0
                ? t("agentDraftMatchesPublished")
                : t("agentDraftReadyToPublish")}
          </span>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            disabled={!activeAgent || !isDraftDirty || saveMutation.isPending}
            form="managed-model-draft-form"
            pending={saveMutation.isPending}
            type="submit"
            variant="secondary"
          >
            {t("agentSaveDraft")}
          </Button>
          <Button
            disabled={
              !canPublishAgent({
                hasActiveAgent: activeAgent !== undefined,
                isDraftDirty,
                isPublishing: publishMutation.isPending,
              })
            }
            onClick={() => void handlePublish()}
            pending={publishMutation.isPending}
            title={isDraftDirty ? t("agentPublishBlockedByDraft") : undefined}
            variant="primary"
          >
            {t("agentPublish")}
          </Button>
        </div>
      </div>
      {dialog}
    </section>
  );
}

function AgentVoiceTab({
  activeAgent,
  workspaceId,
}: {
  activeAgent: Agent | undefined;
  workspaceId: string | undefined;
}) {
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>();
  return (
    <VoicePanel
      activeAgent={activeAgent}
      onSelectionChange={(voiceId) => setSelectedVoiceId(voiceId ?? undefined)}
      selectedVoiceId={selectedVoiceId}
      workspaceId={workspaceId}
    />
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
