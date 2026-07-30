import type { Agent } from "../features/managed-models/types";
import type {
  BaseModel,
  Provider,
  ProviderOperationalSummary,
  ProviderVerification,
} from "../features/providers/types";
import type { ProviderFormInput } from "./ProviderConnectionDialog";

export interface ProviderPanelProps {
  agents: Agent[];
  isCreating: boolean;
  isUpdating: boolean;
  pullingProviderId: string | undefined;
  deletingModelId: string | undefined;
  syncingProviderId: string | undefined;
  verifyingProviderId: string | undefined;
  onCreateProvider: (input: ProviderFormInput) => Promise<void>;
  onPullProviderModel: (providerId: string, model: string) => Promise<unknown>;
  onDeleteProviderModel: (
    providerId: string,
    modelId: string,
    model: string,
  ) => Promise<unknown>;
  onSyncProvider: (providerId: string) => Promise<void>;
  onUpdateModel: (input: {
    modelId: string;
    enabled: boolean;
  }) => Promise<void>;
  onUpdateProvider: (
    input: Omit<ProviderFormInput, "type"> & {
      providerId: string;
      enabled?: boolean;
      refreshModels?: boolean;
    },
  ) => Promise<void>;
  onVerifyProvider: (providerId: string) => Promise<ProviderVerification>;
  operationalSummary: ProviderOperationalSummary | undefined;
  providers: Provider[];
  models: BaseModel[];
  onProviderSelectionChange: (providerId: string | null) => void;
  selectedProviderId: string | undefined;
}
