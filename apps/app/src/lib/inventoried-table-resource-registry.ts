import type {
  ApiKeySummary,
  BackgroundJob,
  DataExportPackageList,
  DeviceAuthorization,
  EvalSuite,
  Group,
  KnowledgeBase,
  KnowledgeSource,
  ManagedModelVersion,
  NotificationDelivery,
  PromptTemplate,
  ProviderModel,
  ResourceGrant,
  ServiceAccount,
  SupportSessionReport,
  SupportSessionRequestReport,
  ToolCallRecord,
  ToolConnector,
  ToolOperation,
  UsageEvent,
  UserNotification,
  UserSession,
} from "@romeo/api-client/generated/sdk";
import { rowShape } from "./inventoried-table-row-parser";

type DataExportPackageRow = DataExportPackageList["jobs"][number] & {
  id: string;
};

interface ManagedModelToolRow {
  id: string;
  approvalRequired?: boolean;
  enabled?: boolean;
  toolId?: string;
}

export interface InventoriedTableResourceRows {
  agent_versions: ManagedModelVersion;
  api_keys: ApiKeySummary;
  background_jobs: BackgroundJob;
  device_tokens: DeviceAuthorization;
  eval_suites: EvalSuite;
  governance_access_grants: ResourceGrant;
  governance_export_packages: DataExportPackageRow;
  groups: Group;
  knowledge_bases: KnowledgeBase;
  knowledge_sources: KnowledgeSource;
  managed_model_tools: ManagedModelToolRow;
  notification_deliveries: NotificationDelivery;
  notifications: UserNotification;
  prompt_templates: PromptTemplate;
  provider_models: ProviderModel;
  service_accounts: ServiceAccount;
  support_access_requests: SupportSessionRequestReport;
  support_sessions: SupportSessionReport & { id: string };
  tool_connectors: ToolConnector;
  tool_operations: ToolOperation;
  tool_trace_calls: ToolCallRecord;
  usage_events: UsageEvent;
  user_sessions: UserSession;
}

export type InventoriedTableResourceName = keyof InventoriedTableResourceRows;
export type InventoriedTableResourceRow<
  Resource extends InventoriedTableResourceName,
> = InventoriedTableResourceRows[Resource];

export type InventoriedTableScope = "organization" | "parent" | "workspace";
export type InventoriedTableFilterOperator = "eq" | "gte" | "lt" | "neq";

type FilterPolicy = Readonly<
  Record<string, readonly InventoriedTableFilterOperator[]>
>;

export interface InventoriedTableResourceDefinition<
  Row extends { id: string } = { id: string },
  Scope extends InventoriedTableScope = InventoriedTableScope,
  SortField extends string = string,
  Filters extends FilterPolicy = FilterPolicy,
> {
  capabilities: {
    export: boolean;
    savedViews: boolean;
  };
  filters: Filters;
  parseRow: (value: unknown) => Row;
  parentIdentityField?: keyof Row & string;
  scope: Scope;
  searchFields: readonly string[];
  sortFieldByColumnId: Readonly<Record<string, SortField>>;
  sortFields: readonly SortField[];
  summaryKeys: readonly string[];
}

const defaultFilters = {
  status: ["eq", "neq"],
} as const satisfies FilterPolicy;
const defaultSortFields = ["createdAt", "name", "id"] as const;
const nameSortFields = ["name", "id", "slug"] as const;

function defineResource<
  Row extends { id: string },
  const Scope extends InventoriedTableScope,
  const SortFields extends readonly string[],
  const Filters extends FilterPolicy = typeof defaultFilters,
>(input: {
  capabilities?: Partial<InventoriedTableResourceDefinition["capabilities"]>;
  filters?: Filters;
  parentIdentityField?: keyof Row & string;
  parseRow: (value: unknown) => Row;
  scope: Scope;
  searchFields?: readonly string[];
  sortFieldByColumnId?: Readonly<Record<string, SortFields[number]>>;
  sortFields: SortFields;
  summaryKeys?: readonly string[];
}): InventoriedTableResourceDefinition<
  Row,
  Scope,
  SortFields[number],
  Filters
> {
  return {
    capabilities: {
      export: input.capabilities?.export ?? true,
      savedViews: input.capabilities?.savedViews ?? true,
    },
    filters: input.filters ?? (defaultFilters as unknown as Filters),
    ...(input.parentIdentityField === undefined
      ? {}
      : { parentIdentityField: input.parentIdentityField }),
    parseRow: input.parseRow,
    scope: input.scope,
    searchFields: input.searchFields ?? ["name", "id"],
    sortFieldByColumnId:
      input.sortFieldByColumnId ?? identitySortFields(input.sortFields),
    sortFields: input.sortFields,
    summaryKeys: input.summaryKeys ?? [],
  };
}

