import { describe, expect, it } from "vitest";

import {
  PROVIDER_CATALOG_INLINE_CEILING,
  authorizeProviderCatalogSync,
} from "./provider-catalog-sync-job";

describe("provider catalog sync job", () => {
  it("forces large catalogs onto the observable async job", () => {
    expect(
      authorizeProviderCatalogSync({
        estimatedModels: PROVIDER_CATALOG_INLINE_CEILING + 1,
        mode: "inline",
      }),
    ).toEqual({
      code: "provider_catalog_sync_must_be_async",
      outcome: "denied",
    });
    expect(
      authorizeProviderCatalogSync({
        estimatedModels: PROVIDER_CATALOG_INLINE_CEILING + 1,
        mode: "async_job",
      }),
    ).toEqual({ mode: "async_job", outcome: "accepted" });
  });
});
