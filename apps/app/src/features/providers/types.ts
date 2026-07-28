import type {
  ProviderConnection,
  ProviderModel,
  ProviderOperationalSummary,
  ProviderVerification,
  ProvidersDeleteOllamaModelResponse,
  ProvidersPullOllamaModelResponse,
} from "@romeo/api-client/generated/sdk";

export type Provider = ProviderConnection;
export type BaseModel = ProviderModel;
export type ProviderKind = ProviderConnection["type"];
export type ProviderCapabilities = ProviderConnection["capabilities"];
export type ProviderDeploymentConstraints = ProviderCapabilities["deployment"];
export type ModelModality = ProviderCapabilities["modalities"][number];
export type ProviderDeploymentMode = ProviderDeploymentConstraints["mode"];
export type ProviderNetworkAccess =
  ProviderDeploymentConstraints["networkAccess"];
export type ProviderOperationalPolicy = ProviderOperationalSummary["policy"];
export type ProviderFallbackOperationalState =
  ProviderOperationalSummary["fallback"];
export type ProviderOperationalAlert =
  ProviderOperationalSummary["alerts"][number];
export type ProviderOperationalProviderSummary =
  ProviderOperationalSummary["providers"][number];
export type ProviderCircuitOperationalState =
  ProviderOperationalProviderSummary["circuit"];
export type ProviderOperationalStatus = ProviderOperationalSummary["status"];
export type ProviderOperationalProviderStatus =
  ProviderOperationalProviderSummary["status"];
export type OllamaPullResult = ProvidersPullOllamaModelResponse["data"];
export type OllamaDeleteResult = ProvidersDeleteOllamaModelResponse["data"];
export type { ProviderOperationalSummary, ProviderVerification };

export interface ModelPage {
  items: BaseModel[];
  limit: number;
  offset: number;
  total: number;
  hasMore: boolean;
}
