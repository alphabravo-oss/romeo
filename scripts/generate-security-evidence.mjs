import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, join, relative, resolve } from "node:path";

import {
  addCounts,
  addSeverity,
  argValue,
  argValues,
  emptySeverityCounts,
  fileEvidence,
  hasFlag,
  nonEmptyString,
  optionalFile,
  positiveInteger,
  readJson,
  removeUndefined,
  repoPath,
  root,
  severityAtOrAbove,
  severities,
  validateSha256,
  writeJsonOrStdout,
} from "./lib/release-artifacts.mjs";

const manifestPath = repoPath(
  argValue("--manifest") ?? "dist/release/release-manifest.json",
);
const outputPath = repoPath(
  argValue("--output") ?? "dist/release/security-evidence.json",
);
const explicitSbomPath = argValue("--sbom");
const auditFilePath = argValue("--audit-file");
const containerScanPaths = argValues("--container-scan-file").map((path) =>
  resolve(root, path),
);
const containerImageManifestPath = resolve(
  root,
  nonEmptyString(
    argValue("--container-image-manifest"),
    "--container-image-manifest",
  ),
);
const exceptionFileValue = argValue("--container-policy-exceptions");
const exceptionFilePath =
  exceptionFileValue === undefined
    ? undefined
    : resolve(root, exceptionFileValue);
const generatedAt = argValue("--generated-at") ?? new Date().toISOString();
const generatedAtMs = validTimestamp(generatedAt, "--generated-at");
const scanMaxAgeSeconds = positiveInteger(
  Number(argValue("--scan-max-age-seconds") ?? 86400),
  "--scan-max-age-seconds",
);
const failOn = argValue("--fail-on") ?? "high";
const skipAudit = hasFlag("--skip-audit");
const stdout = hasFlag("--stdout");

if (failOn !== "none" && !severities.includes(failOn)) {
  throw new Error(`--fail-on must be one of ${severities.join(", ")} or none.`);
}

const manifest = readJson(manifestPath);
const artifacts = normalizeManifestArtifacts(manifest.artifacts);
const sbomPath = resolveSbomPath();
const sbom = sbomPath === undefined ? undefined : summarizeSbom(sbomPath);
const audit = skipAudit ? skippedAudit() : summarizeAudit();
const imageManifest = summarizeImageManifest(containerImageManifestPath);
const exceptions = summarizeExceptions(exceptionFilePath);
const containerScans = containerScanPaths.map((path) =>
  summarizeContainerScan(path, imageManifest.imagesByRole),
);
const scanPolicy = evaluateContainerScanPolicy({
  containerScans,
  exceptions: exceptions.items,
  expectedImages: imageManifest.images,
});
const totalCounts = emptySeverityCounts();

addCounts(totalCounts, audit.counts);
addCounts(totalCounts, scanPolicy.effectiveCounts);

const failures = [...scanPolicy.failures, ...policyFailures(totalCounts)];
const evidence = {
  schemaVersion: "romeo.security-evidence.v1",
  generatedAt,
  status: failures.length === 0 ? "pass" : "fail",
  policy: {
    failOn,
    scanMaxAgeSeconds,
    requiredImageRoles: ["app", "ops"],
    deniedLicenses: deniedLicenses(),
  },
  release: {
    name: nonEmptyString(manifest.name, "release manifest name"),
    version: nonEmptyString(manifest.version, "release manifest version"),
    manifest: fileEvidence(
      manifestPath,
      relative(dirname(outputPath), manifestPath),
    ),
    artifacts,
    images: imageManifest.images,
  },
  sources: removeUndefined({
    sbom,
    npmAudit: audit.source,
    containerImageManifest: imageManifest.source,
    containerPolicyExceptions: exceptions.source,
    containerScans: containerScans.map((scan) => scan.source),
  }),
  findings: {
    npmAudit: audit.counts,
    containerScans: scanPolicy.rawCounts,
    containerScansEffective: scanPolicy.effectiveCounts,
    containerSecrets: scanPolicy.secretCount,
    deniedLicenses: scanPolicy.deniedLicenseCount,
    exceptionsApplied: scanPolicy.appliedExceptions,
    total: totalCounts,
  },
  failures,
};

