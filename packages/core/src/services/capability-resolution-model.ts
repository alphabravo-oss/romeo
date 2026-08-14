import { hasWorkspaceAccess, type AuthSubject } from "@romeo/auth";

import type {
  CapabilityAssignment,
  CapabilityScopeRef,
} from "../domain/capabilities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import type {
  CapabilityId,
  CapabilityConfiguration,
  CapabilityDefinition,
  ImageGenerationSize,
} from "./capability-definition-registry";
import {
  getCapabilityDefinition,
  imageGenerationConfiguration,
} from "./capability-definition-registry";

export type CapabilityLayer =
  | "deployment"
  | "platform"
  | "entitlement"
  | "organization"
  | "workspace"
  | "agent_version"
  | "agent"
  | "group"
  | "user"
  | "resource"
  | "provider_model"
  | "quota"
  | "action";

export type CapabilityReasonCode =
  | "platform_disabled"
  | "not_configured"
  | "not_entitled"
  | "organization_policy"
  | "workspace_policy"
  | "agent_version_policy"
  | "agent_policy"
  | "group_policy"
  | "user_policy"
  | "missing_grant"
  | "model_unsupported"
  | "dependency_unhealthy"
  | "quota_exceeded"
  | "requested_value_outside_limit";

export const capabilityLayerPrecedence: readonly CapabilityLayer[] = [
  "deployment",
  "platform",
  "entitlement",
  "organization",
  "workspace",
  "agent_version",
  "agent",
  "group",
  "user",
  "action",
  "resource",
  "provider_model",
  "quota",
];

export interface EffectiveCapability {
  capabilityId: CapabilityId;
  status:
    | "enabled"
    | "disabled"
    | "required"
    | "normalized"
    | "not_configured"
    | "not_entitled"
    | "not_allowed"
    | "unsupported"
    | "unhealthy";
  dimensions: {
    installed: "yes" | "no" | "unknown";
    entitled: "yes" | "no" | "unknown" | "not_required";
    available: "yes" | "no" | "unknown";
    allowed: "yes" | "no";
    capable: "yes" | "no" | "unknown";
    selected: "yes" | "no" | "defaulted";
  };
  effective: CapabilityConfiguration;
  requestedChanges: Array<{
    path: string;
    effect: "clamped" | "removed" | "rejected";
  }>;
  reasons: Array<{
    code: CapabilityReasonCode;
    layer: CapabilityLayer;
    effect?: string;
  }>;
  assignmentVersions: Array<{ layer: CapabilityLayer; version: number }>;
  registryVersion: string;
  resolvedAt: string;
  expiresAt?: string;
}

export interface ResolveCapabilityInput {
  subject: AuthSubject;
  capabilityId: CapabilityId;
  workspaceId?: string;
  modelId?: string;
  agentId?: string;
  agentVersionId?: string;
  requested?: CapabilityRequestedValues;
  /** Server-derived identity target used only by authorized admin previews. */
  assignmentSubject?: { userId?: string; groupIds: string[] };
}

export interface ResolveManyCapabilityInput {
  subject: AuthSubject;
  capabilityIds: CapabilityId[];
  workspaceId: string;
  modelId?: string;
  agentId?: string;
  agentVersionId?: string;
  requested?: Partial<Record<CapabilityId, CapabilityRequestedValues>>;
}

export interface CapabilityRequestedValues {
  selected?: boolean;
  maxImagesPerRequest?: number;
  allowedSizes?: ImageGenerationSize[];
  maxSearchResults?: number;
  maxUrlsPerRequest?: number;
  reasoningMode?: "off" | "auto" | "summary";
  reasoningEffort?: "low" | "medium" | "high";
  maxReasoningTokens?: number;
  retainReasoningSummary?: boolean;
}

export interface AuthorizeImageGenerationInput {
  subject: AuthSubject;
  workspaceId: string;
  modelId: string;
  count: number;
  size: ImageGenerationSize;
}

export interface CapabilityScopeContextInput {
  subject: AuthSubject;
  scope: CapabilityScopeRef;
  workspaceId?: string;
  modelId?: string;
}

export interface CapabilityHistoryInput {
  subject: AuthSubject;
  scope: CapabilityScopeRef;
  capabilityId: CapabilityId;
}

export interface CapabilityExplainInput extends CapabilityScopeContextInput {
  capabilityId: CapabilityId;
}

