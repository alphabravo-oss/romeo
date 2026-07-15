import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { relative } from "node:path";

import {
  argValue,
  argValues,
  fileEvidence,
  hasFlag,
  readJson,
  repoPath,
  root,
  writeJsonOrStdout,
} from "./lib/release-artifacts.mjs";

const manifestPath = repoPath(
  argValue("--manifest") ?? "dist/release/release-manifest.json",
);
const provenancePath = repoPath(
  argValue("--provenance-file") ?? "dist/release/release-provenance.json",
);
const outputPath = repoPath(
  argValue("--output") ?? "dist/release/release-approval.json",
);
const generatedAt = argValue("--generated-at") ?? new Date().toISOString();
const approvalSystem = argValue("--approval-system") ?? "github_environment";
const approvalRef = argValue("--approval-ref");
const approverIds = argValues("--approver-id");
const approvedAt = argValue("--approved-at");
const expiresAt = argValue("--expires-at");
const minApprovers = parsePositiveInteger(argValue("--min-approvers") ?? "2");
const stdout = hasFlag("--stdout");

const blockers = [];
const checks = [];
const manifest = readJsonFile(manifestPath, "release manifest");
const provenance = readJsonFile(provenancePath, "release provenance");
const uniqueApproverHashes = uniqueHashes(approverIds);

validateRelease();
validateApproval();
validateRedaction();

const approval = {
  schemaVersion: "romeo.release-approval.v1",
  generatedAt,
  status: blockers.length === 0 ? "passed" : "blocked",
  release: removeUndefinedDeep({
    name: stringValue(manifest?.name),
    version: stringValue(manifest?.version),
    manifest: fileEvidenceIfExists(manifestPath),
    provenance: fileEvidenceIfExists(provenancePath),
  }),
  approval: removeUndefinedDeep({
    system: approvalSystem,
    refConfigured: isNonEmpty(approvalRef),
    refHash: isNonEmpty(approvalRef) ? sha256Value(approvalRef) : undefined,
    approverCount: uniqueApproverHashes.length,
    minApprovers,
    approverHashes: uniqueApproverHashes,
    approvedAt: validInstant(approvedAt)
      ? normalizeInstant(approvedAt)
      : undefined,
    expiresAt: validInstant(expiresAt)
      ? normalizeInstant(expiresAt)
      : undefined,
  }),
  checks,
  blockers,
  redaction: {
    rawApproverIdsReturned: false,
    rawApprovalRefReturned: false,
    secretValuesReturned: false,
    fileBodiesReturned: false,
    rawProvenanceReturned: false,
    environmentReturned: false,
  },
};

writeJsonOrStdout({
  path: outputPath,
  value: removeUndefinedDeep(approval),
  stdout,
});
if (!stdout)
  console.log(
    `Wrote Romeo release approval evidence to ${relative(root, outputPath)}`,
  );
if (blockers.length > 0) process.exit(1);

function validateRelease() {
  check(
    "release manifest file exists",
    existsSync(manifestPath),
    "manifest_missing",
  );
  check(
    "release manifest version is present",
    isNonEmpty(manifest?.version),
    "manifest_version_missing",
  );
  check(
    "release provenance file exists",
    existsSync(provenancePath),
    "provenance_missing",
  );
  check(
    "release provenance schema is valid",
    provenance?.schemaVersion === "romeo.release-provenance.v1",
    "provenance_schema_invalid",
  );
  check(
    "release provenance has passed",
    provenance?.status === "passed",
    "provenance_not_passed",
  );
  check(
    "release provenance version matches manifest",
    !isNonEmpty(manifest?.version) ||
      provenance?.release?.version === manifest.version,
    "provenance_version_mismatch",
  );
  if (existsSync(manifestPath)) {
    check(
      "release provenance manifest digest matches",
      provenance?.release?.manifest?.sha256 ===
        fileEvidence(manifestPath).sha256,
      "provenance_manifest_digest_mismatch",
    );
  }
}

