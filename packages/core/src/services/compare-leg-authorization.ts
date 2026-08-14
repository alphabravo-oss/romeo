import { canAccessOrg, type AuthSubject } from "@romeo/auth";

import type { RomeoRepository } from "../domain/repository";
import type { CompareLegRequest } from "./compare-preflight";

export async function authorizeCompareLegs(input: {
  repository: RomeoRepository;
  subject: AuthSubject;
  modelIds: string[];
}): Promise<CompareLegRequest[]> {
  return Promise.all(
    input.modelIds.map(async (modelId, index) => {
      const model = await input.repository.getModel(modelId);
      const provider =
        model === undefined
          ? undefined
          : await input.repository.getProvider(model.providerId);
      const authorized =
        model !== undefined &&
        provider !== undefined &&
        canAccessOrg(input.subject, provider.orgId) &&
        provider.enabled &&
        model.enabled &&
        model.available !== false;
      return {
        legId: `leg_${index + 1}`,
        modelId,
        providerId: provider?.id ?? "unresolved",
        authorized,
        estimatedMicroUsd: 0,
      };
    }),
  );
}
