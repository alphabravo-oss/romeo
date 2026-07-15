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

const paths = {
  manifest: argValue("--manifest") ?? "dist/release/release-manifest.json",
  channel: argValue("--channel-file") ?? "dist/release/release-channel.json",
  securityEvidence:
    argValue("--security-evidence") ?? "dist/release/security-evidence.json",
  sbom: argValue("--sbom") ?? "dist/release/sbom.cdx.json",
  provenance:
    argValue("--provenance-file") ?? "dist/release/release-provenance.json",
  approval: argValue("--approval-file") ?? "dist/release/release-approval.json",
  readbackValidation:
    argValue("--readback-validation") ??
    "dist/release/readback-validation.json",
  checklist: argValue("--checklist") ?? "dist/release/ga-checklist.json",
  supportBundle: argValue("--support-bundle") ?? "dist/ci/support-bundle.json",
  supportRedaction:
    argValue("--support-redaction") ?? "dist/ci/support-bundle-redaction.json",
  docsCommandCheck:
    argValue("--docs-command-check") ?? "dist/ci/docs-command-check.json",
  tenantIsolation:
    argValue("--tenant-isolation") ??
    "dist/ci/tenant-isolation-negative-suite.json",
};
const outputPath = repoPath(
  argValue("--output") ?? "dist/release/ga-evidence-bundle.json",
);
const generatedAt = argValue("--generated-at") ?? new Date().toISOString();
const stdout = hasFlag("--stdout");
const requireChecklistPassed = hasFlag("--require-checklist-passed");
const requireReadbackValidation =
  hasFlag("--require-readback-validation") || requireChecklistPassed;
const requireSupportBundle = hasFlag("--require-support-bundle");
const requireSupportRedaction = hasFlag("--require-support-redaction");
const requireDocsCommandCheck = hasFlag("--require-docs-command-check");
const requireTenantIsolation = hasFlag("--require-tenant-isolation");
const extraEvidencePaths = argValues("--evidence");
const blockers = [];
const checks = [];

const manifest = jsonEvidence("release_manifest", paths.manifest, true);
const channel = jsonEvidence("release_channel", paths.channel, true);
const securityEvidence = jsonEvidence(
  "security_evidence",
  paths.securityEvidence,
  true,
);
const sbom = jsonEvidence("sbom", paths.sbom, true);
const provenance = jsonEvidence("release_provenance", paths.provenance, true);
const approval = jsonEvidence("release_approval", paths.approval, true);
const readbackValidation = jsonEvidence(
  "readback_validation",
  paths.readbackValidation,
  requireReadbackValidation,
);
const checklist = jsonEvidence("ga_checklist", paths.checklist, true);
const supportBundle = jsonEvidence(
  "support_bundle",
  paths.supportBundle,
  requireSupportBundle,
);
const supportRedaction = jsonEvidence(
  "support_redaction",
  paths.supportRedaction,
  requireSupportRedaction,
);
const docsCommandCheck = jsonEvidence(
  "docs_command_check",
  paths.docsCommandCheck,
  requireDocsCommandCheck,
);
const tenantIsolation = jsonEvidence(
  "tenant_isolation",
  paths.tenantIsolation,
  requireTenantIsolation,
);
const extraEvidence = extraEvidencePaths.map((path, index) =>
  jsonEvidence(`extra_${index + 1}`, path, false),
);

validateReleaseEvidence();
validateChecklistEvidence();
validateSupportEvidence();
validateRedaction();

const allEvidence = [
  manifest,
  channel,
  securityEvidence,
  sbom,
  provenance,
  approval,
  readbackValidation,
  checklist,
  supportBundle,
  supportRedaction,
  docsCommandCheck,
  tenantIsolation,
  ...extraEvidence,
].filter((item) => item.file.present);

