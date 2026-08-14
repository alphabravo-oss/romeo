import type { CapabilityAssignment } from "../domain/capabilities";
import type {
  CapabilityConfiguration,
  CapabilityDefinition,
} from "./capability-definition-registry";
import {
  mergeCapabilityConfiguration,
  parseCapabilityConfigurationPatch,
} from "./capability-definition-registry";
import {
  capabilityDenied,
  dedupeReasons,
  earliestExpiry,
  effectiveStatus,
  layerForAssignment,
  type CapabilityRequestedValues,
  type EffectiveCapability,
  type ResolutionDetails,
} from "./capability-resolution-model";

export function resolveGenericCapability(input: {
  assignments: CapabilityAssignment[];
  agentVersionDefault?: {
    state: CapabilityAssignment["state"];
    configuration: Record<string, unknown>;
    assignmentVersion: number;
    expiresAt?: string;
  };
  definition: CapabilityDefinition;
  legacyConfiguration?: CapabilityConfiguration;
  now: string;
  platformDisabled: boolean;
  entitled?: boolean;
  installed?: "yes" | "no" | "unknown";
  available?: "yes" | "no" | "unknown";
  capable?: "yes" | "no" | "unknown";
  requested?: CapabilityRequestedValues;
}): ResolutionDetails {
  const orderedAssignments = orderCapabilityAssignments(input.assignments);
  let configuration: CapabilityConfiguration = structuredClone(
    input.definition.defaultConfiguration,
  );
  if (input.legacyConfiguration !== undefined) {
    configuration = mergeCapabilityConfiguration(
      input.definition,
      configuration,
      input.legacyConfiguration,
    );
  }
  const policies = [
    ...orderedAssignments.filter((item) =>
      ["organization", "workspace"].includes(item.scopeType),
    ),
    input.agentVersionDefault,
    ...orderedAssignments.filter((item) =>
      ["agent", "group", "user"].includes(item.scopeType),
    ),
  ];
  for (const assignment of policies) {
    if (assignment === undefined || assignment.state === "inherit") continue;
    configuration = mergeCapabilityConfiguration(
      input.definition,
      configuration,
      parseCapabilityConfigurationPatch(
        input.definition.id,
        assignment.configuration,
      ),
    );
  }

  const reasons: EffectiveCapability["reasons"] = [];
  if (input.platformDisabled)
    reasons.push({ code: "platform_disabled", layer: "platform" });
  for (const assignment of orderedAssignments) {
    if (assignment.state !== "disabled") continue;
    reasons.push(reasonForAssignment(assignment));
  }
  if (input.agentVersionDefault?.state === "disabled")
    reasons.push({ code: "agent_version_policy", layer: "agent_version" });
  const required =
    policies.some((assignment) => assignment?.state === "required") &&
    !input.platformDisabled;
  const allowed =
    input.platformDisabled ||
    (!required && policies.some((item) => item?.state === "disabled"))
      ? "no"
      : "yes";
  const requestedChanges = requestedChangesFor(
    input.definition,
    configuration,
    input.requested,
  );
  if (requestedChanges.length > 0)
    reasons.push({ code: "requested_value_outside_limit", layer: "action" });
  const installed = input.installed ?? "unknown";
  const available = input.available ?? "unknown";
  const capable = input.capable ?? "unknown";
  const entitled =
    input.entitled === undefined
      ? "not_required"
      : input.entitled
        ? "yes"
        : "no";
  if (input.entitled === false)
    reasons.push({ code: "not_entitled", layer: "entitlement" });
  if (installed === "no")
    reasons.push({ code: "not_configured", layer: "deployment" });
  if (available === "no")
    reasons.push({ code: "dependency_unhealthy", layer: "resource" });
  if (capable === "no")
    reasons.push({ code: "model_unsupported", layer: "provider_model" });
  const effective: EffectiveCapability = {
    capabilityId: input.definition.id,
    status:
      required && allowed === "yes"
        ? "required"
        : effectiveStatus({
            platformDisabled: input.platformDisabled,
            installed,
            billingBlocked: input.entitled === false,
            allowed,
            available,
            capable,
            normalized: requestedChanges.length > 0,
          }),
    dimensions: {
      installed,
      entitled,
      available,
      allowed,
      capable,
      selected: required
        ? "yes"
        : input.requested?.selected === undefined
          ? "defaulted"
          : input.requested.selected
            ? "yes"
            : "no",
    },
    effective: configuration,
    requestedChanges,
    reasons: dedupeReasons(reasons),
    assignmentVersions: [
      ...orderedAssignments
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
      ...orderedAssignments
        .filter((assignment) =>
          ["agent", "group", "user"].includes(assignment.scopeType),
        )
        .map((assignment) => ({
          layer: layerForAssignment(assignment),
          version: assignment.version,
        })),
    ],
    registryVersion: input.definition.registryVersion,
    resolvedAt: input.now,
    ...earliestExpiry([
      ...input.assignments,
      ...(input.agentVersionDefault === undefined
        ? []
        : [input.agentVersionDefault]),
    ]),
  };
  return { effective, assignments: input.assignments };
}

