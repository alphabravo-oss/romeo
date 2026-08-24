#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const directory = mkdtempSync(join(tmpdir(), "romeo-coordinated-restore-"));
const backupPath = join(directory, "postgres.dump");
const postgresManifestPath = join(directory, "postgres.json");
const objectManifestPath = join(directory, "objects.json");
const backupSetId = "backup-set-2026-08-23-001";
writeFileSync(backupPath, "database-backup", "utf8");

const postgresManifest = {
  schemaVersion: "romeo.postgres-backup.v2",
  backupSetId,
  checkpointAt: "2026-08-23T12:00:00.000Z",
  destinationPolicy: { policySha256: "a".repeat(64) },
  backup: { sha256: digest(backupPath) },
};
const objectManifest = {
  schemaVersion: "romeo.object-store-backup.v2",
  backupSetId,
  checkpointAt: "2026-08-23T12:01:00.000Z",
  destinationPolicy: { verified: true, policySha256: "b".repeat(64) },
  sourceConsistency: { status: "verified" },
  objectCount: 0,
  totalBytes: 0,
  objects: [],
};

writeJson(postgresManifestPath, postgresManifest);
writeJson(objectManifestPath, objectManifest);
expect(0, [], "matching backup set");

writeJson(objectManifestPath, {
  ...objectManifest,
  backupSetId: "different-set",
});
expect(1, [], "mismatched backup set");

writeJson(objectManifestPath, {
  ...objectManifest,
  checkpointAt: "2026-08-23T13:00:00.000Z",
});
expect(1, [], "checkpoint skew");

writeJson(objectManifestPath, {
  ...objectManifest,
  destinationPolicy: { ...objectManifest.destinationPolicy, verified: false },
});
expect(1, [], "unverified object backup destination");

writeJson(objectManifestPath, objectManifest);
expect(
  1,
  ["--object-manifest-sha256", "c".repeat(64)],
  "wrong manifest digest",
);

console.log(
  "coordinated restore: positive plan and 4 fail-closed cases passed",
);

function expect(expectedStatus, extra, label) {
  const objectDigestArgs = extra.includes("--object-manifest-sha256")
    ? extra
    : ["--object-manifest-sha256", digest(objectManifestPath), ...extra];
  const args = [
    "scripts/coordinated-restore.mjs",
    "--dry-run",
    "--postgres-manifest",
    postgresManifestPath,
    "--postgres-backup",
    backupPath,
    "--object-manifest",
    objectManifestPath,
    "--postgres-manifest-sha256",
    digest(postgresManifestPath),
    ...objectDigestArgs,
  ];
  const result = spawnSync(process.execPath, args, { encoding: "utf8" });
  if (result.status !== expectedStatus)
    throw new Error(
      `${label} returned ${result.status}; expected ${expectedStatus}: ${result.stderr || result.stdout}`,
    );
}

function digest(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