const bundle = {
  schemaVersion: "romeo.ga-evidence-bundle.v1",
  generatedAt,
  status: blockers.length === 0 ? "passed" : "blocked",
  requirements: {
    checklistPassed: requireChecklistPassed,
    readbackValidation: requireReadbackValidation,
    supportBundle: requireSupportBundle,
    supportRedaction: requireSupportRedaction,
    docsCommandCheck: requireDocsCommandCheck,
    tenantIsolation: requireTenantIsolation,
  },
  release: {
    name: manifest.json?.name,
    version: manifest.json?.version,
    artifactCount: Array.isArray(manifest.json?.artifacts)
      ? manifest.json.artifacts.length
      : 0,
    manifest: manifest.file,
    channel: channel.file,
    securityEvidence: securityEvidence.file,
    sbom: sbom.file,
    provenance: provenance.file,
    approval: approval.file,
    readbackValidation: readbackValidation.file,
  },
  ga: {
    checklist: checklist.file,
    status: checklist.json?.status,
    strict: checklist.json?.strict === true,
    summary: summarizeChecklist(checklist.json),
    profile:
      checklist.json?.target?.profile === "full-product-enterprise"
        ? "full-product-enterprise"
        : "default-ga",
    fullProductEnterpriseRequired:
      checklist.json?.target?.fullProductEnterpriseRequired === true,
    qdrantLiveRequired: checklist.json?.target?.qdrantLiveRequired === true,
    qdrantDrRequired: checklist.json?.target?.qdrantDrRequired === true,
    ciGovernanceLiveRequired:
      checklist.json?.target?.ciGovernanceLiveRequired === true,
    kedaRequired: checklist.json?.target?.kedaRequired === true,
    browserAutomationRequired:
      checklist.json?.target?.browserAutomationRequired === true,
    identityLiveRequired: checklist.json?.target?.identityLiveRequired === true,
    dataConnectorLiveRequired:
      checklist.json?.target?.dataConnectorLiveRequired === true,
    toolDispatchLiveRequired:
      checklist.json?.target?.toolDispatchLiveRequired === true,
    voiceProviderLiveRequired:
      checklist.json?.target?.voiceProviderLiveRequired === true,
    notificationAdapterLiveRequired:
      checklist.json?.target?.notificationAdapterLiveRequired === true,
    analyticsAuthzLiveRequired:
      checklist.json?.target?.analyticsAuthzLiveRequired === true,
    targetQualityVectorComparisonRequired:
      checklist.json?.target?.targetQualityVectorComparisonRequired === true,
    dataRightsRetentionLiveRequired:
      checklist.json?.target?.dataRightsRetentionLiveRequired === true,
    billingOperationsLiveRequired:
      checklist.json?.target?.billingOperationsLiveRequired === true,
    auditIntegrityLiveRequired:
      checklist.json?.target?.auditIntegrityLiveRequired === true,
    tenantPurgeLiveRequired:
      checklist.json?.target?.tenantPurgeLiveRequired === true,
    supportBundleLiveRequired:
      checklist.json?.target?.supportBundleLiveRequired === true,
    targetResilienceDrillsRequired:
      checklist.json?.target?.targetResilienceDrillsRequired === true,
    postgresOperationsLiveRequired:
      checklist.json?.target?.postgresOperationsLiveRequired === true,
    blockedGateIds: blockedGateIds(checklist.json),
    exceptionCount: Array.isArray(checklist.json?.exceptions)
      ? checklist.json.exceptions.length
      : 0,
  },
  support: {
    supportBundle: supportBundle.file,
    supportRedaction: supportRedaction.file,
    docsCommandCheck: docsCommandCheck.file,
    tenantIsolation: tenantIsolation.file,
  },
  extraEvidence: extraEvidence.map((item) => item.file),
  inventory: {
    evidenceFileCount: allEvidence.length,
    totalBytes: allEvidence.reduce((total, item) => total + item.file.bytes, 0),
    sha256: sha256Inventory(allEvidence),
  },
  checks,
  blockers,
  redaction: {
    evidenceBodiesIncluded: false,
    exceptionRationaleIncluded: false,
    rawEvidencePathsIncluded: false,
    rawSecretsIncluded: false,
    rawLogsIncluded: false,
    rawPromptsIncluded: false,
    rawProviderPayloadsIncluded: false,
    rawConnectorPayloadsIncluded: false,
  },
};