export function orderCapabilityAssignments(
  assignments: CapabilityAssignment[],
): CapabilityAssignment[] {
  const rank: Record<CapabilityAssignment["scopeType"], number> = {
    organization: 0,
    workspace: 1,
    agent: 2,
    group: 3,
    user: 4,
  };
  return [...assignments].sort(
    (left, right) =>
      rank[left.scopeType] - rank[right.scopeType] ||
      left.scopeId.localeCompare(right.scopeId),
  );
}

export function reasonForAssignment(
  assignment: CapabilityAssignment,
): EffectiveCapability["reasons"][number] {
  switch (assignment.scopeType) {
    case "organization":
      return { code: "organization_policy", layer: "organization" };
    case "workspace":
      return { code: "workspace_policy", layer: "workspace" };
    case "agent":
      return { code: "agent_policy", layer: "agent" };
    case "group":
      return { code: "group_policy", layer: "group" };
    case "user":
      return { code: "user_policy", layer: "user" };
  }
}

export function enforceGenericCapability(
  effective: EffectiveCapability,
): EffectiveCapability {
  if (["disabled", "not_allowed"].includes(effective.status))
    throw capabilityDenied(effective);
  return effective;
}

function requestedChangesFor(
  definition: CapabilityDefinition,
  effective: CapabilityConfiguration,
  requested: CapabilityRequestedValues | undefined,
): EffectiveCapability["requestedChanges"] {
  if (requested === undefined) return [];
  const maxima = definition.merge.maxima.flatMap((path) => {
    const maximum = effective[path as keyof CapabilityConfiguration];
    const requestedPath = capabilityRequestPath(path);
    const value = requested[requestedPath];
    return typeof maximum === "number" &&
      typeof value === "number" &&
      value > maximum
      ? [{ path: requestedPath, effect: requestEffect(definition.id) }]
      : typeof maximum === "string" &&
          typeof value === "string" &&
          orderedValueExceeds(path, value, maximum)
        ? [{ path: requestedPath, effect: requestEffect(definition.id) }]
        : [];
  });
  if (
    definition.id === "reasoning_policy" &&
    requested.retainReasoningSummary === true &&
    effective.allowReasoningSummaryRetention === false
  )
    maxima.push({
      path: "retainReasoningSummary",
      effect: "rejected" as const,
    });
  return maxima;
}

function capabilityRequestPath(path: string): keyof CapabilityRequestedValues {
  if (path === "reasoningModeMaximum") return "reasoningMode";
  if (path === "reasoningEffortMaximum") return "reasoningEffort";
  return path as keyof CapabilityRequestedValues;
}

function requestEffect(
  capabilityId: CapabilityDefinition["id"],
): "clamped" | "rejected" {
  return capabilityId === "reasoning_policy" ? "rejected" : "clamped";
}

function orderedValueExceeds(
  path: string,
  value: string,
  maximum: string,
): boolean {
  const order =
    path === "reasoningModeMaximum"
      ? ["off", "auto", "summary"]
      : ["low", "medium", "high"];
  return order.indexOf(value) > order.indexOf(maximum);
}
