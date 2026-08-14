import {
  AuthorizationError,
  assertScope,
  canAccessOrg,
  hasGrant,
  hasWorkspaceAccess,
  type AuthSubject,
  type ResourceGrant,
} from "@romeo/auth";

import type { Message, UsageEvent, VoiceProfile } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { metadataString } from "./voice-artifact-metadata";

export class VoiceAccess {
  constructor(private readonly repository: RomeoRepository) {}

  async voice(
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
    )
      throw new AuthorizationError(
        `Missing ${permission} permission for voice_profile:${voiceProfile.id}`,
      );
    return voiceProfile;
  }

  async assistantMessage(
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
        "Speech can only be generated for model messages.",
        400,
      );
    return message;
  }

  async artifact(subject: AuthSubject, event: UsageEvent): Promise<void> {
    await this.voice(event.sourceId, subject, "use");
    const messageId = metadataString(event.metadata, "messageId");
    if (messageId !== undefined)
      await this.assistantMessage(subject, messageId);
  }
}
