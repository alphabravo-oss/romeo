import { describe, expect, it } from "vitest";

import {
  resolveModelCatalogRouteState,
  updateModelCatalogRouteState,
} from "./model-catalog-route-state";

describe("model catalog route state", () => {
  it("keeps legacy links working and emits compact URL state", () => {
    const legacy = {
      availability: "enabled",
      direction: "desc",
      page: 3,
      provider: "provider-1",
      query: "vision",
      sort: "contextWindow",
    };
    expect(resolveModelCatalogRouteState(legacy)).toEqual({
      availability: "enabled",
      direction: "desc",
      page: 3,
      providerId: "provider-1",
      query: "vision",
      sort: "contextWindow",
    });
    const table = updateModelCatalogRouteState(legacy, { query: "audio" });
    expect(resolveModelCatalogRouteState({ table })).toMatchObject({
      availability: "enabled",
      page: 0,
      providerId: "provider-1",
      query: "audio",
    });
  });

  it("restores a shared compact link and rejects malformed state", () => {
    const table = updateModelCatalogRouteState(
      {},
      {
        availability: "available",
        direction: "desc",
        page: 2,
        provider: "provider-2",
        sort: "name",
      },
    );
    expect(resolveModelCatalogRouteState({ table })).toMatchObject({
      availability: "available",
      direction: "desc",
      page: 2,
      providerId: "provider-2",
      sort: "name",
    });
    expect(resolveModelCatalogRouteState({ table: "{" })).toEqual({
      availability: "all",
      direction: "asc",
      page: 0,
      providerId: "all",
      query: "",
      sort: "displayName",
    });
  });
});