writeJsonOrStdout({ path: outputPath, value: evidence, stdout });
if (!stdout)
  console.log(
    `Wrote Romeo release security evidence to ${relative(root, outputPath)}`,
  );
if (failures.length > 0) process.exit(1);

function normalizeManifestArtifacts(value) {
  if (!Array.isArray(value) || value.length === 0)
    throw new Error("Release manifest must contain artifacts.");
  return value.map((artifact) => ({
    name: nonEmptyString(artifact.name, "artifact name"),
    version: nonEmptyString(
      artifact.version,
      `artifact ${artifact.name} version`,
    ),
    file: nonEmptyString(artifact.file, `artifact ${artifact.name} file`),
    bytes: positiveInteger(artifact.bytes, `artifact ${artifact.name} bytes`),
    sha256: validateSha256(artifact.sha256, `artifact ${artifact.name} sha256`),
  }));
}

function resolveSbomPath() {
  if (explicitSbomPath !== undefined) return resolve(root, explicitSbomPath);
  return optionalFile(join(dirname(manifestPath), "sbom.cdx.json"));
}

function summarizeSbom(path) {
  const document = readJson(path);
  if (document.bomFormat !== "CycloneDX")
    throw new Error("SBOM evidence must be a CycloneDX document.");
  return {
    ...fileEvidence(path, relative(dirname(outputPath), path)),
    format: document.bomFormat,
    specVersion: nonEmptyString(document.specVersion, "SBOM specVersion"),
    componentCount: Array.isArray(document.components)
      ? document.components.length
      : 0,
    dependencyCount: Array.isArray(document.dependencies)
      ? document.dependencies.length
      : 0,
  };
}

function skippedAudit() {
  return {
    source: {
      type: "pnpm-audit",
      status: "skipped",
    },
    counts: emptySeverityCounts(),
  };
}

function summarizeAudit() {
  if (auditFilePath !== undefined) {
    const resolved = resolve(root, auditFilePath);
    return {
      source: {
        type: "pnpm-audit",
        ...fileEvidence(resolved, relative(dirname(outputPath), resolved)),
      },
      counts: countsFromNpmAudit(readJson(resolved)),
    };
  }

  const result = spawnSync("pnpm", ["audit", "--prod", "--json"], {
    cwd: root,
    encoding: "utf8",
  });
  const raw = result.stdout.trim();
  if (raw.length === 0) {
    process.stderr.write(result.stderr);
    throw new Error("pnpm audit did not return JSON output.");
  }
  return {
    source: {
      type: "pnpm-audit",
      command: "pnpm audit --prod --json",
      exitCode: result.status ?? 0,
    },
    counts: countsFromNpmAudit(JSON.parse(raw)),
  };
}

function countsFromNpmAudit(document) {
  const metadataCounts = countsFromMetadata(document.metadata?.vulnerabilities);
  if (metadataCounts !== undefined) return metadataCounts;

  const counts = emptySeverityCounts();
  for (const vulnerability of Object.values(document.vulnerabilities ?? {}))
    addSeverity(counts, vulnerability?.severity);
  for (const advisory of Object.values(document.advisories ?? {}))
    addSeverity(counts, advisory?.severity);
  return counts;
}

function summarizeContainerScan(path, imagesByRole) {
  const document = readJson(path);
  if (
    document.schemaVersion !== "romeo.container-scan-report.v1" ||
    document.scanner?.name !== "trivy" ||
    document.scanner?.format !== "trivy-json" ||
    !Array.isArray(document.report?.Results)
  ) {
    throw new Error(
      `${relative(root, path)} is not a Romeo Trivy scan report.`,
    );
  }
  const role = nonEmptyString(
    document.image?.role,
    "container scan image role",
  );
  const expected = imagesByRole.get(role);
  const digest = normalizedImageDigest(
    document.image?.digest,
    `container scan ${role} digest`,
  );
  const scannerDigest = normalizedImageDigest(
    document.report?.Metadata?.ImageID,
    `Trivy ${role} image ID`,
  );
  const scannedAt = nonEmptyString(
    document.generatedAt,
    `container scan ${role} generatedAt`,
  );
  const scannedAtMs = validTimestamp(
    scannedAt,
    `container scan ${role} generatedAt`,
  );
  const ageSeconds = Math.floor((generatedAtMs - scannedAtMs) / 1000);
  const findings = findingsFromContainerScan(document.report, role);
  return {
    source: {
      type: "container-scan",
      ...fileEvidence(path, relative(dirname(outputPath), path)),
      scanner: "trivy",
      role,
      reference: document.image.reference,
      digest,
      generatedAt: scannedAt,
      ageSeconds,
      digestMatchesManifest: expected?.digest === digest,
      scannerDigestMatches: scannerDigest === digest,
    },
    role,
    digest,
    scannerDigest,
    reference: nonEmptyString(
      document.image?.reference,
      `container scan ${role} reference`,
    ),
    expected,
    ageSeconds,
    findings,
    counts: countsFromFindings(findings),
  };
}

