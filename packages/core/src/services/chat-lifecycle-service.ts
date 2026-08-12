import {
  AuthorizationError,
  assertScope,
  canAccessOrg,
  hasWorkspaceAccess,
  type AuthSubject,
  type ResourceGrant,
} from "@romeo/auth";

import type {
  Chat,
  DataDeletionPreview,
  DataDeletionResult,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { createId } from "../ids";
import { writeAuditLog } from "./audit-log";
import { getAuthorizedChat } from "./chat-access";
import { persistedSubjectActorId } from "./subject-persisted-actor";
import { assertWorkspaceActive } from "./workspace-guard";

export class ChatLifecycleService {
  constructor(private readonly repository: RomeoRepository) {}

  async create(input: {
    agentId?: string;
    workspaceId: string;
    title: string;
    subject: AuthSubject;
    temporary?: boolean;
    expiresAt?: string;
  }): Promise<Chat> {
    assertScope(input.subject, "chats:write");
    if (!hasWorkspaceAccess(input.subject, input.workspaceId)) {
      throw new AuthorizationError(
        "The workspace is outside the caller access.",
      );
    }
    await assertWorkspaceActive(this.repository, {
      orgId: input.subject.orgId,
      workspaceId: input.workspaceId,
    });
    const now = new Date().toISOString();
    if (input.agentId !== undefined)
      await this.assertAgentAvailable(
        input.agentId,
        input.workspaceId,
        input.subject.orgId,
      );
    const createdBy = await persistedSubjectActorId(
      this.repository,
      input.subject,
      {
        kind: "service_account_chat_owner",
        name: "Service Account Chat Owner",
      },
    );
    const chat = await this.repository.createChat({
      id: createId("chat"),
      orgId: input.subject.orgId,
      workspaceId: input.workspaceId,
      title: input.title,
      ...(input.agentId === undefined ? {} : { agentId: input.agentId }),
      ...(input.temporary === true ? { temporary: true } : {}),
      ...(input.expiresAt === undefined
        ? input.temporary === true
          ? {
              expiresAt: new Date(
                Date.now() + 24 * 60 * 60 * 1_000,
              ).toISOString(),
            }
          : {}
        : { expiresAt: input.expiresAt }),
      createdBy,
      updatedAt: now,
    });
    await this.createOwnerGrants(input.subject, chat.id);
    return chat;
  }

  async update(input: {
    activeLeafMessageId?: string;
    agentId?: string | null;
    chatId: string;
    subject: AuthSubject;
    title?: string;
    modelId?: string | null;
  }): Promise<Chat> {
    const chat = await this.writableChat(input.chatId, input.subject);
    const title = input.title?.trim();
    if (
      input.title !== undefined &&
      (title === undefined || title.length === 0)
    ) {
      throw new ApiError(
        "invalid_chat_update",
        "The chat title cannot be empty.",
        400,
      );
    }
    if (input.modelId !== undefined && input.modelId !== null) {
      await this.assertModelAvailable(input.modelId, input.subject.orgId);
    }
    if (input.agentId !== undefined && input.agentId !== null)
      await this.assertAgentAvailable(
        input.agentId,
        chat.workspaceId,
        input.subject.orgId,
      );
    if (input.activeLeafMessageId !== undefined) {
      // The pointer is a plain text column with no foreign key, so this is the only place that can
      // stop a caller aiming one chat's branch pointer at another chat's message.
      const leaf = await this.repository.getMessage(input.activeLeafMessageId);
      if (leaf === undefined || leaf.chatId !== chat.id)
        throw notFound("Message");
    }
    const changedFields = [
      ...(input.title === undefined ? [] : ["title"]),
      ...(input.modelId === undefined ? [] : ["modelId"]),
      ...(input.agentId === undefined ? [] : ["agentId"]),
      ...(input.activeLeafMessageId === undefined
        ? []
        : ["activeLeafMessageId"]),
    ];
    if (changedFields.length === 0) {
      throw new ApiError(
        "invalid_chat_update",
        "No chat fields were supplied.",
        400,
      );
    }
    const updatedAt = new Date().toISOString();
    return this.repository.transaction(async (repository) => {
      const chatWithModel =
        input.modelId === null
          ? withoutChatModel(chat)
          : input.modelId === undefined
            ? chat
            : { ...chat, modelId: input.modelId };
      const chatWithAgent =
        input.agentId === null
          ? withoutChatAgent(chatWithModel)
          : input.agentId === undefined
            ? chatWithModel
            : { ...chatWithModel, agentId: input.agentId };
      const updated = await repository.updateChat({
        ...chatWithAgent,
        ...(title === undefined ? {} : { title }),
        ...(input.activeLeafMessageId === undefined
          ? {}
          : { activeLeafMessageId: input.activeLeafMessageId }),
        updatedAt,
      });
      await this.audit(
        input.subject,
        "chat.update",
        updated,
        { changedFields },
        repository,
      );
      return updated;
    });
  }

  private async assertAgentAvailable(
    agentId: string,
    workspaceId: string,
    orgId: string,
  ): Promise<void> {
    const agent = await this.repository.getAgent(agentId);
    if (
      agent === undefined ||
      agent.orgId !== orgId ||
      agent.workspaceId !== workspaceId ||
      agent.archivedAt !== undefined ||
      agent.publishedVersionId === undefined
    )
      throw new ApiError(
        "chat_agent_unavailable",
        "The selected custom model is not available in this workspace.",
        400,
      );
  }

  async archive(input: {
    chatId: string;
    subject: AuthSubject;
  }): Promise<Chat> {
    const chat = await this.writableChat(input.chatId, input.subject);
    const archivedAt = new Date().toISOString();
    return this.repository.transaction(async (repository) => {
      const updated = await repository.updateChat({
        ...chat,
        archivedAt,
        updatedAt: archivedAt,
      });
      await this.audit(
        input.subject,
        "chat.archive",
        updated,
        { archivedAt },
        repository,
      );
      return updated;
    });
  }

  async unarchive(input: {
    chatId: string;
    subject: AuthSubject;
  }): Promise<Chat> {
    const chat = await this.writableChat(input.chatId, input.subject);
    await assertWorkspaceActive(this.repository, {
      orgId: chat.orgId,
      workspaceId: chat.workspaceId,
    });
    if (chat.archivedAt === undefined) return chat;
    const updatedAt = new Date().toISOString();
    const { archivedAt: _archivedAt, ...activeChat } = chat;
    return this.repository.transaction(async (repository) => {
      const updated = await repository.updateChat({ ...activeChat, updatedAt });
      await this.audit(
        input.subject,
        "chat.unarchive",
        updated,
        { unarchivedAt: updatedAt },
        repository,
      );
      return updated;
    });
  }

  async deletePreview(input: {
    chatId: string;
    subject: AuthSubject;
  }): Promise<DataDeletionPreview> {
    const chat = await this.writableChat(input.chatId, input.subject);
    const plan = await this.repository.getDataDeletionPlan(
      chat.orgId,
      "chat",
      chat.id,
    );
    if (!plan) throw notFound("Chat");
    return {
      schema: "romeo.data-deletion-preview.v1",
      ...plan,
      previewedAt: new Date().toISOString(),
    };
  }

  async delete(input: {
    chatId: string;
    confirmChatId: string;
    subject: AuthSubject;
  }): Promise<DataDeletionResult> {
    const chat = await this.writableChat(input.chatId, input.subject);
    if (input.confirmChatId !== chat.id) {
      throw new ApiError(
        "chat_delete_confirmation_mismatch",
        "confirmChatId must exactly match chatId.",
        400,
      );
    }
    const plan = await this.repository.getDataDeletionPlan(
      chat.orgId,
      "chat",
      chat.id,
    );
    if (!plan) throw notFound("Chat");
    if (plan.legalHold !== undefined) {
      throw new ApiError(
        "chat_delete_legal_hold",
        "Chat is under legal hold and cannot be deleted.",
        409,
        { legalHoldUntil: plan.legalHold.until },
      );
    }
    const deletedAt = new Date().toISOString();
    const deleted = await this.repository.transaction(async (repository) => {
      const deletion = await repository.deleteDataForResource(
        chat.orgId,
        "chat",
        chat.id,
      );
      if (!deletion) throw notFound("Chat");
      await writeAuditLog(repository, {
        subject: input.subject,
        action: "chat.delete",
        resourceType: "chat",
        resourceId: chat.id,
        metadata: {
          workspaceId: deletion.workspaceId,
          counts: deletion.counts,
          deletionEngine: "governed_data_deletion",
          confirmationMatched: true,
        },
      });
      return deletion;
    });
    return { schema: "romeo.data-deletion-result.v1", ...deleted, deletedAt };
  }

  async updateLegalHold(input: {
    chatId: string;
    subject: AuthSubject;
    legalHoldUntil?: string | null;
    legalHoldReason?: string;
  }): Promise<Chat> {
    assertScope(input.subject, "admin:write");
    const chat = await this.repository.getChat(input.chatId);
    if (!chat) throw notFound("Chat");
    if (!canAccessOrg(input.subject, chat.orgId)) {
      throw new AuthorizationError(
        "The chat is outside the caller organization.",
      );
    }
    if (!hasWorkspaceAccess(input.subject, chat.workspaceId)) {
      throw new AuthorizationError(
        "The workspace is outside the caller access.",
      );
    }
    const now = new Date();
    const updatedAt = now.toISOString();
    if (input.legalHoldUntil === undefined || input.legalHoldUntil === null) {
      return this.repository.transaction(async (repository) => {
        const updated = await repository.updateChat(
          withoutLegalHold({ ...chat, updatedAt }),
        );
        await this.audit(
          input.subject,
          "chat.legal_hold.clear",
          updated,
          { clearedAt: updatedAt },
          repository,
        );
        return updated;
      });
    }
    const holdUntil = new Date(input.legalHoldUntil);
    if (!Number.isFinite(holdUntil.getTime()) || holdUntil <= now) {
      throw new ApiError(
        "invalid_legal_hold",
        "legalHoldUntil must be a future ISO timestamp.",
        400,
      );
    }
    const reason = input.legalHoldReason?.trim();
    return this.repository.transaction(async (repository) => {
      const updated = await repository.updateChat({
        ...withoutLegalHold(chat),
        legalHoldUntil: holdUntil.toISOString(),
        ...(reason !== undefined && reason.length > 0
          ? { legalHoldReason: reason }
          : {}),
        updatedAt,
      });
      await this.audit(
        input.subject,
        "chat.legal_hold.update",
        updated,
        {
          legalHoldUntil: updated.legalHoldUntil,
          hasReason: updated.legalHoldReason !== undefined,
        },
        repository,
      );
      return updated;
    });
  }

  async createOwnerGrants(
    subject: AuthSubject,
    chatId: string,
    repository: RomeoRepository = this.repository,
  ): Promise<void> {
    const permissions: ResourceGrant["permission"][] = ["read", "write"];
    await Promise.all(
      permissions.map((permission) =>
        repository.createResourceGrant({
          id: createId("grant"),
          resourceType: "chat",
          resourceId: chatId,
          principalType: subject.type,
          principalId: subject.id,
          permission,
        }),
      ),
    );
  }

  private writableChat(chatId: string, subject: AuthSubject): Promise<Chat> {
    return getAuthorizedChat(this.repository, {
      chatId,
      subject,
      scope: "chats:write",
      permission: "write",
    });
  }

  private async assertModelAvailable(modelId: string, orgId: string) {
    const model = await this.repository.getModel(modelId);
    if (model === undefined || !model.enabled || model.available === false)
      throw notFound("Model");
    const provider = await this.repository.getProvider(model.providerId);
    if (
      provider === undefined ||
      provider.orgId !== orgId ||
      !provider.enabled
    ) {
      throw notFound("Model");
    }
  }

  private async audit(
    subject: AuthSubject,
    action: string,
    chat: Chat,
    metadata: Record<string, unknown>,
    repository: RomeoRepository,
  ) {
    await writeAuditLog(repository, {
      subject,
      action,
      resourceType: "chat",
      resourceId: chat.id,
      metadata: { workspaceId: chat.workspaceId, ...metadata },
    });
  }
}

function withoutLegalHold(chat: Chat): Chat {
  const {
    legalHoldUntil: _legalHoldUntil,
    legalHoldReason: _legalHoldReason,
    ...rest
  } = chat;
  return rest;
}

function withoutChatModel(chat: Chat): Chat {
  const { modelId: _modelId, ...rest } = chat;
  return rest;
}

function withoutChatAgent(chat: Chat): Chat {
  const { agentId: _agentId, ...rest } = chat;
  return rest;
}
