import type { ResourceGrant } from "@romeo/auth";

import type { PortableAgentAccessGrant } from "./agent-portability-types";

export function groupPortableAccessGrants(
  grants: ResourceGrant[],
): PortableAgentAccessGrant[] {
  const grouped = new Map<string, PortableAgentAccessGrant>();
  for (const grant of grants) {
    if (!isPortableAgentPermission(grant.permission)) continue;
    const key = `${grant.principalType}:${grant.principalId}`;
    const current = grouped.get(key) ?? {
      principalType: grant.principalType,
      principalId: grant.principalId,
      permissions: [],
    };
    current.permissions.push(grant.permission);
    grouped.set(key, current);
  }
  return [...grouped.values()]
    .map((grant) => ({
      ...grant,
      permissions: [...new Set(grant.permissions)].sort(),
    }))
    .sort(
      (left, right) =>
        left.principalType.localeCompare(right.principalType) ||
        left.principalId.localeCompare(right.principalId),
    );
}

export function isPortableAgentPermission(
  permission: ResourceGrant["permission"],
): permission is Extract<
  ResourceGrant["permission"],
  "read" | "run" | "write"
> {
  return (
    permission === "read" || permission === "run" || permission === "write"
  );
}
