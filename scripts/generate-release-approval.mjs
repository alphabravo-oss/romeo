import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
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
import {
  normalizedArtifactDigests,
  verifyProtectedApprovalAttestation,
} from "./lib/protected-release-approval.mjs";

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
const dryRun = hasFlag("--dry-run");
const attestationPath = optionalRepoPath(argValue("--attestation-file"));
const trustedPublicKeyPath = optionalRepoPath(
  argValue("--trusted-public-key-file"),
);
const expectedEnvironment = argValue("--environment");
const expectedPolicyDigest = argValue("--policy-digest");
const stdout = hasFlag("--stdout");

const blockers = [];
const checks = [];
const manifest = readJsonFile(manifestPath, "release manifest");
const provenance = readJsonFile(provenancePath, "release provenance");
const verifiedAttestation = dryRun ? undefined : loadAndVerifyAttestation();
const attested = verifiedAttestation?.payload;
const effectiveApprovalRef = dryRun ? approvalRef : attested?.approvalRef;
const effectiveApproverIds = dryRun
  ? approverIds
  : (attested?.approverIds ?? []);
const effectiveApprovedAt = dryRun ? approvedAt : attested?.approvedAt;
const effectiveExpiresAt = dryRun ? expiresAt : attested?.expiresAt;
const effectiveApprovalSystem = dryRun
  ? approvalSystem
  : attested?.approvalSystem;
const uniqueApproverHashes = uniqueHashes(effectiveApproverIds);

validateRelease();
validateApproval();
validateRedaction();

const approval = {
  schemaVersion: "romeo.release-approval.v1",
  generatedAt,
  status: blockers.length === 0 ? "passed" : "blocked",
  mode: dryRun ? "dry_run" : "protected_environment",
  authentic: !dryRun && verifiedAttestation !== undefined,
  promotable: !dryRun && blockers.length === 0,
  release: removeUndefinedDeep({
    name: stringValue(manifest?.name),
    version: stringValue(manifest?.version),
    manifest: fileEvidenceIfExists(manifestPath),
    provenance: fileEvidenceIfExists(provenancePath),
  }),
  approval: removeUndefinedDeep({
    system: effectiveApprovalSystem,
    refConfigured: isNonEmpty(effectiveApprovalRef),
    refHash: isNonEmpty(effectiveApprovalRef)
      ? sha256Value(effectiveApprovalRef)
      : undefined,
    approverCount: uniqueApproverHashes.length,
    minApprovers,
    approverHashes: uniqueApproverHashes,
    approvedAt: validInstant(effectiveApprovedAt)
      ? normalizeInstant(effectiveApprovedAt)
      : undefined,
    expiresAt: validInstant(effectiveExpiresAt)
      ? normalizeInstant(effectiveExpiresAt)
      : undefined,
    attestation: verifiedAttestation
      ? {
          sha256: fileEvidence(attestationPath).sha256,
          keyId: verifiedAttestation.keyId,
          environmentHash: sha256Value(expectedEnvironment),
          policyDigest: expectedPolicyDigest,
        }
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
    rawAttestationReturned: false,
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
    isNonEmpty(effectiveApprovalSystem),
    "approval_system_missing",
  );
  check(
    "approval reference is present",
    isNonEmpty(effectiveApprovalRef),
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
    isNonEmpty(effectiveApprovedAt),
    "approved_at_missing",
  );
  check(
    "approval timestamp is valid",
    validInstant(effectiveApprovedAt),
    "approved_at_invalid",
  );
  check(
    "generated timestamp is valid",
    validInstant(generatedAt),
    "generated_at_invalid",
  );
  if (validInstant(effectiveApprovedAt) && validInstant(generatedAt)) {
    check(
      "approval timestamp is not after evidence generation",
      instantMs(effectiveApprovedAt) <= instantMs(generatedAt),
      "approved_at_after_generated_at",
    );
  }
  if (isNonEmpty(effectiveExpiresAt)) {
    check(
      "approval expiration timestamp is valid",
      validInstant(effectiveExpiresAt),
      "expires_at_invalid",
    );
    if (validInstant(effectiveExpiresAt) && validInstant(generatedAt)) {
      check(
        "approval has not expired",
        instantMs(effectiveExpiresAt) > instantMs(generatedAt),
        "approval_expired",
      );
    }
  }
  if (!dryRun) validateProtectedBindings();
}

function validateRedaction() {
  const serialized = JSON.stringify({
    release: {
      name: stringValue(manifest?.name),
      version: stringValue(manifest?.version),
    },
    approval: {
      system: effectiveApprovalSystem,
      refHash: isNonEmpty(effectiveApprovalRef)
        ? sha256Value(effectiveApprovalRef)
        : undefined,
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

function loadAndVerifyAttestation() {
  if (attestationPath === undefined || !existsSync(attestationPath)) {
    addBlocker(
      "protected_approval_attestation_missing",
      "A signed protected-environment approval attestation is required.",
    );
    return undefined;
  }
  if (trustedPublicKeyPath === undefined || !existsSync(trustedPublicKeyPath)) {
    addBlocker(
      "protected_approval_trust_key_missing",
      "A pinned trusted approval public key is required.",
    );
    return undefined;
  }
  try {
    const attestation = readJson(attestationPath);
    const payload = verifyProtectedApprovalAttestation({
      attestation,
      trustedPublicKeyPem: readFileSync(trustedPublicKeyPath, "utf8"),
    });
    return { payload, keyId: attestation.signature.keyId };
  } catch (error) {
    addBlocker(
      "protected_approval_signature_invalid",
      error instanceof Error ? error.message : "Approval signature is invalid.",
    );
    return undefined;
  }
}

function validateProtectedBindings() {
  const payload = attested;
  check(
    "protected approval environment is configured",
    isNonEmpty(expectedEnvironment),
    "approval_environment_missing",
  );
  check(
    "protected approval policy digest is configured",
    /^[a-f0-9]{64}$/u.test(expectedPolicyDigest ?? ""),
    "approval_policy_digest_invalid",
  );
  check(
    "protected approval is not revoked",
    payload?.revoked === false,
    "approval_revoked",
  );
  check(
    "protected approval is not a dry run",
    payload?.dryRun === false,
    "approval_attestation_dry_run",
  );
  check(
    "protected approval commit matches provenance",
    payload?.commitSha === provenance?.source?.commitSha,
    "approval_commit_mismatch",
  );
  check(
    "protected approval manifest digest matches",
    existsSync(manifestPath) &&
      payload?.manifestSha256 === fileEvidence(manifestPath).sha256,
    "approval_manifest_binding_mismatch",
  );
  check(
    "protected approval provenance digest matches",
    existsSync(provenancePath) &&
      payload?.provenanceSha256 === fileEvidence(provenancePath).sha256,
    "approval_provenance_binding_mismatch",
  );
  check(
    "protected approval artifact digests match",
    JSON.stringify(payload?.artifactDigests) ===
      JSON.stringify(normalizedArtifactDigests(provenance?.release?.artifacts)),
    "approval_artifact_binding_mismatch",
  );
  check(
    "protected approval environment matches",
    payload?.environment === expectedEnvironment,
    "approval_environment_mismatch",
  );
  check(
    "protected approval policy digest matches",
    payload?.policyDigest === expectedPolicyDigest,
    "approval_policy_digest_mismatch",
  );
}

function optionalRepoPath(value) {
  return value === undefined || value.length === 0
    ? undefined
    : repoPath(value);
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
