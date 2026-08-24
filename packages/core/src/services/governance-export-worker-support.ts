import { createHash } from "node:crypto";

import type { ObjectStore } from "@romeo/storage";

export const GOVERNANCE_EXPORT_PAGE_SIZE = 100;
export const GOVERNANCE_EXPORT_PART_MAX_BYTES = 8 * 1_048_576;
export const GOVERNANCE_EXPORT_ARTIFACT_MAX_BYTES = 500 * 1_048_576;
export const GOVERNANCE_EXPORT_MANIFEST_MAX_BYTES = 1_048_576;
export const GOVERNANCE_EXPORT_LEASE_SECONDS = 60;
export const GOVERNANCE_EXPORT_MAX_ATTEMPTS = 3;
export const GOVERNANCE_EXPORT_ARTIFACT_TTL_MS = 24 * 60 * 60 * 1_000;
export const GOVERNANCE_EXPORT_MANIFEST_SCHEMA =
  "romeo.governance-export-manifest.v1";

export interface GovernanceExportManifest {
  schema: typeof GOVERNANCE_EXPORT_MANIFEST_SCHEMA;
  jobId: string;
  orgId: string;
  partKeys: string[];
  sizeBytes: number;
  sha256: string;
  createdAt: string;
  expiresAt: string;
}

export function encodeGovernanceExportPart(
  dataset: string,
  records: Array<Record<string, unknown>>,
): Uint8Array {
  const lines = records.map((record) => JSON.stringify({ dataset, record }));
  return new TextEncoder().encode(
    lines.length === 0 ? "" : `${lines.join("\n")}\n`,
  );
}

export function governanceExportPartKey(
  orgId: string,
  jobId: string,
  index: number,
): string {
  return `governance/data-exports/${safePart(orgId)}/${safePart(jobId)}/part-${index}.ndjson`;
}

export function governanceExportManifestKey(
  orgId: string,
  jobId: string,
): string {
  return `governance/data-exports/${safePart(orgId)}/${safePart(jobId)}/manifest.json`;
}

export function governanceExportPartKeys(
  orgId: string,
  jobId: string,
  partCount: number,
): string[] {
  return Array.from({ length: partCount }, (_, index) =>
    governanceExportPartKey(orgId, jobId, index),
  );
}

export async function artifactDigest(
  objectStore: ObjectStore,
  partKeys: string[],
): Promise<{ sha256: string; sizeBytes: number }> {
  const digest = createHash("sha256");
  let sizeBytes = 0;
  for (const key of partKeys) {
    const bytes = await objectStore.getObject(key, {
      maxBytes: GOVERNANCE_EXPORT_PART_MAX_BYTES,
    });
    if (bytes === undefined) throw new Error("governance_export_part_missing");
    digest.update(bytes);
    sizeBytes += bytes.byteLength;
    if (sizeBytes > GOVERNANCE_EXPORT_ARTIFACT_MAX_BYTES)
      throw new Error("governance_export_artifact_too_large");
  }
  return { sha256: digest.digest("hex"), sizeBytes };
}

export function parseGovernanceExportManifest(
  value: unknown,
): GovernanceExportManifest | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const candidate = value as Partial<GovernanceExportManifest>;
  return candidate.schema === GOVERNANCE_EXPORT_MANIFEST_SCHEMA &&
    typeof candidate.jobId === "string" &&
    typeof candidate.orgId === "string" &&
    Array.isArray(candidate.partKeys) &&
    candidate.partKeys.every((key) => typeof key === "string") &&
    typeof candidate.sizeBytes === "number" &&
    typeof candidate.sha256 === "string" &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.expiresAt === "string"
    ? (candidate as GovernanceExportManifest)
    : undefined;
}

export function governanceExportObjectStream(
  objectStore: ObjectStore,
  manifest: GovernanceExportManifest,
): ReadableStream<Uint8Array> {
  let index = 0;
  let sizeBytes = 0;
  const digest = createHash("sha256");
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const key = manifest.partKeys[index];
        if (key === undefined) {
          if (
            sizeBytes !== manifest.sizeBytes ||
            digest.digest("hex") !== manifest.sha256
          ) {
            controller.error(new Error("governance_export_integrity_failure"));
            return;
          }
          controller.close();
          return;
        }
        const bytes = await objectStore.getObject(key, {
          maxBytes: GOVERNANCE_EXPORT_PART_MAX_BYTES,
        });
        if (bytes === undefined)
          throw new Error("governance_export_part_missing");
        sizeBytes += bytes.byteLength;
        if (sizeBytes > manifest.sizeBytes)
          throw new Error("governance_export_integrity_failure");
        digest.update(bytes);
        index += 1;
        controller.enqueue(bytes);
      } catch (error) {
        controller.error(error);
      }
    },
  });
}

export async function deleteGovernanceExportObjects(
  objectStore: ObjectStore,
  manifestKey: string,
  partKeys: string[],
): Promise<void> {
  for (const key of [...partKeys, manifestKey])
    await objectStore.deleteObject(key);
}

function safePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/gu, "_").slice(0, 120);
}