writeJsonOrStdout({
  path: outputPath,
  value: removeUndefinedDeep(bundle),
  stdout,
});
if (!stdout) {
  console.log(
    `Wrote Romeo GA evidence bundle to ${relative(root, outputPath)}`,
  );
}
if (blockers.length > 0) process.exit(1);

function validateReleaseEvidence() {
  check("release manifest name is Romeo", manifest.json?.name === "romeo", {
    code: "manifest_name_invalid",
  });
  check(
    "release manifest version is present",
    isNonEmpty(manifest.json?.version),
    { code: "manifest_version_missing" },
  );
  check(
    "release channel schema is valid",
    channel.json?.schemaVersion === "romeo.release-channel.v1",
    { code: "channel_schema_invalid" },
  );
  check(
    "release channel latest matches manifest",
    channel.json?.latest === manifest.json?.version,
    { code: "channel_latest_mismatch" },
  );
  check(
    "security evidence passed",
    securityEvidence.json?.schemaVersion === "romeo.security-evidence.v1" &&
      securityEvidence.json?.status === "pass",
    { code: "security_evidence_not_passed" },
  );
  check(
    "security evidence version matches manifest",
    securityEvidence.json?.release?.version === manifest.json?.version,
    { code: "security_evidence_version_mismatch" },
  );
  check("SBOM is CycloneDX", sbom.json?.bomFormat === "CycloneDX", {
    code: "sbom_not_cyclonedx",
  });
  check(
    "release provenance passed",
    provenance.json?.schemaVersion === "romeo.release-provenance.v1" &&
      provenance.json?.status === "passed",
    { code: "release_provenance_not_passed" },
  );
  check(
    "release provenance version matches manifest",
    provenance.json?.release?.version === manifest.json?.version,
    { code: "release_provenance_version_mismatch" },
  );
  for (const [field, evidence] of [
    ["manifest", manifest],
    ["channel", channel],
    ["securityEvidence", securityEvidence],
    ["sbom", sbom],
  ]) {
    check(
      `release provenance ${field} digest matches`,
      provenance.json?.release?.[field]?.sha256 === evidence.file.sha256,
      { code: `release_provenance_${field}_digest_mismatch` },
    );
  }
  check(
    "release approval passed",
    approval.json?.schemaVersion === "romeo.release-approval.v1" &&
      approval.json?.status === "passed",
    { code: "release_approval_not_passed" },
  );
  check(
    "release approval version matches manifest",
    approval.json?.release?.version === manifest.json?.version,
    { code: "release_approval_version_mismatch" },
  );
  check(
    "release approval manifest digest matches",
    approval.json?.release?.manifest?.sha256 === manifest.file.sha256,
    { code: "release_approval_manifest_digest_mismatch" },
  );
  check(
    "release approval provenance digest matches",
    approval.json?.release?.provenance?.sha256 === provenance.file.sha256,
    { code: "release_approval_provenance_digest_mismatch" },
  );
  const approverCount = approval.json?.approval?.approverCount;
  const minApprovers = approval.json?.approval?.minApprovers;
  const requiredApprovers = Math.max(
    Number.isInteger(minApprovers) ? minApprovers : 2,
    2,
  );
  check(
    "release approval has enough unique approvers",
    Number.isInteger(approverCount) && approverCount >= requiredApprovers,
    { code: "release_approval_approver_count_insufficient" },
  );
  check(
    "release approval reference is configured",
    approval.json?.approval?.refConfigured === true,
    { code: "release_approval_reference_missing" },
  );
  if (approval.json?.approval?.expiresAt !== undefined) {
    check(
      "release approval has not expired",
      validTimestamp(approval.json.approval.expiresAt) &&
        validTimestamp(generatedAt) &&
        Date.parse(approval.json.approval.expiresAt) > Date.parse(generatedAt),
      { code: "release_approval_expired" },
    );
  }
  check(
    "release approval redaction flags are safe",
    redactionFlagsFalse(approval.json?.redaction, [
      "rawApproverIdsReturned",
      "rawApprovalRefReturned",
      "secretValuesReturned",
      "fileBodiesReturned",
      "rawProvenanceReturned",
      "environmentReturned",
    ]),
    { code: "release_approval_redaction_invalid" },
  );
  validateReadbackValidationEvidence();
}

