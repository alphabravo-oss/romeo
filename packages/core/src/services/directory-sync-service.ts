import { assertScope, type AuthSubject } from "@romeo/auth";

import type {
  DirectorySyncGroupInventory,
  DirectorySyncGroupRemovalPlan,
  DirectorySyncMembershipRemovalPlan,
  DirectorySyncRequest,
  DirectorySyncResult,
  DirectorySyncSource,
  DirectorySyncUserDisablePlan,
} from "../domain/directory-sync";
import type { Group, GroupMembership, User } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { normalizeUserRole } from "./auth-subject";
import { writeAuditLog } from "./audit-log";
import { normalizeLocalAuthEmail } from "./local-password";
import { UserLifecycleService } from "./user-lifecycle-service";

const defaultMaxUserDisables = 25;
const defaultMaxMembershipRemovals = 250;

export class DirectorySyncService {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly users: UserLifecycleService,
  ) {}

  async reconcile(
    subject: AuthSubject,
    request: DirectorySyncRequest,
  ): Promise<DirectorySyncResult> {
    assertScope(subject, "admin:write");
    const input = normalizeDirectorySyncRequest(request);
    if (!input.disableMissingUsers && !input.removeMissingGroupMembers) {
      throw new ApiError(
        "directory_sync_noop",
        "Directory sync must request user disable or group membership removal.",
        400,
      );
    }
    if (!input.dryRun && input.confirmApply !== "apply-directory-sync") {
      throw new ApiError(
        "directory_sync_confirmation_required",
        "Applying directory sync requires confirmApply to equal apply-directory-sync.",
        400,
      );
    }

    const [users, groups, memberships] = await Promise.all([
      this.repository.listUsers(subject.orgId),
      this.repository.listGroups(subject.orgId),
      this.repository.listGroupMemberships(subject.orgId),
    ]);
    const userDisables = input.disableMissingUsers
      ? planUserDisables(subject, users, input)
      : emptyUserDisablePlan();
    const membershipRemovals = input.removeMissingGroupMembers
      ? planMembershipRemovals(subject, groups, memberships, input)
      : emptyMembershipRemovalPlan();

    if (
      userDisables.userIds.length > 0 &&
      !input.preserveAdminUsers &&
      !input.allowAdminUserDisable
    ) {
      const adminUserIds = userDisables.userIds.filter((userId) => {
        const user = users.find((candidate) => candidate.id === userId);
        return user !== undefined && normalizeUserRole(user) !== "user";
      });
      if (adminUserIds.length > 0) {
        throw new ApiError(
          "directory_sync_admin_disable_confirmation_required",
          "Directory sync requires allowAdminUserDisable when the plan disables admin users.",
          400,
          { adminUserCount: adminUserIds.length },
        );
      }
    }
    if (userDisables.count > input.maxUserDisables) {
      throw new ApiError(
        "directory_sync_user_disable_limit_exceeded",
        "Directory sync user disable count exceeds the requested limit.",
        400,
        {
          plannedCount: userDisables.count,
          maxUserDisables: input.maxUserDisables,
        },
      );
    }
    if (membershipRemovals.count > input.maxMembershipRemovals) {
      throw new ApiError(
        "directory_sync_membership_removal_limit_exceeded",
        "Directory sync group membership removal count exceeds the requested limit.",
        400,
        {
          plannedCount: membershipRemovals.count,
          maxMembershipRemovals: input.maxMembershipRemovals,
        },
      );
    }

    const result = directorySyncResult(subject, input, {
      membershipRemovals,
      userDisables,
    });
    if (!input.dryRun) {
      await this.repository.transaction(async (repository) => {
        const users = this.userLifecycleService(repository);
        for (const userId of userDisables.userIds) {
          await users.disable({ subject, userId });
        }
        for (const group of membershipRemovals.groups) {
          for (const userId of group.userIds) {
            await repository.deleteGroupMembership(group.groupId, userId);
          }
        }
        await this.audit(repository, subject, "directory_sync.apply", result, {
          reason: input.reason,
        });
      });
      return result;
    }
    await this.audit(
      this.repository,
      subject,
      "directory_sync.preview",
      result,
      {
        reason: input.reason,
      },
    );
    return result;
  }

  private userLifecycleService(
    repository: RomeoRepository,
  ): UserLifecycleService {
    if (repository === this.repository) return this.users;
    return new UserLifecycleService(repository);
  }

  private async audit(
    repository: RomeoRepository,
    subject: AuthSubject,
    action: "directory_sync.apply" | "directory_sync.preview",
    result: DirectorySyncResult,
    options: { reason?: string | undefined },
  ): Promise<void> {
    await writeAuditLog(repository, {
      subject,
      action,
      resourceType: "organization",
      resourceId: subject.orgId,
      metadata: directorySyncAuditMetadata(result, options.reason),
    });
  }
}

