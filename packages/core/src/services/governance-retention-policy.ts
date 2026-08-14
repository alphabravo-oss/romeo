import type { AuthSubject } from "@romeo/auth";

import type { RetentionPolicy } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";

export function defaultRetentionPolicy(subject: AuthSubject): RetentionPolicy {
  return {
    orgId: subject.orgId,
    auditLogRetentionDays: 365,
    runEventRetentionDays: 30,
    fileRetentionDays: null,
    workspaceFileRetentionDays: {},
    userFileRetentionDays: {},
    updatedBy: subject.id,
    updatedAt: new Date().toISOString(),
  };
}

export function validateFileRetentionDays(days: number | null): void {
  if (days !== null && (!Number.isInteger(days) || days < 1 || days > 3650))
    throw new ApiError(
      "invalid_retention_policy",
      "File retention must be indefinite or between 1 and 3650 days.",
      400,
    );
}

export function effectiveFileExpiry(
  file: {
    createdAt: string;
    metadata: Record<string, unknown>;
    ownerId: string;
    workspaceId: string;
  },
  policy: RetentionPolicy,
): string | undefined {
  let explicitExpiryMs: number | undefined;
  if (typeof file.metadata.expiresAt === "string") {
    const parsed = Date.parse(file.metadata.expiresAt);
    if (Number.isFinite(parsed)) explicitExpiryMs = parsed;
  }
  const days = Object.prototype.hasOwnProperty.call(
    policy.userFileRetentionDays,
    file.ownerId,
  )
    ? policy.userFileRetentionDays[file.ownerId]
    : Object.prototype.hasOwnProperty.call(
          policy.workspaceFileRetentionDays,
          file.workspaceId,
        )
      ? policy.workspaceFileRetentionDays[file.workspaceId]
      : policy.fileRetentionDays;
  let policyExpiryMs: number | undefined;
  if (days !== null && days !== undefined) {
    const createdAtMs = Date.parse(file.createdAt);
    if (Number.isFinite(createdAtMs))
      policyExpiryMs = createdAtMs + days * 86_400_000;
  }
  const effectiveExpiryMs =
    explicitExpiryMs === undefined
      ? policyExpiryMs
      : policyExpiryMs === undefined
        ? explicitExpiryMs
        : Math.min(explicitExpiryMs, policyExpiryMs);
  return effectiveExpiryMs === undefined
    ? undefined
    : new Date(effectiveExpiryMs).toISOString();
}

export async function retentionPolicyForOrg(
  repository: RomeoRepository,
  subject: AuthSubject,
): Promise<RetentionPolicy> {
  return (
    (await repository.getRetentionPolicy(subject.orgId)) ??
    defaultRetentionPolicy(subject)
  );
}

export function withoutBrowserArtifacts(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const { browserArtifacts: _browserArtifacts, ...rest } = payload;
  return rest;
}
