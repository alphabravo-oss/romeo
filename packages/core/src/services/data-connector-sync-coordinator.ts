import type { AuthSubject } from "@romeo/auth";

import type { DataConnectorSync } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import type { RepositoryRequestScope } from "../domain/repository-request-scope";
import { createId } from "../ids";
import { settingKey as abuseControlSettingKey } from "./abuse-control-policy-helpers";
import { deletionRequestKey } from "./tenant-admin-support";
import { WorkerSupervisor } from "./worker-supervisor";

export interface DataConnectorSyncCoordinatorOptions {
  enabled: boolean;
  intervalMs?: number;
  maxConnectorsPerTenant?: number;
  maxTenantsPerRun?: number;
  tenantConcurrency?: number;
  workerId?: string;
}

export interface DataConnectorSyncRunReport {
  attempted: number;
  completed: number;
  failed: number;
  selectedTenants: number;
  skippedTenants: number;
  tenantFailures: number;
}

interface DueConnectorSyncService {
  syncNextDue(input: {
    now?: string;
    subject: AuthSubject;
    workerId: string;
  }): Promise<DataConnectorSync | undefined>;
}

type ServiceFactory = (repository: RomeoRepository) => DueConnectorSyncService;
type TenantOutcome = {
  attempted: number;
  completed: number;
  failed: number;
  skipped: boolean;
};

const progressKey = "scheduled-work.data-connector-sync.v1";
const defaultIntervalMs = 60_000;

export class DataConnectorSyncCoordinator {
  private readonly supervisor = new WorkerSupervisor(
    "data_connector_scheduled_sync",
  );
  private readonly workerId: string;

  constructor(
    private readonly scope: RepositoryRequestScope,
    private readonly createService: ServiceFactory,
    private readonly options: DataConnectorSyncCoordinatorOptions,
  ) {
    this.workerId = options.workerId ?? createId("data_connector_sync_worker");
  }

  start(): void {
    if (!this.options.enabled) return;
    const intervalMs = this.options.intervalMs ?? defaultIntervalMs;
    this.supervisor.start((signal) => this.runOnce(undefined, signal), {
      intervalMs,
      maxBackoffMs: intervalMs * 16,
      jitterRatio: 0.2,
    });
  }

  stop(): void {
    this.supervisor.stop();
  }

  drain(): Promise<void> {
    return this.supervisor.drain();
  }

  async runOnce(
    now = new Date().toISOString(),
    signal?: AbortSignal,
  ): Promise<DataConnectorSyncRunReport> {
    const report = emptyReport();
    if (!this.options.enabled || isAborted(signal)) return report;
    const candidates = await this.loadCandidateTenants();
    report.selectedTenants = candidates.length;
    const concurrency = bounded(this.options.tenantConcurrency, 4, 20);
    for (let index = 0; index < candidates.length; index += concurrency) {
      if (isAborted(signal)) break;
      const batch = candidates.slice(index, index + concurrency);
      const eligibility = await this.loadEligibility(
        batch.map((tenant) => tenant.id),
      );
      const outcomes = await Promise.allSettled(
        batch.map(async (tenant) => {
          if (!eligibility.get(tenant.id))
            return {
              attempted: 0,
              completed: 0,
              failed: 0,
              skipped: true,
            } satisfies TenantOutcome;
          return this.runForTenant(tenant.id, now, signal);
        }),
      );
      for (const outcome of outcomes) {
        if (outcome.status === "rejected") {
          report.tenantFailures += 1;
        } else if (outcome.value.skipped) {
          report.skippedTenants += 1;
        } else {
          report.attempted += outcome.value.attempted;
          report.completed += outcome.value.completed;
          report.failed += outcome.value.failed;
        }
      }
      await this.saveProgress(batch.at(-1)!.id, now, report);
    }
    return report;
  }

  private async loadCandidateTenants() {
    return this.scope.runAsSystem(async (repository) => {
      const organizations = (await repository.listAllOrganizations()).sort(
        (left, right) => left.id.localeCompare(right.id),
      );
      const previous = await repository.getSystemSetting(progressKey, null);
      const cursor =
        typeof previous?.value.cursorOrgId === "string"
          ? previous.value.cursorOrgId
          : undefined;
      const pivot = organizations.findIndex(
        (organization) => cursor === undefined || organization.id > cursor,
      );
      const ordered =
        pivot <= 0
          ? organizations
          : [...organizations.slice(pivot), ...organizations.slice(0, pivot)];
      return ordered.slice(
        0,
        bounded(this.options.maxTenantsPerRun, 100, 1_000),
      );
    });
  }

  private loadEligibility(orgIds: string[]): Promise<Map<string, boolean>> {
    return this.scope.runAsSystem(async (repository) => {
      const entries = await Promise.all(
        orgIds.map(async (orgId) => {
          const [abuseControl, deletion] = await Promise.all([
            repository.getSystemSetting(abuseControlSettingKey(orgId), orgId),
            repository.getSystemSetting(deletionRequestKey(orgId), orgId),
          ]);
          const suspension = abuseControl?.value.suspension;
          const suspended =
            typeof suspension === "object" &&
            suspension !== null &&
            !Array.isArray(suspension) &&
            (suspension as Record<string, unknown>).suspended === true;
          return [
            orgId,
            !suspended && deletion?.value.status !== "requested",
          ] as const;
        }),
      );
      return new Map(entries);
    });
  }

  private runForTenant(
    orgId: string,
    now: string,
    signal?: AbortSignal,
  ): Promise<TenantOutcome> {
    return this.scope.runAsTenant(orgId, async (repository) => {
      const workspaces = await repository.listWorkspaces(orgId);
      const service = this.createService(repository);
      const subject = workerSubject(
        orgId,
        workspaces.map((workspace) => workspace.id),
      );
      const result: TenantOutcome = {
        attempted: 0,
        completed: 0,
        failed: 0,
        skipped: false,
      };
      const limit = bounded(this.options.maxConnectorsPerTenant, 10, 100);
      for (let index = 0; index < limit; index += 1) {
        if (isAborted(signal)) break;
        try {
          const sync = await service.syncNextDue({
            now,
            subject,
            workerId: this.workerId,
          });
          if (sync === undefined) break;
          result.attempted += 1;
          result.completed += 1;
          this.supervisor.recordLease({ claimed: true });
        } catch {
          result.attempted += 1;
          result.failed += 1;
          this.supervisor.recordLease({ claimed: true });
        }
      }
      if (result.attempted === 0)
        this.supervisor.recordLease({ claimed: false });
      return result;
    });
  }

  private saveProgress(
    cursorOrgId: string,
    now: string,
    report: DataConnectorSyncRunReport,
  ): Promise<unknown> {
    return this.scope.runAsSystem((repository) =>
      repository.upsertSystemSetting(
        {
          key: progressKey,
          updatedAt: now,
          value: { version: 1, cursorOrgId, ...report, updatedAt: now },
        },
        null,
      ),
    );
  }
}

function bounded(value: number | undefined, fallback: number, maximum: number) {
  return Math.max(1, Math.min(Math.floor(value ?? fallback), maximum));
}

function emptyReport(): DataConnectorSyncRunReport {
  return {
    attempted: 0,
    completed: 0,
    failed: 0,
    selectedTenants: 0,
    skippedTenants: 0,
    tenantFailures: 0,
  };
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function workerSubject(orgId: string, workspaceIds: string[]): AuthSubject {
  return {
    id: "system_data_connector_scheduled_sync",
    type: "service_account",
    orgId,
    workspaceIds,
    groupIds: [],
    scopes: ["knowledge:read", "knowledge:write"],
  };
}
