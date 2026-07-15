import type { User } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";

export async function provisionExternalUser(
  repository: RomeoRepository,
  input: {
    email: string;
    name: string;
    orgId: string;
    providerLabel: string;
    userId: string;
  },
): Promise<User> {
  const existing = await repository.getCurrentUser(input.userId);
  if (existing !== undefined && existing.orgId !== input.orgId) {
    throw new Error(
      `${input.providerLabel} subject collides with an existing user in another organization.`,
    );
  }
  await assertEmailDoesNotRequireAccountLinking(repository, input);
  if (existing === undefined) {
    return repository.createUser({
      id: input.userId,
      orgId: input.orgId,
      email: input.email,
      name: input.name,
    });
  }
  if (existing.disabledAt !== undefined) {
    throw new Error(`${input.providerLabel} user is disabled.`);
  }
  if (
    existing.email === input.email &&
    existing.name === input.name &&
    existing.orgId === input.orgId
  ) {
    return existing;
  }
  return repository.updateUser({
    ...existing,
    orgId: input.orgId,
    email: input.email,
    name: input.name,
  });
}

export async function syncExternalGroupMemberships(
  repository: RomeoRepository,
  input: { groupIds: string[]; orgId: string; userId: string },
): Promise<void> {
  const groupIds = [...new Set(input.groupIds)];
  if (groupIds.length === 0) return;
  const [groups, memberships] = await Promise.all([
    repository.listGroups(input.orgId),
    repository.listGroupMemberships(input.orgId, undefined, input.userId),
  ]);
  const existingGroupIds = new Set(groups.map((group) => group.id));
  const existingMemberships = new Set(
    memberships.map((membership) => membership.groupId),
  );
  const now = new Date().toISOString();
  for (const groupId of groupIds) {
    if (!existingGroupIds.has(groupId) || existingMemberships.has(groupId)) {
      continue;
    }
    await repository.createGroupMembership({
      groupId,
      userId: input.userId,
      orgId: input.orgId,
      createdAt: now,
    });
  }
}

async function assertEmailDoesNotRequireAccountLinking(
  repository: RomeoRepository,
  input: { email: string; orgId: string; providerLabel: string; userId: string },
): Promise<void> {
  const normalizedEmail = normalizeEmail(input.email);
  const existingUsers = await repository.listUsers(input.orgId);
  const collision = existingUsers.find(
    (user) =>
      user.id !== input.userId &&
      normalizeEmail(user.email) === normalizedEmail,
  );
  if (collision !== undefined) {
    throw new Error(
      `${input.providerLabel} account linking is disabled for existing local email addresses.`,
    );
  }
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}
