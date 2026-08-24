import type { RomeoRepository } from "../domain/repository";

export const CONTENT_POLICY_DETECTOR_CODES = [
  "credit_card",
  "email_address",
  "us_ssn",
  "api_token",
] as const;
export type ContentPolicyDetectorCode =
  (typeof CONTENT_POLICY_DETECTOR_CODES)[number];
export type ContentPolicyAction = "disabled" | "audit" | "block" | "redact";
export type ContentPolicyDetectorActions = Record<
  ContentPolicyDetectorCode,
  ContentPolicyAction
>;

export interface StoredContentPolicy {
  schema: "romeo.content-policy.v1";
  orgId: string;
  detectors: ContentPolicyDetectorActions;
  versionId: string;
  approvalRequired: boolean;
  approvalTtlSeconds: number;
  updatedAt: string;
  updatedBy: string;
}

export interface ActiveContentPolicy {
  detectors: ContentPolicyDetectorActions;
  versionId: string;
  approvalRequired: boolean;
  approvalTtlSeconds: number;
}

export const DEFAULT_CONTENT_POLICY_ACTIONS: ContentPolicyDetectorActions = {
  credit_card: "disabled",
  email_address: "disabled",
  us_ssn: "disabled",
  api_token: "disabled",
};

export const CONTENT_POLICY_ACTIONS = new Set<ContentPolicyAction>([
  "disabled",
  "audit",
  "block",
  "redact",
]);

export async function activeContentPolicyFor(
  repository: RomeoRepository,
  orgId: string,
): Promise<ActiveContentPolicy> {
  const stored = await readContentPolicy(repository, orgId);
  return stored === undefined
    ? {
        detectors: { ...DEFAULT_CONTENT_POLICY_ACTIONS },
        versionId: "default",
        approvalRequired: false,
        approvalTtlSeconds: 3_600,
      }
    : {
        detectors: { ...stored.detectors },
        versionId: stored.versionId,
        approvalRequired: stored.approvalRequired,
        approvalTtlSeconds: stored.approvalTtlSeconds,
      };
}

export async function readContentPolicy(
  repository: RomeoRepository,
  orgId: string,
): Promise<StoredContentPolicy | undefined> {
  const value = (
    await repository.getSystemSetting(contentPolicySettingKey(orgId), orgId)
  )?.value;
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    candidate.schema !== "romeo.content-policy.v1" ||
    candidate.orgId !== orgId
  )
    return undefined;
  const detectors = candidate.detectors;
  if (
    detectors === null ||
    typeof detectors !== "object" ||
    Array.isArray(detectors)
  )
    return undefined;
  const detectorRecord = detectors as Record<string, unknown>;
  if (
    !CONTENT_POLICY_DETECTOR_CODES.every((code) =>
      CONTENT_POLICY_ACTIONS.has(detectorRecord[code] as ContentPolicyAction),
    )
  )
    return undefined;
  if (
    typeof candidate.updatedAt !== "string" ||
    typeof candidate.updatedBy !== "string" ||
    (candidate.versionId !== undefined &&
      typeof candidate.versionId !== "string") ||
    (candidate.approvalRequired !== undefined &&
      typeof candidate.approvalRequired !== "boolean") ||
    (candidate.approvalTtlSeconds !== undefined &&
      (typeof candidate.approvalTtlSeconds !== "number" ||
        !Number.isSafeInteger(candidate.approvalTtlSeconds) ||
        candidate.approvalTtlSeconds < 60 ||
        candidate.approvalTtlSeconds > 86_400))
  )
    return undefined;
  return {
    schema: "romeo.content-policy.v1",
    orgId,
    detectors: Object.fromEntries(
      CONTENT_POLICY_DETECTOR_CODES.map((code) => [code, detectorRecord[code]]),
    ) as ContentPolicyDetectorActions,
    versionId:
      typeof candidate.versionId === "string"
        ? candidate.versionId
        : `legacy:${candidate.updatedAt}`,
    approvalRequired: candidate.approvalRequired === true,
    approvalTtlSeconds:
      typeof candidate.approvalTtlSeconds === "number"
        ? candidate.approvalTtlSeconds
        : 3_600,
    updatedAt: candidate.updatedAt,
    updatedBy: candidate.updatedBy,
  };
}

export function contentPolicySettingKey(orgId: string): string {
  return `content_policy.v1:${orgId}`;
}
