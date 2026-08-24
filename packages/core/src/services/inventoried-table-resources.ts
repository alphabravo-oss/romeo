import type { AuthSubject, Scope } from "@romeo/auth";

import type { RomeoRepository } from "../domain/repository";
import { decorateCatalogModels } from "./catalog-model-decorator";
import type {
  InventoriedTablePolicy,
  InventoriedTableRow,
} from "./inventoried-table-page";

export interface InventoriedTableLoadInput {
  parentId?: string;
  repository: RomeoRepository;
  subject: AuthSubject;
  workspaceId?: string;
}

export interface InventoriedTableResource {
  id: string;
  load?: (input: InventoriedTableLoadInput) => Promise<InventoriedTableRow[]>;
  nativePagination?: true;
  policy: InventoriedTablePolicy;
  requiredRowKeys: readonly string[];
  requiresParent?: boolean;
  requiresWorkspace?: boolean;
  scope: Scope;
  summarize?: (rows: readonly InventoriedTableRow[]) => Record<string, number>;
}

const defaultPolicy: InventoriedTablePolicy = {
  defaultSort: { direction: "desc", field: "createdAt" },
  filters: { status: ["eq", "neq"] },
  searchFields: ["name", "id"],
  sortFields: ["createdAt", "name", "id"],
};

const namePolicy: InventoriedTablePolicy = {
  defaultSort: { direction: "asc", field: "name" },
  filters: { status: ["eq", "neq"] },
  searchFields: ["name", "id", "slug"],
  sortFields: ["name", "id", "slug"],
};

export const inventoriedTableResources: Record<
  string,
  InventoriedTableResource
