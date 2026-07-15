import type {
  ProviderCircuitBreaker,
  ProviderCircuitBreakerSnapshot,
} from "@romeo/ai-runtime";
import type {
  BaseModel,
  ProviderInstance,
  ProviderKind,
} from "@romeo/providers";

import type { RomeoRepository } from "../domain/repository";
import type { RunServiceOptions } from "./run-service";
import type { ProviderRoutingPolicy } from "./provider-routing";

export type ProviderOperationalStatus = "critical" | "degraded" | "healthy";
export type ProviderOperationalProviderStatus =
  | "available"
  | "degraded"
  | "unavailable";

export interface ProviderOperationalPolicy {
  circuitCooldownMs: number;
  circuitFailureThreshold: number;
  disabledProviderIds: string[];
  fallbackModelId?: string;
  retryAttempts: number;
  retryBackoffMs: number;
  streamTimeoutMs: number;
}

export interface ProviderFallbackOperationalState {
  available: boolean;
  configured: boolean;
  modelId?: string;
  providerId?: string;
  reason?: "model_disabled" | "model_missing" | "provider_disabled";
}

export interface ProviderOperationalAlert {
  code:
    | "fallback_unavailable"
    | "no_available_providers"
    | "provider_circuit_open"
    | "provider_disabled"
    | "provider_kill_switch"
    | "provider_without_enabled_models";
  id: string;
  modelId?: string;
  providerId?: string;
  severity: "critical" | "warning";
}

export interface ProviderOperationalProviderSummary {
  circuit: ProviderCircuitBreakerSnapshot;
  enabled: boolean;
  enabledModelCount: number;
  killSwitchActive: boolean;
  modelCount: number;
  providerId: string;
  reasons: string[];
  status: ProviderOperationalProviderStatus;
  type: ProviderKind;
}

export interface ProviderOperationalSummary {
  alerts: ProviderOperationalAlert[];
  fallback: ProviderFallbackOperationalState;
  generatedAt: string;
  policy: ProviderOperationalPolicy;
  providers: ProviderOperationalProviderSummary[];
  status: ProviderOperationalStatus;
}

export async function summarizeProviderOperations(input: {
  circuitBreaker: ProviderCircuitBreaker;
  now?: string;
  options: RunServiceOptions;
  orgId: string;
  repository: RomeoRepository;
  routingPolicy: ProviderRoutingPolicy;
}): Promise<ProviderOperationalSummary> {
  const generatedAt = input.now ?? new Date().toISOString();
  const providers = (await input.repository.listProviders(input.orgId)).sort(
    (left, right) => left.id.localeCompare(right.id),
  );
  const models = await input.repository.listModels(input.orgId);
  const modelsByProvider = groupModelsByProvider(models);
  const fallback = fallbackState(models, providers, input.routingPolicy);
  const policy = policySummary(input.routingPolicy, input.options);

  const providerSummaries = providers.map((provider) => {
    const providerModels = modelsByProvider.get(provider.id) ?? [];
    const circuit = input.circuitBreaker.snapshot(provider.id);
    const killSwitchActive = input.routingPolicy.disabledProviderIds.has(
      provider.id,
    );
    const enabledModelCount = providerModels.filter(
      (model) => model.enabled,
    ).length;
    const reasons = providerReasons({
      circuit,
      enabledModelCount,
      providerEnabled: provider.enabled,
      killSwitchActive,
    });
    return {
      circuit,
      enabled: provider.enabled,
      enabledModelCount,
      killSwitchActive,
      modelCount: providerModels.length,
      providerId: provider.id,
      reasons,
      status: providerStatus(reasons, circuit),
      type: provider.type,
    };
  });

  const alerts: ProviderOperationalAlert[] = [
    ...fallbackAlerts(fallback, input.routingPolicy),
    ...providerSummaries.flatMap((summary) =>
      providerAlerts(summary, fallback),
    ),
  ];

  const availableProviders = providerSummaries.filter(
    (summary) => summary.status === "available",
  ).length;
  if (availableProviders === 0) {
    alerts.push({
      code: "no_available_providers",
      id: "provider_no_available_providers",
      severity: "critical",
    });
  }
  alerts.sort(compareProviderAlerts);

  return {
    alerts,
    fallback,
    generatedAt,
    policy,
    providers: providerSummaries,
    status: alerts.some((alert) => alert.severity === "critical")
      ? "critical"
      : alerts.length > 0
        ? "degraded"
        : "healthy",
  };
}

function policySummary(
  routingPolicy: ProviderRoutingPolicy,
  options: RunServiceOptions,
): ProviderOperationalPolicy {
  return {
    circuitCooldownMs: options.providerCircuitCooldownMs ?? 0,
    circuitFailureThreshold: options.providerCircuitFailureThreshold ?? 0,
    disabledProviderIds: Array.from(routingPolicy.disabledProviderIds).sort(),
    ...(routingPolicy.fallbackModelId === undefined
      ? {}
      : { fallbackModelId: routingPolicy.fallbackModelId }),
    retryAttempts: options.providerRetryAttempts ?? 0,
    retryBackoffMs: options.providerRetryBackoffMs ?? 0,
    streamTimeoutMs: options.providerStreamTimeoutMs ?? 0,
  };
}

