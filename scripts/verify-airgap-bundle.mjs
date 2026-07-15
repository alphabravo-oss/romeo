import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import {
  argValue,
  fileEvidence,
  hasFlag,
  readJson,
  repoPath,
  root,
  validateSha256,
  writeJsonOrStdout,
} from "./lib/release-artifacts.mjs";

const bundleDir = repoPath(argValue("--bundle-dir") ?? "dist/release");
const generatedAt = argValue("--generated-at") ?? new Date().toISOString();
const outputPath = repoPath(
  argValue("--output") ?? "dist/release/airgap-bundle-verification.json",
);
const stdout = hasFlag("--stdout");
const requireGaBundle = hasFlag("--require-ga-bundle");
const requirePublishPlan = hasFlag("--require-publish-plan");
const requireReleaseReadback = hasFlag("--require-release-readback");
const requireReadbackValidation = hasFlag("--require-readback-validation");
const requireSignedProvenance = hasFlag("--require-signed-provenance");
const requireApproval = hasFlag("--require-approval");
const checks = [];
const blockers = [];

const manifest = jsonEvidence(
  "release_manifest",
  pathArg("--manifest", "release-manifest.json"),
  true,
);
const channel = jsonEvidence(
  "release_channel",
  pathArg("--channel-file", "release-channel.json"),
  true,
);
const securityEvidence = jsonEvidence(
  "security_evidence",
  pathArg("--security-evidence", "security-evidence.json"),
  true,
);
const sbom = jsonEvidence("sbom", pathArg("--sbom", "sbom.cdx.json"), true);
const provenance = jsonEvidence(
  "release_provenance",
  pathArg("--provenance-file", "release-provenance.json"),
  true,
);
const approval = jsonEvidence(
  "release_approval",
  pathArg("--approval-file", "release-approval.json"),
  requireApproval,
);
const gaBundle = jsonEvidence(
  "ga_evidence_bundle",
  pathArg("--ga-bundle", "ga-evidence-bundle.json"),
  requireGaBundle,
);
const publishPlan = jsonEvidence(
  "publish_plan",
  pathArg("--publish-plan", "publish-plan.json"),
  requirePublishPlan,
);
const releaseReadback = jsonEvidence(
  "release_readback",
  pathArg("--release-readback", "release-readback.json"),
  requireReleaseReadback,
);
const readbackValidation = jsonEvidence(
  "readback_validation",
  pathArg("--readback-validation", "readback-validation.json"),
  requireReadbackValidation,
);

const artifacts = validateArtifacts();

validateReleaseManifest();
validateChannel();
validateSecurityEvidence();
validateSbom();
validateProvenance();
validateApproval();
validateGaBundle();
validatePublishPlan();
validateReleaseReadback();
validateReadbackValidation();

const evidenceFiles = [
  manifest.file,
  channel.file,
  securityEvidence.file,
  sbom.file,
  provenance.file,
  approval.file,
  gaBundle.file,
  publishPlan.file,
  releaseReadback.file,
  readbackValidation.file,
  ...artifacts.map((artifact) => artifact.file),
].filter((file) => file.present);