> = {
  agent_versions: defineResource("agent_versions", "agents:read", {
    requiresParent: true,
    policy: {
      ...defaultPolicy,
      searchFields: ["id", "label"],
      sortFields: ["createdAt", "id"],
    },
    load: async ({ parentId, repository }) =>
      parentId === undefined
        ? []
        : publicRows(await repository.listAgentVersions(parentId)),
  }),
  api_keys: defineResource("api_keys", "admin:read", {
    summarize: (rows) => ({
      revokedTotal: rows.filter((row) => row.revokedAt !== undefined).length,
      total: rows.length,
    }),
    load: async ({ repository, subject }) =>
      publicRows(await repository.listApiKeys(subject.orgId)),
  }),
  background_jobs: defineResource("background_jobs", "admin:read", {
    nativePagination: true,
    policy: {
      ...defaultPolicy,
      searchFields: ["id", "type", "status"],
      sortFields: ["createdAt", "id", "status", "type"],
    },
  }),
  data_connector_sync_runs: defineResource(
    "data_connector_sync_runs",
    "admin:read",
    {
      requiresParent: true,
      nativePagination: true,
      policy: {
        defaultSort: { direction: "desc", field: "startedAt" },
        filters: { status: ["eq", "neq"] },
        searchFields: ["id", "status"],
        sortFields: ["startedAt", "id", "status"],
      },
    },
  ),
  data_connectors: defineResource("data_connectors", "admin:read", {
    summarize: (rows) => ({
      activeTotal: rows.filter((row) => row.status === "active").length,
      total: rows.length,
    }),
    requiresWorkspace: true,
    load: async ({ repository, subject, workspaceId }) =>
      publicRows(
        await repository.listDataConnectors(subject.orgId, workspaceId),
      ),
  }),
  device_tokens: defineResource("device_tokens", "me:read", {
    load: async ({ repository, subject }) =>
      subject.type === "user"
        ? publicRows(
            await repository.listDeviceAuthorizations(
              subject.orgId,
              subject.id,
            ),
          )
        : [],
  }),
  eval_suites: defineResource("eval_suites", "agents:read", {
    requiresParent: true,
    load: async ({ parentId, repository }) =>
      parentId === undefined
        ? []
        : publicRows(await repository.listEvalSuites(parentId)),
  }),
  governance_access_grants: defineResource(
    "governance_access_grants",
    "admin:read",
    {
      policy: {
        defaultSort: { direction: "asc", field: "resourceType" },
        filters: {},
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
      },
      load: async ({ repository, subject }) =>
        publicRows(await repository.listResourceGrants(subject.orgId)),
    },
  ),
  governance_export_packages: defineResource(
    "governance_export_packages",
    "admin:read",
    {
      nativePagination: true,
      requiredRowKeys: ["id", "packageId", "createdAt"],
      policy: {
        defaultSort: { direction: "desc", field: "createdAt" },
        filters: { state: ["eq", "neq"] },
        searchFields: ["id", "packageId"],
        sortFields: ["createdAt", "id", "packageId", "state"],
      },
    },
  ),
  groups: defineResource("groups", "admin:read", {
    policy: namePolicy,
    load: async ({ repository, subject }) =>
      publicRows(await repository.listGroups(subject.orgId)),
  }),
  knowledge_bases: defineResource("knowledge_bases", "knowledge:read", {
    requiresWorkspace: true,
    load: async ({ repository, workspaceId }) =>
      workspaceId === undefined
        ? []
        : publicRows(await repository.listKnowledgeBases(workspaceId)),
  }),
  knowledge_sources: defineResource("knowledge_sources", "knowledge:read", {
    requiresParent: true,
    load: async ({ parentId, repository }) =>
      parentId === undefined
        ? []
        : publicRows(await repository.listKnowledgeSources(parentId)),
  }),
  managed_model_tools: defineResource("managed_model_tools", "agents:read", {
    requiresParent: true,
    load: async ({ parentId, repository }) =>
      parentId === undefined
        ? []
        : publicRows(await repository.listAgentToolBindings(parentId)),
  }),
  notification_deliveries: defineResource(
    "notification_deliveries",
    "me:read",
    {
      nativePagination: true,
      policy: {
        defaultSort: { direction: "desc", field: "createdAt" },
        filters: { status: ["eq", "neq"] },
        searchFields: ["id", "status", "errorCode"],
        sortFields: ["createdAt", "id", "status"],
      },
    },
  ),
  notifications: defineResource("notifications", "me:read", {
    nativePagination: true,
    summarize: (rows) => ({
      total: rows.length,
      unreadTotal: rows.filter(
        (row) => row.readAt === undefined || row.readAt === null,
      ).length,
    }),
    policy: {
      defaultSort: { direction: "desc", field: "createdAt" },
      filters: {},
      searchFields: ["id", "type", "resourceId"],
      sortFields: ["createdAt", "id", "type"],
    },
  }),
  prompt_templates: defineResource("prompt_templates", "agents:read", {
    summarize: (rows) => ({
      marketplaceTotal: rows.filter((row) => row.visibility === "marketplace")
        .length,
      total: rows.length,
    }),
    requiresWorkspace: true,
    load: async ({ repository, subject, workspaceId }) =>
      publicRows(
        await repository.listPromptTemplates(subject.orgId, workspaceId),
      ),
  }),
  provider_models: defineResource("provider_models", "admin:read", {
    requiresParent: true,
    policy: namePolicy,
    load: async ({ parentId, repository, subject }) => {
      if (parentId === undefined) return [];
      const provider = await repository.getProvider(parentId);
      if (provider?.orgId !== subject.orgId) return [];
      return publicRows(
        await decorateCatalogModels(
          repository,
          subject.orgId,
          (await repository.listModels(subject.orgId)).filter(
            (model) => model.providerId === parentId,
          ),
        ),
      );
    },
  }),
  service_accounts: defineResource("service_accounts", "admin:read", {
    summarize: (rows) => ({
      disabledTotal: rows.filter((row) => row.disabledAt !== undefined).length,
      total: rows.length,
    }),
    load: async ({ repository, subject }) =>
      publicRows(await repository.listServiceAccounts(subject.orgId)),
  }),
  support_access_requests: defineResource(
    "support_access_requests",
    "admin:read",
    {
      nativePagination: true,
      policy: {
        defaultSort: { direction: "desc", field: "createdAt" },
        filters: { status: ["eq", "neq"] },
        searchFields: ["id", "targetUserId", "requestedByUserId"],
        sortFields: ["createdAt", "id", "status", "targetUserId"],
      },
      requiredRowKeys: ["id", "targetUserId", "ttlMinutes", "status"],
    },
  ),
  support_sessions: defineResource("support_sessions", "admin:read", {
    nativePagination: true,
    requiredRowKeys: ["id", "targetUserId", "session", "status"],
    policy: {
      defaultSort: { direction: "desc", field: "createdAt" },
      filters: { status: ["eq", "neq"] },
      searchFields: ["id", "targetUserId", "adminUserId"],
      sortFields: ["createdAt", "id", "status", "targetUserId"],
    },
  }),
  tool_connectors: defineResource("tool_connectors", "tools:manage", {
    summarize: (rows) => ({
      enabledTotal: rows.filter((row) => row.enabled === true).length,
      total: rows.length,
    }),
    policy: namePolicy,
    load: async ({ repository, subject }) =>
      publicRows(await repository.listToolConnectors(subject.orgId)),
  }),
  tool_operations: defineResource("tool_operations", "tools:manage", {
    requiresParent: true,
    policy: namePolicy,
    load: async ({ parentId, repository }) =>
      parentId === undefined
        ? []
        : publicRows(await repository.listToolOperations(parentId)),
  }),
  tool_trace_calls: defineResource("tool_trace_calls", "tools:use", {
    nativePagination: true,
    requiresParent: true,
    policy: {
      defaultSort: { direction: "desc", field: "startedAt" },
      filters: { status: ["eq", "neq"] },
      searchFields: ["id", "toolId", "runId", "errorCode"],
      sortFields: ["startedAt", "completedAt", "id", "status", "toolId"],
    },
  }),
  usage_events: defineResource("usage_events", "usage:read", {
    nativePagination: true,
    policy: {
      ...defaultPolicy,
      filters: {
        createdAt: ["gte", "lt"],
      },
      searchFields: ["id", "metric"],
      sortFields: ["createdAt", "id", "metric"],
    },
  }),
  user_sessions: defineResource("user_sessions", "me:read", {
    load: async ({ repository, subject }) =>
      subject.type === "user"
        ? publicRows(
            await repository.listUserSessions(subject.orgId, subject.id),
          )
        : [],
  }),
};

