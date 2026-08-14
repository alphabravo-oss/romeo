import { Button, Select } from "@romeo/ui";
import BookOpen from "lucide-react/dist/esm/icons/book-open.mjs";
import FileText from "lucide-react/dist/esm/icons/file-text.mjs";
import X from "lucide-react/dist/esm/icons/x.mjs";
import type { KeyboardEvent } from "react";

import type { MessageKey } from "../lib/i18n";
import { useLocale } from "../lib/i18n";
import type { ChatComposerProps } from "./chat-composer-props";
import { trayCompatibilityConstraint } from "./composer-attachment-input";
import {
  trayAnnouncement,
  trayCanCancel,
  trayCanRetry,
  trayIsBusy,
  type TrayLifecycle,
} from "./composer-tray-lifecycle";
import {
  documentPageSelection,
  isAudioAttachment,
  safeAttachmentDownloadUrl,
} from "./composer-tray-media";

export function ComposerPendingAttachments(props: {
  documentAttachments: ChatComposerProps["documentAttachments"];
  imageAttachments: ChatComposerProps["imageAttachments"];
  isStreaming: boolean;
  knowledgeOverrideLabel: string | undefined;
  onCancelAttachment: (id: string) => void;
  onClearKnowledgeOverride: () => void;
  onMoveDocument: (id: string, direction: -1 | 1) => void;
  onMoveImage: (id: string, direction: -1 | 1) => void;
  onRemoveDocument: (id: string) => void;
  onRemoveImage: (id: string) => void;
  onRetryDocument: (id: string) => void;
  onSelectDocumentPage: (id: string, page: number) => void;
  selectedModel: ChatComposerProps["models"][number] | undefined;
}) {
  const { t } = useLocale();
  const mixed = [
    ...props.imageAttachments.map((attachment) => ({
      altText: attachment.altText,
      downloadUrl: undefined as string | undefined,
      fileName: attachment.fileName,
      height: attachment.height,
      id: attachment.id,
      kind: "image" as const,
      mimeType: attachment.mimeType,
      pageCount: undefined as number | undefined,
      percent: attachment.percent,
      previewUrl: attachment.previewUrl,
      selectedPage: undefined as number | undefined,
      status: attachment.status,
      transcript: undefined as string | undefined,
      width: attachment.width,
      onMove: (direction: -1 | 1) =>
        props.onMoveImage(attachment.id, direction),
      onRemove: () => props.onRemoveImage(attachment.id),
      onRetry: () => undefined,
    })),
    ...props.documentAttachments.map((attachment) => ({
      altText: attachment.fileName,
      downloadUrl: attachment.downloadUrl,
      fileName: attachment.fileName,
      height: undefined as number | undefined,
      id: attachment.id,
      kind: isAudioAttachment(attachment.mimeType)
        ? ("audio" as const)
        : attachment.mimeType.startsWith("video/")
          ? ("video" as const)
          : ("document" as const),
      mimeType: attachment.mimeType,
      pageCount: attachment.pageCount,
      percent: attachment.percent,
      previewUrl: attachment.downloadUrl,
      selectedPage: attachment.selectedPage,
      status: attachment.status,
      transcript: attachment.transcript,
      width: undefined as number | undefined,
      onMove: (direction: -1 | 1) =>
        props.onMoveDocument(attachment.id, direction),
      onRemove: () => props.onRemoveDocument(attachment.id),
      onRetry: () => props.onRetryDocument(attachment.id),
    })),
  ];
  const constraint = trayCompatibilityConstraint({
    hasAudio: mixed.some((item) => item.kind === "audio"),
    hasDocuments: mixed.some((item) => item.kind === "document"),
    hasImages: mixed.some((item) => item.kind === "image"),
    model: props.selectedModel,
  });
  const announcement =
    mixed.length === 0
      ? t("mixedAttachmentTrayEmpty")
      : `${t("mixedAttachmentTrayCount", { count: mixed.length })}. ${mixed
          .map((item) =>
            trayAnnouncement({
              fileName: item.fileName,
              percent: item.percent,
              status: item.status,
            }),
          )
          .join(". ")}`;

  function onCardKeyDown(
    event: KeyboardEvent<HTMLDivElement>,
    attachment: (typeof mixed)[number],
  ) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      attachment.onMove(-1);
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      attachment.onMove(1);
    }
  }

  return (
    <>
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
      {constraint === undefined ? null : (
        <p className="text-xs text-muted" role="status">
          {t(
            constraint === "vision"
              ? "mixedAttachmentNeedsVision"
              : constraint === "audio"
                ? "mixedAttachmentNeedsAudio"
                : "mixedAttachmentNeedsTools",
          )}
        </p>
      )}
      {mixed.length > 0 ? (
        <div
          aria-label={t("mixedAttachmentTray")}
          className="rm-pending-attachments"
          role="list"
        >
          {mixed.map((attachment) => {
            const pages = documentPageSelection(attachment);
            const download = safeAttachmentDownloadUrl(attachment.downloadUrl);
            return (
              <div
                className="rm-pending-attachment rm-tray-card"
                key={`${attachment.kind}:${attachment.id}`}
                onKeyDown={(event) => onCardKeyDown(event, attachment)}
                role="listitem"
                tabIndex={0}
              >
                {attachment.kind === "image" &&
                attachment.previewUrl !== undefined ? (
                  <img
                    alt={attachment.altText}
                    height={attachment.height ?? 48}
                    src={attachment.previewUrl}
                    width={attachment.width ?? 48}
                  />
                ) : attachment.kind === "audio" &&
                  attachment.previewUrl !== undefined ? (
                  <audio controls preload="metadata" src={attachment.previewUrl}>
                    {attachment.fileName}
                  </audio>
                ) : (
                  <FileText aria-hidden="true" size={18} />
                )}
                <span className="rm-tray-card-title">
                  {attachmentPartLabel(attachment.kind, t)} · {attachment.fileName}
                </span>
                {attachment.width !== undefined &&
                attachment.height !== undefined ? (
                  <small>
                    {attachment.width}×{attachment.height}
                  </small>
                ) : null}
                <TrayProgress percent={attachment.percent} status={attachment.status} t={t} />
                {attachment.transcript === undefined ? null : (
                  <p className="rm-tray-transcript">{attachment.transcript}</p>
                )}
                {pages === undefined ? null : (
                  <div className="rm-tray-pages">
                    <Select
                      aria-label={`${t("trayDocumentPage")}: ${attachment.fileName}`}
                      disabled={props.isStreaming}
                      onValueChange={(value) =>
                        props.onSelectDocumentPage(attachment.id, Number(value))
                      }
                      options={Array.from({ length: pages.pageCount }, (_, index) => ({
                        label: String(index + 1),
                        value: String(index + 1),
                      }))}
                      value={String(pages.selectedPage)}
                    />
                  </div>
                )}
                {download === undefined ? null : (
                  <a
                    className="rm-tray-download"
                    download={attachment.fileName}
                    href={download}
                    rel="noreferrer"
                  >
                    {t("traySafeDownload")}
                  </a>
                )}
                <div className="rm-tray-card-actions">
                  <Button
                    aria-label={`${t("moveAttachmentEarlier")}: ${attachment.fileName}`}
                    disabled={props.isStreaming}
                    onClick={() => attachment.onMove(-1)}
                    type="button"
                  >
                    {t("moveAttachmentEarlier")}
                  </Button>
                  <Button
                    aria-label={`${t("moveAttachmentLater")}: ${attachment.fileName}`}
                    disabled={props.isStreaming}
                    onClick={() => attachment.onMove(1)}
                    type="button"
                  >
                    {t("moveAttachmentLater")}
                  </Button>
                  {trayCanRetry(attachment.status) ? (
                    <Button
                      aria-label={`${t("trayRetryUpload")}: ${attachment.fileName}`}
                      disabled={props.isStreaming}
                      onClick={() => attachment.onRetry()}
                      type="button"
                    >
                      {t("trayRetryUpload")}
                    </Button>
                  ) : null}
                  {trayCanCancel(attachment.status) ? (
                    <Button
                      aria-label={`${t("trayCancelUpload")}: ${attachment.fileName}`}
                      onClick={() => props.onCancelAttachment(attachment.id)}
                      type="button"
                    >
                      {t("cancel")}
                    </Button>
                  ) : (
                    <Button
                      aria-label={`${t("removeAttachment")}: ${attachment.fileName}`}
                      disabled={props.isStreaming}
                      onClick={attachment.onRemove}
                      type="button"
                    >
                      <X aria-hidden size={12} />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
      {props.knowledgeOverrideLabel === undefined ? null : (
        <div className="rm-pending-attachments">
          <div className="rm-pending-attachment document">
            <BookOpen aria-hidden="true" size={16} />
            <span className="truncate">{props.knowledgeOverrideLabel}</span>
            <Button
              aria-label={t("composerKnowledgeClearOverride")}
              disabled={props.isStreaming}
              onClick={props.onClearKnowledgeOverride}
              title={t("composerKnowledgeClearOverride")}
              type="button"
            >
              <X aria-hidden="true" size={12} />
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

function TrayProgress({
  percent,
  status,
  t,
}: {
  percent: number;
  status: TrayLifecycle;
  t: (key: MessageKey) => string;
}) {
  if (!trayIsBusy(status) && status !== "failed") return null;
  return (
    <div
      aria-label={t("trayUploadProgress")}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={percent}
      className="rm-tray-progress"
      role="progressbar"
    >
      <span className="rm-tray-progress-bar" style={{ width: `${percent}%` }} />
      <small>
        {t("trayUploadStatus")}: {status} {percent}%
      </small>
    </div>
  );
}

function attachmentPartLabel(
  kind: "image" | "document" | "audio" | "video",
  t: ReturnType<typeof useLocale>["t"],
) {
  if (kind === "image") return t("attachmentPart_image");
  if (kind === "audio") return t("attachmentPart_audio");
  if (kind === "video") return t("attachmentPart_video");
  return t("attachmentPart_document");
}
