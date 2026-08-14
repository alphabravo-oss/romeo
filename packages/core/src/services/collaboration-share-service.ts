import type { AuthSubject, ResourceGrant } from "@romeo/auth";

import type { FileObject } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { getAuthorizedAgent } from "./agent-access";
import type { AuditAction, AuditMetadata } from "./audit-log";
import { getAuthorizedChat } from "./chat-access";
import { getAuthorizedKnowledgeBase } from "./knowledge-access";
import type { ShareInput, ShareTarget } from "./collaboration-share-model";
import {
  auditShare,
  createResourceShares,
  deleteResourceShare,
  findShareTargets,
  getAuthorizedSharedFile,
  requireOrgModel,
  requireOrgWorkspace,
  revokeAgentShare,
  revokeKnowledgeBaseShare,
  sharesForResource,
} from "./collaboration-share-support";

export type { ShareInput, ShareTarget } from "./collaboration-share-model";

export class CollaborationShareService {
  constructor(protected readonly repository: RomeoRepository) {}

  async shareTargets(
    subject: AuthSubject,
    query = "",
    limit = 20,
  ): Promise<ShareTarget[]> {
    return findShareTargets(this.repository, subject, query, limit);
  }

  async listAgentShares(
    subject: AuthSubject,
    agentId: string,
  ): Promise<ResourceGrant[]> {
    const agent = await getAuthorizedAgent(this.repository, {
      agentId,
      subject,
      scope: "agents:read",
    });
    return this.sharesFor("agent", agent.id, subject.orgId);
  }

  async shareAgent(input: {
    subject: AuthSubject;
    agentId: string;
    share: ShareInput;
  }): Promise<ResourceGrant[]> {
    const agent = await getAuthorizedAgent(this.repository, {
      agentId: input.agentId,
      subject: input.subject,
      scope: "agents:write",
    });
    return this.repository.transaction(async (repository) => {
      const grants = await this.shareResource({
        repository,
        subject: input.subject,
        resourceType: "agent",
        resourceId: agent.id,
        allowedPermissions: ["read", "run", "write"],
        share: input.share,
      });
      await this.audit(
        input.subject,
        "agent.share",
        "agent",
        agent.id,
        {
          principalType: input.share.principalType,
          permissions: grants.map((grant) => grant.permission),
        },
        repository,
      );
      return grants;
    });
  }

  async revokeAgentGrant(input: {
    subject: AuthSubject;
    agentId: string;
    grantId: string;
  }): Promise<ResourceGrant> {
    return revokeAgentShare(this.repository, input);
  }

  async revokeKnowledgeBaseGrant(input: {
    subject: AuthSubject;
    knowledgeBaseId: string;
    grantId: string;
  }): Promise<ResourceGrant> {
    return revokeKnowledgeBaseShare(this.repository, input);
  }

  async listModelShares(
    subject: AuthSubject,
    modelId: string,
  ): Promise<ResourceGrant[]> {
    const model = await requireOrgModel(
      this.repository,
      subject,
      modelId,
      "admin:read",
    );
    return this.sharesFor("model", model.id, subject.orgId);
  }

  async shareModel(input: {
    subject: AuthSubject;
    modelId: string;
    share: ShareInput;
  }): Promise<ResourceGrant[]> {
    const model = await requireOrgModel(
      this.repository,
      input.subject,
      input.modelId,
      "admin:write",
    );
    return this.repository.transaction(async (repository) => {
      const grants = await this.shareResource({
        repository,
        subject: input.subject,
        resourceType: "model",
        resourceId: model.id,
        allowedPermissions: ["use"],
        share: input.share,
      });
      await this.shareResource({
        repository,
        subject: input.subject,
        resourceType: "provider",
        resourceId: model.providerId,
        allowedPermissions: ["use"],
        share: { ...input.share, permissions: ["use"] },
      });
      await this.audit(
        input.subject,
        "model.share",
        "model",
        model.id,
        {
          principalType: input.share.principalType,
          permissions: grants.map((grant) => grant.permission),
          providerId: model.providerId,
        },
        repository,
      );
      return grants;
    });
  }

