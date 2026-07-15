import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { organizations } from "./tenancy";

export const toolConnectors = pgTable(
  "tool_connectors",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    type: text("type").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    schema: jsonb("schema").notNull(),
    authConfig: jsonb("auth_config").notNull(),
    networkPolicy: jsonb("network_policy").notNull(),
    riskLevel: text("risk_level").notNull(),
    approvalPolicy: text("approval_policy").notNull(),
    visibility: text("visibility").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    toolConnectorsOrgUpdatedIdx: index("tool_connectors_org_updated_idx").on(
      table.orgId,
      table.updatedAt,
    ),
    toolConnectorsOrgNameIdx: uniqueIndex("tool_connectors_org_name_idx").on(
      table.orgId,
      table.name,
    ),
  }),
);

export const toolOperations = pgTable(
  "tool_operations",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    connectorId: text("connector_id")
      .notNull()
      .references(() => toolConnectors.id),
    operationId: text("operation_id").notNull(),
    method: text("method").notNull(),
    path: text("path").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    inputSchema: jsonb("input_schema").notNull(),
    outputSchema: jsonb("output_schema").notNull(),
    riskLevel: text("risk_level").notNull(),
    approvalPolicy: text("approval_policy").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    toolOperationsConnectorIdx: index("tool_operations_connector_idx").on(
      table.connectorId,
      table.operationId,
    ),
    toolOperationsConnectorOperationIdx: uniqueIndex(
      "tool_operations_connector_operation_idx",
    ).on(table.connectorId, table.operationId),
  }),
);
