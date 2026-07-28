import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AlertDialog, Button } from "@romeo/ui";

import {
  diffAgentVersions,
  deleteAgent,
  listAgentVersions,
  publishAgent,
  rollbackAgentVersion,
  updateAgent,
} from "../features/managed-models";
import { useLocale } from "../lib/i18n";
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

const emptyVersions: AgentVersion[] = [];

export function AgentStudioPanel({
  activeAgent,
  models,
  providers,
  isAdmin,
  onAgentCreated,
  workspaceId,
}: {
  activeAgent: Agent | undefined;
  models: BaseModel[];
  providers: Provider[];
  isAdmin: boolean;
  onAgentCreated: (agentId: string) => void;
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

  const saveMutation = useMutation({ mutationFn: updateAgent });
  const publishMutation = useMutation({ mutationFn: publishAgent });
  const rollbackMutation = useMutation({ mutationFn: rollbackAgentVersion });
  const diffMutation = useMutation({ mutationFn: diffAgentVersions });
  const deleteMutation = useMutation({ mutationFn: deleteAgent });

  useEffect(() => {
    setNotice(undefined);
    setDiff(undefined);
    setIsDraftDirty(false);
  }, [activeAgent?.id]);

  useEffect(() => {
    setLeftVersionId(versions[1]?.id ?? versions[0]?.id ?? "");
    setRightVersionId(versions[0]?.id ?? "");
  }, [activeAgent?.id, versions]);

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
      toast(t("agentDeleted"), "success");
    } catch {
      toast(t("agentCouldNotDelete"), "error");
    }
  }

  async function invalidateAgentData(agentId: string) {
    await Promise.all([
      workspaceId
        ? queryClient.invalidateQueries({ queryKey: ["agents", workspaceId] })
        : Promise.resolve(),
      queryClient.invalidateQueries({ queryKey: ["agentVersions", agentId] }),
    ]);
  }

  return (
    <section className="rm-panel p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="rm-card-title">{t("agentStudio")}</div>
        <div className="flex items-center gap-2">
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
          <CreateManagedModelDialog
            models={models}
            onCreated={onAgentCreated}
            providers={providers}
            workspaceId={workspaceId}
          />
        </div>
      </div>
      <AgentDraftForm
        activeAgent={activeAgent}
        isSaving={saveMutation.isPending}
        models={models}
        onDirtyChange={setIsDraftDirty}
        onNotice={setNotice}
        onSave={handleSave}
        providers={providers}
      />

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="grid gap-1">
          <span className="text-sm text-muted">{t("agentPublished")}</span>
          <span className="break-all text-sm">
            {activeAgent?.publishedVersionId ?? t("agentDraftOnly")}
          </span>
        </div>
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
      {isDraftDirty ? (
        <div className="text-xs text-muted" role="status">
          {t("agentPublishBlockedByDraft")}
        </div>
      ) : null}

      {notice ? <div className="mt-3 text-sm text-muted">{notice}</div> : null}

      <AgentAccessPanel activeAgent={activeAgent} onNotice={setNotice} />

      {isAdmin ? (
        <ManagedModelCustomizationPanel activeAgent={activeAgent} />
      ) : null}

      <AgentTestConsole activeAgent={activeAgent} workspaceId={workspaceId} />

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
      {dialog}
    </section>
  );
}
