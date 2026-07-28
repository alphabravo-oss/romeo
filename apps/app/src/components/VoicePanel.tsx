import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@romeo/ui";

import { listVoices, previewVoice, syncVoices } from "../features";
import { bindAgentVoice } from "../features/managed-models";
import type { SpeechArtifact } from "../features/voices";
import type { Agent } from "../features/managed-models";
import { useLocale, type Locale } from "../lib/i18n";
import { formatNumber } from "../lib/locale-format";
import { toast } from "../lib/toast";

export function VoicePanel({
  activeAgent,
  workspaceId,
}: {
  activeAgent: Agent | undefined;
  workspaceId: string | undefined;
}) {
  const queryClient = useQueryClient();
  const { locale, t } = useLocale();
  const voicesQuery = useQuery({ queryKey: ["voices"], queryFn: listVoices });
  const voices = useMemo(() => voicesQuery.data ?? [], [voicesQuery.data]);
  const [voiceProfileId, setVoiceProfileId] = useState("");
  const [notice, setNotice] = useState<string>();
  const [previewArtifact, setPreviewArtifact] = useState<SpeechArtifact>();

  const bindMutation = useMutation({ mutationFn: bindAgentVoice });
  const previewMutation = useMutation({ mutationFn: previewVoice });
  const syncMutation = useMutation({ mutationFn: syncVoices });

  useEffect(() => {
    setVoiceProfileId(activeAgent?.voiceProfileId ?? voices[0]?.id ?? "");
  }, [activeAgent?.id, activeAgent?.voiceProfileId, voices]);

  async function handleBind() {
    if (!activeAgent || !voiceProfileId) return;
    try {
      await bindMutation.mutateAsync({
        agentId: activeAgent.id,
        voiceProfileId,
      });
      setNotice(t("workspaceVoiceBoundNotice"));
      if (workspaceId)
        await queryClient.invalidateQueries({
          queryKey: ["agents", workspaceId],
        });
      toast(t("workspaceVoiceBound"), "success");
    } catch (caught) {
      setNotice(
        caught instanceof Error
          ? caught.message
          : t("workspaceVoiceBindFailed"),
      );
      toast(t("workspaceVoiceCouldNotBind"), "error");
    }
  }

  async function handlePreview() {
    if (!voiceProfileId) return;
    try {
      const artifact = await previewMutation.mutateAsync({
        voiceProfileId,
        text: t("workspaceVoicePreviewText"),
      });
      setPreviewArtifact(artifact);
      setNotice(t("workspaceVoicePreviewGeneratedNotice"));
      toast(t("workspaceVoicePreviewGenerated"), "success");
    } catch (caught) {
      setNotice(
        caught instanceof Error
          ? caught.message
          : t("workspaceVoicePreviewFailed"),
      );
      toast(t("workspaceVoiceCouldNotPreview"), "error");
    }
  }

  async function handleSync() {
    try {
      const result = await syncMutation.mutateAsync();
      setNotice(
        `${t("workspaceVoiceCatalogSynced")}: ${formatNumber(result.imported, locale)} ${t("workspaceVoiceNew")}, ${formatNumber(result.existing, locale)} ${t("workspaceVoiceExisting")}.`,
      );
      await queryClient.invalidateQueries({ queryKey: ["voices"] });
      toast(t("workspaceVoiceCatalogSynced"), "success");
    } catch (caught) {
      setNotice(
        caught instanceof Error
          ? caught.message
          : t("workspaceVoiceCatalogSyncFailed"),
      );
      toast(t("workspaceVoiceCouldNotSync"), "error");
    }
  }

  return (
    <section className="rm-panel p-4">
      <div className="rm-card-title">{t("workspaceVoice")}</div>
      <div className="grid gap-2 text-sm">
        {voices.map((voice) => (
          <Button
            className="min-w-0 justify-start text-left"
            key={voice.id}
            onClick={() => setVoiceProfileId(voice.id)}
            variant={voice.id === voiceProfileId ? "primary" : "outline"}
          >
            <span className="block truncate">{voice.name}</span>
          </Button>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        <Button
          disabled={syncMutation.isPending}
          onClick={handleSync}
          pending={syncMutation.isPending}
        >
          {t("sync")}
        </Button>
        <Button
          disabled={!voiceProfileId || previewMutation.isPending}
          onClick={handlePreview}
          pending={previewMutation.isPending}
        >
          {t("preview")}
        </Button>
        <Button
          disabled={!activeAgent || !voiceProfileId || bindMutation.isPending}
          onClick={handleBind}
          pending={bindMutation.isPending}
          variant="primary"
        >
          {t("workspaceVoiceBind")}
        </Button>
      </div>
      {notice ? <div className="mt-3 text-sm text-muted">{notice}</div> : null}
      {previewArtifact ? (
        <div className="mt-3 grid gap-2 text-xs text-muted">
          <span>{formatSpeechArtifact(previewArtifact, locale)}</span>
          {previewArtifact.playbackUrl ? (
            <audio
              className="w-full"
              controls
              preload="metadata"
              src={previewArtifact.playbackUrl}
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function formatSpeechArtifact(
  artifact: SpeechArtifact,
  locale: Locale,
): string {
  if (artifact.durationMs === undefined) return artifact.contentType;
  return `${artifact.contentType} · ${formatNumber(Math.round(artifact.durationMs / 1000), locale)} s`;
}
