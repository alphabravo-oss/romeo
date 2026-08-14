import { canUseProviderModel } from "./access-visibility";
import { readAbuseControlPolicy } from "./abuse-control-service";
import type { CapabilityAssignment } from "../domain/capabilities";
import type { RomeoRepository } from "../domain/repository";
import type { OrganizationCapabilityFlagService } from "./organization-capability-flag-service";
import {
  CAPABILITY_REGISTRY_VERSION,
  imageGenerationConfiguration,
  mergeCapabilityConfiguration,
  parseCapabilityConfigurationPatch,
  type CapabilityDefinition,
} from "./capability-definition-registry";
import {
  orderCapabilityAssignments,
  reasonForAssignment,
} from "./capability-generic-resolution";
import { capabilityResolutionUsageStore } from "./capability-resolution-observability";
import {
  dedupeReasons,
  earliestExpiry,
  effectiveStatus,
  layerForAssignment,
  loadImageCatalog,
  type EffectiveCapability,
  type ResolutionDetails,
  type ResolveCapabilityInput,
} from "./capability-resolution-model";

export async function resolveImageCapability(input: {
  repository: RomeoRepository;
  organizationFlags?: OrganizationCapabilityFlagService;
  request: ResolveCapabilityInput;
  assignments: CapabilityAssignment[];
  agentVersionDefault?: NonNullable<ResolutionDetails["agentVersionDefault"]>;
  definition: CapabilityDefinition;
  now: string;
  platformDisabled: boolean;
}): Promise<ResolutionDetails> {
  const [abuse, grants, catalog, imageJobsFlag] = await Promise.all([
    readAbuseControlPolicy(input.repository, input.request.subject.orgId),
    input.repository.listResourceGrants(input.request.subject.orgId),
    loadImageCatalog(
      input.repository,
      input.request.subject.orgId,
      input.request.modelId,
    ),
    input.organizationFlags?.resolve(input.request.subject, "image_jobs_v2"),
  ]);
  const ordered = orderCapabilityAssignments(input.assignments);
  const orgAssignment = ordered.find(
    (item) => item.scopeType === "organization",
  );
  const policies = [
    ...ordered.filter((item) =>
      ["organization", "workspace"].includes(item.scopeType),
    ),
    input.agentVersionDefault,
    ...ordered.filter((item) =>
      ["agent", "group", "user"].includes(item.scopeType),
    ),
  ];
  let configuration = imageGenerationConfiguration(
    input.definition.defaultConfiguration,
  );
  for (const assignment of policies) {
    if (assignment === undefined || assignment.state === "inherit") continue;
    configuration = imageGenerationConfiguration(
      mergeCapabilityConfiguration(
        input.definition,
        configuration,
        parseCapabilityConfigurationPatch(
          input.definition.id,
          assignment.configuration,
        ),
      ),
    );
  }

  const reasons: EffectiveCapability["reasons"] = [];
  if (input.platformDisabled)
    reasons.push({ code: "platform_disabled", layer: "platform" });
  for (const assignment of ordered) {
    if (assignment.state === "disabled")
      reasons.push(reasonForAssignment(assignment));
  }
  if (input.agentVersionDefault?.state === "disabled")
    reasons.push({ code: "agent_version_policy", layer: "agent_version" });
  if (imageJobsFlag?.effectiveState === "disabled" && !input.platformDisabled)
    reasons.push({
      code: "organization_policy",
      layer: "organization",
      effect: imageJobsFlag.reasonCode,
    });
  const noAllowedSizes = configuration.allowedSizes.length === 0;
  if (noAllowedSizes)
    reasons.push({
      code: "workspace_policy",
      layer: "workspace",
      effect: "no_allowed_image_sizes",
    });
  const billingBlocked = abuse.enforcement.defaultBlockReasons.some(
    (reason) =>
      reason === "billing_plan_missing" || reason === "billing_status_blocked",
  );
  const suspended =
    abuse.enforcement.defaultBlockReasons.includes("org_suspended");
  if (billingBlocked)
    reasons.push({ code: "not_entitled", layer: "entitlement" });
  if (suspended && orgAssignment?.state !== "disabled")
    reasons.push({ code: "organization_policy", layer: "organization" });

  const providerKilled =
    catalog.provider !== undefined &&
    abuse.killSwitches.providerIds.includes(catalog.provider.id);
  const installed = catalog.installed ? "yes" : "no";
  if (!catalog.installed)
    reasons.push({ code: "not_configured", layer: "deployment" });
  const available = imageAvailability(catalog, input.request.modelId, {
    providerIds: abuse.killSwitches.providerIds,
    providerKilled,
  });
  if (installed === "yes" && available === "no")
    reasons.push({
      code: "dependency_unhealthy",
      layer: "provider_model",
      effect: "image_provider_unavailable",
    });
  const capable = imageCapability(catalog, input.request.modelId);
  if (capable === "no")
    reasons.push({ code: "model_unsupported", layer: "provider_model" });
  const resourceAllowed =
    catalog.model === undefined ||
    canUseProviderModel(input.request.subject, grants, catalog.model);
  if (!resourceAllowed)
    reasons.push({ code: "missing_grant", layer: "resource" });

  const policyDenied = policies.some((item) => item?.state === "disabled");
  const required =
    policies.some((item) => item?.state === "required") &&
    !input.platformDisabled;
  const allowed =
    input.platformDisabled ||
    (!required && policyDenied) ||
    imageJobsFlag?.effectiveState === "disabled" ||
    noAllowedSizes ||
    suspended ||
    !resourceAllowed
      ? "no"
      : "yes";
  const requestedChanges = imageRequestedChanges(input.request, configuration);
  if (requestedChanges.length > 0)
    reasons.push({ code: "requested_value_outside_limit", layer: "action" });
  const effective: EffectiveCapability = {
    capabilityId: "image_generation",
    status:
      required && allowed === "yes"
        ? "required"
        : effectiveStatus({
            platformDisabled: input.platformDisabled,
            allowed,
            available,
            billingBlocked,
            capable,
            installed,
            normalized: requestedChanges.length > 0,
          }),
    dimensions: {
      installed,
      entitled: billingBlocked ? "no" : "not_required",
      available,
      allowed,
      capable,
      selected: required
        ? "yes"
        : input.request.requested?.selected === undefined
          ? "defaulted"
          : input.request.requested.selected
            ? "yes"
            : "no",
    },
    effective: configuration,
    requestedChanges,
    reasons: dedupeReasons(reasons),
    assignmentVersions: [
      ...ordered
        .filter((assignment) =>
          ["organization", "workspace"].includes(assignment.scopeType),
        )
        .map((assignment) => ({
          layer: layerForAssignment(assignment),
          version: assignment.version,
        })),
      ...(input.agentVersionDefault === undefined
        ? []
        : [
            {
              layer: "agent_version" as const,
              version: input.agentVersionDefault.assignmentVersion,
            },
          ]),
      ...ordered
        .filter((assignment) =>
          ["agent", "group", "user"].includes(assignment.scopeType),
        )
        .map((assignment) => ({
          layer: layerForAssignment(assignment),
          version: assignment.version,
        })),
    ],
    registryVersion: CAPABILITY_REGISTRY_VERSION,
    resolvedAt: input.now,
    ...earliestExpiry([
      ...input.assignments,
      ...(input.agentVersionDefault === undefined
        ? []
        : [input.agentVersionDefault]),
    ]),
  };
  capabilityResolutionUsageStore.record(effective);
  return {
    effective,
    assignments: input.assignments,
    ...(input.agentVersionDefault === undefined
      ? {}
      : { agentVersionDefault: input.agentVersionDefault }),
  };
}

