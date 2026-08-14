import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { apiQueryKeys, modelCatalogQueryKey } from "./api-query-options";
import * as appQueryKeys from "./app-query-keys";
import {
  modelCatalogApiQuery,
  modelCatalogRequest,
} from "../components/model-catalog-query";

describe("application query key contracts", () => {
  it("invalidates every workspace chat variant through its stable prefix", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(appQueryKeys.chats("workspace-1"), ["primary"]);
    queryClient.setQueryData(
      appQueryKeys.chats("workspace-1", "collaboration"),
      ["collaboration"],
    );

    await queryClient.invalidateQueries({
      queryKey: appQueryKeys.chats("workspace-1"),
    });

    expect(
      queryClient.getQueryState(appQueryKeys.chats("workspace-1"))
        ?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(
        appQueryKeys.chats("workspace-1", "collaboration"),
      )?.isInvalidated,
    ).toBe(true);
  });

  it("keeps paginated model catalogs under generated model invalidation", async () => {
    const queryClient = new QueryClient();
    const catalogKey = modelCatalogQueryKey({ limit: 50, offset: 0 });
    queryClient.setQueryData(catalogKey, { data: [] });

    await queryClient.invalidateQueries({ queryKey: apiQueryKeys.models() });

    expect(queryClient.getQueryState(catalogKey)?.isInvalidated).toBe(true);
  });

  it("uses identical normalized filters for model fetches and cache keys", () => {
    const request = modelCatalogRequest({
      availability: "enabled",
      direction: "desc",
      page: 2,
      providerId: "provider-1",
      query: "embed",
      sort: "name",
    });

    expect(request).toMatchObject({
      direction: "desc",
      enabled: true,
      limit: 50,
      offset: 100,
      providerId: "provider-1",
      query: "embed",
      sort: "name",
    });
    expect(modelCatalogApiQuery(request)).toMatchObject({
      direction: "desc",
      enabled: "true",
      limit: 50,
      offset: 100,
      providerId: "provider-1",
      q: "embed",
      sort: "name",
    });
  });

  it("separates locale, resource purpose, and paginated request dimensions", () => {
    expect(appQueryKeys.routerSession("en")).not.toEqual(
      appQueryKeys.routerSession("fr"),
    );
    expect(appQueryKeys.shareTargets({ query: "collaboration" })).not.toEqual(
      appQueryKeys.shareTargets({ context: "collaboration" }),
    );
    expect(
      appQueryKeys.webhookDeliveries("webhook-1", {
        cursor: "cursor-a",
        pageSize: 25,
      }),
    ).not.toEqual(
      appQueryKeys.webhookDeliveries("webhook-1", {
        cursor: "cursor-b",
        pageSize: 25,
      }),
    );
  });
});
