import { readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import {
  argInteger,
  argValue,
  downloadObject,
  ensureDirectory,
  ensureParentDirectory,
  hasFlag,
  listObjects,
  manifestObjectPath,
  printPlan,
  readSourceObjectStoreConfig,
  redactedObjectStore,
  relativeManifestPath,
  resolveRepoPath,
  timestampForFilename,
} from "./lib/object-store-maintenance.mjs";
import { validateBackupDestinationPolicy } from "./lib/backup-destination-policy.mjs";

const config = readSourceObjectStoreConfig();
const outputDirValue = argValue("--output-dir");
const outputDir =
  outputDirValue === undefined
    ? resolveRepoPath(`backups/object-store-${timestampForFilename()}`)
    : resolveRepoPath(outputDirValue);
const manifestOutputValue = argValue("--manifest-output");
const manifestOutput =
  manifestOutputValue === undefined
    ? `${outputDir}/manifest.json`
    : resolveRepoPath(manifestOutputValue);
const prefix = argValue("--prefix") ?? "";
const maxKeys = argInteger("--max-keys", 1000);
const developmentLocalPolicy = hasFlag(
  "--allow-unverified-development-destination",
);
const invokedAt = new Date();
const backupSetId =
  argValue("--backup-set-id") ??
  (developmentLocalPolicy
    ? `development-${invokedAt.toISOString()}`
    : undefined);
const checkpointAt =
  argValue("--checkpoint-at") ??
  (developmentLocalPolicy ? invokedAt.toISOString() : undefined);
const destinationPolicyPathValue =
  argValue("--destination-policy-file") ??
  process.env.OBJECT_STORE_BACKUP_POLICY_FILE;
const destinationPolicyMaxAgeSeconds = argInteger(
  "--destination-policy-max-age-seconds",
  3600,
);
const retentionDays = argInteger("--retention-days", 30);
const dryRun = hasFlag("--dry-run");

validateInputs();
const destinationPolicy = developmentLocalPolicy
  ? {
      schemaVersion: "romeo.backup-destination-policy.development.v1",
      verifiedAt: invokedAt.toISOString(),
      verified: false,
      policySha256: "0".repeat(64),
    }
  : validateBackupDestinationPolicy(
      JSON.parse(
        readFileSync(resolveRepoPath(destinationPolicyPathValue), "utf8"),
      ),
      {
        maximumAgeSeconds: destinationPolicyMaxAgeSeconds,
        minimumRetentionDays: retentionDays,
      },
    );

if (dryRun) {
  printPlan({
    operation: "object_store.backup",
    objectStore: redactedObjectStore(config),
    prefix,
    maxKeys,
    outputDir,
    manifestOutput,
    backupSetId,
    checkpointAt,
    destinationPolicyFile: destinationPolicyPathValue,
    destinationPolicy,
  });
  process.exit(0);
}

ensureDirectory(outputDir);
ensureParentDirectory(manifestOutput);

const listedObjects = await listObjects(config, { prefix, maxKeys });
const startedAt = new Date();
const objects = [];

for (const [index, listedObject] of listedObjects.entries()) {
  const downloaded = await downloadObject(
    config,
    listedObject,
    manifestObjectPath(outputDir, index, listedObject.key),
  );
  objects.push({
    key: downloaded.key,
    file: relativeManifestPath(downloaded.file, dirname(manifestOutput)),
    bytes: downloaded.bytes,
    sha256: downloaded.sha256,
    contentType: downloaded.contentType,
    etag: downloaded.etag,
    lastModified: downloaded.lastModified,
    versionId: downloaded.versionId,
    serverSideEncryption: downloaded.serverSideEncryption,
  });
}

const verifiedListing = await listObjects(config, { prefix, maxKeys });
verifyStableListing(listedObjects, verifiedListing);

const completedAt = new Date();
writeFileSync(
  manifestOutput,
  `${JSON.stringify(
    {
      schemaVersion: "romeo.object-store-backup.v2",
      generatedAt: completedAt.toISOString(),
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      backupSetId,
      checkpointAt: new Date(checkpointAt).toISOString(),
      destinationPolicy,
      sourceConsistency: {
        status: "verified",
        listingCount: verifiedListing.length,
        verifiedAt: completedAt.toISOString(),
      },
      durationMs: completedAt.getTime() - startedAt.getTime(),
      objectStore: redactedObjectStore(config),
      prefix,
      objectCount: objects.length,
      totalBytes: objects.reduce((sum, object) => sum + object.bytes, 0),
      objects,
    },
    null,
    2,
  )}\n`,
  "utf8",
);

console.log(`Wrote object-store backup manifest to ${manifestOutput}`);
console.log(
  `Downloaded ${objects.length} object${objects.length === 1 ? "" : "s"} into ${outputDir} (${statSync(manifestOutput).size} manifest bytes).`,
);

function validateInputs() {
  if (developmentLocalPolicy && process.env.ROMEO_ENV === "production")
    throw new Error(
      "--allow-unverified-development-destination is forbidden in production.",
    );
  if (typeof backupSetId !== "string" || backupSetId.trim().length < 8)
    throw new Error(
      "--backup-set-id is required and must be at least 8 characters.",
    );
  if (
    typeof checkpointAt !== "string" ||
    Number.isNaN(new Date(checkpointAt).getTime())
  )
    throw new Error(
      "--checkpoint-at is required and must be an ISO timestamp.",
    );
  if (
    !developmentLocalPolicy &&
    (typeof destinationPolicyPathValue !== "string" ||
      destinationPolicyPathValue.length === 0)
  )
    throw new Error(
      "--destination-policy-file or OBJECT_STORE_BACKUP_POLICY_FILE is required.",
    );
}

function verifyStableListing(before, after) {
  if (before.length !== after.length)
    throw new Error("Object-store source changed during backup.");
  const afterByKey = new Map(after.map((object) => [object.key, object]));
  for (const object of before) {
    const current = afterByKey.get(object.key);
    if (
      current === undefined ||
      current.bytes !== object.bytes ||
      current.etag !== object.etag ||
      current.lastModified !== object.lastModified
    )
      throw new Error(
        `Object-store source changed during backup: ${object.key}`,
      );
  }
}
