import { statSync, writeFileSync } from "node:fs";
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
const dryRun = hasFlag("--dry-run");

if (dryRun) {
  printPlan({
    operation: "object_store.backup",
    objectStore: redactedObjectStore(config),
    prefix,
    maxKeys,
    outputDir,
    manifestOutput,
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
  });
}

const completedAt = new Date();
writeFileSync(
  manifestOutput,
  `${JSON.stringify(
    {
      schemaVersion: "romeo.object-store-backup.v1",
      generatedAt: completedAt.toISOString(),
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
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