export function inventoriedTableResource(
  id: string,
): InventoriedTableResource | undefined {
  return inventoriedTableResources[id];
}

function defineResource(
  id: string,
  scope: Scope,
  extras: Omit<
    InventoriedTableResource,
    "id" | "policy" | "requiredRowKeys" | "scope"
  > &
    Partial<Pick<InventoriedTableResource, "policy" | "requiredRowKeys">>,
): InventoriedTableResource {
  return {
    id,
    scope,
    policy: extras.policy ?? defaultPolicy,
    requiredRowKeys: extras.requiredRowKeys ?? ["id"],
    ...(extras.load === undefined ? {} : { load: extras.load }),
    ...(extras.requiresParent === undefined
      ? {}
      : { requiresParent: extras.requiresParent }),
    ...(extras.requiresWorkspace === undefined
      ? {}
      : { requiresWorkspace: extras.requiresWorkspace }),
    ...(extras.summarize === undefined ? {} : { summarize: extras.summarize }),
    ...(extras.nativePagination === undefined
      ? {}
      : { nativePagination: extras.nativePagination }),
  };
}

const secretKeys = new Set([
  "hashedToken",
  "hashedRefreshToken",
  "signingSecret",
  "clientSecret",
  "privateKey",
]);

export function publicRows(values: readonly object[]): InventoriedTableRow[] {
  return values.flatMap((value) => {
    const row = Object.fromEntries(
      Object.entries(value).filter(([key]) => !secretKeys.has(key)),
    );
    return typeof row.id === "string" ? [row as InventoriedTableRow] : [];
  });
}
