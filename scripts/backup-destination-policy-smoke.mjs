#!/usr/bin/env node

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { validateBackupDestinationPolicy } from "./lib/backup-destination-policy.mjs";

const now = new Date("2026-08-23T12:00:00.000Z");
const valid = {
  schemaVersion: "romeo.backup-destination-policy.v1",
  destinationId: "prod-backup-vault-us-east-1",
  observedAt: "2026-08-23T11:55:00.000Z",
  versioningEnabled: true,
  replication: { enabled: true, destination: "us-west-2-vault" },
  objectLock: {
    mode: "COMPLIANCE",
    minimumRetentionDays: 30,
    manifestsProtected: true,
    indexesProtected: true,
  },
  lifecycle: { earlyDeletionAllowed: false, deleteAfterDays: 45 },
  legalHold: {
    supported: true,
    bypassRequiresProtectedApproval: true,
  },
};

const verified = validateBackupDestinationPolicy(valid, {
  maximumAgeSeconds: 600,
  minimumRetentionDays: 30,
  now,
});
assert(verified.minimumRetentionDays === 30, "valid policy was not verified");

for (const [name, mutate, expected] of [
  [
    "stale evidence",
    (policy) => (policy.observedAt = "2026-08-23T10:00:00.000Z"),
    "stale",
  ],
  [
    "versioning disabled",
    (policy) => (policy.versioningEnabled = false),
    "versioning",
  ],
  [
    "replication disabled",
    (policy) => (policy.replication.enabled = false),
    "replication",
  ],
  [
    "retention too short",
    (policy) => (policy.objectLock.minimumRetentionDays = 7),
    "shorter",
  ],
  [
    "manifests mutable",
    (policy) => (policy.objectLock.manifestsProtected = false),
    "manifests",
  ],
  [
    "early deletion",
    (policy) => (policy.lifecycle.earlyDeletionAllowed = true),
    "early deletion",
  ],
  [
    "lifecycle before lock",
    (policy) => (policy.lifecycle.deleteAfterDays = 20),
    "precedes",
  ],
  [
    "legal hold bypass",
    (policy) => (policy.legalHold.bypassRequiresProtectedApproval = false),
    "legal-hold",
  ],
]) {
  const policy = structuredClone(valid);
  mutate(policy);
  expectFailure(
    name,
    () =>
      validateBackupDestinationPolicy(policy, {
        maximumAgeSeconds: 600,
        minimumRetentionDays: 30,
        now,
      }),
    expected,
  );
}

const directory = mkdtempSync(join(tmpdir(), "romeo-backup-policy-"));
const policyPath = join(directory, "policy.json");
writeFileSync(
  policyPath,
  `${JSON.stringify({ ...valid, observedAt: new Date().toISOString() })}\n`,
  "utf8",
);
const objectBackupArgs = [
  "scripts/object-store-backup.mjs",
  "--dry-run",
  "--backup-set-id",
  "backup-set-policy-smoke",
  "--checkpoint-at",
  new Date().toISOString(),
  "--destination-policy-file",
  policyPath,
];
expectChildStatus(0, objectBackupArgs, {}, "verified object backup plan");
expectChildStatus(
  1,
  [...objectBackupArgs.slice(0, -1), join(directory, "missing-policy.json")],
  {},
  "missing object backup policy",
);
expectChildStatus(
  1,
  [
    "scripts/object-store-backup.mjs",
    "--dry-run",
    "--allow-unverified-development-destination",
  ],
  { ROMEO_ENV: "production" },
  "production development bypass",
);

console.log(
  "backup destination policy: positive plan and 10 fail-closed/tamper cases passed",
);

function expectFailure(name, operation, expected) {
  try {
    operation();
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.toLowerCase().includes(expected)
    )
      return;
    throw new Error(`${name} failed with an unexpected error: ${error}`);
  }
  throw new Error(`${name} unexpectedly passed.`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function expectChildStatus(status, args, environment, label) {
  const result = spawnSync(process.execPath, args, {
    encoding: "utf8",
    env: {
      ...process.env,
      S3_ENDPOINT: "https://s3.example.invalid",
      S3_BUCKET: "romeo-backup-smoke",
      S3_ACCESS_KEY_ID: "redacted-access-key",
      S3_SECRET_ACCESS_KEY: "redacted-secret-key",
      ...environment,
    },
  });
  if (result.status !== status)
    throw new Error(
      `${label} returned ${result.status}; expected ${status}: ${result.stderr || result.stdout}`,
    );
}
