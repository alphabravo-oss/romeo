import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

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
  listObjects,
  downloadObject,
} from "./lib/object-store-maintenance.mjs";

const manifestValue = argValue("--manifest");
if (manifestValue === undefined || manifestValue.length === 0)
  throw new Error("--manifest is required.");

const config = readRestoreObjectStoreConfig();
const manifestPath = resolveRepoPath(manifestValue);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
validateObjectStoreManifest(manifest);

const dryRun = hasFlag("--dry-run");
const confirmed = hasFlag("--confirm-isolated-target");

if (dryRun) {
  printPlan({
    operation: "object_store.restore",
    objectStore: redactedObjectStore(config),
    manifest: manifestPath,
    objectCount: manifest.objects.length,
    totalBytes: manifest.totalBytes,
    requiresConfirmIsolatedTarget: true,
  });
  process.exit(0);
}

if (!confirmed) {
  throw new Error(
    "Object-store restore is destructive. Re-run with --confirm-isolated-target after selecting an empty isolated target bucket.",
  );
}

const existing = await listObjects(config, { prefix: manifest.prefix ?? "" });
if (existing.length > 0)
  throw new Error(
    "Isolated restore target is not empty; refusing to overwrite or leave orphaned objects.",
  );

const restored = [];
const verificationDirectory = mkdtempSync(
  join(tmpdir(), "romeo-object-restore-readback-"),
);
try {
  for (const [index, object] of manifest.objects.entries()) {
    const file = manifestObjectAbsolutePath(manifestPath, object.file);
    await assertFileSha256(file, object.sha256);
    await uploadObject(config, {
      key: object.key,
      file,
      contentType: object.contentType,
    });
    const readback = await downloadObject(
      config,
      object,
      join(verificationDirectory, `${index}.bin`),
    );
    await assertFileSha256(readback.file, object.sha256);
    restored.push({
      key: object.key,
      bytes: readback.bytes,
      sha256: readback.sha256,
      versionId: readback.versionId,
      serverSideEncryption: readback.serverSideEncryption,
    });
  }
  const after = await listObjects(config, { prefix: manifest.prefix ?? "" });
  const restoredKeys = new Set(restored.map((object) => object.key));
  const unexpected = after.filter((object) => !restoredKeys.has(object.key));
  const missing = restored.filter(
    (object) => !after.some((listed) => listed.key === object.key),
  );
  if (unexpected.length > 0 || missing.length > 0)
    throw new Error(
      `Object restore reconciliation failed (${missing.length} missing, ${unexpected.length} unexpected).`,
    );
} finally {
  rmSync(verificationDirectory, { force: true, recursive: true });
}

console.log(
  `Restored ${restored.length} object${restored.length === 1 ? "" : "s"} from ${manifestPath}`,
);
