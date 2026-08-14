import { seededSubject, type AuthSubject } from "@romeo/auth";
import {
  ProviderCapabilityReportSchema,
  ProviderModelCapabilityReportSchema,
} from "@romeo/contracts";
import { describe, expect, it } from "vitest";

import { createRomeoApi } from "./api";
import { InMemoryRomeoRepository } from "./repositories/in-memory";
import { ProviderCapabilityReportService } from "./services/provider-capability-report-service";

const providerId = "provider_openai_compatible";
const modelId = "model_openai_compatible_default";

describe("provider capability reports", () => {
  it("separates registry, configured, source, and operational truth", async () => {
    const repository = new InMemoryRomeoRepository();
    const reports = new ProviderCapabilityReportService(repository);

    const provider = await reports.provider(seededSubject, providerId);
    const model = await reports.model(seededSubject, modelId);

    expect(ProviderCapabilityReportSchema.parse(provider)).toEqual(provider);
    expect(ProviderModelCapabilityReportSchema.parse(model)).toEqual(model);
    expect(provider).toMatchObject({
      providerId,
      kind: "openai-compatible",
      dialect: {
        operations: {
          chat: true,
          discovery: true,
          errorNormalization: true,
        },
      },
      visibleModels: { total: 1 },
    });
    expect(model).toMatchObject({
      modelId,
      capabilitySource: "detected",
      operationallyUsable: true,
      operationalReason: "available",
    });

    const currentProvider = await repository.getProvider(providerId);
    await repository.updateProvider({ ...currentProvider!, enabled: false });
    expect(await reports.model(seededSubject, modelId)).toMatchObject({
      operationallyUsable: false,
      operationalReason: "provider_disabled",
    });
  });

  it("fails hidden resources as not found and never returns endpoint or secret data", async () => {
    const repository = new InMemoryRomeoRepository();
    const reports = new ProviderCapabilityReportService(repository);
    const ungranted: AuthSubject = {
      id: "user_without_provider_grant",
      type: "user",
      orgId: seededSubject.orgId,
      workspaceIds: seededSubject.workspaceIds,
      groupIds: [],
      scopes: ["providers:read", "models:read"],
    };

    await expect(reports.provider(ungranted, providerId)).rejects.toMatchObject(
      {
        status: 404,
      },
    );
    await expect(reports.model(ungranted, modelId)).rejects.toMatchObject({
      status: 404,
    });

    const api = createRomeoApi(repository, { startBackgroundWorkers: false });
    const [providerResponse, modelResponse] = await Promise.all([
      api.request(`/api/v1/providers/${providerId}/capability-report`),
      api.request(`/api/v1/models/${modelId}/capability-report`),
    ]);
    expect(providerResponse.status).toBe(200);
    expect(modelResponse.status).toBe(200);
    const serialized = JSON.stringify([
      await providerResponse.json(),
      await modelResponse.json(),
    ]);
    expect(serialized).not.toMatch(
      /(?:baseUrl|credentialRef|https?:\/\/|secretValue|api[_-]?key)/iu,
    );
  });
});