function validateReadbackValidationEvidence() {
  if (!readbackValidation.file.present) return;
  check(
    "release readback validation schema is valid",
    readbackValidation.json?.schemaVersion ===
      "romeo.release-readback-validation.v1",
    { code: "release_readback_validation_schema_invalid" },
  );
  check(
    "release readback validation passed",
    readbackValidation.json?.status === "pass",
    { code: "release_readback_validation_not_passed" },
  );
  check(
    "release readback validation is live",
    readbackValidation.json?.mode === "live_readback",
    { code: "release_readback_validation_not_live" },
  );
  check(
    "release readback includes credentialed npm proof",
    hasPassedCheck(
      readbackValidation.json,
      "credentialed npm registry readback",
    ),
    { code: "release_readback_npm_not_credentialed" },
  );
  const required = readbackValidation.json?.required ?? {};
  check(
    "release readback includes required image proof",
    Array.isArray(required.images) && required.images.length > 0,
    { code: "release_readback_required_image_missing" },
  );
  if (Array.isArray(required.images)) {
    for (const image of required.images) {
      check(
        `${image} image readback is verified`,
        typeof image === "string" &&
          hasPassedCheck(
            readbackValidation.json,
            `${image} image registry readback is verified`,
          ),
        { code: "release_readback_image_not_verified" },
      );
    }
  }
  check(
    "release readback includes required chart proof",
    Array.isArray(required.charts) && required.charts.length > 0,
    { code: "release_readback_required_chart_missing" },
  );
  if (Array.isArray(required.charts)) {
    for (const chart of required.charts) {
      check(
        `${chart?.name} chart readback is verified`,
        typeof chart?.name === "string" &&
          hasPassedCheck(
            readbackValidation.json,
            `${chart.name} chart repository readback is verified`,
          ),
        { code: "release_readback_chart_not_verified" },
      );
    }
  }
  const assets = new Map(
    Array.isArray(required.assets)
      ? required.assets
          .filter((asset) => typeof asset?.name === "string")
          .map((asset) => [asset.name, asset])
      : [],
  );
  for (const name of [
    "release-channel",
    "security-evidence",
    "sbom",
    "provenance",
    "approval",
  ]) {
    const asset = assets.get(name);
    check(
      `${name} release asset is required`,
      asset !== undefined &&
        typeof asset.sha256 === "string" &&
        /^[a-f0-9]{64}$/u.test(asset.sha256),
      { code: `release_readback_required_asset_missing:${name}` },
    );
    check(
      `${name} release asset readback is verified`,
      hasPassedCheck(
        readbackValidation.json,
        `${name} release asset readback is verified`,
      ),
      { code: `release_readback_asset_not_verified:${name}` },
    );
  }
  check(
    "release readback validation redaction flags are safe",
    redactionFlagsFalse(readbackValidation.json?.redaction, [
      "tokenValuesReturned",
      "rawReadbackBodyReturned",
      "rawRegistryResponsesReturned",
      "rawPackageTarballsReturned",
      "rawOciManifestsReturned",
      "rawHelmRepositoryBodiesReturned",
      "rawReleaseAssetBodiesReturned",
      "environmentReturned",
    ]),
    { code: "release_readback_validation_redaction_invalid" },
  );
}

