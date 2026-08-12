import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Button, StatusBadge } from "@romeo/ui";
import ArrowLeft from "lucide-react/dist/esm/icons/arrow-left.mjs";

import { listVoices, previewVoice, syncVoices } from "../features";
import { bindAgentVoice } from "../features/managed-models";
import type { SpeechArtifact, VoiceProfile } from "../features/voices";
import type { Agent } from "../features/managed-models";
import { useLocale, type Locale } from "../lib/i18n";
import { formatNumber, LocalizedDateTime } from "../lib/locale-format";
import { toast } from "../lib/toast";
import { createColumnHelper, DataTable } from "./DataTable";
import { SettingsSection } from "./SettingsSection";

const voiceColumn = createColumnHelper<VoiceProfile>();

export function VoicePanel({
  activeAgent,
  onSelectionChange,
  selectedVoiceId,
  workspaceId,
}: {
  activeAgent: Agent | undefined;
  onSelectionChange: (voiceId: string | null) => void;
  selectedVoiceId: string | undefined;
  workspaceId: string | undefined;
}) {
  const queryClient = useQueryClient();
  const { locale, t } = useLocale();
  const voicesQuery = useQuery({ queryKey: ["voices"], queryFn: listVoices });
  const voices = useMemo(() => voicesQuery.data ?? [], [voicesQuery.data]);
  const [notice, setNotice] = useState<string>();
  const [previewArtifact, setPreviewArtifact] = useState<SpeechArtifact>();

  const bindMutation = useMutation({ mutationFn: bindAgentVoice });
  const previewMutation = useMutation({ mutationFn: previewVoice });
  const syncMutation = useMutation({ mutationFn: syncVoices });

  const selectedVoice = voices.find((voice) => voice.id === selectedVoiceId);
  const voiceProfileId = selectedVoice?.id ?? "";
  const columns = useMemo(
    () => [
      voiceColumn.accessor("name", {
        header: t("workspaceVoiceName"),
        cell: ({ row }) => (
          <span className="block min-w-0">
            <strong className="block truncate">{row.original.name}</strong>
            <small className="block truncate text-muted">
              {row.original.styleTags.join(", ") || "—"}
            </small>
          </span>
        ),
      }),
      voiceColumn.accessor("providerId", {
        header: t("workspaceVoiceProvider"),
      }),
      voiceColumn.accessor("language", {
        header: t("workspaceVoiceLanguage"),
      }),
      voiceColumn.accessor("enabled", {
        header: t("workspaceVoiceAvailability"),
        cell: ({ getValue }) => (
          <StatusBadge tone={getValue() ? "success" : "neutral"}>
            {t(getValue() ? "workspaceVoiceAvailable" : "assistantUnavailable")}
          </StatusBadge>
        ),
      }),
      voiceColumn.accessor("grantCount", {
        header: t("workspaceVoiceAccess"),
        cell: ({ getValue }) =>
          `${formatNumber(getValue() ?? 0, locale)} ${t("workspaceVoiceGrants")}`,
      }),
      voiceColumn.accessor("dependentAgentCount", {
        header: t("workspaceVoiceAssistants"),
        cell: ({ getValue }) => formatNumber(getValue() ?? 0, locale),
      }),
      voiceColumn.accessor("updatedAt", {
        header: t("workspaceVoiceUpdated"),
        cell: ({ getValue }) => <LocalizedDateTime value={getValue()} />,
      }),
    ],
    [locale, t],
  );

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

  if (selectedVoiceId === undefined) {
    return (
      <div className="rm-console-page">
        <div className="rm-console-toolbar">
          <Button
            disabled={syncMutation.isPending}
            onClick={handleSync}
            pending={syncMutation.isPending}
          >
            {t("sync")}
          </Button>
        </div>
        <DataTable
          columns={columns}
          data={voices}
          empty={
            voicesQuery.isLoading ? t("loading") : t("workspaceVoiceNoProfiles")
          }
          getRowId={(voice) => voice.id}
          minTableWidth={900}
          onRowActivate={(voice) => onSelectionChange(voice.id)}
          preferenceKey="workspace-voices"
          rowAriaLabel={(voice) =>
            t("workspaceVoiceOpen", { name: voice.name })
          }
          searchVisibility="always"
        />
        {notice ? <p className="rm-list-empty">{notice}</p> : null}
      </div>
    );
  }

  return (
    <div className="rm-console-page">
      <Button
        className="w-fit"
        onClick={() => onSelectionChange(null)}
        variant="ghost"
      >
        <ArrowLeft aria-hidden="true" size={16} />
        {t("workspaceVoiceBack")}
      </Button>
      {selectedVoice ? (
        <>
          <SettingsSection
            description={`${selectedVoice.providerId} · ${selectedVoice.providerVoiceId}`}
            title={selectedVoice.name}
          >
            <div className="rm-defs">
              <div>
                <dt>{t("workspaceVoiceLanguage")}</dt>
                <dd>{selectedVoice.language}</dd>
              </div>
              <div>
                <dt>{t("workspaceVoiceAvailability")}</dt>
                <dd>
                  <StatusBadge
                    tone={selectedVoice.enabled ? "success" : "neutral"}
                  >
                    {t(
                      selectedVoice.enabled
                        ? "workspaceVoiceAvailable"
                        : "assistantUnavailable",
                    )}
                  </StatusBadge>
                </dd>
              </div>
              <div>
                <dt>{t("workspaceVoiceAccess")}</dt>
                <dd>{formatNumber(selectedVoice.grantCount ?? 0, locale)}</dd>
              </div>
              <div>
                <dt>{t("workspaceVoiceAssistants")}</dt>
                <dd>
                  {formatNumber(selectedVoice.dependentAgentCount ?? 0, locale)}
                </dd>
              </div>
              <div>
                <dt>{t("workspaceVoiceCloning")}</dt>
                <dd>
                  {t(
                    selectedVoice.cloningAllowed
                      ? "workspaceVoiceAllowed"
                      : "workspaceVoiceNotAllowed",
                  )}
                </dd>
              </div>
              <div>
                <dt>{t("workspaceVoiceUpdated")}</dt>
                <dd>
                  <LocalizedDateTime value={selectedVoice.updatedAt} />
                </dd>
              </div>
            </div>
            <p className="rm-list-empty">
              {selectedVoice.styleTags.join(", ") ||
                t("workspaceVoiceNoStyles")}
            </p>
          </SettingsSection>
          <SettingsSection
            description={t("workspaceVoiceCatalogDescription")}
            title={t("preview")}
          >
            <div className="rm-resource-row__actions rm-resource-row__actions--start">
              <Button
                disabled={!voiceProfileId || previewMutation.isPending}
                onClick={handlePreview}
                pending={previewMutation.isPending}
              >
                {t("preview")}
              </Button>
              <Button
                disabled={
                  !activeAgent || !voiceProfileId || bindMutation.isPending
                }
                onClick={handleBind}
                pending={bindMutation.isPending}
                variant="primary"
              >
                {t("workspaceVoiceBind")}
              </Button>
            </div>
            {notice ? <p className="rm-list-empty">{notice}</p> : null}
            {previewArtifact ? (
              <div className="grid gap-2">
                <p className="rm-list-empty">
                  {formatSpeechArtifact(previewArtifact, locale)}
                </p>
                {previewArtifact.playbackUrl ? (
                  // The visible preview metadata is the text alternative for
                  // this generated speech-only artifact.
                  // oxlint-disable-next-line jsx-a11y/media-has-caption
                  <audio
                    className="w-full"
                    controls
                    preload="metadata"
                    src={previewArtifact.playbackUrl}
                  />
                ) : null}
              </div>
            ) : null}
          </SettingsSection>
        </>
      ) : (
        <p className="rm-list-empty">{t("workspaceVoiceNotFound")}</p>
      )}
    </div>
  );
}

function formatSpeechArtifact(
  artifact: SpeechArtifact,
  locale: Locale,
): string {
  if (artifact.durationMs === undefined) return artifact.contentType;
  return `${artifact.contentType} · ${formatNumber(Math.round(artifact.durationMs / 1000), locale)} s`;
}
