#!/usr/bin/env node

import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { canonicalJson } from "./lib/protected-release-approval.mjs";

const directory = mkdtempSync(join(tmpdir(), "romeo-release-approval-"));
const manifestPath = join(directory, "manifest.json");
const channelPath = join(directory, "channel.json");
const provenancePath = join(directory, "provenance.json");
const artifactPath = join(directory, "romeo-core.tgz");
const publicKeyPath = join(directory, "approval-public.pem");
const attestationPath = join(directory, "attestation.json");
const outputPath = join(directory, "approval.json");
const generatedAt = "2026-08-23T12:00:00.000Z";
const commitSha = "a".repeat(40);
const policyDigest = "b".repeat(64);
const artifactDigests = { "@romeo/core": "c".repeat(64) };

writeFileSync(artifactPath, "release-artifact", "utf8");
const artifact = {
  name: "@romeo/core",
  version: "1.2.3",
  file: "romeo-core.tgz",
  bytes: readFileSync(artifactPath).byteLength,
  sha256: digestFile(artifactPath),
};
writeJson(manifestPath, {
  name: "romeo",
  version: "1.2.3",
  artifacts: [artifact],
  publishOrder: [artifact.name],
});
writeJson(channelPath, {
  schemaVersion: "romeo.release-channel.v1",
  channel: "stable",
  latest: "1.2.3",
  releases: [{ version: "1.2.3", artifacts: [artifact] }],
});
writeJson(provenancePath, {
  schemaVersion: "romeo.release-provenance.v1",
  status: "passed",
  release: {
    version: "1.2.3",
    manifest: { sha256: digestFile(manifestPath) },
    channel: { sha256: digestFile(channelPath) },
    artifacts: [
      { name: "@romeo/core", sha256: artifactDigests["@romeo/core"] },
    ],
  },
  source: { commitSha },
});

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
writeFileSync(
  publicKeyPath,
  publicKey.export({ type: "spki", format: "pem" }),
  "utf8",
);

const validPayload = {
  approvalSystem: "github_environment",
  approvalRef: "environment-approval-42",
  approverIds: ["reviewer-a", "reviewer-b"],
  approvedAt: "2026-08-23T11:00:00.000Z",
  expiresAt: "2026-08-23T13:00:00.000Z",
  commitSha,
  environment: "production",
  manifestSha256: digestFile(manifestPath),
  provenanceSha256: digestFile(provenancePath),
  artifactDigests,
  policyDigest,
  revoked: false,
  dryRun: false,
};

writeAttestation(validPayload);
expectStatus(protectedArgs(), 0, "valid protected approval");
const validEvidence = JSON.parse(readFileSync(outputPath, "utf8"));
assert(
  validEvidence.authentic === true && validEvidence.promotable === true,
  "valid protected approval was not marked authentic/promotable",
);
expectPublishStatus(0, "valid protected publish plan");
const publishPlan = JSON.parse(
  readFileSync(join(directory, "publish-plan.json"), "utf8"),
);
assert(
  publishPlan.promotable === true && publishPlan.steps.length > 0,
  "valid protected publish plan was not promotable",
);
writeJson(outputPath, {
  ...validEvidence,
  approval: {
    ...validEvidence.approval,
    approverHashes: ["f".repeat(64), "e".repeat(64)],
  },
});
expectPublishStatus(1, "fabricated approval evidence");
writeJson(outputPath, validEvidence);

const forged = JSON.parse(readFileSync(attestationPath, "utf8"));
forged.payload.commitSha = "d".repeat(40);
writeJson(attestationPath, forged);
expectStatus(protectedArgs(), 1, "tampered signed payload");

writeAttestation({ ...validPayload, commitSha: "d".repeat(40) });
expectStatus(protectedArgs(), 1, "valid signature for wrong commit");

expectStatus(
  [
    "--manifest",
    manifestPath,
    "--provenance-file",
    provenancePath,
    "--approval-ref",
    "caller-claimed-reference",
    "--approver-id",
    "caller-a",
    "--approver-id",
    "caller-b",
    "--approved-at",
    "2026-08-23T11:00:00.000Z",
    "--generated-at",
    generatedAt,
    "--output",
    outputPath,
  ],
  1,
  "unsigned caller claims",
);

expectStatus(
  [
    "--dry-run",
    "--manifest",
    manifestPath,
    "--provenance-file",
    provenancePath,
    "--approval-ref",
    "ci-dry-run",
    "--approver-id",
    "ci-a",
    "--approver-id",
    "ci-b",
    "--approved-at",
    "2026-08-23T11:00:00.000Z",
    "--generated-at",
    generatedAt,
    "--output",
    outputPath,
  ],
  0,
  "explicit dry run",
);
const dryRunEvidence = JSON.parse(readFileSync(outputPath, "utf8"));
assert(
  dryRunEvidence.authentic === false && dryRunEvidence.promotable === false,
  "dry-run approval must never be promotable",
);

console.log(
  "release approval authenticity: signed publish binding and five adversarial cases passed",
);

function protectedArgs() {
  return [
    "--manifest",
    manifestPath,
    "--provenance-file",
    provenancePath,
    "--attestation-file",
    attestationPath,
    "--trusted-public-key-file",
    publicKeyPath,
    "--environment",
    "production",
    "--policy-digest",
    policyDigest,
    "--generated-at",
    generatedAt,
    "--output",
    outputPath,
  ];
}

function expectPublishStatus(status, label) {
  const result = spawnSync(
    process.execPath,
    [
      "scripts/generate-release-publish-plan.mjs",
      "--manifest",
      manifestPath,
      "--channel-file",
      channelPath,
      "--security-evidence",
      "",
      "--provenance-file",
      provenancePath,
      "--require-provenance",
      "--approval-file",
      outputPath,
      "--require-approval",
      "--approval-attestation-file",
      attestationPath,
      "--approval-trusted-public-key-file",
      publicKeyPath,
      "--approval-environment",
      "production",
      "--approval-policy-digest",
      policyDigest,
      "--generated-at",
      generatedAt,
      "--output",
      join(directory, "publish-plan.json"),
    ],
    { encoding: "utf8" },
  );
  if (result.status !== status)
    throw new Error(
      `${label} returned ${result.status}; expected ${status}\n${result.stderr || result.stdout}`,
    );
}

function writeAttestation(payload) {
  const signature = sign(null, Buffer.from(canonicalJson(payload)), privateKey);
  writeJson(attestationPath, {
    schemaVersion: "romeo.protected-environment-approval-attestation.v1",
    payload,
    signature: {
      algorithm: "ed25519",
      keyId: "release-approval-2026-08",
      value: signature.toString("base64url"),
    },
  });
}

function expectStatus(args, status, label) {
  const result = spawnSync(
    process.execPath,
    ["scripts/generate-release-approval.mjs", ...args],
    { encoding: "utf8" },
  );
  if (result.status !== status)
    throw new Error(
      `${label} returned ${result.status}; expected ${status}\n${result.stderr || result.stdout}`,
    );
}

function digestFile(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
