export type ProviderKind =
  | "openai-compatible"
  | "openai-responses-compatible"
  | "ollama";
export type ModelModality =
  | "audio-input"
  | "audio-output"
  | "embeddings"
  | "text"
  | "vision";
export type ProviderDeploymentMode = "hosted-api" | "local-runtime";
export type ProviderNetworkAccess = "external-http" | "local-http";

export interface ProviderDeploymentConstraints {
  mode: ProviderDeploymentMode;
  networkAccess: ProviderNetworkAccess;
  credentialRequired: boolean;
}

export interface ProviderCapabilities {
  streaming: boolean;
  toolCalling: boolean;
  vision: boolean;
  audioInput: boolean;
  structuredJson: boolean;
  reasoning: boolean;
  modalities: ModelModality[];
  deployment: ProviderDeploymentConstraints;
}

export interface Provider {
  id: string;
  name: string;
  type: ProviderKind;
  baseUrl: string;
  credentialConfigured?: boolean;
  credentialRefScheme?: string;
  enabled: boolean;
  capabilities: ProviderCapabilities;
}

export interface BaseModel {
  id: string;
  providerId: string;
  name: string;
  displayName: string;
  enabled: boolean;
  capabilities: ProviderCapabilities;
  contextWindow: number;
  pricing?: {
    inputTokenUsd: number;
    outputTokenUsd: number;
  };
}

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

export interface ProviderCircuitOperationalState {
  consecutiveFailures: number;
  state: "closed" | "half_open" | "open";
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
  circuit: ProviderCircuitOperationalState;
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