const bundle = {
  schemaVersion: "romeo.airgap-bundle-verification.v1",
  generatedAt,
  status: blockers.length === 0 ? "passed" : "blocked",
  bundle: {
    directory: displayPath(bundleDir),
    releaseName: manifest.json?.name,
    releaseVersion: manifest.json?.version,
    artifactCount: artifacts.length,
    evidenceFileCount: evidenceFiles.length,
    totalBytes: evidenceFiles.reduce((total, file) => total + file.bytes, 0),
    sha256: sha256Inventory(evidenceFiles),
  },
  requirements: {
    gaBundle: requireGaBundle,
    publishPlan: requirePublishPlan,
    releaseReadback: requireReleaseReadback,
    readbackValidation: requireReadbackValidation,
    signedProvenance: requireSignedProvenance,
    approval: requireApproval,
  },
  files: {
    manifest: manifest.file,
    channel: channel.file,
    securityEvidence: securityEvidence.file,
    sbom: sbom.file,
    provenance: provenance.file,
    approval: approval.file,
    gaBundle: gaBundle.file,
    publishPlan: publishPlan.file,
    releaseReadback: releaseReadback.file,
    readbackValidation: readbackValidation.file,
  },
  artifacts,
  checks,
  blockers,
  redaction: {
    artifactBodiesIncluded: false,
    packageContentsIncluded: false,
    sbomBodyIncluded: false,
    provenanceBodyIncluded: false,
    evidenceBodiesIncluded: false,
    registryTokensIncluded: false,
    secretValuesIncluded: false,
    absoluteBundlePathsIncluded: false,
  },
};

validateRedaction(bundle);

writeJsonOrStdout({
  path: outputPath,
  value: removeUndefinedDeep(bundle),
  stdout,
});
if (!stdout) {
  console.log(
    `Wrote Romeo air-gapped bundle verification to ${displayPath(outputPath)}`,
  );
}
if (blockers.length > 0) process.exit(1);

function validateReleaseManifest() {
  check("release manifest name is Romeo", manifest.json?.name === "romeo", {
    code: "manifest_name_invalid",
  });
  check(
    "release manifest version is present",
    isNonEmpty(manifest.json?.version),
    { code: "manifest_version_missing" },
  );
  check(
    "release manifest artifacts are present",
    Array.isArray(manifest.json?.artifacts) &&
      manifest.json.artifacts.length > 0,
    { code: "manifest_artifacts_missing" },
  );
}

function validateArtifacts() {
  if (!Array.isArray(manifest.json?.artifacts)) return [];
  return manifest.json.artifacts.map((artifact) => {
    const name = stringValue(artifact?.name);
    const version = stringValue(artifact?.version);
    const declaredFile = stringValue(artifact?.file);
    const expectedSha256 = safeSha256(
      artifact?.sha256,
      `${name ?? declaredFile ?? "artifact"} sha256`,
    );
    const expectedBytes = Number.isInteger(artifact?.bytes)
      ? artifact.bytes
      : undefined;
    const path = declaredFile
      ? resolve(dirname(manifest.path), declaredFile)
      : undefined;
    const pathSafe =
      path !== undefined &&
      isInsideDirectory(bundleDir, path) &&
      !isAbsolute(declaredFile);
    if (!declaredFile) {
      addBlocker(
        "artifact_file_missing",
        "Release manifest artifact file is missing.",
      );
    } else if (!pathSafe) {
      addBlocker(
        "artifact_path_unsafe",
        `Release artifact must stay inside the air-gapped bundle: ${declaredFile}`,
      );
    }
    const present = pathSafe && path !== undefined && existsSync(path);
    const file = present
      ? {
          label: "artifact",
          present: true,
          path: bundleRelative(path),
          ...fileEvidence(path, bundleRelative(path)),
          expectedBytes,
          expectedSha256,
        }
      : {
          label: "artifact",
          present: false,
          path: declaredFile,
          bytes: 0,
          expectedBytes,
          expectedSha256,
        };
    if (declaredFile && pathSafe && !present) {
      addBlocker(
        "artifact_missing",
        `Release artifact is missing: ${declaredFile}`,
      );
    }
    if (present && expectedSha256 !== undefined) {
      check(
        `artifact ${name ?? declaredFile} digest matches manifest`,
        file.sha256 === expectedSha256,
        { code: "artifact_digest_mismatch" },
      );
    }
    if (present && expectedBytes !== undefined) {
      check(
        `artifact ${name ?? declaredFile} size matches manifest`,
        file.bytes === expectedBytes,
        { code: "artifact_size_mismatch" },
      );
    }
    return {
      name,
      version,
      file,
      expected: {
        file: declaredFile,
        bytes: expectedBytes,
        sha256: expectedSha256,
      },
    };
  });
}

