import type {
  ContentPolicyDetectorActions,
  ContentPolicyEvaluation,
} from "./content-policy-service";
import { evaluateContentPolicyStrings } from "./content-policy-service";

export const CONTENT_POLICY_VERSION_STATES = [
  "draft",
  "staged",
  "published",
  "retired",
] as const;
export type ContentPolicyVersionState =
  (typeof CONTENT_POLICY_VERSION_STATES)[number];

export interface ContentPolicyVersion {
  id: string;
  version: number;
  state: ContentPolicyVersionState;
  detectors: ContentPolicyDetectorActions;
  approvalRequired: boolean;
  approvalTtlSeconds: number;
  createdAt: string;
  createdBy: string;
  publishedAt?: string;
  publishedBy?: string;
}

export interface ContentPolicyVersionStore {
  publishedVersionId?: string;
  stagedVersionId?: string;
  versions: ContentPolicyVersion[];
}

export interface SanitizedPolicyDecision {
  id: string;
  versionId: string;
  surface: string;
  action: ContentPolicyEvaluation["action"];
  detectors: Array<{ code: string; count: number; action: string }>;
  decidedAt: string;
}

export function createPolicyVersionDraft(input: {
  store: ContentPolicyVersionStore;
  id: string;
  now: string;
  actorId: string;
  detectors: ContentPolicyDetectorActions;
  approvalRequired?: boolean;
  approvalTtlSeconds?: number;
}): ContentPolicyVersionStore {
  const nextVersion =
    input.store.versions.reduce(
      (max, version) => Math.max(max, version.version),
      0,
    ) + 1;
  const draft: ContentPolicyVersion = {
    id: input.id,
    version: nextVersion,
    state: "draft",
    detectors: { ...input.detectors },
    approvalRequired: input.approvalRequired === true,
    approvalTtlSeconds: Math.min(
      Math.max(input.approvalTtlSeconds ?? 3_600, 60),
      86_400,
    ),
    createdAt: input.now,
    createdBy: input.actorId,
  };
  return { ...input.store, versions: [...input.store.versions, draft] };
}

export function dryRunPolicyVersion(input: {
  version: ContentPolicyVersion;
  content: string;
  decisionId: string;
  now: string;
}): {
  evaluation: ContentPolicyEvaluation;
  decision: SanitizedPolicyDecision;
} {
  const evaluation = evaluateContentPolicyStrings(
    [input.content],
    input.version.detectors,
  ).result;
  return {
    evaluation,
    decision: sanitizePolicyDecision({
      id: input.decisionId,
      versionId: input.version.id,
      surface: "dry_run",
      evaluation,
      decidedAt: input.now,
    }),
  };
}

export function publishPolicyVersion(input: {
  store: ContentPolicyVersionStore;
  versionId: string;
  now: string;
  actorId: string;
}):
  | { outcome: "published"; store: ContentPolicyVersionStore }
  | { outcome: "denied"; code: "content_policy_version_not_draft" } {
  const current = input.store.versions.find((item) => item.id === input.versionId);
  if (current === undefined || (current.state !== "draft" && current.state !== "staged"))
    return { outcome: "denied", code: "content_policy_version_not_draft" };
  const versions = input.store.versions.map((item) => {
    if (item.id === input.versionId) {
      return {
        ...item,
        state: "published" as const,
        publishedAt: input.now,
        publishedBy: input.actorId,
      };
    }
    if (item.state === "published") return { ...item, state: "retired" as const };
    return item;
  });
  return {
    outcome: "published",
    store: {
      publishedVersionId: input.versionId,
      versions,
    },
  };
}

export function rollbackPolicyVersion(input: {
  store: ContentPolicyVersionStore;
  versionId?: string;
  now: string;
  actorId: string;
}):
  | { outcome: "published"; store: ContentPolicyVersionStore }
  | { outcome: "denied"; code: "content_policy_rollback_unavailable" } {
  const target =
    input.versionId === undefined
      ? [...input.store.versions]
          .reverse()
          .find(
            (item) =>
              item.state === "retired" &&
              item.id !== input.store.publishedVersionId,
          )
      : input.store.versions.find((item) => item.id === input.versionId);
  if (target === undefined || target.state === "draft")
    return { outcome: "denied", code: "content_policy_rollback_unavailable" };
  const published = publishPolicyVersion({
    store: {
      ...input.store,
      versions: input.store.versions.map((item) =>
        item.id === target.id ? { ...item, state: "staged" } : item,
      ),
    },
    versionId: target.id,
    now: input.now,
    actorId: input.actorId,
  });
  if (published.outcome === "denied")
    return { outcome: "denied", code: "content_policy_rollback_unavailable" };
  return published;
}

export function sanitizePolicyDecision(input: {
  id: string;
  versionId: string;
  surface: string;
  evaluation: ContentPolicyEvaluation;
  decidedAt: string;
}): SanitizedPolicyDecision {
  return {
    id: input.id,
    versionId: input.versionId,
    surface: input.surface,
    action: input.evaluation.action,
    detectors: input.evaluation.detections.map(({ code, count, action }) => ({
      code,
      count,
      action,
    })),
    decidedAt: input.decidedAt,
  };
}

export function publishedDetectors(
  store: ContentPolicyVersionStore,
): ContentPolicyDetectorActions | undefined {
  return store.versions.find((item) => item.id === store.publishedVersionId)
    ?.detectors;
}
