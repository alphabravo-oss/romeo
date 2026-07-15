import { assertScope, type AuthSubject } from "@romeo/auth";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import type { Group, User } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { createId } from "../ids";
import { writeAuditLog } from "./audit-log";
import { normalizeLocalAuthEmail } from "./local-password";
import {
  scimListResponse,
  scimResourceTypes,
  scimSchemas,
  scimServiceProviderConfig,
  toScimGroup,
  toScimUser,
  type ScimGroupResource,
  type ScimUserResource,
} from "./scim-resource";

export interface ScimListQuery {
  filter?: string | undefined;
  startIndex?: number | undefined;
  count?: number | undefined;
}

export interface ScimCreateUserInput {
  userName?: string | undefined;
  displayName?: string | undefined;
  name?:
    | {
        formatted?: string | undefined;
        givenName?: string | undefined;
        familyName?: string | undefined;
      }
    | undefined;
  emails?:
    | {
        value?: string | undefined;
        primary?: boolean | undefined;
        type?: string | undefined;
      }[]
    | undefined;
  active?: boolean | undefined;
}

export interface ScimCreateGroupInput {
  displayName?: string | undefined;
  members?: { value?: string | undefined }[] | undefined;
}

export interface ScimPatchInput {
  Operations?: ScimPatchOperation[];
}

export interface ScimPatchOperation {
  op?: string | undefined;
  path?: string | undefined;
  value?: unknown;
}

interface NormalizedPatchOperation {
  op: string;
  path?: string | undefined;
  value?: unknown;
}

interface ScimOptions {
  enabled: boolean;
}

interface Page {
  startIndex: number;
  count: number;
}

interface ParsedFilter {
  attribute: string;
  value: string;
}

export class ScimService {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly options: ScimOptions,
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

  async listUsers(input: {
    subject: AuthSubject;
    query: ScimListQuery;
    baseUrl: string;
  }) {
    this.assertEnabled();
    assertScope(input.subject, "admin:read");
    const page = pageFromQuery(input.query);
    const filter = parseFilter(input.query.filter);
    const [users, groups, memberships] = await Promise.all([
      this.repository.listUsers(input.subject.orgId),
      this.repository.listGroups(input.subject.orgId),
      this.repository.listGroupMemberships(input.subject.orgId),
    ]);
    const filtered = users.filter((user) => userMatchesFilter(user, filter));
    return scimListResponse(
      filtered
        .slice(page.startIndex - 1, page.startIndex - 1 + page.count)
        .map((user) =>
          toScimUser({
            user,
            groups,
            memberships,
            baseUrl: input.baseUrl,
          }),
        ),
      { totalResults: filtered.length, startIndex: page.startIndex },
    );
  }

  async getUser(input: {
    subject: AuthSubject;
    userId: string;
    baseUrl: string;
  }): Promise<ScimUserResource> {
    this.assertEnabled();
    assertScope(input.subject, "admin:read");
    const user = await this.userInOrg(
      this.repository,
      input.subject,
      input.userId,
    );
    const [groups, memberships] = await Promise.all([
      this.repository.listGroups(input.subject.orgId),
      this.repository.listGroupMemberships(
        input.subject.orgId,
        undefined,
        user.id,
      ),
    ]);
    return toScimUser({
      user,
      groups,
      memberships,
      baseUrl: input.baseUrl,
    });
  }

  async createUser(input: {
    subject: AuthSubject;
    body: ScimCreateUserInput;
    baseUrl: string;
  }): Promise<ScimUserResource> {
    this.assertEnabled();
    assertScope(input.subject, "admin:write");
    const email = normalizeScimUserEmail(input.body);
    const name = normalizeScimUserName(input.body, email);
    const now = new Date().toISOString();
    const user = await this.repository.transaction(async (repository) => {
      await this.assertEmailAvailable(repository, input.subject.orgId, email);
      const created = await repository.createUser({
        id: createId("user"),
        orgId: input.subject.orgId,
        email,
        name,
        role: "user",
        ...(input.body.active === false ? { disabledAt: now } : {}),
      });
      await this.audit(
        repository,
        input.subject,
        "scim.user.create",
        "user",
        created.id,
        {
          active: created.disabledAt === undefined,
          suppliedActive: input.body.active !== undefined,
        },
      );
      return created;
    });
    return this.getUser({
      subject: input.subject,
      userId: user.id,
      baseUrl: input.baseUrl,
    });
  }

