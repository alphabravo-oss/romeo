import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

import {
  argValue,
  fileEvidence,
  hasFlag,
  nonEmptyString,
  readJson,
  repoPath,
  root,
  validateSha256,
  writeJsonOrStdout,
} from "./lib/release-artifacts.mjs";

const manifestPath = repoPath(
  argValue("--manifest") ?? "dist/release/release-manifest.json",
);
const channelPath = repoPath(
  argValue("--channel-file") ?? "dist/release/release-channel.json",
);
const securityEvidencePath = repoPath(
  argValue("--security-evidence") ?? "dist/release/security-evidence.json",
);
const sbomPath = repoPath(argValue("--sbom") ?? "dist/release/sbom.cdx.json");
const signatureFilePath = optionalRepoPath(argValue("--signature-file"));
const attestationFilePath = optionalRepoPath(argValue("--attestation-file"));
const signatureRef = argValue("--signature-ref");
const attestationRef = argValue("--attestation-ref");
const outputPath = repoPath(
  argValue("--output") ?? "dist/release/release-provenance.json",
);
const generatedAt = argValue("--generated-at") ?? new Date().toISOString();
const commitSha = argValue("--commit-sha") ?? process.env.GITHUB_SHA;
const sourceRepo = argValue("--source-repo") ?? process.env.GITHUB_REPOSITORY;
const sourceRef = argValue("--source-ref") ?? process.env.GITHUB_REF;
const builderId = argValue("--builder-id") ?? process.env.GITHUB_WORKFLOW;
const ciRunUrl = argValue("--ci-run-url") ?? githubRunUrl();
const requireSignature = hasFlag("--require-signature");
const requireAttestation = hasFlag("--require-attestation");
const requireCiSource = hasFlag("--require-ci-source");
const stdout = hasFlag("--stdout");

const blockers = [];
const checks = [];
const manifest = readJson(manifestPath);
const channel = readJson(channelPath);
const securityEvidence = readJson(securityEvidencePath);
const sbom = readJson(sbomPath);
const artifacts = validateArtifacts();
const signature = signatureEvidence();
const attestation = attestationEvidence();

validateManifest();
validateChannel();
validateSecurityEvidence();
validateSbom();
validateSource();
validateSignatureAndAttestation();
validateRedaction();

const provenance = {
  schemaVersion: "romeo.release-provenance.v1",
  generatedAt,
  status: blockers.length === 0 ? "passed" : "blocked",
  release: {
    name: nonEmptyString(manifest.name, "release manifest name"),
    version: nonEmptyString(manifest.version, "release manifest version"),
    manifest: fileEvidence(manifestPath, relative(root, manifestPath)),
    channel: fileEvidence(channelPath, relative(root, channelPath)),
    securityEvidence: fileEvidence(
      securityEvidencePath,
      relative(root, securityEvidencePath),
    ),
    sbom: fileEvidence(sbomPath, relative(root, sbomPath)),
    artifacts,
  },
  source: {
    commitShaConfigured: isNonEmpty(commitSha),
    commitSha: validCommitSha(commitSha) ? commitSha : undefined,
    sourceRepoConfigured: isNonEmpty(sourceRepo),
    sourceRepoHash: isNonEmpty(sourceRepo)
      ? sha256Value(sourceRepo)
      : undefined,
    sourceRefConfigured: isNonEmpty(sourceRef),
    sourceRefHash: isNonEmpty(sourceRef) ? sha256Value(sourceRef) : undefined,
    builderIdConfigured: isNonEmpty(builderId),
    builderIdHash: isNonEmpty(builderId) ? sha256Value(builderId) : undefined,
    ciRunUrlConfigured: isNonEmpty(ciRunUrl),
    ciRunUrlHash: isNonEmpty(ciRunUrl) ? sha256Value(ciRunUrl) : undefined,
  },
  supplyChain: {
    sbomAttached: true,
    securityEvidenceAttached: true,
    releaseChannelAttached: true,
    signatureAttached: signature.signed,
    attestationAttached: attestation.attested,
    signatureRequired: requireSignature,
    attestationRequired: requireAttestation,
    ciSourceRequired: requireCiSource,
  },
  signature,
  attestation,
  checks,
  blockers,
  redaction: {
    tokenValuesReturned: false,
    secretValuesReturned: false,
    fileBodiesReturned: false,
    rawSignatureReturned: false,
    rawAttestationReturned: false,
    rawCiRunUrlReturned: false,
    rawSourceRepoReturned: false,
    rawSourceRefReturned: false,
    environmentReturned: false,
  },
};

