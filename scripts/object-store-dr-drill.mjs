import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import {
  argValue,
  assertFileSha256,
  downloadObject,
  ensureParentDirectory,
  hasFlag,
  listObjects,
  manifestObjectAbsolutePath,
  printPlan,
  readRestoreObjectStoreConfig,
  redactedObjectStore,
  resolveRepoPath,
  timestampForFilename,
  validateObjectStoreManifest,
} from "./lib/object-store-maintenance.mjs";

const manifestValue = argValue("--manifest");
if (manifestValue === undefined || manifestValue.length === 0)
  throw new Error("--manifest is required.");

const manifestPath = resolveRepoPath(manifestValue);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
validateObjectStoreManifest(manifest);

const outputValue = argValue("--output");
const output =
  outputValue === undefined
    ? resolveRepoPath(
        `backups/romeo-object-store-dr-drill-${timestampForFilename()}.json`,
      )
    : resolveRepoPath(outputValue);
const config = readRestoreObjectStoreConfig();
const dryRun = hasFlag("--dry-run");
const confirmed = hasFlag("--confirm-isolated-target");

if (dryRun) {
  printPlan({
    operation: "object_store.dr_drill",
    objectStore: redactedObjectStore(config),
    manifest: manifestPath,
    output,
    objectCount: manifest.objects.length,
    totalBytes: manifest.totalBytes,
    requiresConfirm: true,
  });
  process.exit(0);
}

if (!confirmed) {
  throw new Error(
    "Object-store restore drills are destructive. Re-run with --confirm-isolated-target after selecting an isolated target bucket.",
  );
}

const startedAt = new Date();
const restoreResult = spawnSync(
  process.execPath,
  ["scripts/object-store-restore.mjs", "--manifest", manifestPath, "--confirm"],
  {
    cwd: resolveRepoPath("."),
    env: process.env,
    stdio: "inherit",
  },
);
const restoredAt = new Date();
let verified = [];
let status = restoreResult.status === 0 ? "passed" : "failed";
const verificationDir = mkdtempSync(
  join(tmpdir(), "romeo-object-store-drill-"),
);

try {
  if (restoreResult.status === 0) {
    const targetObjects = await listObjects(config, {
      prefix: manifest.prefix ?? "",
    });
    const targetKeys = new Set(targetObjects.map((object) => object.key));
    for (const object of manifest.objects) {
      if (!targetKeys.has(object.key))
        throw new Error(`Restored target is missing object ${object.key}.`);
      const sourceFile = manifestObjectAbsolutePath(manifestPath, object.file);
      await assertFileSha256(sourceFile, object.sha256);
      const downloaded = await downloadObject(
        config,
        object,
        join(verificationDir, Buffer.from(object.key).toString("base64url")),
      );
      await assertFileSha256(downloaded.file, object.sha256);
      verified.push({
        key: object.key,
        bytes: downloaded.bytes,
        sha256: downloaded.sha256,
      });
    }
  }
} catch (error) {
  status = "failed";
  verified = verified.length === 0 ? [] : verified;
  writeEvidence({
    startedAt,
    restoredAt,
    status,
    restoreResult,
    verified,
    error,
  });
  throw error;
} finally {
  rmSync(verificationDir, { force: true, recursive: true });
}

writeEvidence({ startedAt, restoredAt, status, restoreResult, verified });
if (restoreResult.status !== 0) process.exit(restoreResult.status ?? 1);

function writeEvidence(input) {
  const completedAt = new Date();
  const evidence = {
    schemaVersion: "romeo.object-store-dr-drill.v1",
    status: input.status,
    startedAt: input.startedAt.toISOString(),
    restoredAt: input.restoredAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - input.startedAt.getTime(),
    objectStore: redactedObjectStore(config),
    manifest: manifestPath,
    objectCount: manifest.objects.length,
    totalBytes: manifest.totalBytes,
    restoreExitCode: input.restoreResult.status ?? 1,
    verifiedObjects: input.verified,
    error: input.error instanceof Error ? input.error.message : undefined,
  };
  ensureParentDirectory(output);
  writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(`Wrote object-store DR drill evidence to ${output}`);
}
