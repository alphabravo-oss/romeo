#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const baselinePath = "docs/api/openapi-baseline.json";
const ledgerPath = "docs/api/openapi-compatibility-ledger.json";

export function validateCompatibilityPolicy({
  baselineSha256,
  changes,
  ledger,
  now = new Date(),
  repositoryPathExists = () => true,
}) {
  const failures = [];
  if (
    !isRecord(ledger) ||
    ledger.schemaVersion !== 1 ||
    !isRecord(ledger.baseline) ||
    !Array.isArray(ledger.breakingChanges) ||
    !Array.isArray(ledger.warningChanges)
  ) {
    return [
      "Compatibility ledger must be schemaVersion 1 with baseline, breakingChanges[], and warningChanges[].",
    ];
  }
  if (ledger.baseline.path !== baselinePath)
    failures.push(
      `Compatibility ledger baseline path must be ${baselinePath}.`,
    );
  if (ledger.baseline.sha256 !== baselineSha256)
    failures.push(
      "Compatibility ledger baseline digest is stale; review the baseline rather than silently refreshing it.",
    );

  const currentByFingerprint = new Map();
  for (const [index, change] of changes.entries()) {
    if (!validChange(change)) {
      failures.push(`oasdiff change[${index}] has an invalid shape.`);
      continue;
    }
    if (currentByFingerprint.has(change.fingerprint))
      failures.push(
        `oasdiff returned duplicate fingerprint ${change.fingerprint}.`,
      );
    currentByFingerprint.set(change.fingerprint, change);
  }

  const breakingByFingerprint = validateLedgerEntries(
    ledger.breakingChanges,
    "breakingChanges",
    failures,
  );
  const warningByFingerprint = validateLedgerEntries(
    ledger.warningChanges,
    "warningChanges",
    failures,
  );

  for (const change of currentByFingerprint.values()) {
    if (change.level >= 3) {
      const approval = breakingByFingerprint.get(change.fingerprint);
      if (approval === undefined) {
        failures.push(
          `${change.fingerprint}: unapproved breaking change ${change.id} on ${change.operationId}.`,
        );
      } else {
        validateBinding(change, approval, failures);
        validateBreakingApproval(approval, now, repositoryPathExists, failures);
      }
      continue;
    }
    if (change.level === 2) {
      const decision = warningByFingerprint.get(change.fingerprint);
      if (decision === undefined) {
        failures.push(
          `${change.fingerprint}: unclassified compatibility warning ${change.id} on ${change.operationId}.`,
        );
      } else {
        validateBinding(change, decision, failures);
        validateWarningDecision(decision, now, repositoryPathExists, failures);
      }
    }
  }

  for (const [fingerprint] of breakingByFingerprint) {
    if (!currentByFingerprint.has(fingerprint))
      failures.push(`${fingerprint}: stale breaking-change ledger entry.`);
  }
  for (const [fingerprint] of warningByFingerprint) {
    if (!currentByFingerprint.has(fingerprint))
      failures.push(
        `${fingerprint}: stale compatibility-warning ledger entry.`,
      );
  }
  return failures;
}

function validateLedgerEntries(entries, label, failures) {
  const indexed = new Map();
  for (const [index, entry] of entries.entries()) {
    if (!isRecord(entry) || !/^[a-f0-9]{12}$/u.test(entry.fingerprint ?? "")) {
      failures.push(`${label}[${index}] must have a 12-character fingerprint.`);
      continue;
    }
    if (indexed.has(entry.fingerprint))
      failures.push(`${entry.fingerprint}: duplicate ${label} entry.`);
    indexed.set(entry.fingerprint, entry);
  }
  return indexed;
}

function validateBinding(change, entry, failures) {
  for (const field of ["id", "operationId", "path"]) {
    if (entry[field] !== change[field])
      failures.push(`${change.fingerprint}: ledger disagrees on ${field}.`);
  }
}

function validateBreakingApproval(entry, now, repositoryPathExists, failures) {
  for (const field of [
    "approvedAt",
    "expiresAt",
    "migrationDocument",
    "owner",
    "rationale",
    "targetMajorVersion",
  ]) {
    if (typeof entry[field] !== "string" || entry[field].trim().length === 0)
      failures.push(
        `${entry.fingerprint}: breaking approval requires ${field}.`,
      );
  }
  if (!isIsoTimestamp(entry.approvedAt) || !isIsoTimestamp(entry.expiresAt))
    failures.push(
      `${entry.fingerprint}: breaking approval timestamps must be ISO timestamps.`,
    );
  else if (Date.parse(entry.expiresAt) <= now.getTime())
    failures.push(`${entry.fingerprint}: breaking approval has expired.`);
  if (!safeRepositoryPath(entry.migrationDocument))
    failures.push(
      `${entry.fingerprint}: migrationDocument must be repository-relative.`,
    );
  else if (!repositoryPathExists(entry.migrationDocument))
    failures.push(`${entry.fingerprint}: migrationDocument does not exist.`);
  if (!/^\d+\.0$/u.test(entry.targetMajorVersion))
    failures.push(
      `${entry.fingerprint}: targetMajorVersion must identify a major release (for example, 2.0).`,
    );
}

