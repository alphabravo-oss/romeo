import {
  providerReasoningPolicyFromUnknown,
  type ProviderReasoningPolicy,
} from "@romeo/providers";

import type { CapabilityAssignment } from "../domain/capabilities";
import type { RomeoRepository } from "../domain/repository";
import type { CapabilityPlatformPolicy } from "./capability-platform-policy";
import {
  getCapabilityDefinition,
  type CapabilityConfiguration,
} from "./capability-definition-registry";
import { resolveGenericCapability } from "./capability-generic-resolution";

const legacySettingPrefix = "reasoning_policy.org.v1:";

export function reasoningPolicySettingKey(orgId: string): string {
  return `${legacySettingPrefix}${orgId}`;
}

export async function resolveReasoningCapabilityMaximum(
  repository: RomeoRepository,
  input: {
    orgId: string;
    workspaceId: string;
    platformPolicy?: CapabilityPlatformPolicy;
    at?: string;
  },
): Promise<ProviderReasoningPolicy> {
  const now = input.at ?? new Date().toISOString();
  const assignments = await repository.listActiveCapabilityAssignments({
    orgId: input.orgId,
    scopes: [
      { scopeType: "organization", scopeId: input.orgId },
      { scopeType: "workspace", scopeId: input.workspaceId },
    ],
    capabilityIds: ["reasoning_policy"],
    at: now,
  });
  const definition = getCapabilityDefinition("reasoning_policy")!;
  const details = resolveGenericCapability({
    assignments,
    definition,
    now,
    platformDisabled:
      input.platformPolicy?.disabledCapabilityIds.includes(
        "reasoning_policy",
      ) === true,
    ...(await legacyReasoningConfiguration(
      repository,
      input.orgId,
      assignments,
    )),
  });
  if (details.effective.dimensions.allowed === "no")
    return { schemaVersion: 1, mode: "off" };
  return reasoningMaximumFromConfiguration(details.effective.effective);
}

export async function legacyReasoningConfiguration(
  repository: RomeoRepository,
  orgId: string,
  assignments: CapabilityAssignment[],
): Promise<{ legacyConfiguration?: CapabilityConfiguration }> {
  if (assignments.some((assignment) => assignment.scopeType === "organization"))
    return {};
  const setting = await repository.getSystemSetting(
    reasoningPolicySettingKey(orgId),
  );
  const policy = providerReasoningPolicyFromUnknown(setting?.value.policy);
  return policy === undefined
    ? {}
    : { legacyConfiguration: configurationFromReasoningMaximum(policy) };
}

export function reasoningMaximumFromConfiguration(
  configuration: CapabilityConfiguration,
): ProviderReasoningPolicy {
  const mode = configuration.reasoningModeMaximum ?? "off";
  if (mode === "off") return { schemaVersion: 1, mode };
  const shared = {
    schemaVersion: 1 as const,
    effort: configuration.reasoningEffortMaximum ?? "low",
    ...(configuration.maxReasoningTokens === undefined
      ? {}
      : { maxReasoningTokens: configuration.maxReasoningTokens }),
  };
  if (mode === "auto") return { ...shared, mode };
  return {
    ...shared,
    mode,
    summaryDetail: "detailed",
    retainSummary: configuration.allowReasoningSummaryRetention === true,
  };
}

function configurationFromReasoningMaximum(
  policy: ProviderReasoningPolicy,
): CapabilityConfiguration {
  if (policy.mode === "off") return { reasoningModeMaximum: "off" };
  return {
    reasoningModeMaximum: policy.mode,
    reasoningEffortMaximum: policy.effort ?? "medium",
    ...(policy.maxReasoningTokens === undefined
      ? {}
      : { maxReasoningTokens: policy.maxReasoningTokens }),
    allowReasoningSummaryRetention:
      policy.mode === "summary" && policy.retainSummary,
  };
}