  async replaceUser(input: {
    subject: AuthSubject;
    userId: string;
    body: ScimCreateUserInput;
    baseUrl: string;
  }): Promise<ScimUserResource> {
    this.assertEnabled();
    assertScope(input.subject, "admin:write");
    const existing = await this.userInOrg(
      this.repository,
      input.subject,
      input.userId,
    );
    const email = normalizeScimUserEmail(input.body);
    const name = normalizeScimUserName(input.body, email);
    const active = input.body.active ?? existing.disabledAt === undefined;
    const replacement: User = {
      ...existing,
      email,
      name,
    };
    const updated = await this.repository.transaction(async (repository) => {
      await this.assertEmailAvailable(
        repository,
        input.subject.orgId,
        email,
        existing.id,
      );
      const updatedUser = await this.updateUserLifecycle(
        repository,
        input.subject,
        applyUserActive(replacement, active),
      );
      await this.audit(
        repository,
        input.subject,
        "scim.user.replace",
        "user",
        updatedUser.id,
        {
          active,
          emailChanged: existing.email !== updatedUser.email,
          nameChanged: existing.name !== updatedUser.name,
          activeChanged: (existing.disabledAt === undefined) !== active,
        },
      );
      return updatedUser;
    });
    return this.getUser({
      subject: input.subject,
      userId: updated.id,
      baseUrl: input.baseUrl,
    });
  }

  async patchUser(input: {
    subject: AuthSubject;
    userId: string;
    body: ScimPatchInput;
    baseUrl: string;
  }): Promise<ScimUserResource> {
    this.assertEnabled();
    assertScope(input.subject, "admin:write");
    const existing = await this.userInOrg(
      this.repository,
      input.subject,
      input.userId,
    );
    let draft: User = { ...existing };
    const changes = {
      emailChanged: false,
      nameChanged: false,
      activeChanged: false,
    };
    for (const operation of normalizePatchOperations(input.body)) {
      const op = operation.op.toLowerCase();
      const path = operation.path?.toLowerCase();
      if (op !== "add" && op !== "replace") {
        throw scimError(
          "Unsupported SCIM user patch operation.",
          400,
          "mutability",
        );
      }
      const value = operation.value;
      if (path === undefined && isObjectRecord(value)) {
        if (value.userName !== undefined) {
          draft.email = normalizeLocalAuthEmail(String(value.userName));
          changes.emailChanged = true;
        }
        if (value.displayName !== undefined || value.name !== undefined) {
          draft.name = normalizeScimUserName(
            value as ScimCreateUserInput,
            draft.email,
          );
          changes.nameChanged = true;
        }
        if (value.active !== undefined) {
          draft = applyUserActive(draft, Boolean(value.active));
          changes.activeChanged = true;
        }
        continue;
      }
      if (path === "username" || path === "emails" || path === "emails.value") {
        draft.email = normalizeLocalAuthEmail(
          stringValue(value, "SCIM userName"),
        );
        changes.emailChanged = true;
        continue;
      }
      if (
        path === "displayname" ||
        path === "name.formatted" ||
        path === "name"
      ) {
        draft.name = boundedText(
          stringValue(value, "SCIM displayName"),
          1,
          200,
        );
        changes.nameChanged = true;
        continue;
      }
      if (path === "active") {
        draft = applyUserActive(draft, Boolean(value));
        changes.activeChanged = true;
        continue;
      }
      throw scimError("Unsupported SCIM user patch path.", 400, "invalidPath");
    }
    const updated = await this.repository.transaction(async (repository) => {
      await this.assertEmailAvailable(
        repository,
        input.subject.orgId,
        draft.email,
        existing.id,
      );
      const updatedUser = await this.updateUserLifecycle(
        repository,
        input.subject,
        draft,
      );
      await this.audit(
        repository,
        input.subject,
        "scim.user.patch",
        "user",
        updatedUser.id,
        changes,
      );
      return updatedUser;
    });
    return this.getUser({
      subject: input.subject,
      userId: updated.id,
      baseUrl: input.baseUrl,
    });
  }