function findingsFromContainerScan(document, role) {
  const findings = [];
  for (const result of document.Results ?? []) {
    for (const vulnerability of result.Vulnerabilities ?? []) {
      findings.push({
        type: "vulnerability",
        id: nonEmptyString(
          vulnerability.VulnerabilityID,
          "Trivy vulnerability ID",
        ),
        severity: vulnerability.Severity,
        role,
      });
    }
    for (const secret of result.Secrets ?? []) {
      findings.push({
        type: "secret",
        id: nonEmptyString(secret.RuleID ?? secret.Title, "Trivy secret ID"),
        severity: secret.Severity ?? "critical",
        role,
      });
    }
    for (const license of result.Licenses ?? []) {
      findings.push({
        type: "license",
        id: nonEmptyString(license.Name, "Trivy license name"),
        severity: "info",
        role,
      });
    }
  }
  return findings;
}

function countsFromFindings(findings) {
  const counts = emptySeverityCounts();
  for (const finding of findings) addSeverity(counts, finding.severity);
  return counts;
}

function countsFromMetadata(value) {
  if (typeof value !== "object" || value === null) return undefined;
  const counts = emptySeverityCounts();
  for (const severity of severities) {
    const count = value[severity];
    if (Number.isInteger(count) && count >= 0) counts[severity] = count;
  }
  return counts;
}

function policyFailures(counts) {
  const failingCount = severityAtOrAbove(counts, failOn);
  if (failingCount === 0) return [];
  return [
    {
      code: "vulnerability_threshold_exceeded",
      message: `${failingCount} vulnerability findings meet or exceed the ${failOn} release threshold.`,
    },
  ];
}

function summarizeImageManifest(path) {
  const document = readJson(path);
  if (
    document.schemaVersion !== "romeo.container-image-manifest.v1" ||
    !Array.isArray(document.images)
  ) {
    throw new Error("Container image manifest is malformed.");
  }
  const images = document.images.map((image) => ({
    role: nonEmptyString(image.role, "container image role"),
    reference: nonEmptyString(image.reference, "container image reference"),
    digest: normalizedImageDigest(image.digest, "container image digest"),
  }));
  const imagesByRole = new Map(images.map((image) => [image.role, image]));
  if (imagesByRole.size !== images.length)
    throw new Error("Container image manifest contains duplicate roles.");
  for (const role of ["app", "ops"])
    if (!imagesByRole.has(role))
      throw new Error(`Container image manifest is missing ${role}.`);
  return {
    images,
    imagesByRole,
    source: {
      type: "container-image-manifest",
      ...fileEvidence(path, relative(dirname(outputPath), path)),
    },
  };
}

function summarizeExceptions(path) {
  if (path === undefined) return { items: [], source: undefined };
  const document = readJson(path);
  if (
    document.schemaVersion !== "romeo.container-scan-exceptions.v1" ||
    !Array.isArray(document.exceptions)
  ) {
    throw new Error("Container scan exception file is malformed.");
  }
  const items = document.exceptions.map((item) => {
    const expiresAt = nonEmptyString(item.expiresAt, "exception expiresAt");
    const expiresAtMs = validTimestamp(expiresAt, "exception expiresAt");
    if (expiresAtMs <= generatedAtMs)
      throw new Error(`Container scan exception ${item.id} is expired.`);
    const reason = nonEmptyString(item.reason, "exception reason");
    if (reason.length < 16)
      throw new Error("Container scan exception reason is too short.");
    return {
      type: nonEmptyString(item.type, "exception type"),
      id: nonEmptyString(item.id, "exception finding ID"),
      imageRole: nonEmptyString(item.imageRole, "exception image role"),
      expiresAt,
      reason,
    };
  });
  return {
    items,
    source: {
      type: "container-scan-exceptions",
      ...fileEvidence(path, relative(dirname(outputPath), path)),
      exceptionCount: items.length,
    },
  };
}

