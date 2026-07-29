import { Button, Input } from "@romeo/ui";
import type { ReactNode } from "react";

import type { Message, MessageAttachment } from "../features/types";
import { useLocale } from "../lib/i18n";

export function previewUrlForAttachment(
  attachment: MessageAttachment,
): string | undefined {
  if (attachment.previewUrl === undefined) return undefined;
  if (isOfficeMimeType(attachment.mimeType))
    return `${attachment.previewUrl}/preview`;
  return canInlinePreview(attachment.mimeType)
    ? attachment.previewUrl
    : undefined;
}

function canInlinePreview(mimeType: string): boolean {
  return (
    mimeType.startsWith("image/") ||
    mimeType === "application/pdf" ||
    mimeType.startsWith("text/") ||
    mimeType === "application/json"
  );
}

function isOfficeMimeType(mimeType: string): boolean {
  return (
    mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mimeType ===
      "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    mimeType ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
}

export function MessageAttachments({
  isStreaming,
  message,
  onRetentionChange,
  onPreview,
}: {
  isStreaming: boolean;
  message: Message;
  onRetentionChange: (
    messageId: string,
    attachmentId: string,
    retainedInContext: boolean,
  ) => void;
  onPreview: (attachment: MessageAttachment) => void;
}) {
  const { t } = useLocale();
  if (!message.attachments?.length) return null;
  return (
    <div className="rm-message-attachments">
      {message.attachments.map((attachment) => (
        <div className="rm-attachment-with-retention" key={attachment.id}>
          <Button
            className="rm-attachment-tile"
            disabled={attachment.previewUrl === undefined}
            onClick={() => onPreview(attachment)}
            type="button"
          >
            {attachment.previewUrl && attachment.kind === "image" ? (
              <img
                alt={attachment.fileName}
                height={48}
                loading="lazy"
                src={attachment.previewUrl}
                width={48}
              />
            ) : null}
            <div className="truncate">{attachment.fileName}</div>
          </Button>
          <label
            title={isStreaming ? t("waitForResponse") : t("keepContextTitle")}
          >
            <Input
              checked={attachment.retainedInContext}
              disabled={isStreaming}
              onChange={(event) =>
                onRetentionChange(
                  message.id,
                  attachment.id,
                  event.currentTarget.checked,
                )
              }
              type="checkbox"
            />
            {t("keepContext")}
          </label>
        </div>
      ))}
    </div>
  );
}

export function MessageActions({ children }: { children: ReactNode }) {
  return <div className="rm-message-actions">{children}</div>;
}

export function Action({
  active = false,
  children,
  disabled = false,
  label,
  onClick,
  pressed,
  title,
}: {
  active?: boolean;
  children: ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => void;
  pressed?: boolean;
  title?: string;
}) {
  return (
    <Button
      aria-label={label}
      aria-pressed={pressed || undefined}
      className={`rm-message-tool ${active ? "active" : ""}`}
      disabled={disabled}
      onClick={onClick}
      title={title ?? label}
      type="button"
    >
      {children}
    </Button>
  );
}
