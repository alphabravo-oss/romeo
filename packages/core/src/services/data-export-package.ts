import { createHash } from "node:crypto";

import type { AuthSubject } from "@romeo/auth";
import type { ObjectStore } from "@romeo/storage";

import type {
  DataExportPackageDeleteResult,
  DataExportPackage,
  DataExportPackageJob,
  DataExportPackageList,
  DataExportRequest,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { createId } from "../ids";
import {
  dataExportExclusions,
  normalizeDataExportRequest,
} from "./data-export";
import {
  listRegisteredDataExportPackages,
  removeRegisteredDataExportPackage,
  publicJob,
} from "./data-export-package-registry";
import {
  emptyCounts,
  exportLimits,
  selectedWorkspaces,
  warningsFor,
} from "./data-export-support";
import {
  deleteGovernanceExportObjects,
  GOVERNANCE_EXPORT_MANIFEST_MAX_BYTES,
  governanceExportManifestKey,
  governanceExportObjectStream,
  governanceExportPartKeys,
  parseGovernanceExportManifest,
} from "./governance-export-worker-support";

const packageContentType = "application/json";
const packageIdPattern = /^export_pkg_[a-f0-9]{20}$/u;
export {
  createGovernedDataExportPackage,
  registerGovernedDataExportPackage,
} from "./data-export-package-legacy";

export async function enqueueGovernedDataExportPackage(input: {
  repository: RomeoRepository;
  subject: AuthSubject;
  request: DataExportRequest;
}): Promise<DataExportPackageJob> {
  const request = normalizeDataExportRequest(input.request);
  await selectedWorkspaces({
    repository: input.repository,
    subject: input.subject,
    request,
  });
  const now = new Date().toISOString();
  const counts = emptyCounts();
  const job = await input.repository.createGovernanceExportJob({
    id: createId("export_pkg"),
    orgId: input.subject.orgId,
    ...(request.workspaceId === undefined
      ? {}
      : { workspaceId: request.workspaceId }),
    createdBy: input.subject.id,
    request,
    snapshotAt: now,
    state: "queued",
    percent: 0,
    checkpoint: {
      datasetIndex: 0,
      partCount: 0,
      processedRows: 0,
      sizeBytes: 0,
    },
    counts,
    limits: exportLimits(request),
    warnings: warningsFor(request, counts),
    exclusions: dataExportExclusions,
    leaseAttempt: 0,
    version: 1,
    createdAt: now,
    updatedAt: now,
  });
  return publicJob(job);
}

export async function getGovernedDataExportPackageJob(input: {
  repository: RomeoRepository;
  orgId: string;
  packageId: string;
}): Promise<DataExportPackageJob> {
  if (!packageIdPattern.test(input.packageId))
    throw notFound("Data export package");
  const job = await input.repository.getGovernanceExportJob(
    input.orgId,
    input.packageId,
  );
  if (job === undefined || job.state === "deleted")
    throw notFound("Data export package");
  const artifact = await input.repository.getGovernanceExportArtifact(
    input.orgId,
    input.packageId,
  );
  return publicJob(job, artifact);
}

export interface DataExportPackageRead {
  body: ReadableStream<Uint8Array>;
  contentType: "application/json" | "application/x-ndjson";
  fileName: string;
  packageId: string;
  sizeBytes: number;
}

export interface DataExportPackageRetentionResult {
  deletedDataExportPackageCount: number;
  missingDataExportPackageCount: number;
}

export async function readGovernedDataExportPackage(input: {
  repository: RomeoRepository;
  objectStore: ObjectStore;
  orgId: string;
  packageId: string;
}): Promise<DataExportPackageRead> {
  if (!packageIdPattern.test(input.packageId)) {
    throw notFound("Data export package");
  }
  const job = await input.repository.getGovernanceExportJob(
    input.orgId,
    input.packageId,
  );
  const artifact = await input.repository.getGovernanceExportArtifact(
    input.orgId,
    input.packageId,
  );
  if (
    job?.state !== "artifact_ready" ||
    artifact === undefined ||
    artifact.deletedAt !== undefined ||
    Date.parse(artifact.expiresAt) <= Date.now()
  )
    throw notFound("Data export package");
  if (artifact.contentType === "application/x-ndjson") {
    try {
      const bytes = await input.objectStore.getObject(artifact.objectKey, {
        maxBytes: GOVERNANCE_EXPORT_MANIFEST_MAX_BYTES,
      });
      const manifest =
        bytes === undefined
          ? undefined
          : parseGovernanceExportManifest(
              JSON.parse(new TextDecoder().decode(bytes)),
            );
      if (
        manifest === undefined ||
        manifest.jobId !== job.id ||
        manifest.orgId !== job.orgId ||
        manifest.sha256 !== artifact.sha256 ||
        manifest.sizeBytes !== artifact.sizeBytes ||
        manifest.partKeys.length !== artifact.partCount
      )
        throw integrityError();
      return {
        body: governanceExportObjectStream(input.objectStore, manifest),
        contentType: artifact.contentType,
        fileName: artifact.fileName,
        packageId: input.packageId,
        sizeBytes: artifact.sizeBytes,
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw storeUnavailable("readback");
    }
  }
  const objectKey = artifact.objectKey;
  let body: ReadableStream<Uint8Array> | undefined;
  try {
    const metadata = await input.objectStore.headObject?.(objectKey);
    if (
      metadata !== undefined &&
      (metadata.sizeBytes !== artifact.sizeBytes ||
        metadata.contentType.split(";", 1)[0] !== packageContentType)
    )
      throw integrityError();
    if (input.objectStore.getObjectStream !== undefined) {
      body = await input.objectStore.getObjectStream(objectKey, {
        maxBytes: artifact.sizeBytes,
      });
    } else {
      const bytes = await input.objectStore.getObject(objectKey, {
        maxBytes: artifact.sizeBytes,
      });
      if (bytes !== undefined) {
        assertPackageIntegrity(bytes, publicJob(job, artifact).artifact!);
        body = bytesStream(bytes);
      }
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw storeUnavailable("readback");
  }
  if (body === undefined) throw notFound("Data export package");
  return {
    body: verifiedPackageStream(body, publicJob(job, artifact).artifact!),
    contentType: packageContentType,
    fileName: `${input.packageId}.json`,
    packageId: input.packageId,
    sizeBytes: artifact.sizeBytes,
  };
}

export async function listGovernedDataExportPackages(input: {
  repository: RomeoRepository;
  orgId: string;
}): Promise<DataExportPackageList> {
  return listRegisteredDataExportPackages(input);
}

export async function deleteGovernedDataExportPackage(input: {
  repository: RomeoRepository;
  objectStore: ObjectStore;
  orgId: string;
  packageId: string;
  confirmPackageId: string;
}): Promise<DataExportPackageDeleteResult> {
  const deleted = await prepareGovernedDataExportPackageDelete(input);
  await deleteGovernedDataExportPackageObject(input);
  await removeGovernedDataExportPackageRegistration(input);
  return deleted;
}

export async function prepareGovernedDataExportPackageDelete(input: {
  repository: RomeoRepository;
  objectStore: ObjectStore;
  orgId: string;
  packageId: string;
  confirmPackageId: string;
}): Promise<DataExportPackageDeleteResult> {
  if (input.confirmPackageId !== input.packageId) {
    throw new ApiError(
      "data_export_package_confirmation_mismatch",
      "confirmPackageId must exactly match packageId.",
      400,
    );
  }
  if (!packageIdPattern.test(input.packageId)) {
    throw notFound("Data export package");
  }

  const job = await input.repository.getGovernanceExportJob(
    input.orgId,
    input.packageId,
  );
  if (job === undefined) throw notFound("Data export package");
  const artifact = await input.repository.getGovernanceExportArtifact(
    input.orgId,
    input.packageId,
  );
  const objectKey =
    artifact?.objectKey ??
    governanceExportManifestKey(input.orgId, input.packageId);

  return {
    schema: "romeo.data-export-package-delete-result.v1",
    packageId: input.packageId,
    orgId: input.orgId,
    storage: {
      driver: "object_store",
      objectKeyHash: sha256Hex(new TextEncoder().encode(objectKey)),
      rawObjectKeyReturned: false,
    },
    redaction: {
      packageContentReturned: false,
      rawObjectKeysReturned: false,
    },
    deletedAt: job.deletedAt ?? new Date().toISOString(),
  };
}

export async function removeGovernedDataExportPackageRegistration(input: {
  repository: RomeoRepository;
  orgId: string;
  packageId: string;
  deletedAt?: string;
}): Promise<void> {
  await removeRegisteredDataExportPackage(input);
}

export async function deleteGovernedDataExportPackageObject(input: {
  repository: RomeoRepository;
  objectStore: ObjectStore;
  orgId: string;
  packageId: string;
}): Promise<void> {
  const artifact = await input.repository.getGovernanceExportArtifact(
    input.orgId,
    input.packageId,
  );
  if (artifact === undefined) return;
  try {
    if (artifact.contentType === "application/json") {
      await input.objectStore.deleteObject(artifact.objectKey);
      return;
    }
    await deleteGovernanceExportObjects(
      input.objectStore,
      artifact.objectKey,
      governanceExportPartKeys(
        input.orgId,
        input.packageId,
        artifact.partCount,
      ),
    );
  } catch {
    throw storeUnavailable("deletion");
  }
}

export async function enforceGovernedDataExportPackageRetention(input: {
  repository: RomeoRepository;
  objectStore: ObjectStore;
  orgId: string;
  cutoffAt: string;
}): Promise<DataExportPackageRetentionResult> {
  const cutoffMs = Date.parse(input.cutoffAt);
  if (!Number.isFinite(cutoffMs)) {
    return {
      deletedDataExportPackageCount: 0,
      missingDataExportPackageCount: 0,
    };
  }

  let deletedDataExportPackageCount = 0;
  let missingDataExportPackageCount = 0;
  const registered = await listRegisteredDataExportPackages({
    repository: input.repository,
    orgId: input.orgId,
  });

  for (const item of registered.jobs) {
    const createdAtMs = Date.parse(item.createdAt);
    const artifact = await input.repository.getGovernanceExportArtifact(
      input.orgId,
      item.packageId,
    );
    const artifactExpired =
      artifact !== undefined && Date.parse(artifact.expiresAt) <= Date.now();
    const retentionExpired =
      Number.isFinite(createdAtMs) && createdAtMs < cutoffMs;
    if (!artifactExpired && !retentionExpired) continue;
    try {
      if (artifact === undefined) {
        missingDataExportPackageCount += 1;
      } else {
        await deleteGovernedDataExportPackageObject({
          repository: input.repository,
          objectStore: input.objectStore,
          orgId: input.orgId,
          packageId: item.packageId,
        });
        deletedDataExportPackageCount += 1;
      }
    } catch {
      throw new ApiError(
        "data_export_package_store_unavailable",
        "Object storage is not available for data export package retention.",
        503,
      );
    }

    await removeRegisteredDataExportPackage({
      repository: input.repository,
      orgId: input.orgId,
      packageId: item.packageId,
    });
  }

  return {
    deletedDataExportPackageCount,
    missingDataExportPackageCount,
  };
}

function bytesStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function verifiedPackageStream(
  source: ReadableStream<Uint8Array>,
  artifact: DataExportPackage["artifact"],
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  const digest = createHash("sha256");
  let sizeBytes = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          reader.releaseLock();
          if (
            sizeBytes !== artifact.sizeBytes ||
            digest.digest("hex") !== artifact.sha256
          ) {
            controller.error(integrityError());
            return;
          }
          controller.close();
          return;
        }
        sizeBytes += value.byteLength;
        if (sizeBytes > artifact.sizeBytes) {
          await reader.cancel();
          controller.error(integrityError());
          return;
        }
        digest.update(value);
        controller.enqueue(value);
      } catch (error) {
        controller.error(error);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

function assertPackageIntegrity(
  bytes: Uint8Array,
  artifact: DataExportPackage["artifact"],
): void {
  if (
    bytes.byteLength !== artifact.sizeBytes ||
    sha256Hex(bytes) !== artifact.sha256
  )
    throw integrityError();
}

function integrityError() {
  return new ApiError(
    "data_export_package_integrity_failed",
    "The stored data export package failed integrity verification.",
    500,
  );
}

function storeUnavailable(operation: "deletion" | "readback") {
  return new ApiError(
    "data_export_package_store_unavailable",
    `Object storage is not available for data export package ${operation}.`,
    503,
  );
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
