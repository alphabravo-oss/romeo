import { assertScope, type AuthSubject } from "@romeo/auth";

import type { Group, User } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { notFound } from "../errors";
import { writeAuditLog } from "./audit-log";
import {
  scimListResponse,
  scimResourceTypes,
  scimSchemas,
  scimServiceProviderConfig,
  toScimGroup,
  type ScimGroupResource,
} from "./scim-resource";
import {
  boundedText,
  groupMatchesFilter,
  isObjectRecord,
  memberValues,
  memberValuesFromRemove,
  normalizePatchOperations,
  pageFromQuery,
  parseFilter,
  scimError,
  slugFromName,
  unique,
  type ScimCreateGroupInput,
  type ScimListQuery,
  type ScimOptions,
  type ScimPatchInput,
} from "./scim-support";

export class ScimGroupService {
  constructor(
    protected readonly repository: RomeoRepository,
    protected readonly options: ScimOptions,
  ) {}

  serviceProviderConfig(subject: AuthSubject, baseUrl: string) {
    this.assertEnabled();
    assertScope(subject, "admin:read");
    return scimServiceProviderConfig(baseUrl);
  }

  schemas(subject: AuthSubject, baseUrl: string) {
    this.assertEnabled();
    assertScope(subject, "admin:read");
    return scimSchemas(baseUrl);
  }

  resourceTypes(subject: AuthSubject, baseUrl: string) {
    this.assertEnabled();
    assertScope(subject, "admin:read");
    return scimResourceTypes(baseUrl);
  }

  async listGroups(input: {
    subject: AuthSubject;
    query: ScimListQuery;
    baseUrl: string;
  }) {
    this.assertEnabled();
    assertScope(input.subject, "admin:read");
    const page = pageFromQuery(input.query);
    const filter = parseFilter(input.query.filter);
    const [groups, users, memberships] = await Promise.all([
      this.repository.listGroups(input.subject.orgId),
      this.repository.listUsers(input.subject.orgId),
      this.repository.listGroupMemberships(input.subject.orgId),
    ]);
    const filtered = groups.filter((group) =>
      groupMatchesFilter(group, filter),
    );
    return scimListResponse(
      filtered
        .slice(page.startIndex - 1, page.startIndex - 1 + page.count)
        .map((group) =>
          toScimGroup({
            group,
            users,
            memberships,
            baseUrl: input.baseUrl,
          }),
        ),
      { totalResults: filtered.length, startIndex: page.startIndex },
    );
  }

  async getGroup(input: {
    subject: AuthSubject;
    groupId: string;
    baseUrl: string;
  }): Promise<ScimGroupResource> {
    this.assertEnabled();
    assertScope(input.subject, "admin:read");
    const group = await this.groupInOrg(
      this.repository,
      input.subject,
      input.groupId,
    );
    const [users, memberships] = await Promise.all([
      this.repository.listUsers(input.subject.orgId),
      this.repository.listGroupMemberships(input.subject.orgId, group.id),
    ]);
    return toScimGroup({
      group,
      users,
      memberships,
      baseUrl: input.baseUrl,
    });
  }

  async createGroup(input: {
    subject: AuthSubject;
    body: ScimCreateGroupInput;
    baseUrl: string;
  }): Promise<ScimGroupResource> {
    this.assertEnabled();
    assertScope(input.subject, "admin:write");
    const displayName = boundedText(input.body.displayName, 1, 160);
    const group = await this.repository.transaction(async (repository) => {
      const created = await repository.createGroup({
        id: `group_${slugFromName(displayName)}`,
        orgId: input.subject.orgId,
        name: displayName,
        slug: slugFromName(displayName),
        createdAt: new Date().toISOString(),
      });
      await this.replaceGroupMembers(
        repository,
        input.subject,
        created,
        memberValues(input.body.members),
      );
      await this.audit(
        repository,
        input.subject,
        "scim.group.create",
        "group",
        created.id,
        {
          memberCount: input.body.members?.length ?? 0,
        },
      );
      return created;
    });
    return this.getGroup({
      subject: input.subject,
      groupId: group.id,
      baseUrl: input.baseUrl,
    });
  }

  async replaceGroup(input: {
    subject: AuthSubject;
    groupId: string;
    body: ScimCreateGroupInput;
    baseUrl: string;
  }): Promise<ScimGroupResource> {
    this.assertEnabled();
    assertScope(input.subject, "admin:write");
    const group = await this.groupInOrg(
      this.repository,
      input.subject,
      input.groupId,
    );
    const displayName = boundedText(input.body.displayName, 1, 160);
    const updated = await this.repository.transaction(async (repository) => {
      const updatedGroup = await repository.updateGroup({
        ...group,
        name: displayName,
      });
      await this.replaceGroupMembers(
        repository,
        input.subject,
        updatedGroup,
        memberValues(input.body.members),
      );
      await this.audit(
        repository,
        input.subject,
        "scim.group.replace",
        "group",
        updatedGroup.id,
        {
          displayNameChanged: group.name !== displayName,
          memberCount: input.body.members?.length ?? 0,
        },
      );
      return updatedGroup;
    });
    return this.getGroup({
      subject: input.subject,
      groupId: updated.id,
      baseUrl: input.baseUrl,
    });
  }

