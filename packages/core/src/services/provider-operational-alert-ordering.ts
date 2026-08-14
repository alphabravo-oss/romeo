import type { ProviderOperationalAlert } from "./provider-operational-summary";

export function compareProviderAlerts(
  left: ProviderOperationalAlert,
  right: ProviderOperationalAlert,
): number {
  const severity = severityRank(right.severity) - severityRank(left.severity);
  if (severity !== 0) return severity;
  return left.id.localeCompare(right.id);
}

export function providerAlertIdPart(value: string): string {
  return value.replace(/[^A-Za-z0-9]+/gu, "_");
}

export function severityForProviderReason(
  reason: string,
  fallbackAvailable: boolean,
): "critical" | "warning" {
  if (reason === "provider_kill_switch" || reason === "provider_circuit_open")
    return fallbackAvailable ? "warning" : "critical";
  return reason === "provider_disabled" ? "warning" : "critical";
}

function severityRank(value: ProviderOperationalAlert["severity"]): number {
  return value === "critical" ? 2 : 1;
}
