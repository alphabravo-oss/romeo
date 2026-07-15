import { createHash } from "node:crypto";

import type { AuthSubject } from "@romeo/auth";
import type { ObjectStore } from "@romeo/storage";

import type {
  DataExportPackageDeleteResult,
  DataExportPackage,
  DataExportPackageList,
  DataExportRequest,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { createId } from "../ids";
import { executeDataExport } from "./data-export";
import {
  listRegisteredDataExportPackages,
  registerDataExportPackage,
  removeRegisteredDataExportPackage,
} from "./data-export-package-registry";

const packageContentType = "application/json";
const packageIdPattern = /^export_pkg_[a-f0-9]{20}$/u;

export interface DataExportPackageRead {
  bytes: Uint8Array;
  contentType: typeof packageContentType;
  fileName: string;
  packageId: string;
}

export interface DataExportPackageRetentionResult {
  deletedDataExportPackageCount: number;
  missingDataExportPackageCount: number;
}

export async function createGovernedDataExportPackage(input: {
  register?: boolean | undefined;
  repository: RomeoRepository;
  objectStore: ObjectStore;
  subject: AuthSubject;
  request: DataExportRequest;
}): Promise<DataExportPackage> {
  const exported = await executeDataExport({
    repository: input.repository,
    objectStore: input.objectStore,
    subject: input.subject,
    request: input.request,
  });
  const packageId = createId("export_pkg");
  const objectKey = dataExportPackageObjectKey(input.subject.orgId, packageId);
  const bytes = new TextEncoder().encode(JSON.stringify(exported, null, 2));
  const digest = sha256Hex(bytes);
  let storedAt = new Date().toISOString();

  try {
    const stored = await input.objectStore.putObject({
      key: objectKey,
      body: bytes,
      contentType: packageContentType,
    });
    storedAt = stored.updatedAt;
  } catch {
    throw new ApiError(
      "data_export_package_store_unavailable",
      "Object storage is not available for data export packages.",
      503,
    );
  }

  const packaged: DataExportPackage = {
    schema: "romeo.data-export-package.v1",
    packageId,
    orgId: input.subject.orgId,
    request: exported.request,
    counts: exported.counts,
    limits: exported.limits,
    warnings: exported.warnings,
    exclusions: exported.exclusions,
    artifact: {
      contentType: packageContentType,
      sizeBytes: bytes.byteLength,
      sha256: digest,
      downloadUrl: dataExportPackageDownloadUrl(packageId),
      storage: {
        driver: "object_store",
        objectKeyHash: sha256Hex(new TextEncoder().encode(objectKey)),
        rawObjectKeyReturned: false,
      },
    },
    createdAt: storedAt,
  };
  if (input.register !== false) {
    await registerGovernedDataExportPackage({
      repository: input.repository,
      package: packaged,
    });
  }
  return packaged;
}

export async function registerGovernedDataExportPackage(input: {
  repository: RomeoRepository;
  package: DataExportPackage;
}): Promise<void> {
  await registerDataExportPackage(input);
}

export async function readGovernedDataExportPackage(input: {
  objectStore: ObjectStore;
  orgId: string;
  packageId: string;
}): Promise<DataExportPackageRead> {
  if (!packageIdPattern.test(input.packageId)) {
    throw notFound("Data export package");
  }
  const objectKey = dataExportPackageObjectKey(input.orgId, input.packageId);
  let bytes: Uint8Array | undefined;
  try {
    bytes = await input.objectStore.getObject(objectKey);
  } catch {
    throw new ApiError(
      "data_export_package_store_unavailable",
      "Object storage is not available for data export package readback.",
      503,
    );
  }
  if (bytes === undefined) throw notFound("Data export package");
  return {
    bytes,
    contentType: packageContentType,
    fileName: `${input.packageId}.json`,
    packageId: input.packageId,
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

  const objectKey = dataExportPackageObjectKey(input.orgId, input.packageId);
  try {
    const bytes = await input.objectStore.getObject(objectKey);
    if (bytes === undefined) throw notFound("Data export package");
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      "data_export_package_store_unavailable",
      "Object storage is not available for data export package deletion.",
      503,
    );
  }

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
    deletedAt: new Date().toISOString(),
  };
}

export async function removeGovernedDataExportPackageRegistration(input: {
  repository: RomeoRepository;
  orgId: string;
  packageId: string;
}): Promise<void> {
  await removeRegisteredDataExportPackage(input);
}

export async function deleteGovernedDataExportPackageObject(input: {
  objectStore: ObjectStore;
  orgId: string;
  packageId: string;
}): Promise<void> {
  await input.objectStore.deleteObject(
    dataExportPackageObjectKey(input.orgId, input.packageId),
  );
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

  for (const item of registered.packages) {
    const createdAtMs = Date.parse(item.createdAt);
    if (!Number.isFinite(createdAtMs) || createdAtMs >= cutoffMs) continue;

    const objectKey = dataExportPackageObjectKey(input.orgId, item.packageId);
    try {
      const bytes = await input.objectStore.getObject(objectKey);
      if (bytes === undefined) {
        missingDataExportPackageCount += 1;
      } else {
        await input.objectStore.deleteObject(objectKey);
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

function dataExportPackageObjectKey(orgId: string, packageId: string): string {
  return `governance/data-exports/${encodePathPart(orgId)}/${encodePathPart(
    packageId,
  )}.json`;
}

function dataExportPackageDownloadUrl(packageId: string): string {
  return `/api/v1/governance/data-exports/packages/${encodeURIComponent(
    packageId,
  )}/content`;
}

function encodePathPart(value: string): string {
  return encodeURIComponent(value).replace(/%2F/giu, "%252F");
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