  async patchGroup(input: {
    subject: AuthSubject;
    groupId: string;
    body: ScimPatchInput;
    baseUrl: string;
  }): Promise<ScimGroupResource> {
    this.assertEnabled();
    assertScope(input.subject, "admin:write");
    const group = await this.groupInOrg(
      this.repository,
      input.subject,
      input.groupId,
    );
    const changes = {
      displayNameChanged: false,
      membersAdded: 0,
      membersRemoved: 0,
    };
    const patchedGroup = await this.repository.transaction(
      async (repository) => {
        let draft = group;
        for (const operation of normalizePatchOperations(input.body)) {
          const op = operation.op.toLowerCase();
          const path = operation.path?.toLowerCase();
          if (
            op === "replace" &&
            (path === "displayname" || path === undefined)
          ) {
            const nextName = isObjectRecord(operation.value)
              ? boundedText(operation.value.displayName, 1, 160)
              : boundedText(operation.value, 1, 160);
            draft = await repository.updateGroup({ ...draft, name: nextName });
            changes.displayNameChanged = true;
            continue;
          }
          if (
            (op === "add" || op === "replace") &&
            (path === "members" || path === undefined)
          ) {
            const members = memberValues(
              isObjectRecord(operation.value) &&
                Array.isArray(operation.value.members)
                ? operation.value.members
                : operation.value,
            );
            if (op === "replace")
              await this.replaceGroupMembers(
                repository,
                input.subject,
                draft,
                members,
              );
            else
              changes.membersAdded += await this.addGroupMembers(
                repository,
                input.subject,
                draft,
                members,
              );
            continue;
          }
          if (op === "remove" && path?.startsWith("members") === true) {
            const members = memberValuesFromRemove(operation);
            changes.membersRemoved += await this.removeGroupMembers(
              repository,
              input.subject,
              draft,
              members,
            );
            continue;
          }
          throw scimError(
            "Unsupported SCIM group patch operation.",
            400,
            "invalidPath",
          );
        }
        await this.audit(
          repository,
          input.subject,
          "scim.group.patch",
          "group",
          draft.id,
          changes,
        );
        return draft;
      },
    );
    return this.getGroup({
      subject: input.subject,
      groupId: patchedGroup.id,
      baseUrl: input.baseUrl,
    });
  }

  async deleteGroup(input: {
    subject: AuthSubject;
    groupId: string;
  }): Promise<void> {
    this.assertEnabled();
    assertScope(input.subject, "admin:write");
    await this.repository.transaction(async (repository) => {
      const group = await repository.getGroup(input.groupId);
      if (!group || group.orgId !== input.subject.orgId)
        throw notFound("Group");
      const memberships = await repository.listGroupMemberships(
        input.subject.orgId,
        group.id,
      );
      await Promise.all(
        memberships.map((membership) =>
          repository.deleteGroupMembership(group.id, membership.userId),
        ),
      );
      const grants = await repository.deleteResourceGrantsForPrincipal(
        input.subject.orgId,
        "group",
        group.id,
      );
      const deleted = await repository.deleteGroup(group.id);
      if (deleted === undefined) throw notFound("Group");
      await writeAuditLog(repository, {
        subject: input.subject,
        action: "scim.group.delete",
        resourceType: "group",
        resourceId: group.id,
        metadata: {
          schema: "romeo.scim.audit.v1",
          membershipCount: memberships.length,
          revokedGrantCount: grants.length,
          destructiveDelete: true,
        },
      });
    });
  }

  protected assertEnabled(): void {
    if (!this.options.enabled) {
      throw scimError(
        "SCIM is disabled for this deployment.",
        404,
        "scim_disabled",
      );
    }
  }

  protected async userInOrg(
    repository: RomeoRepository,
    subject: AuthSubject,
    userId: string,
  ): Promise<User> {
    const user = await repository.getCurrentUser(userId);
    if (!user || user.orgId !== subject.orgId) throw notFound("User");
    return user;
  }

  protected async groupInOrg(
    repository: RomeoRepository,
    subject: AuthSubject,
    groupId: string,
  ): Promise<Group> {
    const group = await repository.getGroup(groupId);
    if (!group || group.orgId !== subject.orgId) throw notFound("Group");
    return group;
  }

  protected async replaceGroupMembers(
    repository: RomeoRepository,
    subject: AuthSubject,
    group: Group,
    userIds: string[],
  ): Promise<void> {
    const current = await repository.listGroupMemberships(
      subject.orgId,
      group.id,
    );
    const next = new Set(userIds);
    await Promise.all(
      current
        .filter((membership) => !next.has(membership.userId))
        .map((membership) =>
          repository.deleteGroupMembership(group.id, membership.userId),
        ),
    );
    await this.addGroupMembers(repository, subject, group, [...next]);
  }

  protected async addGroupMembers(
    repository: RomeoRepository,
    subject: AuthSubject,
    group: Group,
    userIds: string[],
  ): Promise<number> {
    let added = 0;
    for (const userId of unique(userIds)) {
      const user = await this.userInOrg(repository, subject, userId);
      const before = await repository.listGroupMemberships(
        subject.orgId,
        group.id,
        user.id,
      );
      await repository.createGroupMembership({
        groupId: group.id,
        userId: user.id,
        orgId: subject.orgId,
        createdAt: new Date().toISOString(),
      });
      if (before.length === 0) added += 1;
    }
    return added;
  }

  protected async removeGroupMembers(
    repository: RomeoRepository,
    subject: AuthSubject,
    group: Group,
    userIds: string[],
  ): Promise<number> {
    let removed = 0;
    for (const userId of unique(userIds)) {
      const deleted = await repository.deleteGroupMembership(group.id, userId);
      if (deleted?.orgId === subject.orgId) removed += 1;
    }
    return removed;
  }

  protected async audit(
    repository: RomeoRepository,
    subject: AuthSubject,
    action: string,
    resourceType: string,
    resourceId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await writeAuditLog(repository, {
      subject,
      action,
      resourceType,
      resourceId,
      metadata: {
        schema: "romeo.scim.audit.v1",
        ...metadata,
      },
    });
  }
}