interface NormalizedDirectorySyncRequest {
  allowAdminUserDisable: boolean;
  confirmApply?: "apply-directory-sync";
  disableMissingUsers: boolean;
  dryRun: boolean;
  groupMemberships: DirectorySyncGroupInventory[];
  maxMembershipRemovals: number;
  maxUserDisables: number;
  presentUserEmails: string[];
  presentUserIds: string[];
  preserveAdminUsers: boolean;
  reason?: string;
  removeMissingGroupMembers: boolean;
  source: DirectorySyncSource;
}

function normalizeDirectorySyncRequest(
  request: DirectorySyncRequest,
): NormalizedDirectorySyncRequest {
  const source = normalizeDirectorySyncSource(request.source);
  const presentUserIds = uniqueStrings(request.presentUserIds ?? []);
  const presentUserEmails = uniqueStrings(
    (request.presentUserEmails ?? []).map(normalizeLocalAuthEmail),
  );
  const groupMemberships = normalizeGroupInventories(
    request.groupMemberships ?? [],
  );
  const disableMissingUsers = request.disableMissingUsers ?? false;
  if (
    disableMissingUsers &&
    presentUserIds.length + presentUserEmails.length === 0
  ) {
    throw new ApiError(
      "directory_sync_user_inventory_required",
      "Disabling missing directory users requires presentUserIds or presentUserEmails.",
      400,
    );
  }
  const removeMissingGroupMembers = request.removeMissingGroupMembers ?? false;
  if (removeMissingGroupMembers && groupMemberships.length === 0) {
    throw new ApiError(
      "directory_sync_group_inventory_required",
      "Removing missing group members requires at least one group membership inventory.",
      400,
    );
  }
  return {
    allowAdminUserDisable: request.allowAdminUserDisable ?? false,
    ...(request.confirmApply === undefined
      ? {}
      : { confirmApply: request.confirmApply }),
    disableMissingUsers,
    dryRun: request.dryRun ?? true,
    groupMemberships,
    maxMembershipRemovals:
      request.maxMembershipRemovals ?? defaultMaxMembershipRemovals,
    maxUserDisables: request.maxUserDisables ?? defaultMaxUserDisables,
    presentUserEmails,
    presentUserIds,
    preserveAdminUsers: request.preserveAdminUsers ?? true,
    ...(request.reason === undefined ? {} : { reason: request.reason.trim() }),
    removeMissingGroupMembers,
    source,
  };
}

function normalizeDirectorySyncSource(
  source: DirectorySyncSource,
): DirectorySyncSource {
  if (
    source === "active-directory" ||
    source === "ldap" ||
    source === "manual" ||
    source === "oidc" ||
    source === "saml" ||
    source === "scim"
  ) {
    return source;
  }
  throw new ApiError(
    "directory_sync_source_invalid",
    "Directory sync source is not supported.",
    400,
  );
}

function normalizeGroupInventories(
  groups: DirectorySyncGroupInventory[],
): DirectorySyncGroupInventory[] {
  const byGroup = new Map<string, Set<string>>();
  for (const group of groups) {
    const groupId = group.groupId.trim();
    if (groupId.length === 0) continue;
    const existing = byGroup.get(groupId) ?? new Set<string>();
    for (const userId of group.presentUserIds) {
      const normalized = userId.trim();
      if (normalized.length > 0) existing.add(normalized);
    }
    byGroup.set(groupId, existing);
  }
  return [...byGroup.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([groupId, presentUserIds]) => ({
      groupId,
      presentUserIds: [...presentUserIds].sort(),
    }));
}

function planUserDisables(
  subject: AuthSubject,
  users: User[],
  input: NormalizedDirectorySyncRequest,
): DirectorySyncUserDisablePlan {
  const presentIds = new Set(input.presentUserIds);
  const presentEmails = new Set(input.presentUserEmails);
  const userIds: string[] = [];
  const skippedAdminUserIds: string[] = [];
  const skippedSelfUserIds: string[] = [];
  for (const user of users) {
    if (user.disabledAt !== undefined) continue;
    if (presentIds.has(user.id)) continue;
    if (presentEmails.has(normalizeLocalAuthEmail(user.email))) continue;
    if (subject.type === "user" && user.id === subject.id) {
      skippedSelfUserIds.push(user.id);
      continue;
    }
    if (input.preserveAdminUsers && normalizeUserRole(user) !== "user") {
      skippedAdminUserIds.push(user.id);
      continue;
    }
    userIds.push(user.id);
  }
  userIds.sort();
  skippedAdminUserIds.sort();
  skippedSelfUserIds.sort();
  return {
    count: userIds.length,
    skippedAdminUserIds,
    skippedSelfUserIds,
    userIds,
  };
}

