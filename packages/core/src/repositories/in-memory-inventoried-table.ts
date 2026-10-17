import type {
  QueryInventoriedTableRowsInput,
  QueryInventoriedTableRowsResult,
} from "../domain/inventoried-table-repository";
import type {
  GovernanceExportArtifactRecord,
  GovernanceExportJobRecord,
} from "../domain/governance-export-records";
import {
  filterInventoriedTableRows,
  sortInventoriedTableRows,
} from "../services/inventoried-table-page";
import { publicJob } from "../services/data-export-package-registry";
import {
  supportRequestReports,
  toSupportSessionReport,
} from "../services/support-session-reporting";
import { InMemoryServerTableRepository } from "./in-memory-server-table";
import type { SeedData } from "./seed-data";

export abstract class InMemoryInventoriedTableRepository extends InMemoryServerTableRepository {
  async createGovernanceExportJob(
    job: GovernanceExportJobRecord,
  ): Promise<GovernanceExportJobRecord> {
    if (
      this.data.governanceExportJobs.some(
        (candidate) => candidate.orgId === job.orgId && candidate.id === job.id,
      )
    )
      throw new Error("governance_export_job_conflict");
    this.data.governanceExportJobs.push(structuredClone(job));
    return structuredClone(job);
  }

  async getGovernanceExportJob(
    orgId: string,
    jobId: string,
  ): Promise<GovernanceExportJobRecord | undefined> {
    const job = this.data.governanceExportJobs.find(
      (candidate) => candidate.orgId === orgId && candidate.id === jobId,
    );
    return job === undefined ? undefined : structuredClone(job);
  }

  async listGovernanceExportJobs(
    orgId: string,
    limit: number,
  ): Promise<GovernanceExportJobRecord[]> {
    return this.data.governanceExportJobs
      .filter((job) => job.orgId === orgId && job.state !== "deleted")
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit)
      .map((job) => structuredClone(job));
  }

  async claimGovernanceExportJob(input: {
    orgId: string;
    workerId: string;
    leaseSeconds: number;
    now: string;
    jobId?: string;
  }): Promise<GovernanceExportJobRecord | undefined> {
    const nowMs = Date.parse(input.now);
    const job = this.data.governanceExportJobs
      .filter(
        (candidate) =>
          candidate.orgId === input.orgId &&
          (input.jobId === undefined || candidate.id === input.jobId) &&
          (candidate.state === "queued" ||
            (candidate.state === "running" &&
              Date.parse(candidate.leaseExpiresAt ?? "") <= nowMs)),
      )
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];
    if (job === undefined) return undefined;
    const claimed: GovernanceExportJobRecord = {
      ...job,
      state: "running",
      leaseOwner: input.workerId,
      leaseExpiresAt: new Date(
        nowMs + input.leaseSeconds * 1_000,
      ).toISOString(),
      leaseAttempt: job.leaseAttempt + 1,
      version: job.version + 1,
      updatedAt: input.now,
    };
    this.replaceGovernanceExportJob(claimed);
    return structuredClone(claimed);
  }

  async updateGovernanceExportJobWithLease(input: {
    job: GovernanceExportJobRecord;
    workerId: string;
    leaseAttempt: number;
  }): Promise<GovernanceExportJobRecord | undefined> {
    const current = await this.getGovernanceExportJob(
      input.job.orgId,
      input.job.id,
    );
    if (
      current === undefined ||
      current.leaseOwner !== input.workerId ||
      current.leaseAttempt !== input.leaseAttempt ||
      input.job.version !== current.version + 1
    )
      return undefined;
    this.replaceGovernanceExportJob(input.job);
    return structuredClone(input.job);
  }

  async updateGovernanceExportJob(
    job: GovernanceExportJobRecord,
  ): Promise<GovernanceExportJobRecord | undefined> {
    const current = await this.getGovernanceExportJob(job.orgId, job.id);
    if (current === undefined || job.version !== current.version + 1)
      return undefined;
    this.replaceGovernanceExportJob(job);
    return structuredClone(job);
  }

  async createGovernanceExportArtifact(
    artifact: GovernanceExportArtifactRecord,
  ): Promise<GovernanceExportArtifactRecord> {
    if (
      this.data.governanceExportArtifacts.some(
        (candidate) =>
          candidate.orgId === artifact.orgId &&
          candidate.jobId === artifact.jobId,
      )
    )
      throw new Error("governance_export_artifact_conflict");
    this.data.governanceExportArtifacts.push(structuredClone(artifact));
    return structuredClone(artifact);
  }

  async getGovernanceExportArtifact(
    orgId: string,
    jobId: string,
  ): Promise<GovernanceExportArtifactRecord | undefined> {
    const artifact = this.data.governanceExportArtifacts.find(
      (candidate) => candidate.orgId === orgId && candidate.jobId === jobId,
    );
    return artifact === undefined ? undefined : structuredClone(artifact);
  }

  async updateGovernanceExportArtifact(
    artifact: GovernanceExportArtifactRecord,
  ): Promise<GovernanceExportArtifactRecord | undefined> {
    const index = this.data.governanceExportArtifacts.findIndex(
      (candidate) =>
        candidate.orgId === artifact.orgId &&
        candidate.jobId === artifact.jobId,
    );
    if (index < 0) return undefined;
    this.data.governanceExportArtifacts[index] = structuredClone(artifact);
    return structuredClone(artifact);
  }

  async queryInventoriedTableRows(
    input: QueryInventoriedTableRowsInput,
  ): Promise<QueryInventoriedTableRowsResult> {
    const scoped = sourceRows(this.data, input).map(publicRow);
    const snapshotAt = input.snapshotAt;
    const snapshotRows =
      snapshotAt === undefined
        ? scoped
        : scoped.filter((row) => {
            const created = row.createdAt ?? row.startedAt;
            return typeof created !== "string" || created <= snapshotAt;
          });
    const filtered = filterInventoriedTableRows(
      snapshotRows,
      {
        filters: input.filters,
        ...(input.search === undefined ? {} : { search: input.search }),
      },
      {
        defaultSort: input.sort,
        filters: {},
        searchFields: input.searchFields,
        sortFields: [input.sort.field],
      },
    );
    const sorted = sortInventoriedTableRows(filtered, input.sort);
    const start =
      input.position === undefined
        ? 0
        : Math.max(
            0,
            sorted.findIndex((row) => row.id === input.position?.id) + 1,
          );
    return {
      items: sorted.slice(start, start + input.limit),
      ...(input.includeTotals ? { total: filtered.length } : {}),
      ...(input.resource === "governance_export_packages"
        ? { summary: governanceExportSummary(snapshotRows) }
        : {}),
      ...(input.resource === "notifications"
        ? {
            summary: {
              total: snapshotRows.length,
              unreadTotal: snapshotRows.filter(
                (row) => row.readAt === undefined || row.readAt === null,
              ).length,
            },
          }
        : {}),
    };
  }

  private replaceGovernanceExportJob(job: GovernanceExportJobRecord): void {
    this.data.governanceExportJobs = this.data.governanceExportJobs.map(
      (candidate) =>
        candidate.orgId === job.orgId && candidate.id === job.id
          ? structuredClone(job)
          : candidate,
    );
  }
}