writeJsonOrStdout({
  path: outputPath,
  value: removeUndefinedDeep(provenance),
  stdout,
});
if (!stdout)
  console.log(
    `Wrote Romeo release provenance evidence to ${relative(root, outputPath)}`,
  );
if (blockers.length > 0) process.exit(1);

function validateManifest() {
  check(
    "release manifest name is present",
    isNonEmpty(manifest.name),
    "manifest_name_missing",
  );
  check(
    "release manifest version is present",
    isNonEmpty(manifest.version),
    "manifest_version_missing",
  );
  check(
    "release manifest artifacts are present",
    artifacts.length > 0,
    "manifest_artifacts_missing",
  );
}

function validateChannel() {
  check(
    "release channel schema is valid",
    channel.schemaVersion === "romeo.release-channel.v1",
    "channel_schema_invalid",
  );
  check(
    "release channel latest matches manifest",
    channel.latest === manifest.version,
    "channel_latest_mismatch",
  );
  const release = Array.isArray(channel.releases)
    ? channel.releases.find((item) => item?.version === manifest.version)
    : undefined;
  check(
    "release channel contains manifest version",
    release !== undefined,
    "channel_release_missing",
  );
  if (release !== undefined) {
    const channelArtifacts = Array.isArray(release.artifacts)
      ? release.artifacts
      : [];
    for (const artifact of artifacts) {
      const channelArtifact = channelArtifacts.find(
        (item) => item?.name === artifact.name,
      );
      check(
        `channel artifact ${artifact.name} digest matches`,
        channelArtifact?.sha256 === artifact.sha256,
        "channel_artifact_digest_mismatch",
      );
    }
  }
}

function validateSecurityEvidence() {
  check(
    "security evidence schema is valid",
    securityEvidence.schemaVersion === "romeo.security-evidence.v1",
    "security_evidence_schema_invalid",
  );
  check(
    "security evidence status is pass",
    securityEvidence.status === "pass",
    "security_evidence_not_passing",
  );
  check(
    "security evidence version matches manifest",
    securityEvidence.release?.version === manifest.version,
    "security_evidence_version_mismatch",
  );
  for (const artifact of artifacts) {
    const securityArtifact = Array.isArray(securityEvidence.release?.artifacts)
      ? securityEvidence.release.artifacts.find(
          (item) => item?.name === artifact.name,
        )
      : undefined;
    check(
      `security evidence artifact ${artifact.name} digest matches`,
      securityArtifact?.sha256 === artifact.sha256,
      "security_artifact_digest_mismatch",
    );
  }
}

function validateSbom() {
  check(
    "SBOM format is CycloneDX",
    sbom.bomFormat === "CycloneDX",
    "sbom_not_cyclonedx",
  );
  check(
    "SBOM component metadata matches release",
    sbom.metadata?.component?.version === manifest.version,
    "sbom_version_mismatch",
  );
  check(
    "security evidence references SBOM digest",
    securityEvidence.sources?.sbom?.sha256 === fileEvidence(sbomPath).sha256,
    "security_sbom_digest_mismatch",
  );
}

function validateArtifacts() {
  if (!Array.isArray(manifest.artifacts)) return [];
  return manifest.artifacts.map((artifact) => {
    const name = nonEmptyString(artifact.name, "artifact name");
    const file = nonEmptyString(artifact.file, `${name} file`);
    const path = resolve(dirname(manifestPath), file);
    const sha256 = validateSha256(artifact.sha256, `${name} sha256`);
    if (!existsSync(path)) {
      addBlocker("artifact_missing", `Artifact file is missing: ${file}`);
    } else {
      const actual = fileEvidence(path, file);
      check(
        `artifact ${name} digest matches manifest`,
        actual.sha256 === sha256,
        "artifact_digest_mismatch",
      );
      check(
        `artifact ${name} size matches manifest`,
        actual.bytes === artifact.bytes,
        "artifact_size_mismatch",
      );
    }
    return {
      name,
      version: nonEmptyString(artifact.version, `${name} version`),
      file,
      bytes: artifact.bytes,
      sha256,
    };
  });
}