export interface UpdateCapabilityAssignmentInput extends CapabilityHistoryInput {
  state: CapabilityAssignment["state"];
  configuration: unknown;
  reason: string;
  expectedVersion?: number;
  expiresAt?: string | null;
  workspaceId?: string;
}

export interface PreviewCapabilityAssignmentInput extends Omit<
  UpdateCapabilityAssignmentInput,
  "expectedVersion" | "reason"
> {
  workspaceId?: string;
  requested?: CapabilityRequestedValues;
}

export interface ResolutionDetails {
  effective: EffectiveCapability;
  assignments: CapabilityAssignment[];
  agentVersionDefault?: {
    agentVersionId: string;
    state: CapabilityAssignment["state"];
    configuration: Record<string, unknown>;
    assignmentVersion: number;
    expiresAt?: string;
  };
}

export function layerForAssignment(
  assignment: CapabilityAssignment,
): CapabilityAssignment["scopeType"] {
  return assignment.scopeType;
}

export function controllingAssignment(
  assignments: CapabilityAssignment[],
): CapabilityAssignment | undefined {
  const precedence: CapabilityAssignment["scopeType"][] = [
    "user",
    "group",
    "agent",
    "workspace",
    "organization",
  ];
  return precedence.flatMap((scopeType) =>
    assignments.filter(
      (assignment) =>
        assignment.scopeType === scopeType && assignment.state !== "inherit",
    ),
  )[0];
}

export function earliestExpiry(assignments: Array<{ expiresAt?: string }>): {
  expiresAt?: string;
} {
  const expiries = assignments
    .flatMap((assignment) =>
      assignment.expiresAt === undefined ? [] : [assignment.expiresAt],
    )
    .sort((left, right) => Date.parse(left) - Date.parse(right));
  return expiries[0] === undefined ? {} : { expiresAt: expiries[0] };
}

export function effectiveStatus(input: {
  platformDisabled: boolean;
  installed: "yes" | "no" | "unknown";
  billingBlocked: boolean;
  allowed: "yes" | "no";
  available: "yes" | "no" | "unknown";
  capable: "yes" | "no" | "unknown";
  normalized: boolean;
}): EffectiveCapability["status"] {
  if (input.platformDisabled) return "disabled";
  if (input.allowed === "no") return "not_allowed";
  if (input.billingBlocked) return "not_entitled";
  if (input.installed === "no") return "not_configured";
  if (input.capable === "no") return "unsupported";
  if (input.available === "no") return "unhealthy";
  if (input.normalized) return "normalized";
  return "enabled";
}

