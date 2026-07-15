import { pathId } from "../path";
import type { RomeoTransport } from "../transport";
import type {
  BaseModel,
  CreateProviderInput,
  ProviderInstance,
  UpdateModelPricingInput,
} from "../types";

export function createProviderResource(transport: RomeoTransport) {
  return {
    list: () => transport.data<ProviderInstance[]>("GET", "/api/v1/providers"),
    create: (input: CreateProviderInput) =>
      transport.data<ProviderInstance>("POST", "/api/v1/providers", input),
    syncModels: (providerId: string) =>
      transport.data<BaseModel[]>(
        "POST",
        `/api/v1/providers/${pathId(providerId)}/sync`,
      ),
    models: () => transport.data<BaseModel[]>("GET", "/api/v1/models"),
    updateModelPricing: (modelId: string, input: UpdateModelPricingInput) =>
      transport.data<BaseModel>(
        "PATCH",
        `/api/v1/models/${pathId(modelId)}/pricing`,
        input,
      ),
  };
}
