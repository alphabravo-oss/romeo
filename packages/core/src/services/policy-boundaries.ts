export function authorizeToolBoundary(input: {
  argumentsScanned: boolean;
  argumentsBlocked: boolean;
  resultsScanned: boolean;
  resultsBlocked: boolean;
  permissionFromRetrieval: boolean;
}):
  | { outcome: "accepted" }
  | {
      outcome: "denied";
      code:
        | "tool_arguments_unscanned"
        | "tool_arguments_blocked"
        | "tool_results_unscanned"
        | "tool_results_blocked"
        | "tool_permission_from_retrieval";
    } {
  if (input.permissionFromRetrieval)
    return { outcome: "denied", code: "tool_permission_from_retrieval" };
  if (!input.argumentsScanned)
    return { outcome: "denied", code: "tool_arguments_unscanned" };
  if (input.argumentsBlocked)
    return { outcome: "denied", code: "tool_arguments_blocked" };
  if (!input.resultsScanned)
    return { outcome: "denied", code: "tool_results_unscanned" };
  if (input.resultsBlocked)
    return { outcome: "denied", code: "tool_results_blocked" };
  return { outcome: "accepted" };
}

export function evaluateRetrievalBoundary(input: {
  sourceLabelled: boolean;
  containsPolicyInstruction: boolean;
  suspiciousInstruction: boolean;
}):
  | { outcome: "trusted" }
  | {
      outcome: "untrusted";
      warning?: "suspicious_instruction";
      blocked?: "policy_instruction";
    } {
  if (!input.sourceLabelled || input.containsPolicyInstruction)
    return { outcome: "untrusted", blocked: "policy_instruction" };
  if (input.suspiciousInstruction)
    return { outcome: "untrusted", warning: "suspicious_instruction" };
  return { outcome: "trusted" };
}

export function evaluateDestinationPolicy(input: {
  providerAllowed: boolean;
  toolAllowed: boolean;
  connectorAllowed: boolean;
  hostAllowed: boolean;
  regionAllowed: boolean;
  dataClassAllowed: boolean;
  fallbackProvider?: string;
}):
  | { outcome: "allowed" }
  | {
      outcome: "denied";
      code:
        | "destination_provider_denied"
        | "destination_tool_denied"
        | "destination_connector_denied"
        | "destination_host_denied"
        | "destination_region_denied"
        | "destination_data_class_denied"
        | "destination_silent_fallback_forbidden";
    } {
  if (input.fallbackProvider !== undefined)
    return { outcome: "denied", code: "destination_silent_fallback_forbidden" };
  if (!input.providerAllowed)
    return { outcome: "denied", code: "destination_provider_denied" };
  if (!input.toolAllowed)
    return { outcome: "denied", code: "destination_tool_denied" };
  if (!input.connectorAllowed)
    return { outcome: "denied", code: "destination_connector_denied" };
  if (!input.hostAllowed)
    return { outcome: "denied", code: "destination_host_denied" };
  if (!input.regionAllowed)
    return { outcome: "denied", code: "destination_region_denied" };
  if (!input.dataClassAllowed)
    return { outcome: "denied", code: "destination_data_class_denied" };
  return { outcome: "allowed" };
}

export function sanitizePolicyEvidence(input: {
  detectorCodes: string[];
  counts: number;
  surface: string;
  action: "allow" | "block" | "redact";
  policyVersion: string;
  destinationClass: string;
  matchText?: string;
}): {
  detectorCodes: string[];
  counts: number;
  surface: string;
  action: "allow" | "block" | "redact";
  policyVersion: string;
  destinationClass: string;
} {
  void input.matchText;
  return {
    detectorCodes: [...input.detectorCodes],
    counts: input.counts,
    surface: input.surface,
    action: input.action,
    policyVersion: input.policyVersion,
    destinationClass: input.destinationClass,
  };
}
