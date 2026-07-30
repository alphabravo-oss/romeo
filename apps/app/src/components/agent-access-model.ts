import type { AgentGrant } from "../features/managed-models";

export type AgentPermission = "read" | "run" | "write";

export interface AgentAccessRow {
  createdAt?: string;
  grants: AgentGrant[];
  principalType: AgentGrant["principalType"];
  principalId: string;
  permissions: AgentPermission[];
}

export function groupAgentShares(grants: AgentGrant[]): AgentAccessRow[] {
  const grouped = new Map<string, AgentAccessRow>();
  for (const grant of grants) {
    const key = `${grant.principalType}:${grant.principalId}`;
    const existing = grouped.get(key) ?? {
      ...(grant.createdAt === undefined ? {} : { createdAt: grant.createdAt }),
      grants: [],
      principalType: grant.principalType,
      principalId: grant.principalId,
      permissions: [],
    };
    existing.grants.push(grant);
    if (
      grant.permission === "read" ||
      grant.permission === "run" ||
      grant.permission === "write"
    )
      existing.permissions.push(grant.permission);
    if (
      grant.createdAt !== undefined &&
      (existing.createdAt === undefined ||
        grant.createdAt.localeCompare(existing.createdAt) > 0)
    )
      existing.createdAt = grant.createdAt;
    grouped.set(key, existing);
  }
  return [...grouped.values()]
    .map((share) => ({
      ...share,
      permissions: [...new Set(share.permissions)].sort() as AgentPermission[],
    }))
    .sort(
      (left, right) =>
        left.principalType.localeCompare(right.principalType) ||
        left.principalId.localeCompare(right.principalId),
    );
}