function planMembershipRemovals(
  subject: AuthSubject,
  groups: Group[],
  memberships: GroupMembership[],
  input: NormalizedDirectorySyncRequest,
): DirectorySyncMembershipRemovalPlan {
  const groupIds = new Set(groups.map((group) => group.id));
  const removals: DirectorySyncGroupRemovalPlan[] = [];
  const skippedSelfUserIds = new Set<string>();
  for (const inventory of input.groupMemberships) {
    if (!groupIds.has(inventory.groupId)) throw notFound("Group");
    const present = new Set(inventory.presentUserIds);
    const userIds = memberships
      .filter(
        (membership) =>
          membership.groupId === inventory.groupId &&
          !present.has(membership.userId),
      )
      .map((membership) => membership.userId)
      .filter((userId) => {
        if (subject.type === "user" && userId === subject.id) {
          skippedSelfUserIds.add(userId);
          return false;
        }
        return true;
      })
      .sort();
    if (userIds.length > 0) {
      removals.push({
        count: userIds.length,
        groupId: inventory.groupId,
        userIds,
      });
    }
  }
  return {
    count: removals.reduce((total, group) => total + group.count, 0),
    groups: removals,
    skippedSelfUserIds: [...skippedSelfUserIds].sort(),
  };
}

function directorySyncResult(
  subject: AuthSubject,
  input: NormalizedDirectorySyncRequest,
  changes: DirectorySyncResult["changes"],
): DirectorySyncResult {
  const warnings = directorySyncWarnings(changes);
  return {
    changes,
    generatedAt: new Date().toISOString(),
    limits: {
      maxMembershipRemovals: input.maxMembershipRemovals,
      maxUserDisables: input.maxUserDisables,
    },
    mode: input.dryRun ? "preview" : "apply",
    orgId: subject.orgId,
    redaction: {
      externalGroupNamesReturned: false,
      externalSubjectIdsReturned: false,
      rawDirectoryPayloadReturned: false,
      userEmailsReturned: false,
      userNamesReturned: false,
    },
    requested: {
      disableMissingUsers: input.disableMissingUsers,
      preserveAdminUsers: input.preserveAdminUsers,
      removeMissingGroupMembers: input.removeMissingGroupMembers,
    },
    schema: "romeo.directory-sync.v1",
    source: input.source,
    status: input.dryRun ? "preview" : "applied",
    warnings,
  };
}

function directorySyncWarnings(
  changes: DirectorySyncResult["changes"],
): string[] {
  const warnings = new Set<string>();
  if (changes.userDisables.count > 0) warnings.add("users_will_be_disabled");
  if (changes.membershipRemovals.count > 0)
    warnings.add("group_memberships_will_be_removed");
  if (changes.userDisables.skippedAdminUserIds.length > 0)
    warnings.add("admin_users_preserved");
  if (
    changes.userDisables.skippedSelfUserIds.length > 0 ||
    changes.membershipRemovals.skippedSelfUserIds.length > 0
  ) {
    warnings.add("caller_user_preserved");
  }
  return [...warnings].sort();
}

function directorySyncAuditMetadata(
  result: DirectorySyncResult,
  reason: string | undefined,
): Record<string, unknown> {
  return {
    schema: result.schema,
    source: result.source,
    mode: result.mode,
    status: result.status,
    reasonProvided: reason !== undefined && reason.length > 0,
    disableMissingUsers: result.requested.disableMissingUsers,
    removeMissingGroupMembers: result.requested.removeMissingGroupMembers,
    preserveAdminUsers: result.requested.preserveAdminUsers,
    userDisableCount: result.changes.userDisables.count,
    skippedAdminUserCount:
      result.changes.userDisables.skippedAdminUserIds.length,
    skippedSelfUserCount:
      result.changes.userDisables.skippedSelfUserIds.length +
      result.changes.membershipRemovals.skippedSelfUserIds.length,
    groupRemovalCount: result.changes.membershipRemovals.groups.length,
    membershipRemovalCount: result.changes.membershipRemovals.count,
    warningCodes: result.warnings,
    redaction: result.redaction,
  };
}

function emptyUserDisablePlan(): DirectorySyncUserDisablePlan {
  return {
    count: 0,
    skippedAdminUserIds: [],
    skippedSelfUserIds: [],
    userIds: [],
  };
}

function emptyMembershipRemovalPlan(): DirectorySyncMembershipRemovalPlan {
  return {
    count: 0,
    groups: [],
    skippedSelfUserIds: [],
  };
}

function uniqueStrings(values: string[]): string[] {
  return [
    ...new Set(values.map((value) => value.trim()).filter(Boolean)),
  ].sort();
}
