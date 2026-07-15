import { asc, desc, eq } from "drizzle-orm";

import type { RomeoDatabase } from "./client";
import { toolConnectors, toolOperations } from "./schema";
import { toIsoString } from "./repository-mapping";

export type ToolConnectorTypeRecord =
  | "browser"
  | "built_in"
  | "enterprise"
  | "mcp"
  | "openapi"
  | "webhook";
export type ToolVisibilityRecord = "org" | "private" | "workspace";
export type ToolRiskLevelRecord = "critical" | "high" | "low" | "medium";
export type ToolApprovalPolicyRecord =
  | "admin_only"
  | "always"
  | "external_side_effects"
  | "never"
  | "write_operations";

export interface ToolNetworkPolicyRecord {
  mode: "allow_hosts" | "deny_all";
  allowedHosts: string[];
  allowPrivateNetwork: boolean;
}

export interface ToolConnectorRecord {
  id: string;
  orgId: string;
  type: ToolConnectorTypeRecord;
  name: string;
  description: string;
  schema: Record<string, unknown>;
  authConfig: Record<string, unknown>;
  networkPolicy: ToolNetworkPolicyRecord;
  riskLevel: ToolRiskLevelRecord;
  approvalPolicy: ToolApprovalPolicyRecord;
  visibility: ToolVisibilityRecord;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ToolOperationRecord {
  id: string;
  orgId: string;
  connectorId: string;
  operationId: string;
  method: string;
  path: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  riskLevel: ToolRiskLevelRecord;
  approvalPolicy: ToolApprovalPolicyRecord;
  enabled: boolean;
  createdAt: string;
}

export class PgToolConnectorRepository {
  constructor(private readonly db: RomeoDatabase) {}

  async listToolConnectors(orgId: string): Promise<ToolConnectorRecord[]> {
    const rows = await this.db
      .select()
      .from(toolConnectors)
      .where(eq(toolConnectors.orgId, orgId))
      .orderBy(desc(toolConnectors.updatedAt), asc(toolConnectors.id));
    return rows.map(toToolConnectorRecord);
  }

  async createToolConnector(
    connector: ToolConnectorRecord,
  ): Promise<ToolConnectorRecord> {
    const [row] = await this.db
      .insert(toolConnectors)
      .values(toToolConnectorInsert(connector))
      .returning();
    return row === undefined ? connector : toToolConnectorRecord(row);
  }

  async updateToolConnector(
    connector: ToolConnectorRecord,
  ): Promise<ToolConnectorRecord> {
    const [row] = await this.db
      .update(toolConnectors)
      .set({
        authConfig: connector.authConfig,
        description: connector.description,
        enabled: connector.enabled,
        name: connector.name,
        networkPolicy: connector.networkPolicy,
        riskLevel: connector.riskLevel,
        schema: connector.schema,
        type: connector.type,
        updatedAt: new Date(connector.updatedAt),
        visibility: connector.visibility,
        approvalPolicy: connector.approvalPolicy,
      })
      .where(eq(toolConnectors.id, connector.id))
      .returning();
    return row === undefined ? connector : toToolConnectorRecord(row);
  }

  async listToolOperations(
    connectorId: string,
  ): Promise<ToolOperationRecord[]> {
    const rows = await this.db
      .select()
      .from(toolOperations)
      .where(eq(toolOperations.connectorId, connectorId))
      .orderBy(asc(toolOperations.operationId));
    return rows.map(toToolOperationRecord);
  }

  async createToolOperations(
    operations: ToolOperationRecord[],
  ): Promise<ToolOperationRecord[]> {
    if (operations.length === 0) return [];
    const rows = await this.db
      .insert(toolOperations)
      .values(operations.map(toToolOperationInsert))
      .returning();
    return rows.map(toToolOperationRecord);
  }