function groupModelsByProvider(models: BaseModel[]): Map<string, BaseModel[]> {
  const result = new Map<string, BaseModel[]>();
  for (const model of models) {
    const providerModels = result.get(model.providerId) ?? [];
    providerModels.push(model);
    result.set(model.providerId, providerModels);
  }
  return result;
}

function fallbackState(
  models: BaseModel[],
  providers: ProviderInstance[],
  routingPolicy: ProviderRoutingPolicy,
): ProviderFallbackOperationalState {
  if (routingPolicy.fallbackModelId === undefined) {
    return { available: false, configured: false };
  }

  const fallbackModel = models.find(
    (model) => model.id === routingPolicy.fallbackModelId,
  );
  if (fallbackModel === undefined) {
    return {
      available: false,
      configured: true,
      modelId: routingPolicy.fallbackModelId,
      reason: "model_missing",
    };
  }
  if (!fallbackModel.enabled) {
    return {
      available: false,
      configured: true,
      modelId: fallbackModel.id,
      providerId: fallbackModel.providerId,
      reason: "model_disabled",
    };
  }
  const fallbackProvider = providers.find(
    (provider) => provider.id === fallbackModel.providerId,
  );
  if (
    fallbackProvider === undefined ||
    !fallbackProvider.enabled ||
    routingPolicy.disabledProviderIds.has(fallbackModel.providerId)
  ) {
    return {
      available: false,
      configured: true,
      modelId: fallbackModel.id,
      providerId: fallbackModel.providerId,
      reason: "provider_disabled",
    };
  }
  return {
    available: true,
    configured: true,
    modelId: fallbackModel.id,
    providerId: fallbackModel.providerId,
  };
}

function providerReasons(input: {
  circuit: ProviderCircuitBreakerSnapshot;
  enabledModelCount: number;
  killSwitchActive: boolean;
  providerEnabled: boolean;
}): string[] {
  const reasons: string[] = [];
  if (!input.providerEnabled) reasons.push("provider_disabled");
  if (input.killSwitchActive) reasons.push("provider_kill_switch");
  if (input.enabledModelCount === 0)
    reasons.push("provider_without_enabled_models");
  if (input.circuit.state === "open") reasons.push("provider_circuit_open");
  if (input.circuit.state === "half_open")
    reasons.push("provider_circuit_probe");
  return reasons;
}

function providerStatus(
  reasons: string[],
  circuit: ProviderCircuitBreakerSnapshot,
): ProviderOperationalProviderStatus {
  if (
    reasons.some((reason) =>
      [
        "provider_circuit_open",
        "provider_disabled",
        "provider_kill_switch",
        "provider_without_enabled_models",
      ].includes(reason),
    )
  ) {
    return "unavailable";
  }
  return circuit.state === "half_open" ? "degraded" : "available";
}

function fallbackAlerts(
  fallback: ProviderFallbackOperationalState,
  routingPolicy: ProviderRoutingPolicy,
): ProviderOperationalAlert[] {
  if (!fallback.configured || fallback.available) return [];
  return [
    {
      code: "fallback_unavailable",
      id: "provider_fallback_unavailable",
      ...(fallback.modelId === undefined ? {} : { modelId: fallback.modelId }),
      ...(fallback.providerId === undefined
        ? {}
        : { providerId: fallback.providerId }),
      severity:
        routingPolicy.disabledProviderIds.size > 0 ? "critical" : "warning",
    },
  ];
}

function providerAlerts(
  summary: ProviderOperationalProviderSummary,
  fallback: ProviderFallbackOperationalState,
): ProviderOperationalAlert[] {
  return summary.reasons
    .filter((reason) => reason !== "provider_circuit_probe")
    .map((reason) => ({
      code: reason as ProviderOperationalAlert["code"],
      id: `provider_${alertIdPart(reason)}_${alertIdPart(summary.providerId)}`,
      providerId: summary.providerId,
      severity: severityForReason(reason, fallback),
    }));
}

function severityForReason(
  reason: string,
  fallback: ProviderFallbackOperationalState,
): ProviderOperationalAlert["severity"] {
  if (reason === "provider_kill_switch" || reason === "provider_circuit_open") {
    return fallback.available ? "warning" : "critical";
  }
  return reason === "provider_disabled" ? "warning" : "critical";
}

function compareProviderAlerts(
  left: ProviderOperationalAlert,
  right: ProviderOperationalAlert,
): number {
  const severity = severityRank(right.severity) - severityRank(left.severity);
  if (severity !== 0) return severity;
  return left.id.localeCompare(right.id);
}

function severityRank(value: ProviderOperationalAlert["severity"]): number {
  return value === "critical" ? 2 : 1;
}

function alertIdPart(value: string): string {
  return value.replace(/[^A-Za-z0-9]+/gu, "_");
}