function validateChannel() {
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
  const release = Array.isArray(channel.json?.releases)
    ? channel.json.releases.find(
        (item) => item?.version === manifest.json?.version,
      )
    : undefined;
  check("release channel contains manifest version", release !== undefined, {
    code: "channel_release_missing",
  });
  validateArtifactIndex(
    "channel",
    Array.isArray(release?.artifacts) ? release.artifacts : [],
    "channel_artifact_digest_mismatch",
  );
}

function validateSecurityEvidence() {
  check(
    "security evidence schema is valid",
    securityEvidence.json?.schemaVersion === "romeo.security-evidence.v1",
    { code: "security_evidence_schema_invalid" },
  );
  check(
    "security evidence status is pass",
    securityEvidence.json?.status === "pass",
    {
      code: "security_evidence_not_passed",
    },
  );
  check(
    "security evidence release version matches manifest",
    securityEvidence.json?.release?.version === manifest.json?.version,
    { code: "security_evidence_version_mismatch" },
  );
  validateArtifactIndex(
    "security evidence",
    Array.isArray(securityEvidence.json?.release?.artifacts)
      ? securityEvidence.json.release.artifacts
      : [],
    "security_artifact_digest_mismatch",
  );
  check(
    "security evidence references bundled SBOM",
    securityEvidence.json?.sources?.sbom?.sha256 === sbom.file.sha256,
    { code: "security_sbom_digest_mismatch" },
  );
}

function validateSbom() {
  check("SBOM is CycloneDX", sbom.json?.bomFormat === "CycloneDX", {
    code: "sbom_not_cyclonedx",
  });
  check(
    "SBOM release version matches manifest",
    sbom.json?.metadata?.component?.version === manifest.json?.version,
    { code: "sbom_version_mismatch" },
  );
}

function validateProvenance() {
  check(
    "release provenance schema is valid",
    provenance.json?.schemaVersion === "romeo.release-provenance.v1",
    { code: "provenance_schema_invalid" },
  );
  check(
    "release provenance status is passed",
    provenance.json?.status === "passed",
    {
      code: "provenance_not_passed",
    },
  );
  check(
    "release provenance version matches manifest",
    provenance.json?.release?.version === manifest.json?.version,
    { code: "provenance_version_mismatch" },
  );
  for (const [field, evidence] of [
    ["manifest", manifest],
    ["channel", channel],
    ["securityEvidence", securityEvidence],
    ["sbom", sbom],
  ]) {
    check(
      `release provenance ${field} digest matches bundle`,
      provenance.json?.release?.[field]?.sha256 === evidence.file.sha256,
      { code: `provenance_${field}_digest_mismatch` },
    );
  }
  if (requireSignedProvenance) {
    check(
      "release provenance has signature or attestation",
      provenance.json?.supplyChain?.signatureAttached === true ||
        provenance.json?.supplyChain?.attestationAttached === true,
      { code: "signed_provenance_missing" },
    );
  }
}

