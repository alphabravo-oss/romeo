import type { MessageKey } from "../lib/i18n";

const valueKeys: Record<string, MessageKey> = {
  yes: "capabilityValueYes",
  no: "capabilityValueNo",
  unknown: "capabilityValueUnknown",
  not_required: "capabilityValueNotRequired",
  defaulted: "capabilityValueDefaulted",
  inherit: "capabilityValueInherit",
  enabled: "capabilityValueEnabled",
  disabled: "capabilityValueDisabled",
  required: "capabilityValueRequired",
  normalized: "capabilityValueNormalized",
  not_configured: "capabilityValueNotConfigured",
  not_entitled: "capabilityValueNotEntitled",
  not_allowed: "capabilityValueNotAllowed",
  unsupported: "capabilityValueUnsupported",
  unhealthy: "capabilityValueUnhealthy",
  deployment: "capabilityLayerDeployment",
  platform: "capabilityLayerPlatform",
  entitlement: "capabilityLayerEntitlement",
  organization: "capabilityLayerOrganization",
  workspace: "capabilityLayerWorkspace",
  agent_version: "capabilityLayerAgentVersion",
  agent: "capabilityLayerAgent",
  group: "capabilityLayerGroup",
  user: "capabilityLayerUser",
  resource: "capabilityLayerResource",
  provider_model: "capabilityLayerProviderModel",
  quota: "capabilityLayerQuota",
  action: "capabilityLayerAction",
  platform_disabled: "capabilityReasonPlatformDisabled",
  not_configured: "capabilityValueNotConfigured",
  not_entitled: "capabilityValueNotEntitled",
  missing_grant: "capabilityReasonMissingGrant",
  model_unsupported: "capabilityReasonModelUnsupported",
  organization_policy: "capabilityReasonOrganizationPolicy",
  workspace_policy: "capabilityReasonWorkspacePolicy",
  agent_version_policy: "capabilityReasonAgentVersionPolicy",
  agent_policy: "capabilityReasonAgentPolicy",
  group_policy: "capabilityReasonGroupPolicy",
  user_policy: "capabilityReasonUserPolicy",
  dependency_unhealthy: "capabilityReasonDependencyUnhealthy",
  quota_exceeded: "capabilityReasonQuotaExceeded",
  requested_value_outside_limit: "capabilityReasonOutsideLimit",
};

export function displayCapabilityValue(
  value: string,
  translate: (key: MessageKey) => string,
): string {
  const key = valueKeys[value];
  return key === undefined ? value : translate(key);
}

export function capabilityApiErrorCode(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  if ("code" in value && typeof value.code === "string") return value.code;
  if ("error" in value) return capabilityApiErrorCode(value.error);
  return undefined;
}