function validateWarningDecision(entry, now, repositoryPathExists, failures) {
  if (
    ![
      "client_reviewed",
      "deprecation_active",
      "remediation_pending",
      "security_limit",
    ].includes(entry.classification)
  ) {
    failures.push(`${entry.fingerprint}: invalid warning classification.`);
  }
  for (const field of [
    "documentation",
    "owner",
    "rationale",
    "reviewedAt",
    "reviewExpiresAt",
  ]) {
    if (typeof entry[field] !== "string" || entry[field].trim().length === 0)
      failures.push(
        `${entry.fingerprint}: warning decision requires ${field}.`,
      );
  }
  if (
    !isIsoTimestamp(entry.reviewedAt) ||
    !isIsoTimestamp(entry.reviewExpiresAt)
  )
    failures.push(
      `${entry.fingerprint}: warning review timestamps must be ISO timestamps.`,
    );
  else if (Date.parse(entry.reviewExpiresAt) <= now.getTime())
    failures.push(
      `${entry.fingerprint}: compatibility-warning review expired.`,
    );
  if (!safeRepositoryPath(entry.documentation))
    failures.push(
      `${entry.fingerprint}: documentation must be repository-relative.`,
    );
  else if (!repositoryPathExists(entry.documentation))
    failures.push(`${entry.fingerprint}: documentation does not exist.`);
}

function validChange(change) {
  return (
    isRecord(change) &&
    typeof change.id === "string" &&
    Number.isInteger(change.level) &&
    typeof change.operationId === "string" &&
    typeof change.path === "string" &&
    /^[a-f0-9]{12}$/u.test(change.fingerprint ?? "")
  );
}

function safeRepositoryPath(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !value.startsWith("/") &&
    !value.includes("..") &&
    !value.includes("\\")
  );
}

function isIsoTimestamp(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T/u.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function collectChanges() {
  const result = spawnSync("corepack", ["pnpm", "openapi:diff:json"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error !== undefined) throw result.error;
  try {
    return JSON.parse(result.stdout.length === 0 ? "[]" : result.stdout);
  } catch {
    throw new Error(
      `oasdiff did not return valid JSON (exit ${String(result.status)}).`,
    );
  }
}

function selfTest() {
  const baselineSha256 = "a".repeat(64);
  const warning = {
    fingerprint: "a1b2c3d4e5f6",
    id: "request-property-max-set",
    level: 2,
    operationId: "example.create",
    path: "/example",
  };
  const ledger = {
    schemaVersion: 1,
    baseline: { path: baselinePath, sha256: baselineSha256 },
    breakingChanges: [],
    warningChanges: [
      {
        classification: "security_limit",
        documentation: "docs/api/example.md",
        fingerprint: warning.fingerprint,
        id: warning.id,
        operationId: warning.operationId,
        owner: "api-governance",
        path: warning.path,
        rationale: "Bound a resource-consuming request.",
        reviewedAt: "2026-08-23T00:00:00.000Z",
        reviewExpiresAt: "2027-02-23T00:00:00.000Z",
      },
    ],
  };
  if (
    validateCompatibilityPolicy({ baselineSha256, changes: [warning], ledger })
      .length > 0
  )
    throw new Error("Valid compatibility warning fixture failed.");
  if (
    !validateCompatibilityPolicy({
      baselineSha256,
      changes: [{ ...warning, level: 3 }],
      ledger: { ...ledger, warningChanges: [] },
    }).some((failure) => failure.includes("unapproved breaking"))
  )
    throw new Error("Compatibility self-test accepted an unapproved break.");
  if (
    !validateCompatibilityPolicy({
      baselineSha256: "b".repeat(64),
      changes: [warning],
      ledger,
    }).some((failure) => failure.includes("baseline digest is stale"))
  )
    throw new Error("Compatibility self-test accepted a stale baseline.");
  const stale = structuredClone(ledger);
  stale.warningChanges[0].fingerprint = "bbbbbbbbbbbb";
  if (
    !validateCompatibilityPolicy({
      baselineSha256,
      changes: [warning],
      ledger: stale,
    }).some((failure) => failure.includes("stale compatibility-warning"))
  )
    throw new Error("Compatibility self-test accepted a stale decision.");
}

function main() {
  selfTest();
  const changes = collectChanges();
  const ledger = JSON.parse(readFileSync(resolve(root, ledgerPath), "utf8"));
  const failures = validateCompatibilityPolicy({
    baselineSha256: sha256(resolve(root, baselinePath)),
    changes,
    ledger,
    repositoryPathExists: (path) => existsSync(resolve(root, path)),
  });
  if (failures.length > 0) {
    console.error(
      `OpenAPI compatibility policy failed:\n${failures
        .map((failure) => `- ${failure}`)
        .join("\n")}`,
    );
    process.exitCode = 1;
    return;
  }
  const breaking = changes.filter((change) => change.level >= 3).length;
  const warnings = changes.filter((change) => change.level === 2).length;
  console.log(
    `OpenAPI compatibility policy passed (${breaking} approved breaks, ${warnings} reviewed warnings, baseline digest verified).`,
  );
}

main();
