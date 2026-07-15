import { createHash } from "node:crypto";

import type { UsageEvent } from "../domain/entities";

export interface VoiceArtifactUsageMetadata {
  artifactId: string;
  storageKey: string;
  contentType?: string;
  chatId?: string;
  messageId?: string;
}

export function readVoiceArtifactUsageMetadata(
  event: UsageEvent,
): VoiceArtifactUsageMetadata | undefined {
  if (event.sourceType !== "voice") return undefined;
  const artifactId = metadataString(event.metadata, "artifactId");
  const storageKey = metadataString(event.metadata, "storageKey");
  if (artifactId === undefined || storageKey === undefined) return undefined;
  const metadata: VoiceArtifactUsageMetadata = { artifactId, storageKey };
  const contentType = metadataString(event.metadata, "contentType");
  if (contentType !== undefined) metadata.contentType = contentType;
  const chatId = metadataString(event.metadata, "chatId");
  if (chatId !== undefined) metadata.chatId = chatId;
  const messageId = metadataString(event.metadata, "messageId");
  if (messageId !== undefined) metadata.messageId = messageId;
  return metadata;
}

export function readActiveVoiceArtifactUsageMetadata(
  event: UsageEvent,
): VoiceArtifactUsageMetadata | undefined {
  if (metadataString(event.metadata, "artifactDeletedAt") !== undefined) {
    return undefined;
  }
  return readVoiceArtifactUsageMetadata(event);
}

export function redactVoiceArtifactStorageMetadata(
  metadata: Record<string, unknown>,
  storageKey: string,
  options: {
    artifactDeletedAt?: string;
    artifactDeletionReason?: "explicit_delete" | "retention";
  } = {},
): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (key === "storageKey") continue;
    next[key] = value;
  }
  next.storageKeyHash = sha256Text(storageKey);
  next.rawStorageKeyReturned = false;
  if (options.artifactDeletedAt !== undefined) {
    next.artifactDeletedAt = options.artifactDeletedAt;
  }
  if (options.artifactDeletionReason !== undefined) {
    next.artifactDeletionReason = options.artifactDeletionReason;
  }
  return next;
}

export function publicUsageEvent(event: UsageEvent): UsageEvent {
  const artifact = readVoiceArtifactUsageMetadata(event);
  if (artifact === undefined) return event;
  return {
    ...event,
    metadata: redactVoiceArtifactStorageMetadata(
      event.metadata,
      artifact.storageKey,
    ),
  };
}

export function metadataString(
  metadata: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = metadata[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
