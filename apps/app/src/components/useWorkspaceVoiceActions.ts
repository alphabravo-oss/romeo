import { useMutation } from "@tanstack/react-query";
import { useState, type Dispatch, type SetStateAction } from "react";

import {
  generateMessageSpeechMutationOptions,
  transcribeVoiceMutationOptions,
} from "../features/voices/mutation-options";
import type { SpeechArtifact } from "../features/types";
import type { MessageKey } from "../lib/i18n";
import { audioExtension, blobToBase64 } from "./workspace-controller-media";
import { safeUserErrorMessage } from "../lib/safe-user-error";

interface WorkspaceVoiceActionsOptions {
  activeVoiceProfileId: string | undefined;
  refreshUsageControls: () => Promise<void>;
  setDraft: Dispatch<SetStateAction<string>>;
  setError: Dispatch<SetStateAction<string | undefined>>;
  setSpeechArtifacts: Dispatch<SetStateAction<Record<string, SpeechArtifact>>>;
  t: (key: MessageKey) => string;
}

export function useWorkspaceVoiceActions({
  activeVoiceProfileId,
  refreshUsageControls,
  setDraft,
  setError,
  setSpeechArtifacts,
  t,
}: WorkspaceVoiceActionsOptions) {
  const [speechMessageId, setSpeechMessageId] = useState<string>();
  const generateSpeechMutation = useMutation(
    generateMessageSpeechMutationOptions(),
  );
  const transcribeVoiceMutation = useMutation(transcribeVoiceMutationOptions());

  async function handleGenerateSpeech(messageId: string) {
    if (activeVoiceProfileId === undefined) {
      setError(t("workspaceSelectVoiceFirst"));
      return;
    }
    setError(undefined);
    setSpeechMessageId(messageId);
    try {
      const artifact = await generateSpeechMutation.mutateAsync({
        messageId,
        voiceProfileId: activeVoiceProfileId,
      });
      setSpeechArtifacts((current) => ({ ...current, [messageId]: artifact }));
      generateSpeechMutation.reset();
      await refreshUsageControls();
    } catch (caught) {
      setError(
        safeUserErrorMessage(caught, t("workspaceUnableGenerateSpeech")),
      );
    } finally {
      setSpeechMessageId(undefined);
    }
  }

  async function handleTranscribeAudio(blob: Blob) {
    if (blob.size > 10_000_000) {
      setError(t("workspaceVoiceInputLimit"));
      return;
    }
    setError(undefined);
    try {
      const result = await transcribeVoiceMutation.mutateAsync({
        audioBase64: await blobToBase64(blob),
        contentType: blob.type || "audio/webm",
        fileName: `voice-input.${audioExtension(blob.type)}`,
      });
      setDraft((current) =>
        `${current}${current.trim().length > 0 ? " " : ""}${result.text}`.trimStart(),
      );
      transcribeVoiceMutation.reset();
      await refreshUsageControls();
    } catch (caught) {
      setError(
        safeUserErrorMessage(caught, t("workspaceUnableTranscribeVoice")),
      );
    }
  }

  return {
    handleGenerateSpeech,
    handleTranscribeAudio,
    isGeneratingSpeech: generateSpeechMutation.isPending,
    isTranscribingVoice: transcribeVoiceMutation.isPending,
    speechMessageId,
  };
}
