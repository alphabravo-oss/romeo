import { describe, expect, it } from "vitest";

import { inventoriedTableIndexInventory } from "./inventoried-table-indexes";

describe("inventoried table index inventory", () => {
  it("names tenant-sort indexes for every SQL-backed table-page resource", () => {
    expect(Object.keys(inventoriedTableIndexInventory).sort()).toEqual([
      "api_keys",
      "background_jobs",
      "groups",
      "notifications",
      "prompt_templates",
      "provider_models",
      "service_accounts",
      "sessions",
      "support_access_requests",
      "support_sessions",
      "tool_connectors",
    ]);
    expect(inventoriedTableIndexInventory.provider_models).toContain(
      "base_models_org_created_id_idx",
    );
    expect(inventoriedTableIndexInventory.support_access_requests).toEqual([
      "audit_logs_org_created_id_idx",
    ]);
  });
});
