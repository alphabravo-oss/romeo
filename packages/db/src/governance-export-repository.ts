import type {
  ClaimGovernanceExportJobInput,
  GovernanceExportArtifactRecord,
  GovernanceExportJobRecord,
  UpdateGovernanceExportJobWithLeaseInput,
} from "@romeo/core";
import { and, asc, desc, eq, isNull, lte, or } from "drizzle-orm";

import type { RomeoDatabase } from "./client";
import { governanceExportArtifacts, governanceExportJobs } from "./schema";

export class PgGovernanceExportRepository {
  constructor(private readonly db: RomeoDatabase) {}

  async createGovernanceExportJob(
    job: GovernanceExportJobRecord,
  ): Promise<GovernanceExportJobRecord> {
    const [row] = await this.db
      .insert(governanceExportJobs)
      .values(toJobInsert(job))
      .returning();
    if (row === undefined) throw new Error("governance_export_job_conflict");
    return toJob(row);
  }

  async getGovernanceExportJob(orgId: string, jobId: string) {
    const [row] = await this.db
      .select()
      .from(governanceExportJobs)
      .where(
        and(
          eq(governanceExportJobs.orgId, orgId),
          eq(governanceExportJobs.id, jobId),
        ),
      )
      .limit(1);
    return row === undefined ? undefined : toJob(row);
  }

  async listGovernanceExportJobs(orgId: string, limit: number) {
    const rows = await this.db
      .select()
      .from(governanceExportJobs)
      .where(
        and(
          eq(governanceExportJobs.orgId, orgId),
          isNull(governanceExportJobs.deletedAt),
        ),
      )
      .orderBy(
        desc(governanceExportJobs.createdAt),
        desc(governanceExportJobs.id),
      )
      .limit(limit);
    return rows.map(toJob);
  }

  async claimGovernanceExportJob(input: ClaimGovernanceExportJobInput) {
    return this.db.transaction(async (transaction) => {
      const [candidate] = await transaction
        .select()
        .from(governanceExportJobs)
        .where(
          and(
            eq(governanceExportJobs.orgId, input.orgId),
            ...(input.jobId === undefined
              ? []
              : [eq(governanceExportJobs.id, input.jobId)]),
            or(
              eq(governanceExportJobs.state, "queued"),
              and(
                eq(governanceExportJobs.state, "running"),
                lte(governanceExportJobs.leaseExpiresAt, new Date(input.now)),
              ),
            ),
          ),
        )
        .orderBy(
          asc(governanceExportJobs.createdAt),
          asc(governanceExportJobs.id),
        )
        .limit(1)
        .for("update", { skipLocked: true });
      if (candidate === undefined) return undefined;
      const [claimed] = await transaction
        .update(governanceExportJobs)
        .set({
          state: "running",
          leaseOwner: input.workerId,
          leaseExpiresAt: new Date(
            Date.parse(input.now) + input.leaseSeconds * 1_000,
          ),
          leaseAttempt: candidate.leaseAttempt + 1,
          version: candidate.version + 1,
          updatedAt: new Date(input.now),
        })
        .where(
          and(
            eq(governanceExportJobs.orgId, candidate.orgId),
            eq(governanceExportJobs.id, candidate.id),
            eq(governanceExportJobs.version, candidate.version),
          ),
        )
        .returning();
      return claimed === undefined ? undefined : toJob(claimed);
    });
  }

  async updateGovernanceExportJobWithLease(
    input: UpdateGovernanceExportJobWithLeaseInput,
  ) {
    const [row] = await this.db
      .update(governanceExportJobs)
      .set(toJobUpdate(input.job))
      .where(
        and(
          eq(governanceExportJobs.orgId, input.job.orgId),
          eq(governanceExportJobs.id, input.job.id),
          eq(governanceExportJobs.version, input.job.version - 1),
          eq(governanceExportJobs.leaseOwner, input.workerId),
          eq(governanceExportJobs.leaseAttempt, input.leaseAttempt),
        ),
      )
      .returning();
    return row === undefined ? undefined : toJob(row);
  }

  async updateGovernanceExportJob(job: GovernanceExportJobRecord) {
    const [row] = await this.db
      .update(governanceExportJobs)
      .set(toJobUpdate(job))
      .where(
        and(
          eq(governanceExportJobs.orgId, job.orgId),
          eq(governanceExportJobs.id, job.id),
          eq(governanceExportJobs.version, job.version - 1),
        ),
      )
      .returning();
    return row === undefined ? undefined : toJob(row);
  }

  async createGovernanceExportArtifact(
    artifact: GovernanceExportArtifactRecord,
  ) {
    const [row] = await this.db
      .insert(governanceExportArtifacts)
      .values(toArtifactInsert(artifact))
      .returning();
    if (row === undefined)
      throw new Error("governance_export_artifact_conflict");
    return toArtifact(row);
  }

