import { assertScope, type AuthSubject } from "@romeo/auth";

import type { Group, GroupMembership } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { writeAuditLog } from "./audit-log";

export class GroupService {
  constructor(private readonly repository: RomeoRepository) {}

  async list(subject: AuthSubject): Promise<Group[]> {
    assertScope(subject, "admin:read");
    return this.repository.listGroups(subject.orgId);
  }

  async create(input: {
    subject: AuthSubject;
    name: string;
    slug?: string | undefined;
  }): Promise<Group> {
    assertScope(input.subject, "admin:write");
    const slug = normalizeSlug(input.slug ?? input.name);
    if (slug.length === 0)
      throw new ApiError(
        "invalid_group_slug",
        "Group slug must contain letters or numbers.",
        400,
      );
    const existing = (
      await this.repository.listGroups(input.subject.orgId)
    ).find((group) => group.slug === slug || group.id === `group_${slug}`);
    if (existing !== undefined) return existing;
    return this.repository.transaction(async (repository) => {
      const group = await repository.createGroup({
        id: `group_${slug}`,
        orgId: input.subject.orgId,
        name: input.name.trim(),
        slug,
        createdAt: new Date().toISOString(),
      });
      await this.audit(repository, input.subject, "group.create", group.id, {
        slug: group.slug,
      });
      return group;
    });
  }

  async members(
    subject: AuthSubject,
    groupId: string,
  ): Promise<GroupMembership[]> {
    assertScope(subject, "admin:read");
    await this.getGroup(this.repository, subject, groupId);
    return this.repository.listGroupMemberships(subject.orgId, groupId);
  }

  async addMember(input: {
    subject: AuthSubject;
    groupId: string;
    userId: string;
  }): Promise<GroupMembership> {
    assertScope(input.subject, "admin:write");
    return this.repository.transaction(async (repository) => {
      const group = await this.getGroup(
        repository,
        input.subject,
        input.groupId,
      );
      const user = await repository.getCurrentUser(input.userId);
      if (!user || user.orgId !== input.subject.orgId) throw notFound("User");
      const membership = await repository.createGroupMembership({
        groupId: group.id,
        userId: user.id,
        orgId: input.subject.orgId,
        createdAt: new Date().toISOString(),
      });
      await this.audit(
        repository,
        input.subject,
        "group.member.add",
        group.id,
        {
          userId: user.id,
        },
      );
      return membership;
    });
  }

  async removeMember(input: {
    subject: AuthSubject;
    groupId: string;
    userId: string;
  }): Promise<GroupMembership> {
    assertScope(input.subject, "admin:write");
    return this.repository.transaction(async (repository) => {
      const group = await this.getGroup(
        repository,
        input.subject,
        input.groupId,
      );
      const deleted = await repository.deleteGroupMembership(
        group.id,
        input.userId,
      );
      if (!deleted || deleted.orgId !== input.subject.orgId)
        throw notFound("Group membership");
      await this.audit(
        repository,
        input.subject,
        "group.member.remove",
        group.id,
        {
          userId: input.userId,
        },
      );
      return deleted;
    });
  }

  private async getGroup(
    repository: RomeoRepository,
    subject: AuthSubject,
    groupId: string,
  ): Promise<Group> {
    const group = await repository.getGroup(groupId);
    if (!group || group.orgId !== subject.orgId) throw notFound("Group");
    return group;
  }

  private async audit(
    repository: RomeoRepository,
    subject: AuthSubject,
    action: string,
    groupId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await writeAuditLog(repository, {
      subject,
      action,
      resourceType: "organization",
      resourceId: groupId,
      metadata,
    });
  }
}

function normalizeSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}
