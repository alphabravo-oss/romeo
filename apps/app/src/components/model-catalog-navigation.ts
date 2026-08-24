import type { Agent } from "../features/managed-models/types";
import type { BaseModel, Provider } from "../features/providers/types";

export type ModelAvailabilityFilter =
  | "all"
  | "available"
  | "unavailable"
  | "enabled"
  | "disabled";
export type ModelSort =
  | "availability"
  | "contextWindow"
  | "displayName"
  | "enabled"
  | "name";

export interface ModelCatalogPanelProps {
  agents: Agent[];
  isUpdating: boolean;
  models: BaseModel[];
  onManagedModelCreated: (agentId: string) => void;
  onUpdateModel: (
    input:
      | { modelId: string; enabled: boolean }
      | {
          modelId: string;
          capabilities: BaseModel["capabilities"];
          contextWindow: number;
        },
  ) => Promise<void>;
  onUpdatePricing: (input: {
    inputTokenUsd: number;
    modelId: string;
    outputTokenUsd: number;
    imageGenerationUsd?: {
      "1024x1024": number;
      "1024x1536": number;
      "1536x1024": number;
    };
  }) => Promise<void>;
  providers: Provider[];
  routeSearch: ModelCatalogRouteSearch;
  workspaceId: string | undefined;
}

export interface ModelCatalogRouteSearch {
  availability?: string;
  direction?: string;
  model?: string;
  page?: number;
  provider?: string;
  query?: string;
  sort?: string;
  table?: string;
}

export interface ModelCatalogNavigationUpdate {
  availability?: ModelAvailabilityFilter;
  direction?: "asc" | "desc";
  model?: string | null;
  page?: number;
  provider?: string;
  query?: string;
  sort?: ModelSort;
}

export function modelAvailabilityFilter(
  value: string | undefined,
): ModelAvailabilityFilter {
  if (value === "available" || value === "unavailable") return value;
  if (value === "enabled" || value === "disabled") return value;
  return "all";
}
