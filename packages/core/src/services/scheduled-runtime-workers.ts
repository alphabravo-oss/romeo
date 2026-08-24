import type { RomeoEnv } from "@romeo/config";

import type { RomeoRepository } from "../domain/repository";
import type { RepositoryRequestScope } from "../domain/repository-request-scope";
import type { RomeoServices } from "./service-registry-types";
import {
  type ScheduledTenantOperation,
  TenantScheduledWorkCoordinator,
} from "./tenant-scheduled-work-coordinator";

type ServiceFactory = (repository: RomeoRepository) => RomeoServices;

export function createScheduledRuntimeWorkers(input: {
  createServices: ServiceFactory;
  env: RomeoEnv;
  scope: RepositoryRequestScope;
}): TenantScheduledWorkCoordinator {
  return new TenantScheduledWorkCoordinator(
    input.scope,
    scheduledOperations(input.createServices, input.env),
    { maxTenantsPerRun: 100, tenantConcurrency: 4 },
  );
}

function scheduledOperations(
  createServices: ServiceFactory,
  env: RomeoEnv,
): ScheduledTenantOperation[] {
  const operation = (
    definition: Omit<ScheduledTenantOperation, "run"> & {
      run: (
        services: RomeoServices,
        input: Parameters<ScheduledTenantOperation["run"]>[0],
      ) => Promise<unknown>;
    },
  ): ScheduledTenantOperation => ({
    intervalMs: definition.intervalMs,
    name: definition.name,
    scopes: definition.scopes,
    run: (runInput) =>
      definition.run(createServices(runInput.repository), runInput),
  });
  const operations: ScheduledTenantOperation[] = [
    operation({
      intervalMs: 1_000,
      name: "governance_export",
      scopes: ["admin:read", "workspaces:read"],
      run: (services, runInput) =>
        services.governanceExports.runNext({
          subject: runInput.subject,
          workerId: `scheduled_governance_export_${runInput.subject.orgId}`,
          ...(runInput.signal === undefined ? {} : { signal: runInput.signal }),
        }),
    }),
    operation({
      intervalMs: 1_000,
      name: "table_export",
      scopes: ["admin:read", "workspaces:read"],
      run: (services, runInput) =>
        services.tableExports.runNext({
          subject: runInput.subject,
          workerId: `scheduled_table_export_${runInput.subject.orgId}`,
          ...(runInput.signal === undefined ? {} : { signal: runInput.signal }),
        }),
    }),
    operation({
      intervalMs: 1_000,
      name: "file_lifecycle",
      scopes: ["files:read", "files:write"],
      run: (services, runInput) =>
        services.files.processLifecycleJob({
          workerId: `scheduled_file_lifecycle_${runInput.subject.orgId}`,
          ...(runInput.signal === undefined ? {} : { signal: runInput.signal }),
        }),
    }),
    operation({
      intervalMs: 1_000,
      name: "content_deletion",
      scopes: [
        "admin:write",
        "files:read",
        "files:write",
        "knowledge:read",
        "knowledge:write",
      ],
      run: (services, runInput) =>
        services.knowledge.processContentDeletionJob({
          subject: runInput.subject,
          workerId: `scheduled_content_deletion_${runInput.subject.orgId}`,
          ...(runInput.signal === undefined ? {} : { signal: runInput.signal }),
        }),
    }),
    operation({
      intervalMs: env.TEMPORARY_CHAT_CLEANUP_INTERVAL_MS,
      name: "temporary_chat_cleanup",
      scopes: ["admin:write", "chats:read", "chats:write"],
      run: (services, runInput) =>
        services.temporaryChatCleanup.runTenantOnce(runInput.subject.orgId),
    }),
    operation({
      intervalMs: 1_000,
      name: "run_terminal_outbox",
      scopes: ["admin:write", "runs:read"],
      run: (services, runInput) =>
        services.runs.runTerminalOutboxForOrg(
          runInput.subject.orgId,
          runInput.signal,
        ),
    }),
    operation({
      intervalMs: env.MODEL_CATALOG_SYNC_INTERVAL_MS,
      name: "provider_catalog_sync",
      scopes: ["models:read", "providers:read", "providers:write"],
      run: async (services, runInput) => {
        await services.providers.catalogSyncJobs.runNext({
          subject: runInput.subject,
          workerId: `scheduled_provider_catalog_${runInput.subject.orgId}`,
        });
        return services.providers.models(runInput.subject);
      },
    }),
    operation({
      intervalMs: 24 * 60 * 60 * 1_000,
      name: "retention_enforcement",
      scopes: ["admin:write"],
      run: (services, runInput) =>
        services.governance.enforceRetention(runInput.subject),
    }),
    operation({
      intervalMs: 10_000,
      name: "webhook_retry",
      scopes: ["admin:write"],
      run: (services, runInput) =>
        services.webhooks.retryDueDeliveries(runInput.subject),
    }),
    operation({
      intervalMs: 10_000,
      name: "notification_retry",
      scopes: ["admin:write"],
      run: (services, runInput) =>
        services.notifications.retryDueDeliveries(runInput.subject),
    }),
    operation({
      intervalMs: 24 * 60 * 60 * 1_000,
      name: "voice_catalog_sync",
      scopes: ["voices:manage", "voices:use"],
      run: (services, runInput) =>
        services.voices.syncCatalog(runInput.subject),
    }),
  ];
  if (env.BILLING_ENABLED) {
    operations.push(
      operation({
        intervalMs: 5 * 60 * 1_000,
        name: "billing_entitlement_reconciliation",
        scopes: ["admin:write"],
        run: (services, runInput) =>
          services.billing.reconcileEntitlements(runInput.subject),
      }),
      operation({
        intervalMs: 15 * 60 * 1_000,
        name: "billing_lifecycle_enforcement",
        scopes: ["admin:write"],
        run: (services, runInput) =>
          services.billing.enforceLifecycle(runInput.subject),
      }),
    );
  }
  return operations.filter(
    (candidate) =>
      (candidate.name !== "temporary_chat_cleanup" ||
        env.TEMPORARY_CHAT_CLEANUP_ENABLED) &&
      (candidate.name !== "provider_catalog_sync" ||
        env.MODEL_CATALOG_SYNC_ENABLED),
  );
}
