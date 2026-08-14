import {
  AuthorizationError,
  assertScope,
  canAccessOrg,
  hasScope,
  hasWorkspaceAccess,
  type AuthSubject,
} from "@romeo/auth";
import { memoryObjectStore, type ObjectStore } from "@romeo/storage";
import {
  disabledVoiceProvider,
  type TranscriptionResult,
  type VoiceProvider,
} from "@romeo/voices";

import type { Agent, VoiceProfile } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { createId } from "../ids";
import { assertAbuseControlsAllow } from "./abuse-control-service";
import { authorizeVoiceProcessing } from "./capability-consumer-enforcement";
import type { CapabilityService } from "./capability-resolver";
import { enforceContentPolicyText } from "./content-policy-service";
import { recordSubjectUsage, updateRecordedUsage } from "./record-usage";
import {
  metadataString,
  readActiveVoiceArtifactUsageMetadata,
  redactVoiceArtifactStorageMetadata,
  sha256Text,
} from "./voice-artifact-metadata";
import {
  auditVoiceProfile,
  boundedVoiceText,
  createVoiceUseGrant,
  decodeBoundedBase64Audio,
  findActiveVoiceArtifactEvent,
  persistVoiceArtifact,
  publicVoiceArtifact,
  safeAudioContentType,
  safeTranscriptionContentType,
  voiceCatalogKey,
  voiceProfileFromProvider,
} from "./voice-service-helpers";
import { listVoiceProfilesWithDependencies } from "./voice-catalog-summary";
import { VoiceAccess } from "./voice-access";

export type {
  PublicSpeechArtifact,
  VoiceArtifactDeleteResult,
  VoiceCatalogSyncResult,
} from "./voice-service-helpers";

export class VoiceService {
  private readonly access: VoiceAccess;

  constructor(
    private readonly repository: RomeoRepository,
    private readonly voiceProvider: VoiceProvider = disabledVoiceProvider,
    private readonly objectStore: ObjectStore = memoryObjectStore,
    private readonly capabilities?: CapabilityService,
  ) {
    this.access = new VoiceAccess(repository);
  }
  async list(subject: AuthSubject): Promise<VoiceProfile[]> {
    return listVoiceProfilesWithDependencies(this.repository, subject);
  }

  async syncCatalog(subject: AuthSubject) {
    assertScope(subject, "voices:manage");
    await authorizeVoiceProcessing(this.capabilities, subject);
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
        await createVoiceUseGrant(repository, subject, created.id);
        existingKeys.add(key);
        imported.push(created);
      }

      await auditVoiceProfile(
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
              catalog.map((voice) => boundedVoiceText(voice.providerId, 120)),
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
      await createVoiceUseGrant(repository, input.subject, voiceProfile.id);
      await auditVoiceProfile(
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
    const voiceProfile = await this.access.voice(
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
    const message = await this.access.assistantMessage(
      input.subject,
      input.messageId,
    );
    if (message.content.length > 4_000)
      throw new ApiError(
        "message_speech_too_long",
        "Message speech is limited to 4000 characters.",
        400,
      );
    const voiceProfile = await this.access.voice(
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
    await authorizeVoiceProcessing(this.capabilities, input.subject);
    const governedPrompt =
      input.prompt === undefined
        ? undefined
        : (
            await enforceContentPolicyText(
              this.repository,
              input.subject,
              input.prompt,
            )
          ).content;
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
        ...(governedPrompt === undefined ? {} : { prompt: governedPrompt }),
      });
      await this.repository.transaction(async (repository) => {
        const metadata = {
          audioBytes: audio.byteLength,
          contentType,
          textLength: result.text.length,
          language: result.language ?? null,
          promptProvided: input.prompt !== undefined,
        };
        await recordSubjectUsage(repository, input.subject, {
          orgId: input.subject.orgId,
          sourceType: "voice",
          sourceId: "voice_transcription",
          metric: "voice.transcription.generated",
          quantity: 1,
          unit: "event",
          metadata,
        });
        await recordSubjectUsage(
          repository,
          input.subject,
          result.durationMs === undefined
            ? {
                orgId: input.subject.orgId,
                sourceType: "voice",
                sourceId: "voice_transcription",
                metric: "audio.input_byte",
                quantity: audio.byteLength,
                unit: "byte",
                metadata: { contentType },
              }
            : {
                orgId: input.subject.orgId,
                sourceType: "voice",
                sourceId: "voice_transcription",
                metric: "audio.input_second",
                quantity: result.durationMs / 1000,
                unit: "second",
                metadata: { contentType },
              },
        );
      });
      return result;
    } catch {
      throw new ApiError(
        "voice_not_configured",
        "Voice transcription is not configured.",
        409,
      );
    }
  }