function validateApproval() {
  check(
    "approval system is present",
    isNonEmpty(approvalSystem),
    "approval_system_missing",
  );
  check(
    "approval reference is present",
    isNonEmpty(approvalRef),
    "approval_ref_missing",
  );
  check(
    "minimum approver count is positive",
    minApprovers !== undefined,
    "min_approvers_invalid",
  );
  check(
    "enough unique approvers are present",
    minApprovers !== undefined && uniqueApproverHashes.length >= minApprovers,
    "approver_count_insufficient",
  );
  check(
    "approval timestamp is present",
    isNonEmpty(approvedAt),
    "approved_at_missing",
  );
  check(
    "approval timestamp is valid",
    validInstant(approvedAt),
    "approved_at_invalid",
  );
  check(
    "generated timestamp is valid",
    validInstant(generatedAt),
    "generated_at_invalid",
  );
  if (validInstant(approvedAt) && validInstant(generatedAt)) {
    check(
      "approval timestamp is not after evidence generation",
      instantMs(approvedAt) <= instantMs(generatedAt),
      "approved_at_after_generated_at",
    );
  }
  if (isNonEmpty(expiresAt)) {
    check(
      "approval expiration timestamp is valid",
      validInstant(expiresAt),
      "expires_at_invalid",
    );
    if (validInstant(expiresAt) && validInstant(generatedAt)) {
      check(
        "approval has not expired",
        instantMs(expiresAt) > instantMs(generatedAt),
        "approval_expired",
      );
    }
  }
}

function validateRedaction() {
  const serialized = JSON.stringify({
    release: {
      name: stringValue(manifest?.name),
      version: stringValue(manifest?.version),
    },
    approval: {
      system: approvalSystem,
      refHash: isNonEmpty(approvalRef) ? sha256Value(approvalRef) : undefined,
      approverHashes: uniqueApproverHashes,
    },
  });
  for (const value of secretLikeEnvironmentValues()) {
    if (serialized.includes(value))
      addBlocker(
        "secret_redaction_failed",
        "Release approval evidence included a secret-like environment value.",
      );
  }
  check(
    "approval evidence redaction self-check passed",
    !blockers.some((item) => item.code === "secret_redaction_failed"),
    "secret_redaction_failed",
  );
}

function readJsonFile(path, label) {
  if (!existsSync(path)) {
    addBlocker(
      `${label.replaceAll(" ", "_")}_missing`,
      `${label} file is missing: ${relative(root, path)}`,
    );
    return undefined;
  }
  try {
    return readJson(path);
  } catch (error) {
    addBlocker(
      `${label.replaceAll(" ", "_")}_invalid_json`,
      error instanceof Error ? error.message : `${label} is invalid JSON.`,
    );
    return undefined;
  }
}

function fileEvidenceIfExists(path) {
  return existsSync(path)
    ? fileEvidence(path, relative(root, path))
    : undefined;
}

function check(name, passed, blockerCode) {
  checks.push({ name, status: passed ? "pass" : "fail" });
  if (!passed) addBlocker(blockerCode, name);
}

function addBlocker(code, message) {
  blockers.push({ code, message });
}

function parsePositiveInteger(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function uniqueHashes(values) {
  return [
    ...new Set(
      values
        .map((value) => value.trim())
        .filter(isNonEmpty)
        .map(sha256Value),
    ),
  ].sort();
}

function validInstant(value) {
  return isNonEmpty(value) && !Number.isNaN(Date.parse(value));
}

function normalizeInstant(value) {
  return new Date(value).toISOString();
}

function instantMs(value) {
  return Date.parse(value);
}

function sha256Value(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stringValue(value) {
  return isNonEmpty(value) ? value : undefined;
}

function isNonEmpty(value) {
  return typeof value === "string" && value.length > 0;
}

function secretLikeEnvironmentValues() {
  return Object.entries(process.env)
    .filter(
      ([key, value]) =>
        /TOKEN|SECRET|PASSWORD|API_KEY|CREDENTIAL/iu.test(key) &&
        isNonEmpty(value) &&
        value.length >= 8,
    )
    .map(([, value]) => value);
}

function removeUndefinedDeep(value) {
  if (Array.isArray(value)) return value.map(removeUndefinedDeep);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, removeUndefinedDeep(item)]),
  );
}
