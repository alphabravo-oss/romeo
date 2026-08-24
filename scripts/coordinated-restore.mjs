#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { relative } from "node:path";
import { spawnSync } from "node:child_process";

import {
  argValue,
  ensureParentDirectory,
  hasFlag,
  repoPath,
} from "./lib/postgres-maintenance.mjs";
import {
  resolveRepoPath,
  validateObjectStoreManifest,
} from "./lib/object-store-maintenance.mjs";

const postgresManifestPath = requiredPath("--postgres-manifest");
const postgresBackupPath = requiredPath("--postgres-backup");
const objectManifestPath = requiredPath("--object-manifest");
const outputPath = resolveRepoPath(
  argValue("--output") ?? "backups/coordinated-restore-evidence.json",
);
const maximumCheckpointSkewSeconds = positiveInteger(
  argValue("--maximum-checkpoint-skew-seconds") ?? "300",
  "--maximum-checkpoint-skew-seconds",
);
const dryRun = hasFlag("--dry-run");
const confirmed = hasFlag("--confirm-isolated-target");

const postgresManifest = readJson(postgresManifestPath);
const objectManifest = readJson(objectManifestPath);
validateObjectStoreManifest(objectManifest);
validatePostgresManifest(postgresManifest);
validateBackupSet();
verifyExpectedDigest(
  postgresManifestPath,
  argValue("--postgres-manifest-sha256"),
  "Postgres manifest",
);
verifyExpectedDigest(
  objectManifestPath,
  argValue("--object-manifest-sha256"),
  "Object manifest",
);
verifyExpectedDigest(
  postgresBackupPath,
  postgresManifest.backup.sha256,
  "Postgres backup",
);

if (dryRun) {
  process.stdout.write(
    `${JSON.stringify(
      {
        schemaVersion: "romeo.coordinated-restore-plan.v1",
        dryRun: true,
        backupSetId: postgresManifest.backupSetId,
        checkpointAt: postgresManifest.checkpointAt,
        postgresManifest: relative(repoPath("."), postgresManifestPath),
        objectManifest: relative(repoPath("."), objectManifestPath),
        requiresConfirmIsolatedTarget: true,
        restoreOrder: ["object_store", "postgres"],
      },
      null,
      2,
    )}\n`,
  );
  process.exit(0);
}

if (!confirmed)
  throw new Error(
    "Coordinated restore requires --confirm-isolated-target for isolated database and object-store targets.",
  );

const startedAt = new Date();
const operations = [];
let status = "failed";
try {
  runOperation("object_store", [
    "scripts/object-store-restore.mjs",
    "--manifest",
    objectManifestPath,
    "--confirm-isolated-target",
  ]);
  runOperation("postgres", [
    "scripts/postgres-restore.mjs",
    "--input",
    postgresBackupPath,
    "--expected-sha256",
    postgresManifest.backup.sha256,
    "--confirm",
  ]);
  status = "passed";
} finally {
  const completedAt = new Date();
  const evidence = {
    schemaVersion: "romeo.coordinated-restore-evidence.v1",
    status,
    backupSetId: postgresManifest.backupSetId,
    checkpointAt: postgresManifest.checkpointAt,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
    restoreOrder: ["object_store", "postgres"],
    operations,
    manifests: {
      postgresSha256: sha256File(postgresManifestPath),
      objectStoreSha256: sha256File(objectManifestPath),
    },
    redaction: {
      databaseUrlReturned: false,
      objectStoreCredentialsReturned: false,
      commandOutputReturned: false,
      environmentReturned: false,
    },
  };
  ensureParentDirectory(outputPath);
  writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

console.log(`Coordinated restore passed; evidence written to ${outputPath}`);

function runOperation(name, args) {
  const startedAt = new Date();
  const result = spawnSync(process.execPath, args, {
    cwd: repoPath("."),
    env: process.env,
    stdio: "inherit",
  });
  operations.push({
    name,
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    exitCode: result.status ?? 1,
    status: result.status === 0 ? "passed" : "failed",
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0)
    throw new Error(`${name} restore failed with exit code ${result.status}.`);
}

function validateBackupSet() {
  if (postgresManifest.backupSetId !== objectManifest.backupSetId)
    throw new Error(
      "Database and object manifests belong to different backup sets.",
    );
  const postgresCheckpoint = Date.parse(postgresManifest.checkpointAt);
  const objectCheckpoint = Date.parse(objectManifest.checkpointAt);
  if (
    Math.abs(postgresCheckpoint - objectCheckpoint) >
    maximumCheckpointSkewSeconds * 1000
  )
    throw new Error(
      "Database and object backup checkpoints exceed allowed skew.",
    );
  if (objectManifest.destinationPolicy?.verified !== true)
    throw new Error(
      "Coordinated production restore requires verified object backup destination policy evidence.",
    );
  if (postgresManifest.destinationPolicy?.policySha256 === undefined)
    throw new Error(
      "Coordinated restore requires database backup destination policy evidence.",
    );
}

function validatePostgresManifest(manifest) {
  if (manifest?.schemaVersion !== "romeo.postgres-backup.v2")
    throw new Error("Postgres manifest schema is invalid.");
  if (
    typeof manifest.backupSetId !== "string" ||
    manifest.backupSetId.length < 8
  )
    throw new Error("Postgres manifest backupSetId is missing.");
  if (Number.isNaN(Date.parse(manifest.checkpointAt)))
    throw new Error("Postgres manifest checkpointAt is invalid.");
  if (!/^[a-f0-9]{64}$/u.test(manifest.backup?.sha256 ?? ""))
    throw new Error("Postgres manifest backup digest is invalid.");
}

function requiredPath(flag) {
  const value = argValue(flag);
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`${flag} is required.`);
  const path = resolveRepoPath(value);
  if (!existsSync(path)) throw new Error(`${flag} does not exist.`);
  return path;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function verifyExpectedDigest(path, expected, label) {
  if (typeof expected !== "string" || !/^[a-f0-9]{64}$/u.test(expected))
    throw new Error(`${label} expected SHA-256 is missing or invalid.`);
  const actual = sha256File(path);
  if (actual !== expected) throw new Error(`${label} SHA-256 mismatch.`);
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0)
    throw new Error(`${label} must be a positive integer.`);
  return parsed;
}