  async revokeModelGrant(input: {
    subject: AuthSubject;
    modelId: string;
    grantId: string;
  }): Promise<ResourceGrant> {
    const model = await requireOrgModel(
      this.repository,
      input.subject,
      input.modelId,
      "admin:write",
    );
    const deleted = await deleteResourceShare({
      repository: this.repository,
      orgId: input.subject.orgId,
      resourceType: "model",
      resourceId: model.id,
      grantId: input.grantId,
      missingLabel: "Model grant",
    });
    const grant = deleted;
    await this.audit(input.subject, "model.share.revoke", "model", model.id, {
      principalType: grant.principalType,
      principalId: grant.principalId,
      permission: grant.permission,
    });
    return deleted;
  }

  async listWorkspaceMembers(
    subject: AuthSubject,
    workspaceId: string,
  ): Promise<ResourceGrant[]> {
    await requireOrgWorkspace(
      this.repository,
      subject,
      workspaceId,
      "admin:read",
    );
    return this.sharesFor("workspace", workspaceId, subject.orgId);
  }

  async shareWorkspace(input: {
    subject: AuthSubject;
    workspaceId: string;
    share: ShareInput;
  }): Promise<ResourceGrant[]> {
    await requireOrgWorkspace(
      this.repository,
      input.subject,
      input.workspaceId,
      "admin:write",
    );
    return this.repository.transaction(async (repository) => {
      const grants = await this.shareResource({
        repository,
        subject: input.subject,
        resourceType: "workspace",
        resourceId: input.workspaceId,
        allowedPermissions: ["read"],
        share: { ...input.share, permissions: ["read"] },
      });
      await this.audit(
        input.subject,
        "workspace.member.add",
        "workspace",
        input.workspaceId,
        {
          principalType: input.share.principalType,
          principalId: input.share.principalId,
        },
        repository,
      );
      return grants;
    });
  }

  async revokeWorkspaceMember(input: {
    subject: AuthSubject;
    workspaceId: string;
    grantId: string;
  }): Promise<ResourceGrant> {
    await requireOrgWorkspace(
      this.repository,
      input.subject,
      input.workspaceId,
      "admin:write",
    );
    const deleted = await deleteResourceShare({
      repository: this.repository,
      orgId: input.subject.orgId,
      resourceType: "workspace",
      resourceId: input.workspaceId,
      grantId: input.grantId,
      missingLabel: "Workspace membership",
    });
    const grant = deleted;
    await this.audit(
      input.subject,
      "workspace.member.remove",
      "workspace",
      input.workspaceId,
      {
        principalType: grant.principalType,
        principalId: grant.principalId,
      },
    );
    return deleted;
  }

  async listKnowledgeBaseShares(
    subject: AuthSubject,
    knowledgeBaseId: string,
  ): Promise<ResourceGrant[]> {
    const knowledgeBase = await getAuthorizedKnowledgeBase(this.repository, {
      knowledgeBaseId,
      subject,
      scope: "knowledge:read",
      permission: "read",
    });
    return this.sharesFor("knowledge_base", knowledgeBase.id, subject.orgId);
  }

  async shareKnowledgeBase(input: {
    subject: AuthSubject;
    knowledgeBaseId: string;
    share: ShareInput;
  }): Promise<ResourceGrant[]> {
    const knowledgeBase = await getAuthorizedKnowledgeBase(this.repository, {
      knowledgeBaseId: input.knowledgeBaseId,
      subject: input.subject,
      scope: "knowledge:write",
      permission: "write",
    });
    return this.repository.transaction(async (repository) => {
      const grants = await this.shareResource({
        repository,
        subject: input.subject,
        resourceType: "knowledge_base",
        resourceId: knowledgeBase.id,
        allowedPermissions: ["read", "use", "write"],
        share: input.share,
      });
      await this.audit(
        input.subject,
        "knowledge_base.share",
        "knowledge_base",
        knowledgeBase.id,
        {
          principalType: input.share.principalType,
          permissions: grants.map((grant) => grant.permission),
        },
        repository,
      );
      return grants;
    });
  }

  async listChatShares(
    subject: AuthSubject,
    chatId: string,
  ): Promise<ResourceGrant[]> {
    const chat = await getAuthorizedChat(this.repository, {
      chatId,
      subject,
      scope: "chats:read",
      permission: "read",
    });
    return (await this.sharesFor("chat", chat.id, subject.orgId)).filter(
      (grant) =>
        !(
          grant.principalType === "user" && grant.principalId === chat.createdBy
        ),
    );
  }

