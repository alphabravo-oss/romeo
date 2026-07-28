import { assertScope, type AuthSubject } from "@romeo/auth";

import type { User } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { createId } from "../ids";
import { normalizeLocalAuthEmail } from "./local-password";
import {
  scimListResponse,
  toScimUser,
  type ScimUserResource,
} from "./scim-resource";
import { ScimGroupService } from "./scim-group-service";
import {
  applyUserActive,
  boundedText,
  isObjectRecord,
  normalizePatchOperations,
  normalizeScimUserEmail,
  normalizeScimUserName,
  pageFromQuery,
  parseFilter,
  scimError,
  stringValue,
  userMatchesFilter,
  type ScimCreateUserInput,
  type ScimListQuery,
  type ScimPatchInput,
} from "./scim-support";

export * from "./scim-support";

export class ScimService extends ScimGroupService {
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
}
