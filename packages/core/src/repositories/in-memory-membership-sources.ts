import type { SeedData } from "./seed-data";

export function groupMembershipSourceKey(
  groupId: string,
  userId: string,
): string {
  return `group_membership\u0000${groupId}\u0000${userId}`;
}

export function resourceGrantSourceKey(grantId: string): string {
  return `resource_grant\u0000${grantId}`;
}

export function membershipSourceFor(
  data: SeedData,
  key: string,
): string | undefined {
  return data.membershipSources?.find((entry) => entry.key === key)?.source;
}

export function setMembershipSource(
  data: SeedData,
  key: string,
  source: string | undefined,
): void {
  const kept = (data.membershipSources ?? []).filter(
    (entry) => entry.key !== key,
  );
  data.membershipSources =
    source === undefined ? kept : [...kept, { key, source }];
}
