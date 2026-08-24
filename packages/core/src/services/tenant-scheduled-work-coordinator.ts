import type { AuthSubject, Scope } from "@romeo/auth";

import type { RomeoRepository } from "../domain/repository";
import type { RepositoryRequestScope } from "../domain/repository-request-scope";
import { createId } from "../ids";
import { settingKey as abuseControlSettingKey } from "./abuse-control-policy-helpers";
import { ensureSystemAuditActor } from "./system-audit-actor";
import { deletionRequestKey } from "./tenant-admin-support";
import { startWorkLeaseHeartbeat } from "./work-lease-heartbeat";
import { WorkerSupervisor } from "./worker-supervisor";

export interface ScheduledTenantOperation {
  intervalMs: number;
  name: string;
  run(input: {
    repository: RomeoRepository;
    signal?: AbortSignal;
    subject: AuthSubject;
  }): Promise<unknown>;
  scopes: Scope[];
}

export interface ScheduledTenantOperationReport {
  claimed: number;
  failed: number;
  selectedTenants: number;
  skippedTenants: number;
  succeeded: number;
}

export interface TenantScheduledWorkCoordinatorOptions {
  maxTenantsPerRun?: number;
  now?: () => Date;
  tenantConcurrency?: number;
  workerId?: string;
}

export class TenantScheduledWorkCoordinator {
  private readonly supervisors = new Map<string, WorkerSupervisor>();
  private readonly workerId: string;

  constructor(
    private readonly scope: RepositoryRequestScope,
    private readonly operations: ScheduledTenantOperation[],
    private readonly options: TenantScheduledWorkCoordinatorOptions = {},
  ) {
    this.workerId = options.workerId ?? createId("scheduled_tenant_worker");
    for (const operation of operations)
      this.supervisors.set(
        operation.name,
        new WorkerSupervisor(`scheduled_${operation.name}`),
      );
  }

  start(): void {
    for (const operation of this.operations) {
      this.supervisor(operation).start(
        (signal) => this.runOnce(operation.name, undefined, signal),
        {
          intervalMs: operation.intervalMs,
          maxBackoffMs: operation.intervalMs * 16,
          jitterRatio: 0.2,
        },
      );
    }
  }

  stop(): void {
    for (const supervisor of this.supervisors.values()) supervisor.stop();
  }

  async drain(): Promise<void> {
    await Promise.all(
      Array.from(this.supervisors.values(), (supervisor) => supervisor.drain()),
    );
  }

  async runOnce(
    operationName: string,
    now = this.now().toISOString(),
    signal?: AbortSignal,
  ): Promise<ScheduledTenantOperationReport> {
    const operation = this.operations.find(
      (candidate) => candidate.name === operationName,
    );
    if (operation === undefined)
      throw new Error(`scheduled_tenant_operation_unknown:${operationName}`);
    const report = emptyReport();
    if (isAborted(signal)) return report;
    const candidates = await this.loadCandidateTenants(operation);
    report.selectedTenants = candidates.length;
    const concurrency = bounded(this.options.tenantConcurrency, 4, 20);
    for (let index = 0; index < candidates.length; index += concurrency) {
      if (isAborted(signal)) break;
      const batch = candidates.slice(index, index + concurrency);
      const eligibility = await this.loadEligibility(
        batch.map((tenant) => tenant.id),
      );
      const outcomes = await Promise.all(
        batch.map((tenant) =>
          eligibility.get(tenant.id)
            ? this.runForTenant(operation, tenant.id, now, signal)
            : Promise.resolve("skipped" as const),
        ),
      );
      for (const outcome of outcomes) {
        if (outcome === "skipped") report.skippedTenants += 1;
        else if (outcome === "missed") continue;
        else {
          report.claimed += 1;
          if (outcome === "succeeded") report.succeeded += 1;
          else report.failed += 1;
        }
      }
      await this.saveProgress(operation, batch.at(-1)!.id, now, report);
    }
    this.supervisor(operation).recordLease({
      claimed: report.claimed > 0,
      count: Math.max(1, report.claimed),
    });
    return report;
  }

