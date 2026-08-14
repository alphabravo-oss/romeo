import { useBlocker } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Button, EmptyState } from "@romeo/ui";

import {
  agentVersionsQueryOptions,
  type Agent,
  type AgentVersion,
  type AgentVersionDiff,
} from "../features/managed-models";
import {
  deleteAgentMutationOptions,
  diffAgentVersionsMutationOptions,
  exportAgentDefinitionMutationOptions,
  publishAgentMutationOptions,
  rollbackAgentVersionMutationOptions,
  updateAgentMutationOptions,
} from "../features/managed-models/mutation-options";
import { useLocale } from "../lib/i18n";
import { downloadText } from "../lib/download";
import { toast } from "../lib/toast";
import type { BaseModel, Provider } from "../features/providers/types";
import { AgentAccessPanel } from "./AgentAccessPanel";
import { AgentDraftForm } from "./AgentDraftForm";
import type { AgentDraftInput } from "./agent-draft-types";
import { canPublishAgent } from "./agent-publish-gate";
import { useConfirm } from "./ConfirmDialog";
import { CreateManagedModelDialog } from "./CreateManagedModelDialog";
import { OverflowMenu } from "./OverflowMenu";
import { AgentTestConsole } from "./AgentTestConsole";
import { AgentVersionPanel } from "./AgentVersionPanel";
import { ManagedModelCustomizationPanel } from "./ManagedModelCustomizationPanel";
import { ManagedModelAvatar } from "./ManagedModelAvatar";
import { ManagedModelKnowledgePanel } from "./ManagedModelKnowledgePanel";
import { ManagedModelToolPanel } from "./ManagedModelToolPanel";
import {
  AgentStudioSaveBar,
  AgentVoiceTab,
  portableAgentFileName,
} from "./agent-studio-sections";
import {
  agentStudioTabLabel,
  agentStudioTabs,
  changedPublishedFields,
  equivalentEditorLocation,
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
  const { t } = useLocale();
  const [leftVersionId, setLeftVersionId] = useState("");
  const [rightVersionId, setRightVersionId] = useState("");
  const [diff, setDiff] = useState<AgentVersionDiff>();
  const [notice, setNotice] = useState<string>();
  const [isDraftDirty, setIsDraftDirty] = useState(false);
  const [draftGeneration, setDraftGeneration] = useState(0);
  const { ask, dialog } = useConfirm();

  const versionsQuery = useQuery(agentVersionsQueryOptions(activeAgent?.id));
  const versions = versionsQuery.data ?? emptyVersions;
  const publishedVersion = versions.find(
    (version) => version.id === activeAgent?.publishedVersionId,
  );
  const draftChanges = useMemo(
    () => changedPublishedFields(activeAgent, publishedVersion),
    [activeAgent, publishedVersion],
  );

  const saveMutation = useMutation(updateAgentMutationOptions(workspaceId));
  const publishMutation = useMutation(publishAgentMutationOptions(workspaceId));
  const rollbackMutation = useMutation(
    rollbackAgentVersionMutationOptions(workspaceId),
  );
  const diffMutation = useMutation(diffAgentVersionsMutationOptions());
  const deleteMutation = useMutation(deleteAgentMutationOptions(workspaceId));
  const exportMutation = useMutation(exportAgentDefinitionMutationOptions());

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
      toast(t("agentSaved"), "success");
      return saved;
    } catch (caught) {
      toast(t("agentCouldNotSave"), "error");
      throw caught;
    }
  }

  async function handlePublish(channel: "candidate" | "production") {
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
        title:
          channel === "candidate"
            ? t("agentStageCandidateTitle")
            : t("agentPublishTitle"),
        body:
          channel === "candidate"
            ? t("agentStageCandidateBody")
            : t("agentPublishBody"),
        confirmLabel:
          channel === "candidate"
            ? t("agentStageCandidate")
            : t("agentPublishProduction"),
        tone: channel === "candidate" ? "default" : "danger",
      }))
    )
      return;
    try {
      const version = await publishMutation.mutateAsync({
        agentId: activeAgent.id,
        channel,
      });
      setNotice(`${t("agentPublishedVersion")} ${version.version}.`);
      toast(
        channel === "candidate"
          ? t("agentCandidateStagedToast")
          : t("agentPublishedToast"),
        "success",
      );
    } catch {
      toast(t("agentCouldNotPublish"), "error");
    }
  }

  async function handleRollback(versionId: string) {
    if (!activeAgent || isDraftDirty) return;
    const target = versions.find((version) => version.id === versionId);
    const promoting =
      target !== undefined &&
      publishedVersion !== undefined &&
      target.version > publishedVersion.version;
    if (
      promoting &&
      !(await ask({
        title: t("agentPromoteCandidateTitle"),
        body: t("agentPromoteCandidateBody"),
        confirmLabel: t("agentPromoteCandidate"),
        tone: "danger",
      }))
    )
      return;
    try {
      await rollbackMutation.mutateAsync({
        agentId: activeAgent.id,
        versionId,
      });
      setNotice(
        promoting
          ? t("agentCandidatePromotedNotice")
          : t("agentRolledBackNotice"),
      );
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

  // Remounting reseeds the form without threading a reset through its state.
  async function handleDiscard() {
    if (
      !(await ask({
        title: t("agentUnsavedChangesTitle"),
        body: t("agentUnsavedChangesDescription"),
        confirmLabel: t("agentDiscardChanges"),
        tone: "danger",
      }))
    )
      return;
    setDraftGeneration((generation) => generation + 1);
    setIsDraftDirty(false);
  }

  async function confirmDelete() {
    if (
      !(await ask({
        title: t("agentDeleteTitle"),
        body: t("agentDeleteDescription"),
        confirmLabel: t("agentDelete"),
        tone: "danger",
      }))
    )
      return;
    await handleDelete();
  }

  async function handleDelete() {
    if (!activeAgent || !workspaceId) return;
    try {
      await deleteMutation.mutateAsync(activeAgent.id);
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
        `${portableAgentFileName(activeAgent.name)}.romeo-custom-model.json`,
        "application/json;charset=utf-8",
      );
      toast(t("managedModelExported"), "success");
    } catch {
      toast(t("managedModelExportFailed"), "error");
    }
  }

  return (
    <section className="rm-managed-model-editor">
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
        {/* One primary action. Export is a utility and Delete is destructive,
            so both live in the overflow rather than sitting a few pixels from
            the button people press every day. */}
        <div className="flex items-center gap-2">
          {showCreateAction ? (
            <CreateManagedModelDialog
              models={models}
              onCreated={onAgentCreated}
              providers={providers}
              workspaceId={workspaceId}
            />
          ) : null}
          {activeAgent ? (
            <OverflowMenu
              items={[
                {
                  label: t("managedModelExport"),
                  onClick: () => void handleExport(),
                  disabled: exportMutation.isPending,
                },
                {
                  label: t("agentDelete"),
                  description: t("agentDeleteDescription"),
                  onClick: () => void confirmDelete(),
                  disabled: deleteMutation.isPending,
                  tone: "danger",
                },
              ]}
              label={t("moreActions")}
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
              key={`${activeAgent?.id ?? "none"}:${draftGeneration}`}
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
          <EmptyState title={t("agentAdminBehaviorOnly")} />
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

      <AgentStudioSaveBar
        activeAgent={activeAgent}
        draftChanges={draftChanges}
        hasPublishedVersion={publishedVersion !== undefined}
        isDraftDirty={isDraftDirty}
        isPublishing={publishMutation.isPending}
        isSaving={saveMutation.isPending}
        onDiscard={() => void handleDiscard()}
        onPublish={(channel) => void handlePublish(channel)}
        t={t}
      />
      {dialog}
    </section>
  );
}