function validateApproval() {
  if (!approval.file.present) return;
  check(
    "release approval schema is valid",
    approval.json?.schemaVersion === "romeo.release-approval.v1",
    { code: "approval_schema_invalid" },
  );
  check(
    "release approval status is passed",
    approval.json?.status === "passed",
    { code: "approval_not_passed" },
  );
  check(
    "release approval version matches manifest",
    approval.json?.release?.version === manifest.json?.version,
    { code: "approval_version_mismatch" },
  );
  check(
    "release approval manifest digest matches bundle",
    approval.json?.release?.manifest?.sha256 === manifest.file.sha256,
    { code: "approval_manifest_digest_mismatch" },
  );
  check(
    "release approval provenance digest matches bundle",
    approval.json?.release?.provenance?.sha256 === provenance.file.sha256,
    { code: "approval_provenance_digest_mismatch" },
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
    { code: "approval_approver_count_insufficient" },
  );
  check(
    "release approval reference is configured",
    approval.json?.approval?.refConfigured === true,
    { code: "approval_ref_missing" },
  );
  if (approval.json?.approval?.expiresAt !== undefined) {
    check(
      "release approval has not expired",
      validTimestamp(approval.json.approval.expiresAt) &&
        validTimestamp(generatedAt) &&
        Date.parse(approval.json.approval.expiresAt) > Date.parse(generatedAt),
      { code: "approval_expired" },
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
    { code: "approval_redaction_invalid" },
  );
}

function validateGaBundle() {
  if (!gaBundle.file.present) return;
  check(
    "GA evidence bundle schema is valid",
    gaBundle.json?.schemaVersion === "romeo.ga-evidence-bundle.v1",
    { code: "ga_bundle_schema_invalid" },
  );
  check(
    "GA evidence bundle status is known",
    gaBundle.json?.status === "passed" || gaBundle.json?.status === "blocked",
    { code: "ga_bundle_status_invalid" },
  );
  check(
    "GA evidence bundle release version matches manifest",
    gaBundle.json?.release?.version === manifest.json?.version,
    { code: "ga_bundle_version_mismatch" },
  );
  for (const [field, evidence] of [
    ["manifest", manifest],
    ["channel", channel],
    ["securityEvidence", securityEvidence],
    ["sbom", sbom],
    ["provenance", provenance],
    ...(approval.file.present && gaBundle.json?.release?.approval !== undefined
      ? [["approval", approval]]
      : []),
    ...(readbackValidation.file.present &&
    gaBundle.json?.release?.readbackValidation !== undefined
      ? [["readbackValidation", readbackValidation]]
      : []),
  ]) {
    check(
      `GA evidence bundle ${field} digest matches bundle`,
      gaBundle.json?.release?.[field]?.sha256 === evidence.file.sha256,
      { code: `ga_bundle_${field}_digest_mismatch` },
    );
  }
  if (requireApproval && approval.file.present) {
    check(
      "GA evidence bundle approval digest matches bundle",
      gaBundle.json?.release?.approval?.sha256 === approval.file.sha256,
      { code: "ga_bundle_approval_digest_mismatch" },
    );
  }
  if (requireReadbackValidation && readbackValidation.file.present) {
    check(
      "GA evidence bundle readback validation digest matches bundle",
      gaBundle.json?.release?.readbackValidation?.sha256 ===
        readbackValidation.file.sha256,
      { code: "ga_bundle_readback_validation_digest_mismatch" },
    );
  }
  check(
    "GA evidence bundle redaction flags are safe",
    redactionFlagsFalse(gaBundle.json?.redaction, [
      "evidenceBodiesIncluded",
      "exceptionRationaleIncluded",
      "rawEvidencePathsIncluded",
      "rawSecretsIncluded",
      "rawLogsIncluded",
      "rawPromptsIncluded",
      "rawProviderPayloadsIncluded",
      "rawConnectorPayloadsIncluded",
    ]),
    { code: "ga_bundle_redaction_invalid" },
  );
}

function validatePublishPlan() {
  if (!publishPlan.file.present) return;
  check(
    "publish plan schema is valid",
    publishPlan.json?.schemaVersion === "romeo.release-publish-plan.v1",
    { code: "publish_plan_schema_invalid" },
  );
  check(
    "publish plan release version matches manifest",
    publishPlan.json?.release?.version === manifest.json?.version,
    { code: "publish_plan_version_mismatch" },
  );
  validateArtifactIndex(
    "publish plan",
    Array.isArray(publishPlan.json?.release?.artifacts)
      ? publishPlan.json.release.artifacts
      : [],
    "publish_plan_artifact_digest_mismatch",
  );
  if (
    approval.file.present &&
    (requireApproval || publishPlan.json?.release?.approval !== undefined)
  ) {
    check(
      "publish plan approval digest matches bundle",
      publishPlan.json?.release?.approval?.sha256 === approval.file.sha256,
      { code: "publish_plan_approval_digest_mismatch" },
    );
  }
}

function validateReleaseReadback() {
  if (!releaseReadback.file.present) return;
  check(
    "release readback schema is valid",
    releaseReadback.json?.schemaVersion === "romeo.release-readback.v1",
    { code: "release_readback_schema_invalid" },
  );
  check(
    "release readback version matches manifest",
    releaseReadback.json?.release?.version === manifest.json?.version,
    { code: "release_readback_version_mismatch" },
  );
}

function validateReadbackValidation() {
  if (!readbackValidation.file.present) return;
  check(
    "release readback validation schema is valid",
    readbackValidation.json?.schemaVersion ===
      "romeo.release-readback-validation.v1",
    { code: "readback_validation_schema_invalid" },
  );
  check(
    "release readback validation status is pass",
    readbackValidation.json?.status === "pass",
    { code: "readback_validation_not_passed" },
  );
  check(
    "release readback validation mode is live",
    readbackValidation.json?.mode === "live_readback",
    { code: "readback_validation_not_live" },
  );
  check(
    "release readback validation version matches manifest",
    readbackValidation.json?.release?.version === manifest.json?.version,
    { code: "readback_validation_version_mismatch" },
  );
  check(
    "release readback validation manifest digest matches bundle",
    readbackValidation.json?.release?.manifest?.sha256 === manifest.file.sha256,
    { code: "readback_validation_manifest_digest_mismatch" },
  );
  check(
    "release readback validation has credentialed npm proof",
    hasPassedCheck(
      readbackValidation.json,
      "credentialed npm registry readback",
    ),
    { code: "readback_validation_npm_not_credentialed" },
  );
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
    { code: "readback_validation_redaction_invalid" },
  );
  validateReadbackValidationPackages();
  validateReadbackValidationImages();
  validateReadbackValidationCharts();
  validateReadbackValidationAssets();
}

