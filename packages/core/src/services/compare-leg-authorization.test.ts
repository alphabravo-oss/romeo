import { seededSubject } from "@romeo/auth";
import { describe, expect, it } from "vitest";

import { InMemoryRomeoRepository } from "../repositories/in-memory";
import { authorizeCompareLegs } from "./compare-leg-authorization";

describe("compare leg authorization", () => {
  it("authorizes seeded models and rejects unknown ones", async () => {
    const repository = new InMemoryRomeoRepository();
    const legs = await authorizeCompareLegs({
      repository,
      subject: seededSubject,
      modelIds: [
        "model_openai_compatible_default",
        "model_missing",
      ],
    });
    expect(legs[0]).toMatchObject({
      modelId: "model_openai_compatible_default",
      authorized: true,
      providerId: "provider_openai_compatible",
    });
    expect(legs[1]).toMatchObject({
      modelId: "model_missing",
      authorized: false,
      providerId: "unresolved",
    });
  });
});
