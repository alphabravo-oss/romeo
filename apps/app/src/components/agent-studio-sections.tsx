import { Button } from "@romeo/ui";
import { useState } from "react";

import type { Agent } from "../features/managed-models/types";
import type { MessageKey } from "../lib/i18n";
import { canPublishAgent } from "./agent-publish-gate";
import { VoicePanel } from "./VoicePanel";

export function AgentStudioSaveBar(props: {
  activeAgent: Agent | undefined;
  draftChanges: string[];
  hasPublishedVersion: boolean;
  isDraftDirty: boolean;
  isPublishing: boolean;
  isSaving: boolean;
  onDiscard: () => void;
  onPublish: (channel: "candidate" | "production") => void;
  t: (key: MessageKey) => string;
}) {
  const publishDisabled = !canPublishAgent({
    hasActiveAgent: props.activeAgent !== undefined,
    isDraftDirty: props.isDraftDirty,
    isPublishing: props.isPublishing,
  });
  return (
    <div className="rm-managed-model-savebar">
      <div className="rm-managed-model-savebar__label">
        <strong>
          {props.isDraftDirty
            ? props.t("agentUnsavedChanges")
            : props.t("agentDraftSaved")}
        </strong>
        <span>
          {props.isDraftDirty
            ? props.t("agentPublishBlockedByDraft")
            : props.hasPublishedVersion && props.draftChanges.length === 0
              ? props.t("agentDraftMatchesPublished")
              : props.t("agentDraftReadyToPublish")}
        </span>
      </div>
      <div className="rm-managed-model-savebar__actions">
        {props.isDraftDirty ? (
          <Button
            disabled={props.isSaving}
            onClick={props.onDiscard}
            type="button"
            variant="ghost"
          >
            {props.t("cancel")}
          </Button>
        ) : null}
        <Button
          disabled={!props.activeAgent || !props.isDraftDirty || props.isSaving}
          form="managed-model-draft-form"
          pending={props.isSaving}
          type="submit"
          variant="secondary"
        >
          {props.t("agentSaveDraft")}
        </Button>
        <Button
          disabled={publishDisabled}
          onClick={() => props.onPublish("candidate")}
          pending={props.isPublishing}
          title={
            props.isDraftDirty
              ? props.t("agentPublishBlockedByDraft")
              : undefined
          }
          variant="secondary"
        >
          {props.t("agentStageCandidate")}
        </Button>
        <Button
          disabled={publishDisabled}
          onClick={() => props.onPublish("production")}
          pending={props.isPublishing}
          title={
            props.isDraftDirty
              ? props.t("agentPublishBlockedByDraft")
              : undefined
          }
          variant="primary"
        >
          {props.t("agentPublishProduction")}
        </Button>
      </div>
    </div>
  );
}

export function AgentVoiceTab({
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

export function portableAgentFileName(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .toLocaleLowerCase()
      .slice(0, 80) || "custom-model"
  );
}
