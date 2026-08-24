import { assertScope, type AuthSubject } from "@romeo/auth";
import type { ObjectStore } from "@romeo/storage";

import type {
  DataExportCounts,
  DataExportPackageJob,
  GovernanceExportJobRecord,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { createId } from "../ids";
import { warningsFor } from "./data-export-support";
import { publicJob } from "./data-export-package-registry";
import {
  governanceExportRowPages,
  type GovernanceExportRowPage,
} from "./governance-export-row-source";
import { GovernanceExportScheduler } from "./governance-export-scheduler";
import {
  artifactDigest,
  encodeGovernanceExportPart,
  GOVERNANCE_EXPORT_ARTIFACT_MAX_BYTES,
  GOVERNANCE_EXPORT_ARTIFACT_TTL_MS,
  GOVERNANCE_EXPORT_LEASE_SECONDS,
  GOVERNANCE_EXPORT_MANIFEST_SCHEMA,
  GOVERNANCE_EXPORT_MAX_ATTEMPTS,
  GOVERNANCE_EXPORT_PART_MAX_BYTES,
  governanceExportManifestKey,
  governanceExportPartKey,
  governanceExportPartKeys,
  type GovernanceExportManifest,
} from "./governance-export-worker-support";
import type { InventoriedTablePageService } from "./inventoried-table-page-service";

export class GovernanceExportWorker {
  private readonly scheduler: GovernanceExportScheduler;

  constructor(
    private readonly repository: RomeoRepository,
    private readonly tablePages: InventoriedTablePageService,
    private readonly objectStore: ObjectStore,
  ) {
    this.scheduler = new GovernanceExportScheduler(repository, (input) =>
      this.runNext(input),
    );
  }

  start(): void {
    this.scheduler.start();
  }

  stop(): void {
    this.scheduler.stop();
  }

  drain(): Promise<void> {
    return this.scheduler.drain();
  }

  async runNext(input: {
    subject: AuthSubject;
    workerId: string;
    jobId?: string;
    now?: string;
    signal?: AbortSignal;
  }): Promise<DataExportPackageJob | undefined> {
    assertScope(input.subject, "admin:read");
    const now = input.now ?? new Date().toISOString();
    const claimed = await this.repository.claimGovernanceExportJob({
      orgId: input.subject.orgId,
      workerId: input.workerId,
      leaseSeconds: GOVERNANCE_EXPORT_LEASE_SECONDS,
      now,
      ...(input.jobId === undefined ? {} : { jobId: input.jobId }),
    });
    if (claimed === undefined) return undefined;
    try {
      return await this.processClaim(claimed, input);
    } catch (error) {
      return this.failClaim(claimed, input, exportErrorCode(error));
    }
  }

  private async processClaim(
    claimed: GovernanceExportJobRecord,
    input: {
      subject: AuthSubject;
      workerId: string;
      signal?: AbortSignal;
    },
  ): Promise<DataExportPackageJob> {
    let job = claimed;
    let pageOrdinal = 0;
    for await (const page of governanceExportRowPages({
      repository: this.repository,
      tablePages: this.tablePages,
      objectStore: this.objectStore,
      subject: input.subject,
      request: job.request,
      snapshotAt: job.snapshotAt,
    })) {
      input.signal?.throwIfAborted();
      if (pageOrdinal < job.checkpoint.partCount) {
        pageOrdinal += 1;
        continue;
      }
      const bytes = encodeGovernanceExportPart(page.dataset, page.records);
      if (bytes.byteLength > GOVERNANCE_EXPORT_PART_MAX_BYTES)
        throw new Error("governance_export_part_too_large");
      if (
        job.checkpoint.sizeBytes + bytes.byteLength >
        GOVERNANCE_EXPORT_ARTIFACT_MAX_BYTES
      )
        throw new Error("governance_export_artifact_too_large");
      await this.objectStore.putObject({
        key: governanceExportPartKey(job.orgId, job.id, pageOrdinal),
        body: bytes,
        contentType: "application/x-ndjson",
      });
      const counts = incrementCounts(job.counts, page);
      const updatedAt = new Date().toISOString();
      job = await this.fencedUpdate(
        {
          ...job,
          state: "running",
          percent: progressFor(
            job.checkpoint.processedRows + page.records.length,
          ),
          checkpoint: {
            datasetIndex: pageOrdinal,
            partCount: pageOrdinal + 1,
            processedRows: job.checkpoint.processedRows + page.records.length,
            sizeBytes: job.checkpoint.sizeBytes + bytes.byteLength,
          },
          counts,
          warnings: warningsFor(job.request, counts),
          leaseExpiresAt: new Date(
            Date.parse(updatedAt) + GOVERNANCE_EXPORT_LEASE_SECONDS * 1_000,
          ).toISOString(),
          updatedAt,
          version: job.version + 1,
        },
        input.workerId,
        claimed.leaseAttempt,
      );
      pageOrdinal += 1;
    }
    if (job.checkpoint.partCount === 0)
      job = await this.writeEmptyPart(
        job,
        input.workerId,
        claimed.leaseAttempt,
      );
    return this.completeClaim(job, input.workerId, claimed.leaseAttempt);
  }

  private async writeEmptyPart(
    job: GovernanceExportJobRecord,
    workerId: string,
    leaseAttempt: number,
  ): Promise<GovernanceExportJobRecord> {
    const bytes = encodeGovernanceExportPart("export_metadata", [
      { request: job.request, snapshotAt: job.snapshotAt },
    ]);
    await this.objectStore.putObject({
      key: governanceExportPartKey(job.orgId, job.id, 0),
      body: bytes,
      contentType: "application/x-ndjson",
    });
    return this.fencedUpdate(
      {
        ...job,
        checkpoint: {
          ...job.checkpoint,
          partCount: 1,
          sizeBytes: bytes.byteLength,
        },
        version: job.version + 1,
      },
      workerId,
      leaseAttempt,
    );
  }

  private async completeClaim(
    job: GovernanceExportJobRecord,
    workerId: string,
    leaseAttempt: number,
  ): Promise<DataExportPackageJob> {
    const partKeys = governanceExportPartKeys(
      job.orgId,
      job.id,
      job.checkpoint.partCount,
    );
    const digest = await artifactDigest(this.objectStore, partKeys);
    if (digest.sizeBytes !== job.checkpoint.sizeBytes)
      throw new Error("governance_export_checkpoint_integrity_failure");
    const completedAt = new Date().toISOString();
    const expiresAt = new Date(
      Date.parse(completedAt) + GOVERNANCE_EXPORT_ARTIFACT_TTL_MS,
    ).toISOString();
    const manifestKey = governanceExportManifestKey(job.orgId, job.id);
    const manifest: GovernanceExportManifest = {
      schema: GOVERNANCE_EXPORT_MANIFEST_SCHEMA,
      jobId: job.id,
      orgId: job.orgId,
      partKeys,
      sizeBytes: digest.sizeBytes,
      sha256: digest.sha256,
      createdAt: completedAt,
      expiresAt,
    };
    await this.objectStore.putObject({
      key: manifestKey,
      body: new TextEncoder().encode(JSON.stringify(manifest)),
      contentType: "application/json",
    });
    const artifact =
      (await this.repository.getGovernanceExportArtifact(job.orgId, job.id)) ??
      (await this.repository.createGovernanceExportArtifact({
        id: createId("governance_export_artifact"),
        jobId: job.id,
        orgId: job.orgId,
        objectKey: manifestKey,
        contentType: "application/x-ndjson",
        fileName: `${job.id}.ndjson`,
        sizeBytes: digest.sizeBytes,
        sha256: digest.sha256,
        partCount: partKeys.length,
        createdAt: completedAt,
        expiresAt,
      }));
    if (
      artifact.sha256 !== digest.sha256 ||
      artifact.sizeBytes !== digest.sizeBytes
    )
      throw new Error("governance_export_artifact_conflict");
    const {
      leaseOwner: _leaseOwner,
      leaseExpiresAt: _leaseExpiresAt,
      ...completedJob
    } = job;
    const complete = await this.fencedUpdate(
      {
        ...completedJob,
        state: "artifact_ready",
        percent: 100,
        completedAt,
        updatedAt: completedAt,
        version: job.version + 1,
      },
      workerId,
      leaseAttempt,
    );
    return publicJob(complete, artifact);
  }

  private async failClaim(
    claimed: GovernanceExportJobRecord,
    input: { workerId: string },
    errorCode: string,
  ): Promise<DataExportPackageJob> {
    const current =
      (await this.repository.getGovernanceExportJob(
        claimed.orgId,
        claimed.id,
      )) ?? claimed;
    const terminal = claimed.leaseAttempt >= GOVERNANCE_EXPORT_MAX_ATTEMPTS;
    const failedAt = new Date().toISOString();
    const {
      leaseOwner: _leaseOwner,
      leaseExpiresAt: _leaseExpiresAt,
      ...failedJob
    } = current;
    const failed = await this.fencedUpdate(
      {
        ...failedJob,
        state: terminal ? "failed" : "queued",
        errorCode,
        ...(terminal ? { completedAt: failedAt } : {}),
        updatedAt: failedAt,
        version: current.version + 1,
      },
      input.workerId,
      claimed.leaseAttempt,
    );
    return publicJob(failed);
  }

  private async fencedUpdate(
    job: GovernanceExportJobRecord,
    workerId: string,
    leaseAttempt: number,
  ): Promise<GovernanceExportJobRecord> {
    const updated = await this.repository.updateGovernanceExportJobWithLease({
      job,
      workerId,
      leaseAttempt,
    });
    if (updated === undefined) throw new Error("governance_export_lease_lost");
    return updated;
  }
}

function incrementCounts(
  counts: DataExportCounts,
  page: GovernanceExportRowPage,
): DataExportCounts {
  return {
    ...counts,
    [page.countKey]: counts[page.countKey] + page.records.length,
    fileObjectBytesIncluded:
      counts.fileObjectBytesIncluded + (page.fileObjectBytesIncluded ?? 0),
    knowledgeSourceBytesIncluded:
      counts.knowledgeSourceBytesIncluded +
      (page.knowledgeSourceBytesIncluded ?? 0),
  };
}

function progressFor(processedRows: number): number {
  return Math.min(
    95,
    Math.max(1, Math.floor(Math.log10(processedRows + 1) * 25)),
  );
}

function exportErrorCode(error: unknown): string {
  if (error instanceof Error && /^[a-z0-9_]{1,100}$/u.test(error.message))
    return error.message;
  return "governance_export_failed";
}