function validateSource() {
  if (isNonEmpty(commitSha)) {
    check(
      "source commit SHA is valid",
      validCommitSha(commitSha),
      "source_commit_sha_invalid",
    );
  }
  if (requireCiSource) {
    check(
      "source commit SHA is configured",
      isNonEmpty(commitSha),
      "source_commit_sha_missing",
    );
    check(
      "source repository is configured",
      isNonEmpty(sourceRepo),
      "source_repo_missing",
    );
    check(
      "builder ID is configured",
      isNonEmpty(builderId),
      "builder_id_missing",
    );
    check(
      "CI run URL is configured",
      isNonEmpty(ciRunUrl),
      "ci_run_url_missing",
    );
    if (isNonEmpty(ciRunUrl)) {
      check(
        "CI run URL is https",
        safeHttpsUrl(ciRunUrl),
        "ci_run_url_not_https",
      );
    }
  }
}

function validateSignatureAndAttestation() {
  if (requireSignature) {
    check(
      "signature evidence is attached",
      signature.signed === true,
      "signature_missing",
    );
  }
  if (requireAttestation) {
    check(
      "attestation evidence is attached",
      attestation.attested === true,
      "attestation_missing",
    );
  }
}

function validateRedaction() {
  const serialized = JSON.stringify({
    release: {
      name: manifest.name,
      version: manifest.version,
      artifacts,
    },
    source: {
      commitSha: validCommitSha(commitSha) ? commitSha : undefined,
    },
    signature,
    attestation,
  });
  const forbidden = Object.entries(process.env)
    .filter(
      ([key, value]) =>
        /TOKEN|SECRET|PASSWORD|API_KEY|CREDENTIAL/iu.test(key) &&
        isNonEmpty(value),
    )
    .map(([, value]) => value);
  for (const value of forbidden) {
    if (serialized.includes(value))
      addBlocker(
        "secret_redaction_failed",
        "Release provenance evidence included a secret-like environment value.",
      );
  }
  check(
    "provenance redaction self-check passed",
    !blockers.some((item) => item.code === "secret_redaction_failed"),
    "secret_redaction_failed",
  );
}

function signatureEvidence() {
  return {
    signed: signatureFilePath !== undefined || isNonEmpty(signatureRef),
    file:
      signatureFilePath === undefined
        ? undefined
        : fileEvidence(signatureFilePath, relative(root, signatureFilePath)),
    ref: externalRefEvidence(signatureRef),
  };
}

function attestationEvidence() {
  return {
    attested: attestationFilePath !== undefined || isNonEmpty(attestationRef),
    file:
      attestationFilePath === undefined
        ? undefined
        : fileEvidence(
            attestationFilePath,
            relative(root, attestationFilePath),
          ),
    ref: externalRefEvidence(attestationRef),
  };
}

function externalRefEvidence(value) {
  if (!isNonEmpty(value)) return undefined;
  return {
    configured: true,
    scheme: refScheme(value),
    hostSha256: refHostHash(value),
    sha256: sha256Value(value),
  };
}

function check(name, passed, blockerCode) {
  checks.push({ name, status: passed ? "pass" : "fail" });
  if (!passed) addBlocker(blockerCode, name);
}

function addBlocker(code, message) {
  blockers.push({ code, message });
}

function optionalRepoPath(value) {
  if (!isNonEmpty(value)) return undefined;
  const path = repoPath(value);
  return existsSync(path) ? path : undefined;
}

function githubRunUrl() {
  const server = process.env.GITHUB_SERVER_URL;
  const repository = process.env.GITHUB_REPOSITORY;
  const runId = process.env.GITHUB_RUN_ID;
  if (!isNonEmpty(server) || !isNonEmpty(repository) || !isNonEmpty(runId))
    return undefined;
  return `${server}/${repository}/actions/runs/${runId}`;
}

function safeHttpsUrl(value) {
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === "https:" &&
      parsed.username.length === 0 &&
      parsed.password.length === 0
    );
  } catch {
    return false;
  }
}

function refScheme(value) {
  try {
    return new URL(value).protocol.slice(0, -1);
  } catch {
    const index = value.indexOf(":");
    return index > 0 ? value.slice(0, index) : "opaque";
  }
}

function refHostHash(value) {
  try {
    const parsed = new URL(value);
    return parsed.host.length > 0 ? sha256Value(parsed.host) : undefined;
  } catch {
    return undefined;
  }
}

function sha256Value(value) {
  return createHash("sha256").update(value).digest("hex");
}

function validCommitSha(value) {
  return typeof value === "string" && /^[a-f0-9]{40}$/iu.test(value);
}

function isNonEmpty(value) {
  return typeof value === "string" && value.length > 0;
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
