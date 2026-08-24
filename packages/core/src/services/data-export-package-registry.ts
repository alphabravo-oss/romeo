import { createHash } from "node:crypto";

import type {
  DataExportPackage,
  DataExportPackageArtifact,
  DataExportPackageJob,
  DataExportPackageList,
  DataExportPackageSummary,
  GovernanceExportArtifactRecord,
  GovernanceExportJobRecord,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";

const registryLimit = 200;
const artifactTtlMs = 24 * 60 * 60 * 1_000;

export async function listRegisteredDataExportPackages(input: {
  repository: RomeoRepository;
  orgId: string;
}): Promise<DataExportPackageList> {
  const records = await input.repository.listGovernanceExportJobs(
    input.orgId,
    registryLimit,
  );
  const jobs = await Promise.all(
    records.map(async (job) =>
      publicJob(
        job,
        await input.repository.getGovernanceExportArtifact(job.orgId, job.id),
      ),
    ),
  );
  return {
    schema: "romeo.data-export-package-list.v1",
    orgId: input.orgId,
    packages: jobs.flatMap((job) =>
      job.state === "artifact_ready" && job.artifact !== undefined
        ? [summaryFromJob(job)]
        : [],
    ),
    jobs,
    redaction: {
      packageContentReturned: false,
      rawObjectKeysReturned: false,
    },
    generatedAt: new Date().toISOString(),
  };
}

export async function registerDataExportPackage(input: {
  repository: RomeoRepository;
  package: DataExportPackage;
}): Promise<void> {
  const existing = await input.repository.getGovernanceExportJob(
    input.package.orgId,
    input.package.packageId,
  );
  if (existing !== undefined) {
    const artifact = await input.repository.getGovernanceExportArtifact(
      input.package.orgId,
      input.package.packageId,
    );
    if (artifact?.sha256 === input.package.artifact.sha256) return;
    throw new Error("data_export_package_registration_conflict");
  }
  const objectKey = legacyObjectKey(
    input.package.orgId,
    input.package.packageId,
  );
  const expiresAt = new Date(
    Date.parse(input.package.createdAt) + artifactTtlMs,
  ).toISOString();
  await input.repository.createGovernanceExportJob({
    id: input.package.packageId,
    orgId: input.package.orgId,
    ...(input.package.request.workspaceId === undefined
      ? {}
      : { workspaceId: input.package.request.workspaceId }),
    createdBy: "legacy_governance_export",
    request: input.package.request,
    snapshotAt: input.package.createdAt,
    state: "artifact_ready",
    percent: 100,
    checkpoint: {
      datasetIndex: 0,
      partCount: 1,
      processedRows: totalRows(Object.values(input.package.counts)),
      sizeBytes: input.package.artifact.sizeBytes,
    },
    counts: input.package.counts,
    limits: input.package.limits,
    warnings: input.package.warnings,
    exclusions: input.package.exclusions,
    leaseAttempt: 0,
    version: 1,
    createdAt: input.package.createdAt,
    updatedAt: input.package.createdAt,
    completedAt: input.package.createdAt,
  });
  await input.repository.createGovernanceExportArtifact({
    id: `artifact_${input.package.packageId}`,
    jobId: input.package.packageId,
    orgId: input.package.orgId,
    objectKey,
    contentType: input.package.artifact.contentType,
    fileName: `${input.package.packageId}.json`,
    sizeBytes: input.package.artifact.sizeBytes,
    sha256: input.package.artifact.sha256,
    partCount: 1,
    createdAt: input.package.createdAt,
    expiresAt,
  });
}

export async function removeRegisteredDataExportPackage(input: {
  repository: RomeoRepository;
  orgId: string;
  packageId: string;
  deletedAt?: string;
}): Promise<void> {
  const job = await input.repository.getGovernanceExportJob(
    input.orgId,
    input.packageId,
  );
  if (job === undefined || job.state === "deleted") return;
  const now = input.deletedAt ?? new Date().toISOString();
  const {
    leaseOwner: _leaseOwner,
    leaseExpiresAt: _leaseExpiresAt,
    ...deletingJob
  } = job;
  const updated = await input.repository.updateGovernanceExportJob({
    ...deletingJob,
    state: "deleted",
    deletedAt: now,
    updatedAt: now,
    version: job.version + 1,
  });
  if (updated === undefined) throw new Error("governance_export_job_conflict");
  const artifact = await input.repository.getGovernanceExportArtifact(
    input.orgId,
    input.packageId,
  );
  if (artifact !== undefined)
    await input.repository.updateGovernanceExportArtifact({
      ...artifact,
      deletedAt: now,
    });
}

export function publicJob(
  job: GovernanceExportJobRecord,
  artifact?: GovernanceExportArtifactRecord,
): DataExportPackageJob {
  const artifactExpired =
    artifact !== undefined && Date.parse(artifact.expiresAt) <= Date.now();
  const publicArtifact =
    artifact === undefined ||
    artifact.deletedAt !== undefined ||
    artifactExpired
      ? undefined
      : publicArtifactFor(job.id, artifact);
  return {
    schema: "romeo.data-export-package-job.v1",
    packageId: job.id,
    orgId: job.orgId,
    request: job.request,
    state:
      job.state === "deleted" ||
      (job.state === "artifact_ready" && artifactExpired)
        ? "expired"
        : job.state,
    percent: job.percent,
    processedRows: job.checkpoint.processedRows,
    attemptCount: job.leaseAttempt,
    counts: job.counts,
    limits: job.limits,
    warnings: job.warnings,
    exclusions: job.exclusions,
    ...(publicArtifact === undefined ? {} : { artifact: publicArtifact }),
    ...(job.errorCode === undefined ? {} : { errorCode: job.errorCode }),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    ...(job.completedAt === undefined ? {} : { completedAt: job.completedAt }),
    ...(artifact === undefined ? {} : { expiresAt: artifact.expiresAt }),
  };
}

function summaryFromJob(job: DataExportPackageJob): DataExportPackageSummary {
  if (job.artifact === undefined) throw new Error("export_artifact_missing");
  return {
    schema: "romeo.data-export-package-summary.v1",
    packageId: job.packageId,
    orgId: job.orgId,
    request: job.request,
    counts: job.counts,
    limits: job.limits,
    warnings: job.warnings,
    exclusions: job.exclusions,
    artifact: job.artifact,
    createdAt: job.createdAt,
  };
}

function publicArtifactFor(
  packageId: string,
  artifact: GovernanceExportArtifactRecord,
): DataExportPackageArtifact {
  return {
    contentType: artifact.contentType,
    sizeBytes: artifact.sizeBytes,
    sha256: artifact.sha256,
    downloadUrl: `/api/v1/governance/data-exports/packages/${encodeURIComponent(packageId)}/content`,
    storage: {
      driver: "object_store",
      objectKeyHash: createHash("sha256")
        .update(artifact.objectKey)
        .digest("hex"),
      rawObjectKeyReturned: false,
    },
  };
}

function legacyObjectKey(orgId: string, packageId: string): string {
  return `governance/data-exports/${encodeURIComponent(orgId)}/${encodeURIComponent(packageId)}.json`;
}

function totalRows(counts: number[]): number {
  return counts.reduce((sum, count) => sum + count, 0);
}