function sourceRows(
  data: SeedData,
  input: QueryInventoriedTableRowsInput,
): readonly object[] {
  if (input.resource === "background_jobs")
    return data.backgroundJobs.filter((row) => row.orgId === input.orgId);
  if (input.resource === "governance_export_packages")
    return data.governanceExportJobs
      .filter((row) => row.orgId === input.orgId && row.state !== "deleted")
      .map((job) => ({
        ...publicJob(
          job,
          data.governanceExportArtifacts.find(
            (artifact) =>
              artifact.orgId === job.orgId && artifact.jobId === job.id,
          ),
        ),
        id: job.id,
      }));
  if (input.resource === "notification_deliveries")
    return input.actorType === "user"
      ? data.notificationDeliveries.filter(
          (row) => row.orgId === input.orgId && row.userId === input.actorId,
        )
      : [];
  if (input.resource === "notifications")
    return input.actorType === "user"
      ? data.userNotifications.filter(
          (row) => row.orgId === input.orgId && row.userId === input.actorId,
        )
      : [];
  if (input.resource === "support_access_requests")
    return supportRequestReports(data.auditLogs);
  if (input.resource === "support_sessions")
    return data.auditLogs.flatMap((log) => {
      if (
        log.orgId !== input.orgId ||
        log.action !== "support.impersonation.create" ||
        log.resourceType !== "session"
      )
        return [];
      const session = data.userSessions.find(
        (candidate) =>
          candidate.id === log.resourceId && candidate.orgId === input.orgId,
      );
      return session === undefined
        ? []
        : [
            {
              id: session.id,
              ...toSupportSessionReport(session, log),
              createdAt: session.createdAt,
            },
          ];
    });
  if (input.resource === "tool_trace_calls")
    return data.toolCalls.filter(
      (row) => row.orgId === input.orgId && row.agentId === input.parentId,
    );
  return data.usageEvents.filter((row) => row.orgId === input.orgId);
}

function publicRow(value: object): { id: string; [key: string]: unknown } {
  const row = Object.fromEntries(
    Object.entries(value).filter(
      ([key]) =>
        !["hashedToken", "hashedRefreshToken", "signingSecret"].includes(key),
    ),
  );
  if (typeof row.id !== "string") throw new Error("table_row_id_missing");
  return row as { id: string; [key: string]: unknown };
}

function governanceExportSummary(
  rows: Array<{ id: string; [key: string]: unknown }>,
): Record<string, number> {
  return {
    orgScopeTotal: rows.filter(
      (row) => exportRequestField(row, "scope") === "org",
    ).length,
    total: rows.length,
    withContentTotal: rows.filter(
      (row) => exportRequestField(row, "includeContent") === true,
    ).length,
    workspaceScopeTotal: rows.filter(
      (row) => exportRequestField(row, "scope") === "workspace",
    ).length,
  };
}

function exportRequestField(
  row: { id: string; [key: string]: unknown },
  field: string,
): unknown {
  return typeof row.request === "object" && row.request !== null
    ? (row.request as Record<string, unknown>)[field]
    : undefined;
}
