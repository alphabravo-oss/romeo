import {
  AuthorizationError,
  assertScope,
  hasGrant,
  hasWorkspaceAccess,
  type AuthSubject,
  type ResourceGrant,
} from "@romeo/auth";

import type { FileObject } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { createId } from "../ids";
import { getAuthorizedAgent } from "./agent-access";
import { writeAuditLog } from "./audit-log";
import { getAuthorizedChat } from "./chat-access";
import { getAuthorizedKnowledgeBase } from "./knowledge-access";
import { filterVisibleServiceAccounts } from "./service-account-access";
import {
  groupLabel,
  principalOrder,
  type ShareInput,
  type ShareTarget,
  targetMatches,
  validateSharePrincipal,
} from "./collaboration-share-model";

export type { ShareInput, ShareTarget } from "./collaboration-share-model";

export class CollaborationShareService {
  constructor(protected readonly repository: RomeoRepository) {}

  async shareTargets(
    subject: AuthSubject,
    query = "",
    limit = 20,
  ): Promise<ShareTarget[]> {
    assertScope(subject, "me:read");
    const normalizedQuery = query.trim().toLowerCase();
    const boundedLimit =
      Number.isInteger(limit) && limit > 0 && limit <= 50 ? limit : 20;
    const [users, grants, serviceAccounts, groups] = await Promise.all([
      this.repository.listUsers(subject.orgId),
      this.repository.listResourceGrants(subject.orgId),
      this.repository.listServiceAccounts(subject.orgId),
      this.repository.listGroups(subject.orgId),
    ]);
    const groupIds = new Set<string>(subject.groupIds);
    for (const grant of grants) {
      if (grant.principalType === "group") groupIds.add(grant.principalId);
    }
    const durableGroupIds = new Set(groups.map((group) => group.id));
    const targets: ShareTarget[] = [
      ...users.map((user) => ({
        principalType: "user" as const,
        principalId: user.id,
        label: user.name,
        detail: user.email,
      })),
      ...groups.map((group) => ({
        principalType: "group" as const,
        principalId: group.id,
        label: group.name,
      })),
      ...[...groupIds]
        .filter((groupId) => !durableGroupIds.has(groupId))
        .sort()
        .map((groupId) => ({
          principalType: "group" as const,
          principalId: groupId,
          label: groupLabel(groupId),
        })),
      ...filterVisibleServiceAccounts(subject, serviceAccounts).map(
        (account) => ({
          principalType: "service_account" as const,
          principalId: account.id,
          label: account.name,
          ...(account.disabledAt === undefined ? {} : { detail: "disabled" }),
        }),
      ),
    ];

    return targets
      .filter((target) => targetMatches(target, normalizedQuery))
      .sort(
        (left, right) =>
          principalOrder(left.principalType) -
            principalOrder(right.principalType) ||
          left.label.localeCompare(right.label) ||
          left.principalId.localeCompare(right.principalId),
      )
      .slice(0, boundedLimit);
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
    const agent = await getAuthorizedAgent(this.repository, {
      agentId: input.agentId,
      subject: input.subject,
      scope: "agents:write",
    });
    const grant = (
      await this.sharesFor("agent", agent.id, input.subject.orgId)
    ).find((item) => item.id === input.grantId);
    if (grant === undefined) throw notFound("Managed-model grant");
    const deleted = await this.repository.deleteResourceGrant(grant.id);
    if (deleted === undefined) throw notFound("Managed-model grant");
    await this.audit(input.subject, "agent.share.revoke", "agent", agent.id, {
      principalType: grant.principalType,
      principalId: grant.principalId,
      permission: grant.permission,
    });
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
    validateSharePrincipal(input.share);
    const invalid = input.share.permissions.filter(
      (permission) => !input.allowedPermissions.includes(permission),
    );
    if (invalid.length > 0)
      throw new ApiError(
        "invalid_share_permission",
        "Share includes an unsupported permission.",
        400,
        { permissions: invalid },
      );

    const repository = input.repository ?? this.repository;
    const existing = await this.sharesFor(
      input.resourceType,
      input.resourceId,
      input.subject.orgId,
      repository,
    );
    const created: ResourceGrant[] = [];
    for (const permission of [...new Set(input.share.permissions)]) {
      const grant = existing.find(
        (item) =>
          item.principalType === input.share.principalType &&
          item.principalId === input.share.principalId &&
          item.permission === permission,
      );
      if (grant) {
        created.push(grant);
        continue;
      }

      created.push(
        await repository.createResourceGrant({
          id: createId("grant"),
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          principalType: input.share.principalType,
          principalId: input.share.principalId,
          permission,
        }),
      );
    }
    return created;
  }

  protected async sharesFor(
    resourceType: ResourceGrant["resourceType"],
    resourceId: string,
    orgId: string,
    repository: RomeoRepository = this.repository,
  ): Promise<ResourceGrant[]> {
    return (await repository.listResourceGrants(orgId)).filter(
      (grant) =>
        grant.resourceType === resourceType && grant.resourceId === resourceId,
    );
  }

  protected async getAuthorizedFile(
    subject: AuthSubject,
    fileId: string,
    permission: "read" | "write",
  ): Promise<FileObject> {
    assertScope(subject, permission === "read" ? "files:read" : "files:write");
    const file = await this.repository.getFileObject(fileId);
    if (
      file === undefined ||
      file.orgId !== subject.orgId ||
      file.status === "deleted"
    ) {
      throw notFound("File");
    }
    if (!hasWorkspaceAccess(subject, file.workspaceId)) {
      throw new AuthorizationError(
        "The file workspace is outside the caller access.",
      );
    }
    const grants = await this.repository.listResourceGrants(subject.orgId);
    if (
      subject.isAdmin !== true &&
      !(file.ownerType === subject.type && file.ownerId === subject.id) &&
      !hasGrant(subject, grants, "file", file.id, permission)
    ) {
      throw new AuthorizationError(
        `Missing ${permission} permission for file:${file.id}`,
      );
    }
    return file;
  }

  protected async audit(
    subject: AuthSubject,
    action: string,
    resourceType: string,
    resourceId: string,
    metadata: Record<string, unknown>,
    repository: RomeoRepository = this.repository,
  ): Promise<void> {
    await writeAuditLog(repository, {
      subject,
      action,
      resourceType,
      resourceId,
      metadata,
    });
  }
}
