import type { AuthSubject } from "@romeo/auth";
import type { ObjectStore } from "@romeo/storage";
import type {
  SpeechArtifact,
  SpeechSynthesisArtifact,
  VoiceProfile as ProviderVoiceProfile,
} from "@romeo/voices";

import type { UsageEvent, VoiceProfile } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { createId } from "../ids";
import { readActiveVoiceArtifactUsageMetadata } from "./voice-artifact-metadata";

export interface VoiceCatalogSyncResult {
  imported: number;
  existing: number;
  providerVoiceCount: number;
  profiles: VoiceProfile[];
}

export interface PublicSpeechArtifact {
  id: string;
  contentType: string;
  durationMs?: number;
  playbackUrl: string;
  deleteUrl: string;
  redaction: { rawStorageKeyReturned: false };
}

export interface VoiceArtifactDeleteResult {
  artifactId: string;
  deleted: boolean;
  deletedAt: string;
  storageKeyHash: string;
  redaction: { rawStorageKeyReturned: false };
}

export function publicVoiceArtifact(
  artifact: SpeechArtifact,
): PublicSpeechArtifact {
  return {
    id: artifact.id,
    contentType: artifact.contentType,
    ...(artifact.durationMs === undefined
      ? {}
      : { durationMs: artifact.durationMs }),
    playbackUrl: `/api/v1/voice-artifacts/${encodeURIComponent(artifact.id)}`,
    deleteUrl: `/api/v1/voice-artifacts/${encodeURIComponent(artifact.id)}`,
    redaction: { rawStorageKeyReturned: false },
  };
}

export function safeAudioContentType(
  value: string | undefined,
): string | undefined {
  if (
    value === "audio/mpeg" ||
    value === "audio/ogg" ||
    value === "audio/wav" ||
    value === "audio/wave" ||
    value === "audio/x-wav"
  )
    return value;
  return undefined;
}

export function safeTranscriptionContentType(
  value: string,
): string | undefined {
  const contentType = value.split(";")[0]?.trim().toLowerCase();
  return [
    "audio/mpeg",
    "audio/ogg",
    "audio/wav",
    "audio/wave",
    "audio/x-wav",
    "audio/webm",
    "audio/mp4",
    "audio/flac",
    "video/mp4",
  ].includes(contentType ?? "")
    ? contentType
    : undefined;
}

export function decodeBoundedBase64Audio(value: string): Uint8Array {
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length % 4 === 1 ||
    !/^[A-Za-z0-9+/]*={0,2}$/u.test(normalized)
  ) {
    throw new ApiError(
      "voice_transcription_audio_invalid",
      "Audio must be valid base64.",
      400,
    );
  }
  const bytes = new Uint8Array(Buffer.from(normalized, "base64"));
  if (bytes.byteLength === 0)
    throw new ApiError(
      "voice_transcription_audio_invalid",
      "Audio must not be empty.",
      400,
    );
  if (bytes.byteLength > 10_000_000)
    throw new ApiError(
      "voice_transcription_audio_too_large",
      "Audio transcription input is limited to 10 MB.",
      413,
    );
  return bytes;
}

export function extensionForContentType(contentType: string): string {
  if (contentType === "audio/mpeg") return "mp3";
  if (contentType === "audio/ogg") return "ogg";
  return "wav";
}

export async function persistVoiceArtifact(
  objectStore: ObjectStore,
  orgId: string,
  artifact: SpeechSynthesisArtifact,
): Promise<SpeechArtifact> {
  const storageKey =
    artifact.body === undefined
      ? artifact.storageKey
      : `voice/${orgId}/${artifact.id}/speech.${extensionForContentType(artifact.contentType)}`;
  if (artifact.body !== undefined) {
    await objectStore.putObject({
      key: storageKey,
      body: artifact.body,
      contentType: artifact.contentType,
    });
  }
  return { ...artifact, storageKey };
}

export async function findActiveVoiceArtifactEvent(
  repository: RomeoRepository,
  subject: AuthSubject,
  artifactId: string,
): Promise<UsageEvent | undefined> {
  return (await repository.listUsageEvents(subject.orgId)).find(
    (candidate) =>
      readActiveVoiceArtifactUsageMetadata(candidate)?.artifactId ===
      artifactId,
  );
}

export function voiceProfileFromProvider(
  orgId: string,
  providerVoice: ProviderVoiceProfile,
): VoiceProfile {
  const now = new Date().toISOString();
  return {
    id: createId("voice"),
    orgId,
    providerId: boundedToken(providerVoice.providerId, "voice_provider"),
    providerVoiceId: boundedToken(
      providerVoice.providerVoiceId ?? providerVoice.id,
      "voice",
    ),
    name: boundedVoiceText(providerVoice.name, 120),
    language: boundedToken(providerVoice.language, "und"),
    styleTags: providerVoice.styleTags
      .map((tag) => boundedToken(tag, "tag"))
      .slice(0, 12),
    cloningAllowed: providerVoice.cloningAllowed,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };
}

export function voiceCatalogKey(
  providerId: string,
  providerVoiceId: string,
): string {
  return `${providerId}\0${providerVoiceId}`;
}

export function boundedVoiceText(value: string, maxLength: number): string {
  const trimmed = value.trim();
  return trimmed.length === 0 ? "Untitled voice" : trimmed.slice(0, maxLength);
}

export async function createVoiceUseGrant(
  repository: RomeoRepository,
  subject: AuthSubject,
  voiceProfileId: string,
): Promise<void> {
  await repository.createResourceGrant({
    id: createId("grant"),
    resourceType: "voice_profile",
    resourceId: voiceProfileId,
    principalType: subject.type,
    principalId: subject.id,
    permission: "use",
  });
}

export async function auditVoiceProfile(
  repository: RomeoRepository,
  subject: AuthSubject,
  action: string,
  resourceId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await repository.createAuditLog({
    id: createId("audit"),
    orgId: subject.orgId,
    actorId: subject.id,
    action,
    resourceType: "voice_profile",
    resourceId,
    outcome: "success",
    metadata,
    createdAt: new Date().toISOString(),
  });
}

function boundedToken(value: string, fallback: string): string {
  const token = value
    .trim()
    .replace(/[^A-Za-z0-9_.:-]/gu, "_")
    .slice(0, 120);
  return token.length === 0 ? fallback : token;
}
