import type * as E from "../domain/entities";
import type * as R from "../domain/repository";
import { append, replaceById } from "./collection-helpers";
import { purgeTenantData } from "./in-memory-tenant-purge";
import { InMemoryRepositoryBase } from "./in-memory-base";

export abstract class InMemoryIdentityRepository extends InMemoryRepositoryBase {
  async getCurrentUser(userId: string): Promise<E.User | undefined> {
    return this.data.users.find((user) => user.id === userId);
  }

  async listUsers(orgId: string): Promise<E.User[]> {
    return this.data.users
      .filter((user) => user.orgId === orgId)
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async listUsersPage(
    orgId: string,
    input: R.UserCatalogQuery,
  ): Promise<R.UserCatalogPage> {
    const all = this.data.users.filter((user) => user.orgId === orgId);
    const query = input.query?.trim().toLocaleLowerCase();
    const filtered = all.filter(
      (user) =>
        query === undefined ||
        query === "" ||
        user.name.toLocaleLowerCase().includes(query) ||
        user.email.toLocaleLowerCase().includes(query),
    );
    const direction = input.direction === "desc" ? -1 : 1;
    const value = (user: E.User): string => {
      if (input.sort === "email") return user.email;
      if (input.sort === "role") return user.role ?? "user";
      if (input.sort === "status") {
        return user.disabledAt === undefined ? "active" : "disabled";
      }
      return user.name;
    };
    filtered.sort(
      (left, right) =>
        direction * value(left).localeCompare(value(right)) ||
        direction * left.id.localeCompare(right.id),
    );
    return {
      activeGlobalAdminTotal: all.filter(
        (user) => user.role === "global_admin" && user.disabledAt === undefined,
      ).length,
      adminTotal: all.filter((user) => (user.role ?? "user") !== "user").length,
      disabledTotal: all.filter((user) => user.disabledAt !== undefined).length,
      items: filtered.slice(input.offset, input.offset + input.limit),
      total: filtered.length,
      userTotal: all.length,
    };
  }

  async queryUsers(
    orgId: string,
    input: R.QueryUsersInput,
  ): Promise<R.UserTableQueryResult> {
    const all = this.data.users.filter((user) => user.orgId === orgId);
    const search = input.search?.trim().toLocaleLowerCase();
    const filtered = all.filter((user) => {
      if (
        input.filter.roles !== undefined &&
        !input.filter.roles.includes(user.role ?? "user")
      )
        return false;
      if (input.filter.status === "active" && user.disabledAt !== undefined)
        return false;
      if (input.filter.status === "disabled" && user.disabledAt === undefined)
        return false;
      return (
        search === undefined ||
        search === "" ||
        `${user.name}\u001f${user.email}`.toLocaleLowerCase().includes(search)
      );
    });
    const value = (user: E.User) =>
      input.sort === "email" ? user.email : user.name;
    const direction = input.direction === "asc" ? 1 : -1;
    filtered.sort((left, right) => {
      const primary = lexicalCompare(value(left), value(right));
      return direction * (primary || lexicalCompare(left.id, right.id));
    });
    const positioned =
      input.position === undefined
        ? filtered
        : filtered.filter((user) => {
            const primary = lexicalCompare(value(user), input.position!.value);
            const comparison =
              primary || lexicalCompare(user.id, input.position!.id);
            return direction * comparison > 0;
          });
    const items = positioned.slice(0, input.limit + 1);
    return {
      activeGlobalAdminTotal: all.filter(
        (user) => user.role === "global_admin" && user.disabledAt === undefined,
      ).length,
      adminTotal: all.filter((user) => (user.role ?? "user") !== "user").length,
      disabledTotal: all.filter((user) => user.disabledAt !== undefined).length,
      hasMore: items.length > input.limit,
      items: items.slice(0, input.limit),
      total: filtered.length,
      userTotal: all.length,
    };
  }

  async createUser(user: E.User): Promise<E.User> {
    return append(this.data.users, user);
  }

  async updateUser(user: E.User): Promise<E.User> {
    return replaceById(this.data.users, user);
  }

  async listGroups(orgId: string): Promise<E.Group[]> {
    return this.data.groups
      .filter((group) => group.orgId === orgId)
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async getGroup(groupId: string): Promise<E.Group | undefined> {
    return this.data.groups.find((group) => group.id === groupId);
  }

  async createGroup(group: E.Group): Promise<E.Group> {
    const existing = this.data.groups.find(
      (item) => item.orgId === group.orgId && item.slug === group.slug,
    );
    return existing ?? append(this.data.groups, group);
  }

  async updateGroup(group: E.Group): Promise<E.Group> {
    return replaceById(this.data.groups, group);
  }

  async deleteGroup(groupId: string): Promise<E.Group | undefined> {
    const index = this.data.groups.findIndex((group) => group.id === groupId);
    if (index < 0) return undefined;
    return this.data.groups.splice(index, 1)[0];
  }

  async listGroupMemberships(
    orgId: string,
    groupId?: string,
    userId?: string,
  ): Promise<E.GroupMembership[]> {
    return this.data.groupMemberships
      .filter(
        (membership) =>
          membership.orgId === orgId &&
          (groupId === undefined || membership.groupId === groupId) &&
          (userId === undefined || membership.userId === userId),
      )
      .sort(
        (left, right) =>
          left.groupId.localeCompare(right.groupId) ||
          left.userId.localeCompare(right.userId),
      );
  }

  async createGroupMembership(
    membership: E.GroupMembership,
  ): Promise<E.GroupMembership> {
    const existing = this.data.groupMemberships.find(
      (item) =>
        item.groupId === membership.groupId &&
        item.userId === membership.userId,
    );
    return existing ?? append(this.data.groupMemberships, membership);
  }

  async deleteGroupMembership(
    groupId: string,
    userId: string,
  ): Promise<E.GroupMembership | undefined> {
    const index = this.data.groupMemberships.findIndex(
      (membership) =>
        membership.groupId === groupId && membership.userId === userId,
    );
    if (index < 0) return undefined;
    return this.data.groupMemberships.splice(index, 1)[0];
  }

  async getSsoOidcSettings(
    orgId: string,
  ): Promise<E.SsoOidcSettings | undefined> {
    return this.data.ssoOidcSettings.find(
      (settings) => settings.orgId === orgId,
    );
  }

  async upsertSsoOidcSettings(
    settings: E.SsoOidcSettings,
  ): Promise<E.SsoOidcSettings> {
    const index = this.data.ssoOidcSettings.findIndex(
      (item) => item.orgId === settings.orgId,
    );
    if (index < 0) return append(this.data.ssoOidcSettings, settings);
    this.data.ssoOidcSettings[index] = settings;
    return settings;
  }

  async getSystemSetting(key: string): Promise<E.SystemSetting | undefined> {
    return this.data.systemSettings.find((setting) => setting.key === key);
  }

  async listSystemSettings(): Promise<E.SystemSetting[]> {
    return [...this.data.systemSettings].sort((left, right) =>
      left.key.localeCompare(right.key),
    );
  }

  async upsertSystemSetting(
    setting: E.SystemSetting,
  ): Promise<E.SystemSetting> {
    const index = this.data.systemSettings.findIndex(
      (item) => item.key === setting.key,
    );
    if (index < 0) return append(this.data.systemSettings, setting);
    this.data.systemSettings[index] = setting;
    return setting;
  }

  async listOrganizations(orgId: string): Promise<E.Organization[]> {
    return this.data.organizations.filter((org) => org.id === orgId);
  }

  async listAllOrganizations(): Promise<E.Organization[]> {
    return [...this.data.organizations].sort((left, right) =>
      left.name.localeCompare(right.name),
    );
  }

  async getOrganization(orgId: string): Promise<E.Organization | undefined> {
    return this.data.organizations.find((org) => org.id === orgId);
  }

  async createOrganization(
    organization: E.Organization,
  ): Promise<E.Organization> {
    const existing = this.data.organizations.find(
      (org) => org.id === organization.id || org.slug === organization.slug,
    );
    return existing ?? append(this.data.organizations, organization);
  }

  async updateOrganization(
    organization: E.Organization,
  ): Promise<E.Organization> {
    return replaceById(this.data.organizations, organization);
  }

  async listWorkspaces(orgId: string): Promise<E.Workspace[]> {
    return this.data.workspaces.filter(
      (workspace) =>
        workspace.orgId === orgId && workspace.archivedAt === undefined,
    );
  }

  async getWorkspace(workspaceId: string): Promise<E.Workspace | undefined> {
    return this.data.workspaces.find(
      (workspace) => workspace.id === workspaceId,
    );
  }

  async createWorkspace(workspace: E.Workspace): Promise<E.Workspace> {
    return append(this.data.workspaces, workspace);
  }

  async updateWorkspace(workspace: E.Workspace): Promise<E.Workspace> {
    return replaceById(this.data.workspaces, workspace);
  }

  async purgeTenantData(orgId: string): Promise<R.TenantDataPurgeResult> {
    return purgeTenantData(this.data, this.runEvents, orgId);
  }
}

function lexicalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