  async updateToolOperation(
    operation: ToolOperationRecord,
  ): Promise<ToolOperationRecord> {
    const [row] = await this.db
      .update(toolOperations)
      .set({
        approvalPolicy: operation.approvalPolicy,
        description: operation.description,
        enabled: operation.enabled,
        inputSchema: operation.inputSchema,
        method: operation.method,
        name: operation.name,
        outputSchema: operation.outputSchema,
        path: operation.path,
        riskLevel: operation.riskLevel,
      })
      .where(eq(toolOperations.id, operation.id))
      .returning();
    return row === undefined ? operation : toToolOperationRecord(row);
  }
}

export function toToolConnectorRecord(
  row: typeof toolConnectors.$inferSelect,
): ToolConnectorRecord {
  return {
    id: row.id,
    orgId: row.orgId,
    type: asToolConnectorType(row.type),
    name: row.name,
    description: row.description,
    schema: asJsonRecord(row.schema),
    authConfig: asJsonRecord(row.authConfig),
    networkPolicy: asToolNetworkPolicy(row.networkPolicy),
    riskLevel: asToolRiskLevel(row.riskLevel),
    approvalPolicy: asToolApprovalPolicy(row.approvalPolicy),
    visibility: asToolVisibility(row.visibility),
    enabled: row.enabled,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
}

export function toToolOperationRecord(
  row: typeof toolOperations.$inferSelect,
): ToolOperationRecord {
  return {
    id: row.id,
    orgId: row.orgId,
    connectorId: row.connectorId,
    operationId: row.operationId,
    method: row.method,
    path: row.path,
    name: row.name,
    description: row.description,
    inputSchema: asJsonRecord(row.inputSchema),
    outputSchema: asJsonRecord(row.outputSchema),
    riskLevel: asToolRiskLevel(row.riskLevel),
    approvalPolicy: asToolApprovalPolicy(row.approvalPolicy),
    enabled: row.enabled,
    createdAt: toIsoString(row.createdAt),
  };
}

function toToolConnectorInsert(
  record: ToolConnectorRecord,
): typeof toolConnectors.$inferInsert {
  return {
    id: record.id,
    orgId: record.orgId,
    type: record.type,
    name: record.name,
    description: record.description,
    schema: record.schema,
    authConfig: record.authConfig,
    networkPolicy: record.networkPolicy,
    riskLevel: record.riskLevel,
    approvalPolicy: record.approvalPolicy,
    visibility: record.visibility,
    enabled: record.enabled,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
  };
}

function toToolOperationInsert(
  record: ToolOperationRecord,
): typeof toolOperations.$inferInsert {
  return {
    id: record.id,
    orgId: record.orgId,
    connectorId: record.connectorId,
    operationId: record.operationId,
    method: record.method,
    path: record.path,
    name: record.name,
    description: record.description,
    inputSchema: record.inputSchema,
    outputSchema: record.outputSchema,
    riskLevel: record.riskLevel,
    approvalPolicy: record.approvalPolicy,
    enabled: record.enabled,
    createdAt: new Date(record.createdAt),
  };
}

function asToolConnectorType(value: string): ToolConnectorTypeRecord {
  if (
    value === "browser" ||
    value === "built_in" ||
    value === "enterprise" ||
    value === "mcp" ||
    value === "openapi" ||
    value === "webhook"
  ) {
    return value;
  }
  return "openapi";
}

function asToolVisibility(value: string): ToolVisibilityRecord {
  if (value === "org" || value === "private" || value === "workspace")
    return value;
  return "private";
}

function asToolRiskLevel(value: string): ToolRiskLevelRecord {
  if (
    value === "critical" ||
    value === "high" ||
    value === "low" ||
    value === "medium"
  ) {
    return value;
  }
  return "high";
}

function asToolApprovalPolicy(value: string): ToolApprovalPolicyRecord {
  if (
    value === "admin_only" ||
    value === "always" ||
    value === "external_side_effects" ||
    value === "never" ||
    value === "write_operations"
  ) {
    return value;
  }
  return "always";
}

function asToolNetworkPolicy(value: unknown): ToolNetworkPolicyRecord {
  const input = asJsonRecord(value);
  return {
    mode: input.mode === "allow_hosts" ? "allow_hosts" : "deny_all",
    allowedHosts: Array.isArray(input.allowedHosts)
      ? input.allowedHosts.filter(
          (host): host is string => typeof host === "string",
        )
      : [],
    allowPrivateNetwork: input.allowPrivateNetwork === true,
  };
}

function asJsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return {};
  return value as Record<string, unknown>;
}
