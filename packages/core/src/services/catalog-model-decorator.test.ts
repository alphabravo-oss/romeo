import { describe, expect, it } from "vitest";

import { InMemoryRomeoRepository } from "../repositories/in-memory";
import { decorateCatalogModels } from "./catalog-model-decorator";

describe("decorateCatalogModels", () => {
  it("attaches native/emulated surface and probe freshness from stored extras", async () => {
    const repository = new InMemoryRomeoRepository();
    const models = await repository.listModels("org_default");
    const model = models.find(
      (item) => item.id === "model_openai_compatible_default",
    );
    expect(model).toBeDefined();
    await repository.upsertSystemSetting({
      key: "model.capability.probe.v1:org_default:model_openai_compatible_default",
      updatedAt: "2026-08-14T12:00:00.000Z",
      value: {
        modelId: "model_openai_compatible_default",
        orgId: "org_default",
        probedAt: "2026-08-14T12:00:00.000Z",
        schema: "romeo.model-capability-probe.v1",
      },
    });
    await repository.upsertSystemSetting({
      key: `provider.connection-extras.v1:${model!.providerId}`,
      updatedAt: "2026-08-14T12:00:00.000Z",
      value: {
        orgId: "org_default",
        region: "us-east-1",
        schema: "romeo.provider-connection-extras.v1",
      },
    });

    const decorated = await decorateCatalogModels(
      repository,
      "org_default",
      [model!],
    );
    expect(decorated[0]).toMatchObject({
      catalogSurface: {
        deploymentBoundary: "hosted-api",
        probeFreshness: "fresh",
        region: "us-east-1",
      },
      probedAt: "2026-08-14T12:00:00.000Z",
    });
    expect(
      ["emulated", "native", "unsupported"].includes(
        decorated[0]!.catalogSurface.tools,
      ),
    ).toBe(true);
  });
});