function validateReadbackValidationPackages() {
  const requiredPackages = new Map(
    Array.isArray(readbackValidation.json?.required?.packages)
      ? readbackValidation.json.required.packages
          .filter(
            (item) =>
              typeof item?.name === "string" &&
              typeof item?.version === "string",
          )
          .map((item) => [`${item.name}@${item.version}`, item])
      : [],
  );
  for (const artifact of artifacts) {
    const key = `${artifact.name}@${artifact.version}`;
    const item = requiredPackages.get(key);
    check(
      `${key} readback validation package is required`,
      item !== undefined,
      {
        code: "readback_validation_required_package_missing",
      },
    );
    if (item === undefined) continue;
    check(
      `${key} readback validation package digest matches manifest`,
      item.sha256 === artifact.expected.sha256,
      { code: "readback_validation_package_digest_mismatch" },
    );
    check(
      `${key} package readback is verified`,
      hasPassedCheck(
        readbackValidation.json,
        `${key} package sha256 matches manifest`,
      ),
      { code: "readback_validation_package_not_verified" },
    );
  }
}

function validateReadbackValidationImages() {
  const images = Array.isArray(readbackValidation.json?.required?.images)
    ? readbackValidation.json.required.images
    : [];
  check("release readback validation includes image proof", images.length > 0, {
    code: "readback_validation_required_image_missing",
  });
  for (const image of images) {
    check(
      `${image} image readback is verified`,
      typeof image === "string" &&
        hasPassedCheck(
          readbackValidation.json,
          `${image} image registry readback is verified`,
        ),
      { code: "readback_validation_image_not_verified" },
    );
  }
}