export function dedupeReasons(
  reasons: EffectiveCapability["reasons"],
): EffectiveCapability["reasons"] {
  const seen = new Set<string>();
  return reasons
    .filter((reason) => {
      const key = `${reason.code}:${reason.layer}:${reason.effect ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort(
      (left, right) =>
        capabilityLayerPrecedence.indexOf(left.layer) -
        capabilityLayerPrecedence.indexOf(right.layer),
    );
}

export function capabilityDenied(effective: EffectiveCapability): ApiError {
  const errorCode =
    effective.status === "disabled"
      ? "capability_platform_disabled"
      : effective.status === "not_configured"
        ? "capability_not_configured"
        : effective.status === "not_entitled"
          ? "capability_not_entitled"
          : effective.status === "unsupported"
            ? "capability_unsupported"
            : effective.status === "unhealthy"
              ? "capability_dependency_unhealthy"
              : "capability_not_allowed";
  return new ApiError(
    errorCode,
    "The requested capability is not available.",
    403,
    {
      capabilityId: effective.capabilityId,
      reasonCodes: effective.reasons.map((reason) => reason.code),
    },
  );
}

export function enforceImageCapability(
  effective: EffectiveCapability,
  requested: { count: number; size: ImageGenerationSize },
): { count: number } {
  if (effective.reasons.some((reason) => reason.code === "missing_grant")) {
    throw notFound("Model");
  }
  if (
    [
      "disabled",
      "not_allowed",
      "not_entitled",
      "not_configured",
      "unsupported",
      "unhealthy",
    ].includes(effective.status)
  ) {
    throw capabilityDenied(effective);
  }
  const configuration = imageGenerationConfiguration(effective.effective);
  if (!configuration.allowedSizes.includes(requested.size)) {
    throw new ApiError(
      "capability_requested_value_outside_limit",
      "The requested image size is outside the effective capability policy.",
      403,
      {
        capabilityId: effective.capabilityId,
        reasonCodes: effective.reasons.map((reason) => reason.code),
      },
    );
  }
  return {
    count: Math.min(requested.count, configuration.maxImagesPerRequest),
  };
}

export async function loadImageCatalog(
  repository: RomeoRepository,
  orgId: string,
  modelId?: string,
) {
  const [models, providers] = await Promise.all([
    repository.listModels(orgId),
    repository.listProviders(orgId),
  ]);
  const compatibleProviderIds = new Set(
    providers
      .filter(
        (provider) =>
          provider.type === "openai-compatible" ||
          provider.type === "openai-responses-compatible",
      )
      .map((provider) => provider.id),
  );
  const installedModels = models.filter(
    (model) =>
      model.capabilities.imageGeneration === true &&
      compatibleProviderIds.has(model.providerId),
  );
  const model = models.find((candidate) => candidate.id === modelId);
  const provider = providers.find(
    (candidate) => candidate.id === model?.providerId,
  );
  if (
    modelId !== undefined &&
    (model === undefined || provider === undefined)
  ) {
    throw notFound("Model");
  }
  return {
    installed: installedModels.length > 0,
    capable: installedModels.length > 0,
    availableProviderIds: installedModels.flatMap((candidate) => {
      const candidateProvider = providers.find(
        (item) => item.id === candidate.providerId,
      );
      return candidate.enabled &&
        candidate.available !== false &&
        candidateProvider?.enabled === true
        ? [candidate.providerId]
        : [];
    }),
    compatibleProvider:
      provider === undefined
        ? undefined
        : compatibleProviderIds.has(provider.id),
    model,
    provider,
  };
}

export function requiredCapabilityDefinition(
  capabilityId: string,
): CapabilityDefinition {
  const definition = getCapabilityDefinition(capabilityId);
  if (definition === undefined) throw notFound("Capability");
  return definition;
}

export async function assertCapabilityScopeRef(
  repository: RomeoRepository,
  subject: AuthSubject,
  scope: CapabilityScopeRef,
): Promise<void> {
  if (scope.scopeType === "organization") {
    if (scope.scopeId !== subject.orgId) throw notFound("Capability scope");
    return;
  }
  if (scope.scopeType === "workspace") {
    const workspace = await repository.getWorkspace(scope.scopeId);
    if (
      workspace === undefined ||
      workspace.orgId !== subject.orgId ||
      !hasWorkspaceAccess(subject, workspace.id)
    )
      throw notFound("Capability scope");
    return;
  }
  if (scope.scopeType === "agent") {
    const agent = await repository.getAgent(scope.scopeId);
    if (
      agent === undefined ||
      agent.orgId !== subject.orgId ||
      !hasWorkspaceAccess(subject, agent.workspaceId)
    )
      throw notFound("Capability scope");
    return;
  }
  if (subject.isAdmin !== true) throw notFound("Capability scope");
  if (scope.scopeType === "group") {
    const group = await repository.getGroup(scope.scopeId);
    if (group === undefined || group.orgId !== subject.orgId)
      throw notFound("Capability scope");
    return;
  }
  const user = await repository.getCurrentUser(scope.scopeId);
  if (user === undefined || user.orgId !== subject.orgId)
    throw notFound("Capability scope");
}

export async function workspaceForCapabilityScope(
  repository: RomeoRepository,
  subject: AuthSubject,
  scope: CapabilityScopeRef,
  requestedWorkspaceId?: string,
): Promise<string> {
  if (scope.scopeType === "workspace") return scope.scopeId;
  if (scope.scopeType === "agent") {
    const agent = await repository.getAgent(scope.scopeId);
    if (agent === undefined || agent.orgId !== subject.orgId)
      throw notFound("Capability scope");
    return agent.workspaceId;
  }
  if (
    (scope.scopeType === "group" || scope.scopeType === "user") &&
    requestedWorkspaceId === undefined
  )
    throw new ApiError(
      "capability_assignment_invalid",
      "An explicit workspace is required for this capability scope.",
      400,
    );
  if (requestedWorkspaceId !== undefined) {
    const workspace = await repository.getWorkspace(requestedWorkspaceId);
    if (
      workspace === undefined ||
      workspace.orgId !== subject.orgId ||
      !hasWorkspaceAccess(subject, workspace.id)
    ) {
      throw notFound("Workspace");
    }
    return workspace.id;
  }
  const workspaces = await repository.listWorkspaces(subject.orgId);
  const workspace = workspaces.find((candidate) =>
    hasWorkspaceAccess(subject, candidate.id),
  );
  if (workspace === undefined) throw notFound("Workspace");
  return workspace.id;
}