  async deleteUser(input: {
    subject: AuthSubject;
    userId: string;
  }): Promise<void> {
    this.assertEnabled();
    assertScope(input.subject, "admin:write");
    const user = await this.userInOrg(
      this.repository,
      input.subject,
      input.userId,
    );
    if (user.disabledAt !== undefined) return;
    await this.repository.transaction(async (repository) => {
      await this.updateUserLifecycle(repository, input.subject, {
        ...user,
        disabledAt: new Date().toISOString(),
      });
      await this.audit(
        repository,
        input.subject,
        "scim.user.deactivate",
        "user",
        user.id,
        {
          destructiveDelete: false,
          credentialRevocation: "user_api_keys_and_sessions",
        },
      );
    });
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

  private assertEnabled(): void {
    if (!this.options.enabled) {
      throw scimError(
        "SCIM is disabled for this deployment.",
        404,
        "scim_disabled",
      );
    }
  }

  private async userInOrg(
    repository: RomeoRepository,
    subject: AuthSubject,
    userId: string,
  ): Promise<User> {
    const user = await repository.getCurrentUser(userId);
    if (!user || user.orgId !== subject.orgId) throw notFound("User");
    return user;
  }

  private async groupInOrg(
    repository: RomeoRepository,
    subject: AuthSubject,
    groupId: string,
  ): Promise<Group> {
    const group = await repository.getGroup(groupId);
    if (!group || group.orgId !== subject.orgId) throw notFound("Group");
    return group;
  }

  private async assertEmailAvailable(
    repository: RomeoRepository,
    orgId: string,
    email: string,
    allowedUserId?: string,
  ): Promise<void> {
    const users = await repository.listUsers(orgId);
    const normalized = normalizeLocalAuthEmail(email);
    if (
      users.some(
        (user) =>
          user.id !== allowedUserId &&
          normalizeLocalAuthEmail(user.email) === normalized,
      )
    ) {
      throw scimError("SCIM userName is already in use.", 409, "uniqueness");
    }
  }

  private async updateUserLifecycle(
    repository: RomeoRepository,
    subject: AuthSubject,
    user: User,
  ): Promise<User> {
    if (
      subject.type === "user" &&
      subject.id === user.id &&
      user.disabledAt !== undefined
    ) {
      throw scimError(
        "SCIM clients cannot deactivate their own user.",
        403,
        "mutability",
      );
    }
    const previous = await this.userInOrg(repository, subject, user.id);
    const updated = await repository.updateUser(user);
    if (previous.disabledAt === undefined && updated.disabledAt !== undefined) {
      await this.revokeUserCredentials(
        repository,
        updated.orgId,
        updated.id,
        updated.disabledAt,
      );
    }
    return updated;
  }

  private async revokeUserCredentials(
    repository: RomeoRepository,
    orgId: string,
    userId: string,
    revokedAt: string,
  ): Promise<void> {
    const [apiKeys, sessions] = await Promise.all([
      repository.listApiKeys(orgId),
      repository.listUserSessions(orgId, userId),
    ]);
    await Promise.all([
      ...apiKeys
        .filter((key) => key.userId === userId && key.revokedAt === undefined)
        .map((key) => repository.updateApiKey({ ...key, revokedAt })),
      ...sessions
        .filter((session) => session.revokedAt === undefined)
        .map((session) =>
          repository.updateUserSession({ ...session, revokedAt }),
        ),
    ]);
  }

  private async replaceGroupMembers(
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

  private async addGroupMembers(
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

  private async removeGroupMembers(
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

  private async audit(
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

export function scimError(
  message: string,
  status: ContentfulStatusCode,
  scimType?: string,
): ApiError {
  return new ApiError("scim_error", message, status, {
    scimType,
    scimStatus: String(status),
  });
}

function normalizeScimUserEmail(input: ScimCreateUserInput): string {
  const email =
    input.userName ??
    input.emails?.find((email) => email.primary === true)?.value ??
    input.emails?.[0]?.value;
  if (email === undefined) {
    throw scimError(
      "SCIM user requires userName or an email value.",
      400,
      "invalidValue",
    );
  }
  return normalizeLocalAuthEmail(email);
}

function normalizeScimUserName(
  input: ScimCreateUserInput,
  fallback: string,
): string {
  const structuredName = [input.name?.givenName, input.name?.familyName]
    .filter((part) => typeof part === "string" && part.trim().length > 0)
    .join(" ");
  const candidate =
    input.displayName ??
    input.name?.formatted ??
    (structuredName.length > 0 ? structuredName : undefined) ??
    fallback;
  return boundedText(candidate, 1, 200);
}

function normalizePatchOperations(
  input: ScimPatchInput,
): NormalizedPatchOperation[] {
  const operations = input.Operations;
  if (
    !Array.isArray(operations) ||
    operations.length === 0 ||
    operations.length > 100
  ) {
    throw scimError(
      "SCIM PatchOp requires 1-100 operations.",
      400,
      "invalidSyntax",
    );
  }
  return operations.map((operation) => {
    if (typeof operation.op !== "string" || operation.op.trim().length === 0) {
      throw scimError(
        "SCIM PatchOp operation is missing op.",
        400,
        "invalidSyntax",
      );
    }
    return {
      op: operation.op.trim(),
      path: operation.path,
      value: operation.value,
    };
  });
}

function applyUserActive(user: User, active: boolean): User {
  if (active) {
    const { disabledAt: _disabledAt, ...enabledUser } = user;
    return enabledUser;
  }
  return { ...user, disabledAt: user.disabledAt ?? new Date().toISOString() };
}

function boundedText(value: unknown, min: number, max: number): string {
  if (typeof value !== "string") {
    throw scimError("SCIM text value is invalid.", 400, "invalidValue");
  }
  const text = value.trim();
  if (text.length < min || text.length > max) {
    throw scimError(
      "SCIM text value is outside allowed bounds.",
      400,
      "invalidValue",
    );
  }
  return text;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value === "string") return value;
  if (isObjectRecord(value) && typeof value.value === "string")
    return value.value;
  throw scimError(`${label} must be a string.`, 400, "invalidValue");
}

function pageFromQuery(query: ScimListQuery): Page {
  const startIndex = clampInteger(query.startIndex ?? 1, 1, 1_000_000);
  const count = clampInteger(query.count ?? 100, 0, 200);
  return { startIndex, count };
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isInteger(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function parseFilter(filter: string | undefined): ParsedFilter | undefined {
  if (filter === undefined || filter.trim().length === 0) return undefined;
  const match = /^\s*([A-Za-z.]+)\s+eq\s+"([^"]{1,320})"\s*$/u.exec(filter);
  if (!match) throw scimError("Unsupported SCIM filter.", 400, "invalidFilter");
  return { attribute: match[1]!.toLowerCase(), value: match[2]! };
}

function userMatchesFilter(
  user: User,
  filter: ParsedFilter | undefined,
): boolean {
  if (filter === undefined) return true;
  if (filter.attribute === "id") return user.id === filter.value;
  if (filter.attribute === "username" || filter.attribute === "emails.value") {
    return (
      normalizeLocalAuthEmail(user.email) ===
      normalizeLocalAuthEmail(filter.value)
    );
  }
  if (filter.attribute === "displayname") return user.name === filter.value;
  throw scimError("Unsupported SCIM user filter.", 400, "invalidFilter");
}

function groupMatchesFilter(
  group: Group,
  filter: ParsedFilter | undefined,
): boolean {
  if (filter === undefined) return true;
  if (filter.attribute === "id") return group.id === filter.value;
  if (filter.attribute === "displayname") return group.name === filter.value;
  throw scimError("Unsupported SCIM group filter.", 400, "invalidFilter");
}

function memberValues(input: unknown): string[] {
  if (input === undefined) return [];
  if (!Array.isArray(input))
    throw scimError("SCIM members must be an array.", 400, "invalidValue");
  return input.map((member) => {
    if (!isObjectRecord(member) || typeof member.value !== "string") {
      throw scimError("SCIM member value is invalid.", 400, "invalidValue");
    }
    return boundedText(member.value, 1, 120);
  });
}

function memberValuesFromRemove(operation: ScimPatchOperation): string[] {
  const pathMatch = /^members\s*\[\s*value\s+eq\s+"([^"]{1,120})"\s*\]$/iu.exec(
    operation.path ?? "",
  );
  if (pathMatch) return [pathMatch[1]!];
  if (operation.value !== undefined) return memberValues(operation.value);
  throw scimError(
    "SCIM member remove requires a value filter or members value.",
    400,
    "invalidValue",
  );
}

function slugFromName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return slug.length === 0 ? `scim_${createId("group").slice(-10)}` : slug;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