  async getGovernanceExportArtifact(orgId: string, jobId: string) {
    const [row] = await this.db
      .select()
      .from(governanceExportArtifacts)
      .where(
        and(
          eq(governanceExportArtifacts.orgId, orgId),
          eq(governanceExportArtifacts.jobId, jobId),
        ),
      )
      .limit(1);
    return row === undefined ? undefined : toArtifact(row);
  }

  async updateGovernanceExportArtifact(
    artifact: GovernanceExportArtifactRecord,
  ) {
    const [row] = await this.db
      .update(governanceExportArtifacts)
      .set(toArtifactInsert(artifact))
      .where(
        and(
          eq(governanceExportArtifacts.orgId, artifact.orgId),
          eq(governanceExportArtifacts.id, artifact.id),
        ),
      )
      .returning();
    return row === undefined ? undefined : toArtifact(row);
  }
}

type JobRow = typeof governanceExportJobs.$inferSelect;
type ArtifactRow = typeof governanceExportArtifacts.$inferSelect;

function toJob(row: JobRow): GovernanceExportJobRecord {
  return {
    id: row.id,
    orgId: row.orgId,
    ...(row.workspaceId === null ? {} : { workspaceId: row.workspaceId }),
    createdBy: row.createdBy,
    request: row.request,
    snapshotAt: row.snapshotAt.toISOString(),
    state: row.state as GovernanceExportJobRecord["state"],
    percent: row.percent,
    checkpoint: row.checkpoint,
    counts: row.counts,
    limits: row.limits,
    warnings: row.warnings,
    exclusions: row.exclusions,
    ...(row.errorCode === null ? {} : { errorCode: row.errorCode }),
    ...(row.leaseOwner === null ? {} : { leaseOwner: row.leaseOwner }),
    ...(row.leaseExpiresAt === null
      ? {}
      : { leaseExpiresAt: row.leaseExpiresAt.toISOString() }),
    leaseAttempt: row.leaseAttempt,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(row.completedAt === null
      ? {}
      : { completedAt: row.completedAt.toISOString() }),
    ...(row.deletedAt === null
      ? {}
      : { deletedAt: row.deletedAt.toISOString() }),
  };
}

function toJobInsert(job: GovernanceExportJobRecord) {
  return {
    id: job.id,
    orgId: job.orgId,
    workspaceId: job.workspaceId ?? null,
    createdBy: job.createdBy,
    request: job.request,
    snapshotAt: new Date(job.snapshotAt),
    state: job.state,
    percent: job.percent,
    checkpoint: job.checkpoint,
    counts: job.counts,
    limits: job.limits,
    warnings: job.warnings,
    exclusions: job.exclusions,
    errorCode: job.errorCode ?? null,
    leaseOwner: job.leaseOwner ?? null,
    leaseExpiresAt: optionalDate(job.leaseExpiresAt),
    leaseAttempt: job.leaseAttempt,
    version: job.version,
    createdAt: new Date(job.createdAt),
    updatedAt: new Date(job.updatedAt),
    completedAt: optionalDate(job.completedAt),
    deletedAt: optionalDate(job.deletedAt),
  } satisfies typeof governanceExportJobs.$inferInsert;
}

function toJobUpdate(job: GovernanceExportJobRecord) {
  const {
    id: _id,
    orgId: _orgId,
    createdAt: _createdAt,
    ...update
  } = toJobInsert(job);
  return update;
}

function toArtifact(row: ArtifactRow): GovernanceExportArtifactRecord {
  return {
    id: row.id,
    jobId: row.jobId,
    orgId: row.orgId,
    objectKey: row.objectKey,
    contentType:
      row.contentType as GovernanceExportArtifactRecord["contentType"],
    fileName: row.fileName,
    sizeBytes: row.sizeBytes,
    sha256: row.sha256,
    partCount: row.partCount,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    ...(row.deletedAt === null
      ? {}
      : { deletedAt: row.deletedAt.toISOString() }),
  };
}

function toArtifactInsert(artifact: GovernanceExportArtifactRecord) {
  return {
    id: artifact.id,
    jobId: artifact.jobId,
    orgId: artifact.orgId,
    objectKey: artifact.objectKey,
    contentType: artifact.contentType,
    fileName: artifact.fileName,
    sizeBytes: artifact.sizeBytes,
    sha256: artifact.sha256,
    partCount: artifact.partCount,
    createdAt: new Date(artifact.createdAt),
    expiresAt: new Date(artifact.expiresAt),
    deletedAt: optionalDate(artifact.deletedAt),
  } satisfies typeof governanceExportArtifacts.$inferInsert;
}

function optionalDate(value: string | undefined): Date | null {
  return value === undefined ? null : new Date(value);
}