  async shareChat(input: {
    subject: AuthSubject;
    chatId: string;
    share: ShareInput;
  }): Promise<ResourceGrant[]> {
    const chat = await getAuthorizedChat(this.repository, {
      chatId: input.chatId,
      subject: input.subject,
      scope: "chats:write",
      permission: "write",
    });
    return this.repository.transaction(async (repository) => {
      const grants = await this.shareResource({
        repository,
        subject: input.subject,
        resourceType: "chat",
        resourceId: chat.id,
        allowedPermissions: ["read", "write"],
        share: input.share,
      });
      await this.audit(
        input.subject,
        "chat.share",
        "chat",
        chat.id,
        {
          principalType: input.share.principalType,
          permissions: grants.map((grant) => grant.permission),
        },
        repository,
      );
      return grants;
    });
  }

  async revokeChatShare(input: {
    subject: AuthSubject;
    chatId: string;
    grantId: string;
  }): Promise<ResourceGrant> {
    const chat = await getAuthorizedChat(this.repository, {
      chatId: input.chatId,
      subject: input.subject,
      scope: "chats:write",
      permission: "write",
    });
    const grant = (
      await this.sharesFor("chat", chat.id, input.subject.orgId)
    ).find((item) => item.id === input.grantId);
    if (grant === undefined) throw notFound("Chat share");
    if (
      grant.principalType === "user" &&
      grant.principalId === chat.createdBy
    ) {
      throw new ApiError(
        "chat_owner_grant_required",
        "The chat owner's access cannot be revoked.",
        409,
      );
    }
    const deleted = await this.repository.deleteResourceGrant(grant.id);
    if (deleted === undefined) throw notFound("Chat share");
    await this.audit(input.subject, "chat.share.revoke", "chat", chat.id, {
      principalType: grant.principalType,
      permission: grant.permission,
    });
    return deleted;
  }

  async listFileShares(
    subject: AuthSubject,
    fileId: string,
  ): Promise<ResourceGrant[]> {
    const file = await this.getAuthorizedFile(subject, fileId, "read");
    return this.sharesFor("file", file.id, subject.orgId);
  }

  async shareFile(input: {
    subject: AuthSubject;
    fileId: string;
    share: ShareInput;
  }): Promise<ResourceGrant[]> {
    const file = await this.getAuthorizedFile(
      input.subject,
      input.fileId,
      "write",
    );
    return this.repository.transaction(async (repository) => {
      const grants = await this.shareResource({
        repository,
        subject: input.subject,
        resourceType: "file",
        resourceId: file.id,
        allowedPermissions: ["read", "write"],
        share: input.share,
      });
      await this.audit(
        input.subject,
        "file.share",
        "file",
        file.id,
        {
          principalType: input.share.principalType,
          permissions: grants.map((grant) => grant.permission),
        },
        repository,
      );
      return grants;
    });
  }

  protected async shareResource(input: {
    repository?: RomeoRepository;
    subject: AuthSubject;
    resourceType: ResourceGrant["resourceType"];
    resourceId: string;
    allowedPermissions: ResourceGrant["permission"][];
    share: ShareInput;
  }): Promise<ResourceGrant[]> {
    const repository = input.repository ?? this.repository;
    return createResourceShares({ ...input, repository });
  }

  protected async sharesFor(
    resourceType: ResourceGrant["resourceType"],
    resourceId: string,
    orgId: string,
    repository: RomeoRepository = this.repository,
  ): Promise<ResourceGrant[]> {
    return sharesForResource(repository, resourceType, resourceId, orgId);
  }

  protected async getAuthorizedFile(
    subject: AuthSubject,
    fileId: string,
    permission: "read" | "write",
  ): Promise<FileObject> {
    return getAuthorizedSharedFile(
      this.repository,
      subject,
      fileId,
      permission,
    );
  }

  protected async audit<A extends AuditAction>(
    subject: AuthSubject,
    action: A,
    resourceType: string,
    resourceId: string,
    metadata: AuditMetadata<A>,
    repository: RomeoRepository = this.repository,
  ): Promise<void> {
    await auditShare(
      repository,
      subject,
      action,
      resourceType,
      resourceId,
      metadata,
    );
  }
}
