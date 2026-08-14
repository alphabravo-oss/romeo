import { hasWorkspaceAccess } from "@romeo/auth";

import type {
  CapabilityAssignment,
  CapabilityScopeRef,
} from "../domain/capabilities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import {
  assignmentPolicyVersion,
  capabilityResolutionCacheKey,
  readCapabilityResolutionCache,
  type CapabilityResolutionCacheEntry,
  type CapabilityResolutionCacheKey,
} from "./capability-resolution-cache";
import type { CapabilityPlatformPolicy } from "./capability-platform-policy";
import type { OrganizationCapabilityFlagService } from "./organization-capability-flag-service";
import { resolveAgentCapabilityContext } from "./capability-assignment-context";
import { resolveGenericCapability } from "./capability-generic-resolution";
import { resolveImageCapability } from "./capability-image-resolution";
import { legacyReasoningConfiguration } from "./reasoning-capability-policy";
import { capabilityResolutionUsageStore } from "./capability-resolution-observability";
import {
  layerForAssignment,
  requiredCapabilityDefinition,
  type EffectiveCapability,
  type ResolutionDetails,
  type ResolveCapabilityInput,
} from "./capability-resolution-model";

export async function resolveCapabilityWithDetails(
  deps: {
    repository: RomeoRepository;
    platformPolicy: CapabilityPlatformPolicy;
    organizationFlags?: OrganizationCapabilityFlagService;
    resolutionCache: Map<string, CapabilityResolutionCacheEntry>;
  },
  input: ResolveCapabilityInput,
  previewScope?: CapabilityScopeRef,
  assignmentOverride?: CapabilityAssignment,
): Promise<ResolutionDetails> {
  const definition = requiredCapabilityDefinition(input.capabilityId);
  const supportsWorkspace = definition.controllingLayers.includes("workspace");
  const workspace =
    input.workspaceId === undefined
      ? undefined
      : await deps.repository.getWorkspace(input.workspaceId);
  if (
    (supportsWorkspace && workspace === undefined) ||
    (workspace !== undefined &&
      (workspace.orgId !== input.subject.orgId ||
        !hasWorkspaceAccess(input.subject, workspace.id)))
  )
    throw notFound("Workspace");
  const now = new Date().toISOString();
  const agentContext = await resolveAgentCapabilityContext(
    deps.repository,
    input,
    workspace?.id,
    now,
  );
  const assignmentSubject = input.assignmentSubject ?? {
    ...(input.subject.type === "user" ? { userId: input.subject.id } : {}),
    groupIds: input.subject.groupIds,
  };
  const scopes: CapabilityScopeRef[] = [
    {
      scopeType: "organization",
      scopeId: input.subject.orgId,
    },
    ...(previewScope?.scopeType === "organization" || !supportsWorkspace
      ? []
      : ([
          { scopeType: "workspace", scopeId: workspace!.id },
        ] satisfies CapabilityScopeRef[])),
    ...(agentContext.agentId === undefined
      ? []
      : ([
          { scopeType: "agent", scopeId: agentContext.agentId },
        ] satisfies CapabilityScopeRef[])),
    ...assignmentSubject.groupIds
      .slice()
      .sort()
      .map((scopeId) => ({ scopeType: "group" as const, scopeId })),
    ...(assignmentSubject.userId === undefined
      ? []
      : ([
          { scopeType: "user", scopeId: assignmentSubject.userId },
        ] satisfies CapabilityScopeRef[])),
  ];
  let assignments = await deps.repository.listActiveCapabilityAssignments({
    orgId: input.subject.orgId,
    scopes,
    capabilityIds: [input.capabilityId],
    at: now,
  });
  if (assignmentOverride !== undefined) {
    assignments = [
      ...assignments.filter(
        (assignment) =>
          assignment.scopeType !== assignmentOverride.scopeType ||
          assignment.scopeId !== assignmentOverride.scopeId,
      ),
      assignmentOverride,
    ];
  }
  const cacheKey = {
    orgId: input.subject.orgId,
    ...(input.workspaceId === undefined
      ? {}
      : { workspaceId: input.workspaceId }),
    subjectId: input.subject.id,
    grantVersion: "grant:1",
    policyVersion: assignmentPolicyVersion(
      assignments.map((assignment) => ({
        layer: layerForAssignment(assignment),
        version: assignment.version,
      })),
    ),
    capabilityId: input.capabilityId,
    healthVersion: "health:1",
    registryVersion: definition.registryVersion,
  };
  const cached =
    assignmentOverride === undefined
      ? readCapabilityResolutionCache({
          entry: deps.resolutionCache.get(
            capabilityResolutionCacheKey(cacheKey),
          ),
          key: cacheKey,
          now,
          risk: definition.risk,
        })
      : { outcome: "miss" as const };
  if (cached.outcome === "hit")
    return {
      effective: cached.value,
      assignments,
      ...(agentContext.capabilityDefault === undefined
        ? {}
        : { agentVersionDefault: agentContext.capabilityDefault }),
    };
  if (cached.outcome === "stale_fail")
    throw new ApiError(
      "capability_resolution_stale",
      "The capability decision cache is stale.",
      403,
    );
  const platformDisabled = deps.platformPolicy.disabledCapabilityIds.some(
    (capabilityId) => capabilityId === input.capabilityId,
  );
  if (input.capabilityId !== "image_generation") {
    const details = resolveGenericCapability({
      assignments,
      ...(agentContext.capabilityDefault === undefined
        ? {}
        : { agentVersionDefault: agentContext.capabilityDefault }),
      definition,
      now,
      platformDisabled,
      ...(input.capabilityId === "reasoning_policy"
        ? await legacyReasoningConfiguration(
            deps.repository,
            input.subject.orgId,
            assignments,
          )
        : {}),
      ...(input.requested === undefined ? {} : { requested: input.requested }),
    });
    capabilityResolutionUsageStore.record(details.effective);
    if (assignmentOverride === undefined)
      storeCapabilityResolution(
        deps.resolutionCache,
        cacheKey,
        details.effective,
        now,
      );
    return {
      ...details,
      ...(agentContext.capabilityDefault === undefined
        ? {}
        : { agentVersionDefault: agentContext.capabilityDefault }),
    };
  }
  const details = await resolveImageCapability({
    repository: deps.repository,
    ...(deps.organizationFlags === undefined
      ? {}
      : { organizationFlags: deps.organizationFlags }),
    request: input,
    assignments,
    definition,
    now,
    platformDisabled,
    ...(agentContext.capabilityDefault === undefined
      ? {}
      : { agentVersionDefault: agentContext.capabilityDefault }),
  });
  if (assignmentOverride === undefined)
    storeCapabilityResolution(
      deps.resolutionCache,
      cacheKey,
      details.effective,
      now,
    );
  return details;
}

export function storeCapabilityResolution(
  cache: Map<string, CapabilityResolutionCacheEntry>,
  key: CapabilityResolutionCacheKey,
  value: EffectiveCapability,
  now: string,
): void {
  cache.set(capabilityResolutionCacheKey(key), {
    key,
    value,
    storedAt: now,
    expiresAt: new Date(Date.parse(now) + 300_000).toISOString(),
  });
}

export function invalidateCapabilityResolutionCache(
  cache: Map<string, CapabilityResolutionCacheEntry>,
  orgId: string,
): void {
  for (const [cacheKey, entry] of cache) {
    if (entry.key.orgId === orgId) cache.delete(cacheKey);
  }
}

export function previewAssignmentExpiry(
  value: string | null | undefined,
  now: string,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (
    !Number.isFinite(Date.parse(value)) ||
    Date.parse(value) <= Date.parse(now)
  )
    throw new ApiError(
      "capability_assignment_invalid",
      "Capability assignment expiry must be in the future.",
      400,
    );
  return new Date(value).toISOString();
}