  async readArtifact(input: {
    subject: AuthSubject;
    artifactId: string;
  }): Promise<{ bytes: Uint8Array; contentType: string }> {
    const event = await findActiveVoiceArtifactEvent(
      this.repository,
      input.subject,
      input.artifactId,
    );
    if (event === undefined) throw notFound("Voice artifact");
    await this.access.artifact(input.subject, event);
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

  async deleteArtifact(input: { subject: AuthSubject; artifactId: string }) {
    const event = await findActiveVoiceArtifactEvent(
      this.repository,
      input.subject,
      input.artifactId,
    );
    if (event === undefined) throw notFound("Voice artifact");
    await this.access.artifact(input.subject, event);
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
      await updateRecordedUsage(repository, {
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
      await writeAuditLog(repository, {
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
      redaction: { rawStorageKeyReturned: false as const },
      storageKeyHash: sha256Text(artifact.storageKey),
    };
  }

  async bindAgent(input: {
    subject: AuthSubject;
    agentId: string;
    voiceProfileId: string;
  }): Promise<Agent> {
    assertScope(input.subject, "agents:write");
    await this.access.voice(input.voiceProfileId, input.subject, "use");

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

  private async synthesizeAndRecord(input: {
    subject: AuthSubject;
    voiceProfile: VoiceProfile;
    text: string;
    metric: "voice.message.generated" | "voice.preview.generated";
    metadata?: Record<string, unknown>;
  }) {
    await authorizeVoiceProcessing(this.capabilities, input.subject);
    const governedText = (
      await enforceContentPolicyText(this.repository, input.subject, input.text)
    ).content;
    await assertAbuseControlsAllow(this.repository, input.subject, {
      action: "voice.request",
      providerId: input.voiceProfile.providerId,
      workerClass: "voice.synthesis",
    });
    try {
      const artifact = await this.voiceProvider.synthesize({
        orgId: input.subject.orgId,
        voiceId: input.voiceProfile.providerVoiceId,
        text: governedText,
        format: "wav",
      });
      const persistedArtifact = await persistVoiceArtifact(
        this.objectStore,
        input.subject.orgId,
        artifact,
      );
      await this.repository.transaction(async (repository) => {
        await recordSubjectUsage(repository, input.subject, {
          orgId: input.subject.orgId,
          sourceType: "voice",
          sourceId: input.voiceProfile.id,
          metric: input.metric,
          quantity: 1,
          unit: "event",
          metadata: {
            ...input.metadata,
            artifactId: persistedArtifact.id,
            storageKey: persistedArtifact.storageKey,
            contentType: persistedArtifact.contentType,
            durationMs: persistedArtifact.durationMs ?? null,
          },
        });
        await recordSubjectUsage(
          repository,
          input.subject,
          persistedArtifact.durationMs === undefined
            ? {
                orgId: input.subject.orgId,
                sourceType: "voice",
                sourceId: input.voiceProfile.id,
                metric: "audio.output_character",
                quantity: governedText.length,
                unit: "character",
                metadata: { contentType: persistedArtifact.contentType },
              }
            : {
                orgId: input.subject.orgId,
                sourceType: "voice",
                sourceId: input.voiceProfile.id,
                metric: "audio.output_second",
                quantity: persistedArtifact.durationMs / 1000,
                unit: "second",
                metadata: { contentType: persistedArtifact.contentType },
              },
        );
      });
      return publicVoiceArtifact(persistedArtifact);
    } catch {
      throw new ApiError(
        "voice_not_configured",
        "Voice synthesis is not configured.",
        409,
      );
    }
  }
}
import { writeAuditLog } from "./audit-log";
