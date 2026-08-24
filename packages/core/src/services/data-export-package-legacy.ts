import { createHash } from "node:crypto";

import type { AuthSubject } from "@romeo/auth";
import type { ObjectStore } from "@romeo/storage";

import type { DataExportPackage, DataExportRequest } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { createId } from "../ids";
import { executeDataExport } from "./data-export";
import { registerDataExportPackage } from "./data-export-package-registry";

const packageMaxBytes = 50_000_000;

/** Legacy internal helper retained only for migration and compatibility tests. */
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
  const objectKey = legacyObjectKey(input.subject.orgId, packageId);
  const bytes = new TextEncoder().encode(JSON.stringify(exported));
  if (bytes.byteLength > packageMaxBytes)
    throw new ApiError(
      "data_export_package_too_large",
      "The data export package exceeds the maximum supported size.",
      413,
      { maxBytes: packageMaxBytes },
    );
  let createdAt: string;
  try {
    createdAt = (
      await input.objectStore.putObject({
        key: objectKey,
        body: bytes,
        contentType: "application/json",
      })
    ).updatedAt;
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
      contentType: "application/json",
      sizeBytes: bytes.byteLength,
      sha256: hash(bytes),
      downloadUrl: `/api/v1/governance/data-exports/packages/${encodeURIComponent(packageId)}/content`,
      storage: {
        driver: "object_store",
        objectKeyHash: hash(new TextEncoder().encode(objectKey)),
        rawObjectKeyReturned: false,
      },
    },
    createdAt,
  };
  if (input.register !== false)
    await registerGovernedDataExportPackage({
      repository: input.repository,
      package: packaged,
    });
  return packaged;
}

export function registerGovernedDataExportPackage(input: {
  repository: RomeoRepository;
  package: DataExportPackage;
}): Promise<void> {
  return registerDataExportPackage(input);
}

function legacyObjectKey(orgId: string, packageId: string): string {
  return `governance/data-exports/${encodeURIComponent(orgId).replace(/%2F/giu, "%252F")}/${encodeURIComponent(packageId).replace(/%2F/giu, "%252F")}.json`;
}

function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