function identitySortFields<SortField extends string>(
  fields: readonly SortField[],
): Readonly<Record<string, SortField>> {
  return Object.fromEntries(fields.map((field) => [field, field])) as Record<
    string,
    SortField
  >;
}

export const inventoriedTableResourceRegistry = {
  agent_versions: defineResource({
    parentIdentityField: "agentId",
    parseRow: rowShape<ManagedModelVersion>({
      agentId: "string",
      createdAt: "string",
      version: "number",
    }),
    scope: "parent",
    searchFields: ["id", "label"],
    sortFields: ["createdAt", "id"],
  }),
  api_keys: defineResource({
    parseRow: rowShape<ApiKeySummary>({
      createdAt: "string",
      name: "string",
      scopes: "array",
    }),
    scope: "organization",
    sortFields: defaultSortFields,
    summaryKeys: ["revokedTotal", "total"],
  }),
  background_jobs: defineResource({
    parseRow: rowShape<BackgroundJob>({
      createdAt: "string",
      status: "string",
      type: "string",
    }),
    scope: "organization",
    searchFields: ["id", "type", "status"],
    sortFields: ["createdAt", "id", "status", "type"],
  }),
  device_tokens: defineResource({
    parseRow: rowShape<DeviceAuthorization>({
      createdAt: "string",
      name: "string",
      scopes: "array",
    }),
    scope: "organization",
    sortFields: defaultSortFields,
  }),
  eval_suites: defineResource({
    parentIdentityField: "agentId",
    parseRow: rowShape<EvalSuite>({
      agentId: "string",
      name: "string",
      updatedAt: "string",
    }),
    scope: "parent",
    sortFields: defaultSortFields,
  }),
  governance_access_grants: defineResource({
    parseRow: rowShape<ResourceGrant>({
      permission: "string",
      principalId: "string",
      resourceId: "string",
      resourceType: "string",
    }),
    scope: "organization",
    searchFields: [
      "id",
      "permission",
      "principalId",
      "principalType",
      "resourceId",
      "resourceType",
    ],
    sortFields: [
      "id",
      "permission",
      "principalId",
      "principalType",
      "resourceId",
      "resourceType",
    ],
  }),
  governance_export_packages: defineResource({
    parseRow: rowShape<DataExportPackageRow>({
      createdAt: "string",
      packageId: "string",
      percent: "number",
      request: "object",
      state: "string",
    }),
    filters: { state: ["eq", "neq"] },
    scope: "organization",
    searchFields: ["id", "packageId"],
    sortFields: ["createdAt", "id", "packageId", "state"],
    summaryKeys: [
      "orgScopeTotal",
      "total",
      "withContentTotal",
      "workspaceScopeTotal",
    ],
  }),
  groups: defineResource({
    parseRow: rowShape<Group>({
      createdAt: "string",
      name: "string",
      slug: "string",
    }),
    scope: "organization",
    searchFields: ["name", "id", "slug"],
    sortFields: nameSortFields,
  }),
  knowledge_bases: defineResource({
    parseRow: rowShape<KnowledgeBase>({
      name: "string",
      updatedAt: "string",
      workspaceId: "string",
    }),
    scope: "workspace",
    sortFields: defaultSortFields,
  }),
  knowledge_sources: defineResource({
    parentIdentityField: "knowledgeBaseId",
    parseRow: rowShape<KnowledgeSource>({
      fileName: "string",
      knowledgeBaseId: "string",
      status: "string",
    }),
    scope: "parent",
    sortFields: defaultSortFields,
  }),
  managed_model_tools: defineResource({
    parseRow: rowShape<ManagedModelToolRow>({}),
    scope: "parent",
    sortFields: defaultSortFields,
  }),
  notification_deliveries: defineResource({
    filters: { status: ["eq", "neq"] },
    parseRow: rowShape<NotificationDelivery>({
      attemptCount: "number",
      createdAt: "string",
      status: "string",
    }),
    scope: "organization",
    searchFields: ["id", "status", "errorCode"],
    sortFields: ["createdAt", "id", "status"],
  }),
  notifications: defineResource({
    filters: {},
    parseRow: rowShape<UserNotification>({
      createdAt: "string",
      resourceId: "string",
      type: "string",
    }),
    scope: "organization",
    searchFields: ["id", "type", "resourceId"],
    sortFields: ["createdAt", "id", "type"],
    summaryKeys: ["total", "unreadTotal"],
  }),
  prompt_templates: defineResource({
    parseRow: rowShape<PromptTemplate>({
      body: "string",
      name: "string",
      visibility: "string",
      workspaceId: "string",
    }),
    scope: "workspace",
    sortFields: defaultSortFields,
    summaryKeys: ["marketplaceTotal", "total"],
  }),
  provider_models: defineResource({
    parentIdentityField: "providerId",
    parseRow: rowShape<ProviderModel>({
      capabilities: "object",
      contextWindow: "number",
      displayName: "string",
      enabled: "boolean",
      name: "string",
      providerId: "string",
    }),
    scope: "parent",
    searchFields: ["name", "id", "slug"],
    sortFields: nameSortFields,
  }),
  service_accounts: defineResource({
    parseRow: rowShape<ServiceAccount>({
      createdAt: "string",
      name: "string",
      scopes: "array",
    }),
    scope: "organization",
    sortFields: defaultSortFields,
    summaryKeys: ["disabledTotal", "total"],
  }),
  support_access_requests: defineResource({
    parseRow: rowShape<SupportSessionRequestReport>({
      status: "string",
      targetUserId: "string",
      ttlMinutes: "number",
    }),
    scope: "organization",
    searchFields: ["id", "targetUserId", "requestedByUserId"],
    sortFields: ["createdAt", "id", "status", "targetUserId"],
  }),
  support_sessions: defineResource({
    parseRow: rowShape<SupportSessionReport & { id: string }>({
      adminUserId: "string",
      session: "object",
      status: "string",
      targetUserId: "string",
    }),
    scope: "organization",
    searchFields: ["id", "targetUserId", "adminUserId"],
    sortFields: ["createdAt", "id", "status", "targetUserId"],
  }),
  tool_connectors: defineResource({
    parseRow: rowShape<ToolConnector>({
      enabled: "boolean",
      name: "string",
      type: "string",
    }),
    scope: "organization",
    searchFields: ["name", "id", "slug"],
    sortFields: nameSortFields,
    summaryKeys: ["enabledTotal", "total"],
  }),
  tool_operations: defineResource({
    parentIdentityField: "connectorId",
    parseRow: rowShape<ToolOperation>({
      connectorId: "string",
      enabled: "boolean",
      name: "string",
      operationId: "string",
    }),
    scope: "parent",
    searchFields: ["name", "id", "slug"],
    sortFields: nameSortFields,
  }),
  tool_trace_calls: defineResource({
    parentIdentityField: "agentId",
    parseRow: rowShape<ToolCallRecord>({
      agentId: "string",
      completedAt: "string",
      startedAt: "string",
      status: "string",
      toolId: "string",
    }),
    scope: "parent",
    searchFields: ["id", "toolId", "runId", "errorCode"],
    sortFields: ["startedAt", "completedAt", "id", "status", "toolId"],
  }),
  usage_events: defineResource({
    filters: {
      createdAt: ["gte", "lt"],
    },
    parseRow: rowShape<UsageEvent>({
      createdAt: "string",
      metric: "string",
      quantity: "number",
    }),
    scope: "organization",
    searchFields: ["id", "metric"],
    sortFields: ["createdAt", "id", "metric"],
  }),
  user_sessions: defineResource({
    parseRow: rowShape<UserSession>({
      createdAt: "string",
      expiresAt: "string",
      name: "string",
    }),
    scope: "organization",
    sortFields: defaultSortFields,
  }),
} as const;

