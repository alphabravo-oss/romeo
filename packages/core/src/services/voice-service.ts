import {
  AuthorizationError,
  assertScope,
  canAccessOrg,
  hasGrant,
  hasScope,
  hasWorkspaceAccess,
  type AuthSubject,
  type ResourceGrant,
} from "@romeo/auth";
import { memoryObjectStore, type ObjectStore } from "@romeo/storage";
import {
  disabledVoiceProvider,
  type SpeechArtifact,
  type SpeechSynthesisArtifact,
  type TranscriptionResult,
  type VoiceProfile as ProviderVoiceProfile,
  type VoiceProvider,
} from "@romeo/voices";

import type {
  Agent,
  Message,
  UsageEvent,
  VoiceProfile,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { createId } from "../ids";
import { assertAbuseControlsAllow } from "./abuse-control-service";
import { recordSubjectUsage } from "./record-usage";
import {
  metadataString,
  readActiveVoiceArtifactUsageMetadata,
  redactVoiceArtifactStorageMetadata,
  sha256Text,
} from "./voice-artifact-metadata";

export class VoiceService {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly voiceProvider: VoiceProvider = disabledVoiceProvider,
    private readonly objectStore: ObjectStore = memoryObjectStore,
  ) {}

  list(subject: AuthSubject): Promise<VoiceProfile[]> {
    assertScope(subject, "voices:use");
    return this.repository.listVoiceProfiles(subject.orgId);
  }

  async syncCatalog(subject: AuthSubject): Promise<VoiceCatalogSyncResult> {
    assertScope(subject, "voices:manage");
    await assertAbuseControlsAllow(this.repository, subject, {
      action: "voice.request",
      workerClass: "voice.catalog_sync",
    });
    const catalog = await this.voiceProvider.listVoices(subject.orgId);
    if (catalog.length > 100)
      throw new ApiError(
        "voice_catalog_too_large",
        "Voice provider catalog sync is limited to 100 voices.",
        413,
      );

    const existing = await this.repository.listVoiceProfiles(subject.orgId);
    const existingKeys = new Set(
      existing.map((voice) =>
        voiceCatalogKey(voice.providerId, voice.providerVoiceId),
      ),
    );
    const imported = await this.repository.transaction(async (repository) => {
      const imported: VoiceProfile[] = [];
      for (const providerVoice of catalog) {
        const candidate = voiceProfileFromProvider(
          subject.orgId,
          providerVoice,
        );
        const key = voiceCatalogKey(
          candidate.providerId,
          candidate.providerVoiceId,
        );
        if (existingKeys.has(key)) continue;
        const created = await repository.createVoiceProfile(candidate);
        await this.createUseGrant(repository, subject, created.id);
        existingKeys.add(key);
        imported.push(created);
      }

      await this.auditVoiceProfile(
        repository,
        subject,
        "voice.catalog_sync",
        "voice_catalog",
        {
          providerVoiceCount: catalog.length,
          importedCount: imported.length,
          existingCount: catalog.length - imported.length,
          providerIds: [
            ...new Set(
              catalog.map((voice) => boundedText(voice.providerId, 120)),
            ),
          ].sort(),
        },
      );
      return imported;
    });

    return {
      imported: imported.length,
      existing: catalog.length - imported.length,
      providerVoiceCount: catalog.length,
      profiles: imported,
    };
  }

  async create(input: {
    subject: AuthSubject;
    name: string;
    providerVoiceId: string;
    language: string;
    styleTags: string[];
  }): Promise<VoiceProfile> {
    assertScope(input.subject, "voices:manage");
    const now = new Date().toISOString();
    return this.repository.transaction(async (repository) => {
      const voiceProfile = await repository.createVoiceProfile({
        id: createId("voice"),
        orgId: input.subject.orgId,
        providerId: "voice_disabled",
        providerVoiceId: input.providerVoiceId,
        name: input.name,
        language: input.language,
        styleTags: input.styleTags,
        cloningAllowed: false,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      });
      await this.createUseGrant(repository, input.subject, voiceProfile.id);
      await this.auditVoiceProfile(
        repository,
        input.subject,
        "voice.profile.create",
        voiceProfile.id,
        {
          providerId: voiceProfile.providerId,
          providerVoiceConfigured: voiceProfile.providerVoiceId !== undefined,
          styleTagCount: voiceProfile.styleTags.length,
        },
      );
      return voiceProfile;
    });
  }

  async preview(input: {
    subject: AuthSubject;
    voiceProfileId: string;
    text: string;
  }) {
    const voiceProfile = await this.getAuthorizedVoice(
      input.voiceProfileId,
      input.subject,
      "use",
    );
    return this.synthesizeAndRecord({
      subject: input.subject,
      voiceProfile,
      text: input.text,
      metric: "voice.preview.generated",
    });
  }

  async generateMessageSpeech(input: {
    subject: AuthSubject;
    messageId: string;
    voiceProfileId: string;
  }) {
    const message = await this.getAuthorizedAssistantMessage(
      input.subject,
      input.messageId,
    );
    if (message.content.length > 4_000)
      throw new ApiError(
        "message_speech_too_long",
        "Message speech is limited to 4000 characters.",
        400,
      );
    const voiceProfile = await this.getAuthorizedVoice(
      input.voiceProfileId,
      input.subject,
      "use",
    );
    return this.synthesizeAndRecord({
      subject: input.subject,
      voiceProfile,
      text: message.content,
      metric: "voice.message.generated",
      metadata: { messageId: message.id, chatId: message.chatId },
    });
  }

  async transcribe(input: {
    subject: AuthSubject;
    audioBase64: string;
    contentType: string;
    fileName?: string;
    language?: string;
    prompt?: string;
  }): Promise<TranscriptionResult> {
    assertScope(input.subject, "voices:use");
    const contentType = safeTranscriptionContentType(input.contentType);
    if (contentType === undefined)
      throw new ApiError(
        "voice_transcription_media_unsupported",
        "Unsupported transcription audio content type.",
        400,
      );
    const audio = decodeBoundedBase64Audio(input.audioBase64);
    await assertAbuseControlsAllow(this.repository, input.subject, {
      action: "voice.request",
      workerClass: "voice.transcription",
    });
    try {
      const result = await this.voiceProvider.transcribe({
        orgId: input.subject.orgId,
        audio,
        contentType,
        ...(input.fileName === undefined ? {} : { fileName: input.fileName }),
        ...(input.language === undefined ? {} : { language: input.language }),
        ...(input.prompt === undefined ? {} : { prompt: input.prompt }),
      });
      await recordSubjectUsage(this.repository, input.subject, {
        orgId: input.subject.orgId,
        sourceType: "voice",
        sourceId: "voice_transcription",
        metric: "voice.transcription.generated",
        quantity: result.durationMs ?? audio.byteLength,
        unit: result.durationMs === undefined ? "byte" : "ms",
        metadata: {
          audioBytes: audio.byteLength,
          contentType,
          textLength: result.text.length,
          language: result.language ?? null,
          promptProvided: input.prompt !== undefined,
        },
      });
      return result;
    } catch (error) {
      throw new ApiError(
        "voice_not_configured",
        error instanceof Error
          ? error.message
          : "Voice transcription is not configured.",
        409,
      );
    }
  }

  async readArtifact(input: {
    subject: AuthSubject;
    artifactId: string;
  }): Promise<{ bytes: Uint8Array; contentType: string }> {
    const event = await this.findActiveArtifactEvent(
      input.subject,
      input.artifactId,
    );
    if (event === undefined) throw notFound("Voice artifact");
    await this.authorizeArtifactEvent(input.subject, event);
    const artifact = readActiveVoiceArtifactUsageMetadata(event);
    const storageKey = artifact?.storageKey;
    const contentType = safeAudioContentType(
      metadataString(event.metadata, "contentType"),
    );
    if (storageKey === undefined || contentType === undefined)
      throw notFound("Voice artifact");
    const bytes = await this.objectStore.getObject(storageKey);
    if (bytes === undefined) throw notFound("Voice artifact");
    return { bytes, contentType };
  }

  async deleteArtifact(input: {
    subject: AuthSubject;
    artifactId: string;
  }): Promise<VoiceArtifactDeleteResult> {
    const event = await this.findActiveArtifactEvent(
      input.subject,
      input.artifactId,
    );
    if (event === undefined) throw notFound("Voice artifact");
    await this.authorizeArtifactEvent(input.subject, event);
    if (
      event.actorId !== input.subject.id &&
      !hasScope(input.subject, "admin:write")
    ) {
      throw new AuthorizationError(
        "Only the artifact owner or an administrator can delete this voice artifact.",
      );
    }
    const artifact = readActiveVoiceArtifactUsageMetadata(event);
    if (artifact === undefined) throw notFound("Voice artifact");
    const deletedAt = new Date().toISOString();
    const existing = await this.objectStore.getObject(artifact.storageKey);
    await this.repository.transaction(async (repository) => {
      await repository.updateUsageEvent({
        ...event,
        metadata: redactVoiceArtifactStorageMetadata(
          event.metadata,
          artifact.storageKey,
          {
            artifactDeletedAt: deletedAt,
            artifactDeletionReason: "explicit_delete",
          },
        ),
      });
      await repository.createAuditLog({
        id: createId("audit"),
        orgId: input.subject.orgId,
        actorId: input.subject.id,
        action: "voice.artifact.delete",
        resourceType: "voice_profile",
        resourceId: event.sourceId,
        outcome: "success",
        metadata: {
          artifactId: artifact.artifactId,
          storageKeyHash: sha256Text(artifact.storageKey),
          objectDeleted: existing !== undefined,
          rawStorageKeyReturned: false,
        },
        createdAt: deletedAt,
      });
    });
    if (existing !== undefined)
      await this.objectStore.deleteObject(artifact.storageKey);
    return {
      artifactId: artifact.artifactId,
      deleted: existing !== undefined,
      deletedAt,
      redaction: { rawStorageKeyReturned: false },
      storageKeyHash: sha256Text(artifact.storageKey),
    };
  }

  async bindAgent(input: {
    subject: AuthSubject;
    agentId: string;
    voiceProfileId: string;
  }): Promise<Agent> {
    assertScope(input.subject, "agents:write");
    await this.getAuthorizedVoice(input.voiceProfileId, input.subject, "use");

    const agent = await this.repository.getAgent(input.agentId);
    if (!agent) throw notFound("Agent");
    if (!canAccessOrg(input.subject, agent.orgId))
      throw new AuthorizationError(
        "The agent is outside the caller organization.",
      );
    if (!hasWorkspaceAccess(input.subject, agent.workspaceId))
      throw new AuthorizationError(
        "The agent is outside the caller workspace access.",
      );

    return this.repository.updateAgent({
      ...agent,
      voiceProfileId: input.voiceProfileId,
      updatedAt: new Date().toISOString(),
    });
  }

  private async getAuthorizedVoice(
    voiceProfileId: string,
    subject: AuthSubject,
    permission: ResourceGrant["permission"],
  ): Promise<VoiceProfile> {
    assertScope(subject, "voices:use");
    const voiceProfile = await this.repository.getVoiceProfile(voiceProfileId);
    if (!voiceProfile) throw notFound("Voice profile");
    if (!canAccessOrg(subject, voiceProfile.orgId))
      throw new AuthorizationError(
        "The voice is outside the caller organization.",
      );

    const grants = await this.repository.listResourceGrants(subject.orgId);
    if (
      !hasGrant(subject, grants, "voice_profile", voiceProfile.id, permission)
    ) {
      throw new AuthorizationError(
        `Missing ${permission} permission for voice_profile:${voiceProfile.id}`,
      );
    }
    return voiceProfile;
  }

  private async getAuthorizedAssistantMessage(
    subject: AuthSubject,
    messageId: string,
  ): Promise<Message> {
    assertScope(subject, "chats:read");
    const message = await this.repository.getMessage(messageId);
    if (!message) throw notFound("Message");
    const chat = await this.repository.getChat(message.chatId);
    if (!chat) throw notFound("Chat");
    if (!canAccessOrg(subject, chat.orgId))
      throw new AuthorizationError(
        "The message is outside the caller organization.",
      );
    if (!hasWorkspaceAccess(subject, chat.workspaceId))
      throw new AuthorizationError(
        "The message is outside the caller workspace access.",
      );
    const grants = await this.repository.listResourceGrants(subject.orgId);
    if (!hasGrant(subject, grants, "chat", chat.id, "read"))
      throw new AuthorizationError(
        `Missing read permission for chat:${chat.id}`,
      );
    if (message.role !== "assistant")
      throw new ApiError(
        "message_speech_role_unsupported",
        "Speech can only be generated for assistant messages.",
        400,
      );
    return message;
  }

  private async synthesizeAndRecord(input: {
    subject: AuthSubject;
    voiceProfile: VoiceProfile;
    text: string;
    metric: "voice.message.generated" | "voice.preview.generated";
    metadata?: Record<string, unknown>;
  }) {
    await assertAbuseControlsAllow(this.repository, input.subject, {
      action: "voice.request",
      providerId: input.voiceProfile.providerId,
      workerClass: "voice.synthesis",
    });
    try {
      const artifact = await this.voiceProvider.synthesize({
        orgId: input.subject.orgId,
        voiceId: input.voiceProfile.providerVoiceId,
        text: input.text,
        format: "wav",
      });
      const persistedArtifact = await this.persistArtifact(
        input.subject.orgId,
        artifact,
      );
      await recordSubjectUsage(this.repository, input.subject, {
        orgId: input.subject.orgId,
        sourceType: "voice",
        sourceId: input.voiceProfile.id,
        metric: input.metric,
        quantity: persistedArtifact.durationMs ?? input.text.length,
        unit: persistedArtifact.durationMs === undefined ? "char" : "ms",
        metadata: {
          ...(input.metadata ?? {}),
          artifactId: persistedArtifact.id,
          storageKey: persistedArtifact.storageKey,
          contentType: persistedArtifact.contentType,
          durationMs: persistedArtifact.durationMs ?? null,
        },
      });
      return publicArtifact(persistedArtifact);
    } catch (error) {
      throw new ApiError(
        "voice_not_configured",
        error instanceof Error
          ? error.message
          : "Voice synthesis is not configured.",
        409,
      );
    }
  }

  private async persistArtifact(
    orgId: string,
    artifact: SpeechSynthesisArtifact,
  ): Promise<SpeechArtifact> {
    const storageKey =
      artifact.body === undefined
        ? artifact.storageKey
        : `voice/${orgId}/${artifact.id}/speech.${extensionForContentType(artifact.contentType)}`;
    if (artifact.body !== undefined) {
      await this.objectStore.putObject({
        key: storageKey,
        body: artifact.body,
        contentType: artifact.contentType,
      });
    }
    return { ...artifact, storageKey };
  }

  private async authorizeArtifactEvent(
    subject: AuthSubject,
    event: UsageEvent,
  ): Promise<void> {
    await this.getAuthorizedVoice(event.sourceId, subject, "use");
    const messageId = metadataString(event.metadata, "messageId");
    if (messageId !== undefined)
      await this.getAuthorizedAssistantMessage(subject, messageId);
  }

  private async createUseGrant(
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

  private async findActiveArtifactEvent(
    subject: AuthSubject,
    artifactId: string,
  ): Promise<UsageEvent | undefined> {
    return (await this.repository.listUsageEvents(subject.orgId)).find(
      (candidate) =>
        readActiveVoiceArtifactUsageMetadata(candidate)?.artifactId ===
        artifactId,
    );
  }

  private async auditVoiceProfile(
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
}

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

function publicArtifact(artifact: SpeechArtifact): PublicSpeechArtifact {
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

function safeAudioContentType(value: string | undefined): string | undefined {
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

function safeTranscriptionContentType(value: string): string | undefined {
  const contentType = value.split(";")[0]?.trim().toLowerCase();
  if (
    contentType === "audio/mpeg" ||
    contentType === "audio/ogg" ||
    contentType === "audio/wav" ||
    contentType === "audio/wave" ||
    contentType === "audio/x-wav" ||
    contentType === "audio/webm" ||
    contentType === "audio/mp4" ||
    contentType === "audio/flac" ||
    contentType === "video/mp4"
  ) {
    return contentType;
  }
  return undefined;
}

function decodeBoundedBase64Audio(value: string): Uint8Array {
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

function extensionForContentType(contentType: string): string {
  if (contentType === "audio/mpeg") return "mp3";
  if (contentType === "audio/ogg") return "ogg";
  return "wav";
}

function voiceProfileFromProvider(
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
    name: boundedText(providerVoice.name, 120),
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

function voiceCatalogKey(providerId: string, providerVoiceId: string): string {
  return `${providerId}\0${providerVoiceId}`;
}

function boundedText(value: string, maxLength: number): string {
  const trimmed = value.trim();
  return trimmed.length === 0 ? "Untitled voice" : trimmed.slice(0, maxLength);
}

function boundedToken(value: string, fallback: string): string {
  const token = value
    .trim()
    .replace(/[^A-Za-z0-9_.:-]/gu, "_")
    .slice(0, 120);
  return token.length === 0 ? fallback : token;
}
