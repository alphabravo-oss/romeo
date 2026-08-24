import { describe, expect, it } from "vitest";

import * as appQueryKeys from "./app-query-keys";
import { invalidateInventoriedTablePages } from "./inventoried-table-cache";
import { createRomeoQueryClient } from "./query-client";

describe("invalidateInventoriedTablePages", () => {
  it("invalidates every scoped variant without touching another parent or resource", async () => {
    const client = createRomeoQueryClient();
    const affected = [
      tableKey("provider_models", "provider-a"),
      appQueryKeys.tablePages({
        filters: [],
        limit: 50,
        parentId: "provider-a",
        resource: "provider_models",
        search: "llama",
        sort: [{ direction: "asc", field: "name" }],
      }),
    ];
    const unaffected = [
      tableKey("provider_models", "provider-b"),
      tableKey("eval_suites", "provider-a"),
    ];
    for (const key of [...affected, ...unaffected])
      client.setQueryData(key, { items: [] });

    await invalidateInventoriedTablePages(client, {
      parentId: "provider-a",
      resource: "provider_models",
    });

    for (const key of affected)
      expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    for (const key of unaffected)
      expect(client.getQueryState(key)?.isInvalidated).toBe(false);
  });
});

function tableKey(
  resource: "eval_suites" | "provider_models",
  parentId: string,
) {
  return appQueryKeys.tablePages({
    filters: [],
    limit: 25,
    parentId,
    resource,
    sort: [],
  });
}