export type InventoriedTableResourceRegistry =
  typeof inventoriedTableResourceRegistry;

export type InventoriedTableResourceFilter<
  Resource extends InventoriedTableResourceName,
> = {
  field: string;
  operator: string;
  value?: unknown;
} & FilterFromPolicy<InventoriedTableResourceRegistry[Resource]["filters"]>;

export type InventoriedTableResourceSortField<
  Resource extends InventoriedTableResourceName,
> = InventoriedTableResourceRegistry[Resource]["sortFields"][number];

type FilterFromPolicy<Policy extends FilterPolicy> = {
  [Field in keyof Policy & string]: {
    field: Field;
    operator: Policy[Field][number] & string;
    value?: unknown;
  };
}[keyof Policy & string];

export function tableResourceDefinition<
  Resource extends InventoriedTableResourceName,
>(resource: Resource): InventoriedTableResourceRegistry[Resource] {
  return inventoriedTableResourceRegistry[resource];
}

export function parseInventoriedTableResourceRow<
  Resource extends InventoriedTableResourceName,
>(resource: Resource, value: unknown): InventoriedTableResourceRow<Resource> {
  try {
    return inventoriedTableResourceRegistry[resource].parseRow(
      value,
    ) as InventoriedTableResourceRow<Resource>;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "invalid row";
    throw new InventoriedTableContractError(resource, `Invalid row: ${reason}`);
  }
}

export class InventoriedTableContractError extends Error {
  readonly resource: InventoriedTableResourceName;

  constructor(resource: InventoriedTableResourceName, message: string) {
    super(message);
    this.name = "InventoriedTableContractError";
    this.resource = resource;
  }
}
