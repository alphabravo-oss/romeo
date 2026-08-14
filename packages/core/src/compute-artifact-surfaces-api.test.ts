import { describe, expect, it } from "vitest";

import { createRomeoApi } from "./api";
import { InMemoryRomeoRepository } from "./repositories/in-memory";
import { testEnv } from "./test-support/env";

const digest = `sha256:${"ab".repeat(32)}`;

async function post(path: string, body: unknown) {
  const api = createRomeoApi(new InMemoryRomeoRepository(), { env: testEnv() });
  const response = await api.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: await response.json() };
}

describe("compute artifact trust surfaces", () => {
  it("denies an unhardened sandbox and accepts a signed allowlisted image", async () => {
    const sandbox = await post("/api/v1/compute/sandbox/posture", {
      allowPrivilegeEscalation: true,
      apparmor: true,
      capabilities: [],
      cpuMillis: 1_000,
      diskBytes: 64 * 1024 * 1024,
      hostNamespaces: false,
      jobScopedTmp: true,
      memoryBytes: 256 * 1024 * 1024,
      nonRoot: true,
      pidLimit: 64,
      privileged: false,
      rootReadOnly: true,
      seccomp: true,
      teardown: "deterministic",
      wallSeconds: 30,
    });
    expect(sandbox.status).toBe(200);
    expect(sandbox.json).toMatchObject({
      data: { code: "compute_sandbox_posture_denied", outcome: "denied" },
    });

    const image = await post("/api/v1/compute/runtime-images/authorize", {
      allowlistedDigests: [digest],
      approvedOfflineMirror: false,
      imageDigest: digest,
      mutableTag: false,
      publicPackageInstall: true,
      signed: true,
    });
    expect(image.json).toMatchObject({
      data: {
        code: "compute_public_package_install_denied",
        outcome: "denied",
      },
    });
  });

  it("fails closed for traversal intake and incomplete provenance", async () => {
    const intake = await post("/api/v1/compute/artifacts/intake", {
      archiveEntries: 1,
      archiveExpansionBytes: 100,
      count: 1,
      dlp: "allow",
      malware: "clean",
      mediaType: "text/csv",
      outputPath: "../secret.csv",
      sha256: digest,
      sizeBytes: 100,
    });
    expect(intake.json).toMatchObject({
      data: { code: "compute_artifact_intake_denied", outcome: "denied" },
    });

    const provenance = await post("/api/v1/compute/artifacts/provenance", {
      codeHash: digest,
      dependencyManifest: [],
      initiatingRunId: "run_1",
      inputHashes: [],
      outputHash: digest,
      policyVersion: "compute-policy.v1",
      runtimeDigest: digest,
      transformations: [],
    });
    expect(provenance.json).toMatchObject({
      data: { code: "compute_provenance_incomplete", outcome: "denied" },
    });
  });

  it("refuses overwrite, same-origin HTML, hold delete, and reports unavailable ops", async () => {
    const version = await post("/api/v1/compute/artifacts/versions", {
      artifactId: "art_1",
      currentVersion: 1,
      nextContentHash: digest,
      overwriteRequested: true,
    });
    expect(version.json).toMatchObject({
      data: { code: "compute_artifact_version_immutable", outcome: "denied" },
    });

    const preview = await post("/api/v1/compute/artifacts/preview", {
      contentDisposition: "attachment",
      filename: "page.html",
      htmlSameOrigin: true,
      htmlSandbox: "allow-same-origin",
      mediaType: "text/html",
      previewer: "browser_native",
    });
    expect(preview.json).toMatchObject({
      data: { code: "compute_artifact_preview_denied", outcome: "denied" },
    });

    const lifecycle = await post("/api/v1/compute/artifacts/lifecycle", {
      action: "delete",
      backupChecked: true,
      dualControl: true,
      legalHold: true,
      orphanedStaging: false,
      quotaBytes: 100,
      usedBytes: 1,
    });
    expect(lifecycle.json).toMatchObject({
      data: { code: "data_deletion_legal_hold", outcome: "denied" },
    });

    const ops = await post("/api/v1/compute/operations/posture", {
      capacityRemaining: 0,
      cleanupBacklog: 0,
      imageAvailable: true,
      lastRejectionCode: "compute_runtime_uninstalled",
      leaseLagMs: 0,
      queueLagMs: 0,
      resourcePressure: false,
      workerHealthy: true,
    });
    expect(ops.json).toMatchObject({
      data: {
        lastRejectionCode: "compute_runtime_uninstalled",
        state: "unavailable",
      },
    });
  });
});
