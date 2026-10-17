import { describe, expect, it } from "vitest";

import { inventoriedTableResourceRegistry } from "./inventoried-table-resource-registry";
import type { InventoriedTableResourceFilter } from "./inventoried-table-resource-registry";
import type { InventoriedServerTableOptions } from "./inventoried-server-table";

const parentScope: InventoriedServerTableOptions<"agent_versions"> = {
  parentId: "agent-1",
};
const disabledParentScope: InventoriedServerTableOptions<"agent_versions"> = {
  enabled: false,
};
const workspaceScope: InventoriedServerTableOptions<"knowledge_bases"> = {
  workspaceId: "workspace-1",
};
const statusFilter: InventoriedTableResourceFilter<"background_jobs"> = {
  field: "status",
  operator: "eq",
  value: "running",
};
// @ts-expect-error Parent-scoped resources cannot query without a parent.
const missingParentScope: InventoriedServerTableOptions<"agent_versions"> = {};
const wrongWorkspaceScope: InventoriedServerTableOptions<"knowledge_bases"> = {
  // @ts-expect-error Workspace-scoped resources cannot query with a parent.
  parentId: "knowledge-base-1",
};
const unknownFilter: InventoriedTableResourceFilter<"background_jobs"> = {
  // @ts-expect-error Only registered filter fields are accepted.
  field: "type",
  operator: "eq",
};

void [
  disabledParentScope,
  missingParentScope,
  parentScope,
  statusFilter,
  unknownFilter,
  workspaceScope,
  wrongWorkspaceScope,
];

describe("inventoried table resource registry", () => {
  it("contains the complete typed client inventory", () => {
    expect(Object.keys(inventoriedTableResourceRegistry).sort()).toEqual([
      "agent_versions",
      "api_keys",
      "background_jobs",
      "device_tokens",
      "eval_suites",
      "governance_access_grants",
      "governance_export_packages",
      "groups",
      "knowledge_bases",
      "knowledge_sources",
      "managed_model_tools",
      "notification_deliveries",
      "notifications",
      "prompt_templates",
      "provider_models",
      "service_accounts",
      "support_access_requests",
      "support_sessions",
      "tool_connectors",
      "tool_operations",
      "tool_trace_calls",
      "usage_events",
      "user_sessions",
    ]);
  });

  it("maps every sortable UI column to a server-supported field", () => {
    for (const [resource, definition] of Object.entries(
      inventoriedTableResourceRegistry,
    )) {
      for (const field of Object.values(definition.sortFieldByColumnId)) {
        expect(
          definition.sortFields,
          `${resource} must allow mapped sort field ${field}`,
        ).toContain(field);
      }
    }
  });
});
