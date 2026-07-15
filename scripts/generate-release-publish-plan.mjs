import { existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

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
const securityEvidencePath = optionalRepoPath(
  argValue("--security-evidence") ?? "dist/release/security-evidence.json",
);
const provenancePath = optionalRepoPath(argValue("--provenance-file"));
const approvalPath = optionalRepoPath(argValue("--approval-file"));
const releaseNotesPath = optionalRepoPath(
  argValue("--release-notes-file") ?? "CHANGELOG.md",
);
const outputPath = repoPath(
  argValue("--output") ?? "dist/release/publish-plan.json",
);
const generatedAt = argValue("--generated-at") ?? new Date().toISOString();
const registryUrl = argValue("--registry-url") ?? "https://registry.npmjs.org/";
const npmTag = argValue("--npm-tag");
const npmAccess = argValue("--npm-access") ?? "public";
const gitRemote = argValue("--git-remote") ?? "origin";
const tagPrefix = argValue("--tag-prefix") ?? "v";
const releaseHost = argValue("--release-host") ?? "github";
const requireSecurityEvidence = hasFlag("--require-security-evidence");
const requireProvenance = hasFlag("--require-provenance");
const requireSignedProvenance = hasFlag("--require-signed-provenance");
const requireApproval = hasFlag("--require-approval");
const requireReleaseNotes = hasFlag("--require-release-notes");
const npmProvenance = hasFlag("--npm-provenance");
const stdout = hasFlag("--stdout");

const blockers = [];
const manifest = readJson(manifestPath);
const channel = readExistingJson(channelPath, "release channel");
const securityEvidence = readOptionalJson(
  securityEvidencePath,
  "security evidence",
);
const artifacts = normalizeManifestArtifacts(manifest.artifacts);
const publishOrder = normalizePublishOrder(manifest.publishOrder, artifacts);
const version = nonEmptyString(manifest.version, "release manifest version");
const channelRelease = findChannelRelease(channel, version);
const tagName = `${tagPrefix}${version}`;
const channelName =
  typeof channel.channel === "string" && channel.channel.length > 0
    ? channel.channel
    : "stable";
const artifactByName = new Map(
  artifacts.map((artifact) => [artifact.name, artifact]),
);

validateChannel();
validateSecurityEvidence();
const notesEvidence = validateOptionalFile(
  releaseNotesPath,
  "release notes",
  requireReleaseNotes,
);
const provenanceEvidence = validateProvenanceEvidence();
const approvalEvidence = validateApprovalEvidence();

const plan = {
  schemaVersion: "romeo.release-publish-plan.v1",
  generatedAt,
  status: blockers.length === 0 ? "ready" : "blocked",
  release: {
    name: nonEmptyString(manifest.name, "release manifest name"),
    version,
    tagName,
    manifest: fileEvidence(manifestPath, relative(root, manifestPath)),
    channel: {
      file: relative(root, channelPath),
      name: channelName,
      latest: channel.latest,
    },
    artifacts: artifacts.map((artifact) => ({
      name: artifact.name,
      version: artifact.version,
      file: artifact.file,
      bytes: artifact.bytes,
      sha256: artifact.sha256,
    })),
    securityEvidence:
      securityEvidencePath !== undefined && existsSync(securityEvidencePath)
        ? fileEvidence(
            securityEvidencePath,
            relative(root, securityEvidencePath),
          )
        : undefined,
    releaseNotes: notesEvidence,
    provenance: provenanceEvidence,
    approval: approvalEvidence,
  },
  policy: {
    registryUrl,
    npmTag: npmTag ?? channelName,
    npmAccess,
    gitRemote,
    releaseHost,
    npmProvenance,
    requireApproval,
    requireSignedProvenance,
  },
  blockers,
  steps: blockers.length === 0 ? buildSteps() : [],
};

writeJsonOrStdout({
  path: outputPath,
  value: removeUndefinedDeep(plan),
  stdout,
});
if (!stdout)
  console.log(
    `Wrote Romeo release publish plan to ${relative(root, outputPath)}`,
  );
if (blockers.length > 0) process.exit(1);

function buildSteps() {
  return [
    ...publishOrder.map((name, index) => {
      const artifact = requiredArtifact(name);
      const command = [
        "pnpm",
        "publish",
        relative(root, artifact.path),
        "--registry",
        registryUrl,
        "--tag",
        npmTag ?? channelName,
        "--access",
        npmAccess,
      ];
      if (npmProvenance) command.push("--provenance");
      return {
        id: `registry-publish-${index + 1}`,
        kind: "registry_publish",
        description: `Publish ${name} after local artifact verification.`,
        command,
        artifact: artifactSummary(artifact),
      };
    }),
    {
      id: "git-create-signed-tag",
      kind: "git_tag",
      description:
        "Create a signed immutable release tag after package publication succeeds.",
      command: ["git", "tag", "-s", tagName, "-m", `Romeo ${version}`],
    },
    {
      id: "git-push-tag",
      kind: "git_push",
      description: "Push the signed release tag to the configured remote.",
      command: ["git", "push", gitRemote, tagName],
    },
    {
      id: "publish-release-notes",
      kind: "release_notes",
      description:
        "Publish changelog, release channel, security evidence, provenance, approval evidence, and package artifacts as release assets.",
      command: releaseCommand(),
    },
  ];
}

function releaseCommand() {
  const assets = [
    ...artifacts.map((artifact) => relative(root, artifact.path)),
    relative(root, channelPath),
    ...(securityEvidencePath !== undefined && existsSync(securityEvidencePath)
      ? [relative(root, securityEvidencePath)]
      : []),
    ...(provenancePath !== undefined && existsSync(provenancePath)
      ? [relative(root, provenancePath)]
      : []),
    ...(approvalPath !== undefined && existsSync(approvalPath)
      ? [relative(root, approvalPath)]
      : []),
  ];
  if (releaseHost !== "github") {
    return [
      "publish-release-notes",
      "--host",
      releaseHost,
      "--tag",
      tagName,
      ...releaseNotesArgs(),
      ...assets,
    ];
  }
  return [
    "gh",
    "release",
    "create",
    tagName,
    "--verify-tag",
    "--title",
    `Romeo ${version}`,
    ...releaseNotesArgs(),
    ...assets,
  ];
}

function releaseNotesArgs() {
  if (releaseNotesPath !== undefined && existsSync(releaseNotesPath))
    return ["--notes-file", relative(root, releaseNotesPath)];
  return [
    "--notes",
    `Romeo ${version} release artifacts are described by ${relative(root, channelPath)}.`,
  ];
}

function normalizeManifestArtifacts(value) {
  if (!Array.isArray(value) || value.length === 0)
    throw new Error("Release manifest must contain artifacts.");
  return value.map((artifact) => {
    const file = nonEmptyString(
      artifact.file,
      `artifact ${artifact.name} file`,
    );
    const path = resolve(dirname(manifestPath), file);
    if (!existsSync(path))
      addBlocker(
        "artifact_missing",
        `Artifact file is missing: ${relative(root, path)}`,
      );
    if (existsSync(path)) {
      const actual = fileEvidence(path, relative(root, path));
      if (actual.sha256 !== artifact.sha256)
        addBlocker(
          "artifact_hash_mismatch",
          `Artifact hash mismatch for ${file}.`,
        );
      if (actual.bytes !== artifact.bytes)
        addBlocker(
          "artifact_size_mismatch",
          `Artifact size mismatch for ${file}.`,
        );
    }
    return {
      name: nonEmptyString(artifact.name, `artifact ${file} name`),
      version: nonEmptyString(artifact.version, `artifact ${file} version`),
      file,
      path,
      bytes: artifact.bytes,
      sha256: validateSha256(artifact.sha256, `artifact ${file} sha256`),
    };
  });
}

function normalizePublishOrder(value, artifactList) {
  const order =
    Array.isArray(value) && value.length > 0
      ? value.map((item) => nonEmptyString(item, "publish order item"))
      : artifactList.map((artifact) => artifact.name);
  for (const artifact of artifactList) {
    if (!order.includes(artifact.name))
      addBlocker(
        "publish_order_missing_artifact",
        `Publish order is missing ${artifact.name}.`,
      );
  }
  return order;
}

function validateChannel() {
  if (channel.schemaVersion !== "romeo.release-channel.v1")
    addBlocker(
      "channel_schema_invalid",
      "Release channel schema is not romeo.release-channel.v1.",
    );
  if (channel.latest !== version)
    addBlocker(
      "channel_latest_mismatch",
      "Release channel latest version does not match the release manifest.",
    );
  if (channelRelease === undefined)
    addBlocker(
      "channel_release_missing",
      `Release channel does not contain version ${version}.`,
    );
}

function validateSecurityEvidence() {
  if (securityEvidence === undefined) {
    if (requireSecurityEvidence)
      addBlocker(
        "security_evidence_missing",
        "Security evidence is required before publishing.",
      );
    return;
  }
  if (securityEvidence.schemaVersion !== "romeo.security-evidence.v1")
    addBlocker(
      "security_evidence_schema_invalid",
      "Security evidence schema is invalid.",
    );
  if (securityEvidence.status !== "pass")
    addBlocker(
      "security_evidence_not_passing",
      "Security evidence must pass before publishing.",
    );
  if (securityEvidence.release?.version !== version)
    addBlocker(
      "security_evidence_version_mismatch",
      "Security evidence release version does not match the manifest.",
    );
}

function validateOptionalFile(path, label, required) {
  if (path === undefined || !existsSync(path)) {
    if (required)
      addBlocker(
        `${label.replaceAll(" ", "_")}_missing`,
        `${label} file is required before publishing.`,
      );
    return undefined;
  }
  return fileEvidence(path, relative(root, path));
}

function validateProvenanceEvidence() {
  if (provenancePath === undefined || !existsSync(provenancePath)) {
    if (requireProvenance)
      addBlocker(
        "provenance_missing",
        "Release provenance evidence is required before publishing.",
      );
    return undefined;
  }
  const evidence = fileEvidence(provenancePath, relative(root, provenancePath));
  let provenance;
  try {
    provenance = readJson(provenancePath);
  } catch (error) {
    addBlocker(
      "provenance_invalid_json",
      error instanceof Error
        ? error.message
        : "Release provenance evidence is invalid JSON.",
    );
    return evidence;
  }
  if (provenance.schemaVersion !== "romeo.release-provenance.v1") {
    addBlocker(
      "provenance_schema_invalid",
      "Release provenance evidence schema is invalid.",
    );
  }
  if (provenance.status !== "passed") {
    addBlocker(
      "provenance_not_passing",
      "Release provenance evidence must pass before publishing.",
    );
  }
  if (provenance.release?.version !== version) {
    addBlocker(
      "provenance_version_mismatch",
      "Release provenance version does not match the manifest.",
    );
  }
  if (
    provenance.release?.manifest?.sha256 !== fileEvidence(manifestPath).sha256
  ) {
    addBlocker(
      "provenance_manifest_digest_mismatch",
      "Release provenance manifest digest does not match.",
    );
  }
  if (
    provenance.release?.channel?.sha256 !== fileEvidence(channelPath).sha256
  ) {
    addBlocker(
      "provenance_channel_digest_mismatch",
      "Release provenance channel digest does not match.",
    );
  }
  if (
    securityEvidencePath !== undefined &&
    existsSync(securityEvidencePath) &&
    provenance.release?.securityEvidence?.sha256 !==
      fileEvidence(securityEvidencePath).sha256
  ) {
    addBlocker(
      "provenance_security_digest_mismatch",
      "Release provenance security evidence digest does not match.",
    );
  }
  if (
    requireSignedProvenance &&
    provenance.signature?.signed !== true &&
    provenance.attestation?.attested !== true
  ) {
    addBlocker(
      "signed_provenance_missing",
      "Signed provenance or attestation evidence is required before publishing.",
    );
  }
  return evidence;
}

function validateApprovalEvidence() {
  if (approvalPath === undefined || !existsSync(approvalPath)) {
    if (requireApproval)
      addBlocker(
        "approval_missing",
        "Release approval evidence is required before publishing.",
      );
    return undefined;
  }
  const evidence = fileEvidence(approvalPath, relative(root, approvalPath));
  let approval;
  try {
    approval = readJson(approvalPath);
  } catch (error) {
    addBlocker(
      "approval_invalid_json",
      error instanceof Error
        ? error.message
        : "Release approval evidence is invalid JSON.",
    );
    return evidence;
  }
  if (approval.schemaVersion !== "romeo.release-approval.v1") {
    addBlocker(
      "approval_schema_invalid",
      "Release approval evidence schema is invalid.",
    );
  }
  if (approval.status !== "passed") {
    addBlocker(
      "approval_not_passed",
      "Release approval evidence must pass before publishing.",
    );
  }
  if (approval.release?.version !== version) {
    addBlocker(
      "approval_version_mismatch",
      "Release approval version does not match the manifest.",
    );
  }
  if (
    approval.release?.manifest?.sha256 !== fileEvidence(manifestPath).sha256
  ) {
    addBlocker(
      "approval_manifest_digest_mismatch",
      "Release approval manifest digest does not match.",
    );
  }
  if (
    provenancePath !== undefined &&
    existsSync(provenancePath) &&
    approval.release?.provenance?.sha256 !== fileEvidence(provenancePath).sha256
  ) {
    addBlocker(
      "approval_provenance_digest_mismatch",
      "Release approval provenance digest does not match.",
    );
  }
  const approverCount = approval.approval?.approverCount;
  const minApprovers = approval.approval?.minApprovers;
  const requiredApprovers = Math.max(
    Number.isInteger(minApprovers) ? minApprovers : 2,
    2,
  );
  if (!Number.isInteger(approverCount) || approverCount < requiredApprovers) {
    addBlocker(
      "approval_approver_count_insufficient",
      "Release approval does not contain enough unique approvers.",
    );
  }
  if (approval.approval?.refConfigured !== true) {
    addBlocker(
      "approval_ref_missing",
      "Release approval evidence does not contain a configured approval reference.",
    );
  }
  if (approval.approval?.expiresAt !== undefined) {
    if (!validInstant(approval.approval.expiresAt)) {
      addBlocker(
        "approval_expires_at_invalid",
        "Release approval expiration timestamp is invalid.",
      );
    } else if (
      validInstant(generatedAt) &&
      instantMs(approval.approval.expiresAt) <= instantMs(generatedAt)
    ) {
      addBlocker("approval_expired", "Release approval evidence has expired.");
    }
  }
  if (
    approval.redaction?.rawApproverIdsReturned !== false ||
    approval.redaction?.rawApprovalRefReturned !== false ||
    approval.redaction?.secretValuesReturned !== false ||
    approval.redaction?.fileBodiesReturned !== false ||
    approval.redaction?.environmentReturned !== false
  ) {
    addBlocker(
      "approval_redaction_invalid",
      "Release approval evidence redaction flags are not safe.",
    );
  }
  return evidence;
}

function findChannelRelease(document, releaseVersion) {
  if (!Array.isArray(document.releases)) return undefined;
  return document.releases.find(
    (release) => release?.version === releaseVersion,
  );
}

function requiredArtifact(name) {
  const artifact = artifactByName.get(name);
  if (artifact === undefined)
    throw new Error(`Publish order references unknown artifact: ${name}`);
  return artifact;
}

function artifactSummary(artifact) {
  return {
    name: artifact.name,
    version: artifact.version,
    file: artifact.file,
    sha256: artifact.sha256,
  };
}

function readExistingJson(path, label) {
  if (!existsSync(path))
    throw new Error(`${label} file is missing: ${relative(root, path)}`);
  return readJson(path);
}

function readOptionalJson(path, label) {
  if (path === undefined || !existsSync(path)) return undefined;
  try {
    return readJson(path);
  } catch (error) {
    addBlocker(
      `${label.replaceAll(" ", "_")}_invalid`,
      error instanceof Error ? error.message : `${label} is invalid.`,
    );
    return undefined;
  }
}

function optionalRepoPath(value) {
  return value === undefined || value.length === 0
    ? undefined
    : repoPath(value);
}

function validInstant(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !Number.isNaN(Date.parse(value))
  );
}

function instantMs(value) {
  return Date.parse(value);
}

function addBlocker(code, message) {
  blockers.push({ code, message });
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
