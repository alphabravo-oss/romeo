import { readFileSync } from "node:fs";

import {
  argValue,
  assertFileSha256,
  hasFlag,
  manifestObjectAbsolutePath,
  printPlan,
  readRestoreObjectStoreConfig,
  redactedObjectStore,
  resolveRepoPath,
  uploadObject,
  validateObjectStoreManifest,
} from "./lib/object-store-maintenance.mjs";

const manifestValue = argValue("--manifest");
if (manifestValue === undefined || manifestValue.length === 0)
  throw new Error("--manifest is required.");

const config = readRestoreObjectStoreConfig();
const manifestPath = resolveRepoPath(manifestValue);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
validateObjectStoreManifest(manifest);

const dryRun = hasFlag("--dry-run");
const confirmed = hasFlag("--confirm");

if (dryRun) {
  printPlan({
    operation: "object_store.restore",
    objectStore: redactedObjectStore(config),
    manifest: manifestPath,
    objectCount: manifest.objects.length,
    totalBytes: manifest.totalBytes,
    requiresConfirm: true,
  });
  process.exit(0);
}

if (!confirmed) {
  throw new Error(
    "Object-store restore is destructive. Re-run with --confirm after validating the target bucket and manifest.",
  );
}

const restored = [];
for (const object of manifest.objects) {
  const file = manifestObjectAbsolutePath(manifestPath, object.file);
  await assertFileSha256(file, object.sha256);
  restored.push(
    await uploadObject(config, {
      key: object.key,
      file,
      contentType: object.contentType,
    }),
  );
}

console.log(
  `Restored ${restored.length} object${restored.length === 1 ? "" : "s"} from ${manifestPath}`,
);