  private async loadCandidateTenants(operation: ScheduledTenantOperation) {
    return this.scope.runAsSystem(async (repository) => {
      const organizations = (await repository.listAllOrganizations()).sort(
        (left, right) => left.id.localeCompare(right.id),
      );
      const previous = await repository.getSystemSetting(
        progressKey(operation),
        null,
      );
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
    operation: ScheduledTenantOperation,
    orgId: string,
    now: string,
    signal?: AbortSignal,
  ): Promise<"failed" | "missed" | "succeeded"> {
    return this.scope.runAsTenant(orgId, async (repository) => {
      const jobId = await scheduledJobForRun(repository, operation, orgId, now);
      if (jobId === undefined) return "missed";
      const leaseSeconds = Math.max(
        60,
        Math.min(300, Math.ceil(operation.intervalMs / 1_000)),
      );
      const claimed = await repository.claimBackgroundJob({
        jobId,
        leaseSeconds,
        now,
        orgId,
        type: scheduledJobType(operation),
        workerId: this.workerId,
      });
      if (claimed === undefined) return "missed";
      const leaseAttempt = claimedLeaseAttempt(claimed.payload);
      if (leaseAttempt === undefined) return "failed";
      const heartbeat = startWorkLeaseHeartbeat({
        leaseDurationMs: leaseSeconds * 1_000,
        lostError: () => new Error("scheduled_tenant_operation_lease_lost"),
        now: () => this.now(),
        renew: async (renewal) =>
          (await repository.renewBackgroundJobLease({
            jobId,
            leaseAttempt,
            leaseSeconds,
            now: renewal.now,
            orgId,
            workerId: this.workerId,
          })) !== undefined,
      });
      const subject = await scheduledWorkerSubject(
        repository,
        operation,
        orgId,
      );
      try {
        await operation.run({
          repository,
          subject,
          ...(signal === undefined ? {} : { signal }),
        });
        await heartbeat.stop();
        const completedAt = this.now().toISOString();
        const completed = await repository.updateBackgroundJobWithLease({
          job: {
            ...claimed,
            status: "completed",
            completedAt,
            updatedAt: completedAt,
          },
          now: completedAt,
          leaseAttempt,
          workerId: this.workerId,
        });
        return completed === undefined ? "failed" : "succeeded";
      } catch {
        await heartbeat.stop({ requireOwned: false });
        const failedAt = this.now().toISOString();
        await repository.updateBackgroundJobWithLease({
          job: {
            ...claimed,
            status: "failed",
            completedAt: failedAt,
            payload: {
              ...claimed.payload,
              errorCode: "scheduled_operation_failed",
            },
            updatedAt: failedAt,
          },
          now: failedAt,
          leaseAttempt,
          workerId: this.workerId,
        });
        return "failed";
      }
    });
  }

  private saveProgress(
    operation: ScheduledTenantOperation,
    cursorOrgId: string,
    now: string,
    report: ScheduledTenantOperationReport,
  ): Promise<unknown> {
    return this.scope.runAsSystem((repository) =>
      repository.upsertSystemSetting(
        {
          key: progressKey(operation),
          updatedAt: now,
          value: { version: 1, cursorOrgId, ...report, updatedAt: now },
        },
        null,
      ),
    );
  }

  private supervisor(operation: ScheduledTenantOperation): WorkerSupervisor {
    return this.supervisors.get(operation.name)!;
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }
}

async function scheduledJobForRun(
  repository: RomeoRepository,
  operation: ScheduledTenantOperation,
  orgId: string,
  now: string,
): Promise<string | undefined> {
  const jobId = scheduledJobId(operation, orgId, now);
  const current = await repository.getBackgroundJob(orgId, jobId);
  if (current !== undefined)
    return current.status === "queued" || current.status === "running"
      ? current.id
      : undefined;
  const [unfinished] = await repository.listBackgroundJobs(orgId, {
    limit: 1,
    order: "asc",
    statuses: ["queued", "running"],
    type: scheduledJobType(operation),
  });
  if (unfinished !== undefined) return unfinished.id;
  try {
    await repository.createBackgroundJob({
      id: jobId,
      orgId,
      type: scheduledJobType(operation),
      status: "queued",
      payload: { operation: operation.name, version: 1 },
      createdAt: now,
      updatedAt: now,
    });
    return jobId;
  } catch {
    const raced = await repository.getBackgroundJob(orgId, jobId);
    return raced?.status === "queued" || raced?.status === "running"
      ? raced.id
      : undefined;
  }
}

async function scheduledWorkerSubject(
  repository: RomeoRepository,
  operation: ScheduledTenantOperation,
  orgId: string,
): Promise<AuthSubject> {
  const [actor, workspaces] = await Promise.all([
    ensureSystemAuditActor(repository, {
      kind: `scheduled_${operation.name}`,
      name: `Scheduled ${operation.name} worker`,
      orgId,
      scopes: operation.scopes,
    }),
    repository.listWorkspaces(orgId),
  ]);
  return {
    id: actor.id,
    type: "user",
    orgId,
    workspaceIds: workspaces.map((workspace) => workspace.id),
    groupIds: [],
    scopes: operation.scopes,
    isAdmin: operation.scopes.some((scope) => scope.startsWith("admin:")),
  };
}

function scheduledJobId(
  operation: ScheduledTenantOperation,
  orgId: string,
  now: string,
): string {
  return `scheduled_${operation.name}_${orgId}_${Math.floor(
    Date.parse(now) / operation.intervalMs,
  )}`;
}

function scheduledJobType(operation: ScheduledTenantOperation): string {
  return `scheduled.${operation.name}`;
}

function progressKey(operation: ScheduledTenantOperation): string {
  return `scheduled-work.${operation.name}.v1`;
}

function bounded(value: number | undefined, fallback: number, maximum: number) {
  return Math.max(1, Math.min(Math.floor(value ?? fallback), maximum));
}

function emptyReport(): ScheduledTenantOperationReport {
  return {
    claimed: 0,
    failed: 0,
    selectedTenants: 0,
    skippedTenants: 0,
    succeeded: 0,
  };
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function claimedLeaseAttempt(
  payload: Record<string, unknown>,
): number | undefined {
  const lease = payload.workerLease;
  if (typeof lease !== "object" || lease === null || Array.isArray(lease))
    return undefined;
  const attempt = (lease as { attempt?: unknown }).attempt;
  return typeof attempt === "number" && Number.isInteger(attempt)
    ? attempt
    : undefined;
}
