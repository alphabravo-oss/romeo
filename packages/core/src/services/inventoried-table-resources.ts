import type { AuthSubject, Scope } from "@romeo/auth";

import type { RomeoRepository } from "../domain/repository";
import { decorateCatalogModels } from "./catalog-model-decorator";
import { listGovernedDataExportPackages } from "./data-export-package";
import type {
  InventoriedTablePolicy,
  InventoriedTableRow,
} from "./inventoried-table-page";
import {
  supportRequestReports,
  toSupportSessionReport,
} from "./support-session-reporting";

export interface InventoriedTableLoadInput {
  parentId?: string;
  repository: RomeoRepository;
  subject: AuthSubject;
  workspaceId?: string;
}

export interface InventoriedTableResource {
  id: string;
  load: (input: InventoriedTableLoadInput) => Promise<InventoriedTableRow[]>;
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
    policy: {
      ...defaultPolicy,
      searchFields: ["id", "type", "status"],
      sortFields: ["createdAt", "id", "status", "type"],
    },
    load: async ({ repository, subject }) =>
      publicRows(await repository.listBackgroundJobs(subject.orgId)),
  }),
  data_connector_sync_runs: defineResource(
    "data_connector_sync_runs",
    "admin:read",
    {
      policy: {
        ...defaultPolicy,
        searchFields: ["id", "status"],
        sortFields: ["createdAt", "id", "status"],
      },
      load: async ({ parentId, repository, subject }) =>
        publicRows(
          await repository.listDataConnectorSyncs(subject.orgId, parentId),
        ),
    },
  ),
  data_connectors: defineResource("data_connectors", "admin:read", {
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
      load: async ({ repository, subject }) =>
        publicRows(await repository.listResourceGrants(subject.orgId)),
    },
  ),
  governance_export_packages: defineResource(
    "governance_export_packages",
    "admin:read",
    {
      requiredRowKeys: ["id", "packageId", "createdAt"],
      load: async ({ repository, subject }) => {
        const listed = await listGovernedDataExportPackages({
          orgId: subject.orgId,
          repository,
        });
        return publicRows(
          listed.packages.map((item) => ({ ...item, id: item.packageId })),
        );
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
      load: async ({ repository, subject }) =>
        subject.type === "user"
          ? publicRows(
              await repository.listNotificationDeliveries(
                subject.orgId,
                subject.id,
              ),
            )
          : [],
    },
  ),
  notifications: defineResource("notifications", "me:read", {
    load: async ({ repository, subject }) =>
      subject.type === "user"
        ? publicRows(
            await repository.listUserNotifications(subject.orgId, subject.id),
          )
        : [],
  }),
  prompt_templates: defineResource("prompt_templates", "agents:read", {
    requiresWorkspace: true,
    load: async ({ repository, subject, workspaceId }) =>
      publicRows(
        await repository.listPromptTemplates(subject.orgId, workspaceId),
      ),
  }),
  provider_models: defineResource("provider_models", "admin:read", {
    policy: namePolicy,
    load: async ({ repository, subject }) =>
      publicRows(
        await decorateCatalogModels(
          repository,
          subject.orgId,
          await repository.listModels(subject.orgId),
        ),
      ),
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
      requiredRowKeys: ["id", "targetUserId", "ttlMinutes", "status"],
      load: async ({ repository, subject }) =>
        publicRows(
          supportRequestReports(await repository.listAuditLogs(subject.orgId)),
        ),
    },
  ),
  support_sessions: defineResource("support_sessions", "admin:read", {
    requiredRowKeys: ["id", "targetUserId", "session", "status"],
    policy: {
      ...defaultPolicy,
      searchFields: ["id", "targetUserId", "adminUserId"],
    },
    load: async ({ repository, subject }) => {
      const reports = [];
      for (const log of await repository.listAuditLogs(subject.orgId)) {
        if (
          log.action !== "support.impersonation.create" ||
          log.resourceType !== "session"
        )
          continue;
        const session = await repository.getUserSession(log.resourceId);
        if (!session || session.orgId !== subject.orgId) continue;
        reports.push({
          id: session.id,
          ...toSupportSessionReport(session, log),
        });
      }
      return publicRows(reports);
    },
  }),
  tool_connectors: defineResource("tool_connectors", "tools:manage", {
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
    load: async ({ repository, subject }) =>
      publicRows(await repository.listToolCalls(subject.orgId)),
  }),
  usage_events: defineResource("usage_events", "usage:read", {
    policy: {
      ...defaultPolicy,
      searchFields: ["id", "metric"],
      sortFields: ["createdAt", "id", "metric"],
    },
    load: async ({ repository, subject }) =>
      publicRows(await repository.listUsageEvents(subject.orgId)),
  }),
  user_sessions: defineResource("user_sessions", "me:read", {
    load: async ({ repository, subject }) =>
      subject.type === "user"
        ? publicRows(
            await repository.listUserSessions(subject.orgId, subject.id),
          )
        : [],
  }),
  workflows: defineResource("workflows", "agents:read", {
    requiresWorkspace: true,
    load: async ({ repository, subject, workspaceId }) =>
      publicRows(
        await repository.listWorkflowDefinitions(subject.orgId, workspaceId),
      ),
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
    load: extras.load,
    ...(extras.requiresParent === undefined
      ? {}
      : { requiresParent: extras.requiresParent }),
    ...(extras.requiresWorkspace === undefined
      ? {}
      : { requiresWorkspace: extras.requiresWorkspace }),
    ...(extras.summarize === undefined ? {} : { summarize: extras.summarize }),
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