function evaluateContainerScanPolicy({
  containerScans,
  exceptions,
  expectedImages,
}) {
  const failures = [];
  const scansByRole = new Map();
  for (const scan of containerScans) {
    if (scansByRole.has(scan.role)) {
      failures.push({
        code: "container_scan_duplicate",
        message: `Multiple container scans were supplied for ${scan.role}.`,
      });
      continue;
    }
    scansByRole.set(scan.role, scan);
  }
  for (const image of expectedImages) {
    const scan = scansByRole.get(image.role);
    if (scan === undefined) {
      failures.push({
        code: "container_scan_missing",
        message: `The ${image.role} release image has no scan report.`,
      });
      continue;
    }
    if (scan.digest !== image.digest) {
      failures.push({
        code: "container_scan_digest_mismatch",
        message: `The ${image.role} scan is not bound to its release digest.`,
      });
    }
    if (
      scan.scannerDigest !== image.digest ||
      scan.reference !== image.reference
    ) {
      failures.push({
        code: "container_scan_artifact_mismatch",
        message: `The ${image.role} Trivy artifact identity does not match its release image.`,
      });
    }
    if (scan.ageSeconds < -300 || scan.ageSeconds > scanMaxAgeSeconds) {
      failures.push({
        code: "container_scan_stale",
        message: `The ${image.role} scan is outside the allowed freshness window.`,
      });
    }
  }
  for (const scan of containerScans) {
    if (!scan.expected) {
      failures.push({
        code: "container_scan_unexpected_role",
        message: `The ${scan.role} scan is not declared by the image manifest.`,
      });
    }
  }

  const rawFindings = containerScans.flatMap((scan) => scan.findings);
  const appliedExceptions = [];
  const effectiveFindings = rawFindings.filter((finding) => {
    const exception = exceptions.find(
      (item) =>
        item.type === finding.type &&
        item.id === finding.id &&
        item.imageRole === finding.role,
    );
    if (exception === undefined) return true;
    appliedExceptions.push({
      type: finding.type,
      id: finding.id,
      imageRole: finding.role,
      expiresAt: exception.expiresAt,
      reasonSha256: createHash("sha256").update(exception.reason).digest("hex"),
    });
    return false;
  });
  const secrets = effectiveFindings.filter((item) => item.type === "secret");
  const denied = new Set(deniedLicenses());
  const licenses = effectiveFindings.filter(
    (item) => item.type === "license" && denied.has(item.id),
  );
  if (secrets.length > 0) {
    failures.push({
      code: "container_secret_detected",
      message: `${secrets.length} unexcepted secret findings were detected in release images.`,
    });
  }
  if (licenses.length > 0) {
    failures.push({
      code: "container_license_denied",
      message: `${licenses.length} denied license findings were detected in release images.`,
    });
  }
  return {
    failures,
    rawCounts: countsFromFindings(rawFindings),
    effectiveCounts: countsFromFindings(effectiveFindings),
    secretCount: secrets.length,
    deniedLicenseCount: licenses.length,
    appliedExceptions,
  };
}

function normalizedImageDigest(value, label) {
  const digest = nonEmptyString(value, label);
  if (!/^sha256:[a-f0-9]{64}$/u.test(digest))
    throw new Error(`${label} must be sha256:<64 lowercase hex>.`);
  return digest;
}

function validTimestamp(value, label) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed))
    throw new Error(`${label} must be an ISO timestamp.`);
  return parsed;
}

function deniedLicenses() {
  const configured = argValues("--deny-license");
  return configured.length > 0
    ? configured
    : ["AGPL-3.0-only", "AGPL-3.0-or-later", "SSPL-1.0"];
}
