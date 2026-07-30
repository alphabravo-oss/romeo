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
  availability: ModelAvailabilityFilter;
  agents: Agent[];
  direction: "asc" | "desc";
  isUpdating: boolean;
  models: BaseModel[];
  onManagedModelCreated: (agentId: string) => void;
  onNavigationChange: (next: {
    availability?: ModelAvailabilityFilter;
    direction?: "asc" | "desc";
    model?: string | null;
    page?: number;
    provider?: string;
    query?: string;
    sort?: ModelSort;
  }) => void;
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
  page: number;
  providers: Provider[];
  providerId: string;
  query: string;
  selectedModelId: string | undefined;
  sort: ModelSort;
  workspaceId: string | undefined;
}

export function modelAvailabilityFilter(
  value: string | undefined,
): ModelAvailabilityFilter {
  if (value === "available" || value === "unavailable") return value;
  if (value === "enabled" || value === "disabled") return value;
  return "all";
}