function validateChecklistEvidence() {
  check(
    "GA checklist schema is valid",
    checklist.json?.schemaVersion === "romeo.ga-checklist.v1",
    { code: "ga_checklist_schema_invalid" },
  );
  check(
    "GA checklist status is known",
    isKnownChecklistStatus(checklist.json),
    {
      code: "ga_checklist_status_invalid",
    },
  );
  if (requireChecklistPassed) {
    check("GA checklist passed", checklist.json?.status === "passed", {
      code: "ga_checklist_not_passed",
    });
  }
  const releaseSecurity = Array.isArray(checklist.json?.gates)
    ? checklist.json.gates.find(
        (gate) => gate.id === "phase22.release_security",
      )
    : undefined;
  check(
    "release security gate is satisfied",
    releaseSecurity?.status === "satisfied",
    { code: "release_security_gate_not_satisfied" },
  );
}

function validateSupportEvidence() {
  validateOptionalEvidence(supportBundle, "romeo.support-bundle.v1", [
    "generated",
  ]);
  validateOptionalEvidence(
    supportRedaction,
    "romeo.support-bundle-redaction.v1",
    ["passed"],
  );
  validateOptionalEvidence(docsCommandCheck, "romeo.docs-command-check.v1", [
    "passed",
  ]);
  validateDocsCommandCheckRedaction();
  validateOptionalEvidence(
    tenantIsolation,
    "romeo.tenant-isolation-negative-suite.v1",
    ["passed"],
  );
}

function validateDocsCommandCheckRedaction() {
  if (!docsCommandCheck.file.present) return;
  check(
    "docs command check includes markdown link validation",
    hasCheck(docsCommandCheck.json, "documented_markdown_links_resolve") &&
      Number.isInteger(docsCommandCheck.json?.stats?.markdownLinksChecked) &&
      docsCommandCheck.json.stats.markdownLinksChecked > 0,
    { code: "docs_command_check_markdown_links_missing" },
  );
  check(
    "docs command check classifies documented commands",
    hasCheck(docsCommandCheck.json, "documented_commands_classified") &&
      docsCommandCheck.json?.commandPosture?.everyCommandClassified === true &&
      Number.isInteger(docsCommandCheck.json?.commandPosture?.total) &&
      docsCommandCheck.json.commandPosture.total > 0 &&
      docsCommandCheck.json.commandPosture.unclassified === 0 &&
      docsCommandCheck.json.commandPosture.rawCommandTextReturned === false,
    { code: "docs_command_check_command_classification_invalid" },
  );
  check(
    "docs command check redaction flags are safe",
    redactionFlagsFalse(docsCommandCheck.json?.redaction, [
      "rawMarkdownBodiesReturned",
      "rawShellCommandTextReturned",
      "environmentValuesReturned",
      "secretValuesReturned",
    ]),
    { code: "docs_command_check_redaction_invalid" },
  );
}

function hasCheck(evidence, name) {
  const checks = Array.isArray(evidence?.checks) ? evidence.checks : [];
  return checks.some(
    (check) =>
      check === name ||
      (check?.name === name &&
        (check.status === "pass" || check.status === "passed")),
  );
}

function validateOptionalEvidence(evidence, schemaVersion, statuses) {
  if (!evidence.file.present) return;
  check(
    `${evidence.label} schema is valid`,
    evidence.json?.schemaVersion === schemaVersion,
    { code: `${evidence.label}_schema_invalid` },
  );
  check(
    `${evidence.label} status is accepted`,
    statuses.includes(evidence.json?.status),
    { code: `${evidence.label}_status_invalid` },
  );
}

function validateRedaction() {
  const serialized = JSON.stringify({
    files: [
      manifest.file,
      channel.file,
      securityEvidence.file,
      sbom.file,
      provenance.file,
      approval.file,
      readbackValidation.file,
      checklist.file,
      supportBundle.file,
      supportRedaction.file,
      docsCommandCheck.file,
      tenantIsolation.file,
      ...extraEvidence.map((item) => item.file),
    ],
    release: {
      name: manifest.json?.name,
      version: manifest.json?.version,
    },
    checklist: {
      status: checklist.json?.status,
      summary: summarizeChecklist(checklist.json),
      blockedGateIds: blockedGateIds(checklist.json),
    },
  });
  const forbidden = Object.entries(process.env)
    .filter(
      ([key, value]) =>
        /TOKEN|SECRET|PASSWORD|API_KEY|CREDENTIAL/iu.test(key) &&
        isNonEmpty(value),
    )
    .map(([, value]) => value);
  for (const value of forbidden) {
    if (serialized.includes(value)) {
      addBlocker(
        "secret_redaction_failed",
        "GA evidence bundle included a secret-like environment value.",
      );
    }
  }
  check(
    "GA bundle redaction self-check passed",
    !blockers.some((item) => item.code === "secret_redaction_failed"),
    { code: "secret_redaction_failed" },
  );
}