function validateReadbackValidationCharts() {
  const charts = Array.isArray(readbackValidation.json?.required?.charts)
    ? readbackValidation.json.required.charts
    : [];
  check("release readback validation includes chart proof", charts.length > 0, {
    code: "readback_validation_required_chart_missing",
  });
  for (const chart of charts) {
    check(
      `${chart?.name} chart readback is verified`,
      typeof chart?.name === "string" &&
        hasPassedCheck(
          readbackValidation.json,
          `${chart.name} chart repository readback is verified`,
        ),
      { code: "readback_validation_chart_not_verified" },
    );
  }
}

function validateReadbackValidationAssets() {
  const assets = new Map(
    Array.isArray(readbackValidation.json?.required?.assets)
      ? readbackValidation.json.required.assets
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
      `${name} release asset is required by readback validation`,
      asset !== undefined &&
        typeof asset.sha256 === "string" &&
        /^[a-f0-9]{64}$/u.test(asset.sha256),
      { code: `readback_validation_required_asset_missing:${name}` },
    );
    check(
      `${name} release asset readback is verified`,
      hasPassedCheck(
        readbackValidation.json,
        `${name} release asset readback is verified`,
      ),
      { code: `readback_validation_asset_not_verified:${name}` },
    );
  }
}

function validateArtifactIndex(label, values, code) {
  for (const artifact of artifacts) {
    const indexed = values.find((item) => item?.name === artifact.name);
    check(
      `${label} artifact ${artifact.name ?? artifact.expected.file} digest matches manifest`,
      indexed?.sha256 === artifact.expected.sha256,
      { code },
    );
  }
}

function jsonEvidence(label, path, required) {
  if (!existsSync(path)) {
    const file = {
      label,
      present: false,
      path: displayPath(path),
      bytes: 0,
    };
    if (required) {
      addBlocker(
        `${label}_missing`,
        `Required air-gapped bundle file is missing: ${file.path}`,
      );
    }
    return { label, path, file, json: undefined };
  }
  const file = {
    label,
    present: true,
    path: displayPath(path),
    ...fileEvidence(path, displayPath(path)),
  };
  try {
    const json = readJson(path);
    return {
      label,
      path,
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
        `Required air-gapped bundle file is not valid JSON: ${file.path}`,
      );
    }
    return { label, path, file, json: undefined };
  }
}

function pathArg(name, fallback) {
  return resolve(bundleDir, argValue(name) ?? fallback);
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

function validateRedaction(value) {
  const serialized = JSON.stringify(value);
  const forbidden = Object.entries(process.env)
    .filter(
      ([key, item]) =>
        /TOKEN|SECRET|PASSWORD|API_KEY|CREDENTIAL/iu.test(key) &&
        typeof item === "string" &&
        item.length >= 8,
    )
    .map(([, item]) => item);
  for (const item of forbidden) {
    if (serialized.includes(item)) {
      addBlocker(
        "secret_redaction_failed",
        "Air-gapped bundle verification included a secret-like environment value.",
      );
    }
  }
  checks.push({
    name: "air-gapped bundle verification redaction self-check passed",
    status: blockers.some((item) => item.code === "secret_redaction_failed")
      ? "fail"
      : "pass",
  });
}

function sha256Inventory(files) {
  const hashes = files
    .map((file) => file.sha256)
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
  if (typeof json?.metadata?.component?.version === "string") {
    return json.metadata.component.version;
  }
  return undefined;
}

function safeSha256(value, label) {
  if (typeof value !== "string") return undefined;
  try {
    return validateSha256(value, label);
  } catch (error) {
    addBlocker("sha256_invalid", error.message);
    return undefined;
  }
}

function stringValue(value) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
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

function hasPassedCheck(evidence, name) {
  return (
    Array.isArray(evidence?.checks) &&
    evidence.checks.some(
      (check) => check?.name === name && check.status === "pass",
    )
  );
}

function isInsideDirectory(parent, child) {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function bundleRelative(path) {
  return relative(bundleDir, path) || ".";
}

function displayPath(path) {
  const rel = relative(root, path);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return rel;
  return bundleRelative(path);
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