type ImageCatalog = Awaited<ReturnType<typeof loadImageCatalog>>;

function imageAvailability(
  catalog: ImageCatalog,
  modelId: string | undefined,
  killed: { providerIds: string[]; providerKilled: boolean },
): "yes" | "no" {
  if (catalog.provider === undefined || catalog.model === undefined) {
    if (modelId !== undefined) return "no";
    return catalog.availableProviderIds.some(
      (providerId) => !killed.providerIds.includes(providerId),
    )
      ? "yes"
      : "no";
  }
  return catalog.compatibleProvider === true &&
    catalog.provider.enabled &&
    catalog.model.enabled &&
    catalog.model.available !== false &&
    !killed.providerKilled
    ? "yes"
    : "no";
}

function imageCapability(
  catalog: ImageCatalog,
  modelId?: string,
): "yes" | "no" | "unknown" {
  if (catalog.model === undefined)
    return modelId === undefined ? (catalog.capable ? "yes" : "unknown") : "no";
  return catalog.model.capabilities.imageGeneration === true &&
    catalog.compatibleProvider === true
    ? "yes"
    : "no";
}

function imageRequestedChanges(
  input: ResolveCapabilityInput,
  configuration: ReturnType<typeof imageGenerationConfiguration>,
): EffectiveCapability["requestedChanges"] {
  const changes: EffectiveCapability["requestedChanges"] = [];
  if (
    input.requested?.maxImagesPerRequest !== undefined &&
    input.requested.maxImagesPerRequest > configuration.maxImagesPerRequest
  )
    changes.push({ path: "maxImagesPerRequest", effect: "clamped" });
  if (
    input.requested?.allowedSizes?.some(
      (size) => !configuration.allowedSizes.includes(size),
    )
  )
    changes.push({ path: "allowedSizes", effect: "rejected" });
  return changes;
}