function jsonEvidence(label, pathValue, required) {
  const absolute = repoPath(pathValue);
  if (!existsSync(absolute)) {
    const file = {
      label,
      path: pathValue,
      present: false,
      bytes: 0,
      sha256: undefined,
    };
    if (required) {
      addBlocker(
        `${label}_missing`,
        `Required GA evidence file is missing: ${pathValue}`,
      );
    }
    return { label, file, json: undefined };
  }
  const file = {
    label,
    present: true,
    path: relative(root, absolute),
    ...fileEvidence(absolute, relative(root, absolute)),
  };
  try {
    const json = readJson(absolute);
    return {
      label,
      file: {
        ...file,
        schemaVersion: schemaVersion(json),
        status: statusValue(json),
        releaseVersion: releaseVersion(json),
      },
      json,
    };
  } catch {
    if (required) {
      addBlocker(
        `${label}_invalid_json`,
        `Required GA evidence file is not valid JSON: ${pathValue}`,
      );
    }
    return { label, file, json: undefined };
  }
}

function check(name, passed, { code }) {
  checks.push({ name, status: passed ? "pass" : "fail" });
  if (!passed) addBlocker(code, name);
}

function addBlocker(code, message) {
  if (blockers.some((item) => item.code === code && item.message === message)) {
    return;
  }
  blockers.push({ code, message });
}

function summarizeChecklist(json) {
  if (typeof json?.summary !== "object" || json.summary === null) {
    return undefined;
  }
  return {
    total: safeInteger(json.summary.total),
    satisfied: safeInteger(json.summary.satisfied),
    excepted: safeInteger(json.summary.excepted),
    blocked: safeInteger(json.summary.blocked),
    environmentRequired: safeInteger(json.summary.environmentRequired),
    securityCriticalBlocked: safeInteger(json.summary.securityCriticalBlocked),
  };
}

function blockedGateIds(json) {
  if (!Array.isArray(json?.gates)) return [];
  return json.gates
    .filter((gate) => gate?.status === "blocked")
    .map((gate) => String(gate.id))
    .sort();
}

function sha256Inventory(evidence) {
  const hashes = evidence
    .map((item) => item.file.sha256)
    .filter((value) => typeof value === "string")
    .sort();
  return createHash("sha256").update(hashes.join(":")).digest("hex");
}

function schemaVersion(json) {
  if (typeof json?.schemaVersion === "string") return json.schemaVersion;
  if (typeof json?.bomFormat === "string") return json.bomFormat;
  return undefined;
}

function statusValue(json) {
  return typeof json?.status === "string" ? json.status : undefined;
}

function releaseVersion(json) {
  if (typeof json?.release?.version === "string") return json.release.version;
  if (typeof json?.version === "string") return json.version;
  return undefined;
}

function isKnownChecklistStatus(json) {
  return json?.status === "passed" || json?.status === "blocked";
}

function safeInteger(value) {
  return Number.isInteger(value) ? value : undefined;
}

function isNonEmpty(value) {
  return typeof value === "string" && value.length > 0;
}

function validTimestamp(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function redactionFlagsFalse(redaction, fields) {
  return fields.every((field) => redaction?.[field] === false);
}

function hasPassedCheck(json, name) {
  const checkItems = Array.isArray(json?.checks) ? json.checks : [];
  return checkItems.some(
    (item) =>
      item === name ||
      (item?.name === name &&
        (item.status === "pass" || item.status === "passed")),
  );
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
