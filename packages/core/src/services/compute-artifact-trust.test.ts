import { describe, expect, it } from "vitest";

import {
  admitComputeArtifact,
  authorizeArtifactLifecycle,
  authorizeRuntimeImage,
  computeOperationsPosture,
  createArtifactVersion,
  evaluateSandboxPosture,
  recordComputeProvenance,
  safeArtifactPreview,
} from "./compute-artifact-trust";

const digest = `sha256:${"ab".repeat(32)}`;
const other = `sha256:${"cd".repeat(32)}`;

const hardenedSandbox = {
  allowPrivilegeEscalation: false,
  apparmor: true,
  capabilities: [] as const,
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
  teardown: "deterministic" as const,
  wallSeconds: 30,
};

const cleanArtifact = {
  archiveEntries: 1,
  archiveExpansionBytes: 1_024,
  count: 1,
  dlp: "allow" as const,
  malware: "clean" as const,
  mediaType: "text/csv",
  outputPath: "outputs/report.csv",
  sha256: digest,
  sizeBytes: 1_024,
};

describe("compute sandbox posture", () => {
  it("accepts a non-root read-only guest with seccomp, AppArmor, limits, and teardown", () => {
    expect(evaluateSandboxPosture(hardenedSandbox)).toEqual({
      outcome: "accepted",
    });
  });

  it("fails closed for root, writable root, privilege escalation, missing isolators, or shared tmp", () => {
    expect(
      evaluateSandboxPosture({ ...hardenedSandbox, nonRoot: false }).code,
    ).toBe("compute_sandbox_posture_denied");
    expect(
      evaluateSandboxPosture({ ...hardenedSandbox, rootReadOnly: false }).code,
    ).toBe("compute_sandbox_posture_denied");
    expect(
      evaluateSandboxPosture({
        ...hardenedSandbox,
        allowPrivilegeEscalation: true,
      }).code,
    ).toBe("compute_sandbox_posture_denied");
    expect(
      evaluateSandboxPosture({ ...hardenedSandbox, seccomp: false }).code,
    ).toBe("compute_sandbox_posture_denied");
    expect(
      evaluateSandboxPosture({ ...hardenedSandbox, apparmor: false }).code,
    ).toBe("compute_sandbox_posture_denied");
    expect(
      evaluateSandboxPosture({
        ...hardenedSandbox,
        capabilities: ["NET_ADMIN"],
      }).code,
    ).toBe("compute_sandbox_posture_denied");
    expect(
      evaluateSandboxPosture({ ...hardenedSandbox, jobScopedTmp: false }).code,
    ).toBe("compute_sandbox_posture_denied");
    expect(
      evaluateSandboxPosture({
        ...hardenedSandbox,
        teardown: "best_effort",
      }).code,
    ).toBe("compute_sandbox_posture_denied");
    expect(
      evaluateSandboxPosture({ ...hardenedSandbox, hostNamespaces: true })
        .code,
    ).toBe("compute_sandbox_posture_denied");
    expect(
      evaluateSandboxPosture({ ...hardenedSandbox, privileged: true }).code,
    ).toBe("compute_sandbox_posture_denied");
    expect(
      evaluateSandboxPosture({ ...hardenedSandbox, pidLimit: 0 }).code,
    ).toBe("compute_sandbox_posture_denied");
  });
});

describe("compute package policy", () => {
  it("requires a signed digest-pinned allowlisted image and denies public installs", () => {
    expect(
      authorizeRuntimeImage({
        allowlistedDigests: [digest],
        approvedOfflineMirror: false,
        imageDigest: digest,
        mutableTag: false,
        publicPackageInstall: false,
        signed: true,
      }),
    ).toEqual({ outcome: "accepted" });
    expect(
      authorizeRuntimeImage({
        allowlistedDigests: [digest],
        approvedOfflineMirror: false,
        imageDigest: "python:latest",
        mutableTag: true,
        publicPackageInstall: false,
        signed: false,
      }).code,
    ).toBe("compute_runtime_image_unverified");
    expect(
      authorizeRuntimeImage({
        allowlistedDigests: [other],
        approvedOfflineMirror: false,
        imageDigest: digest,
        mutableTag: false,
        publicPackageInstall: false,
        signed: true,
      }).code,
    ).toBe("compute_runtime_image_unverified");
    expect(
      authorizeRuntimeImage({
        allowlistedDigests: [digest],
        approvedOfflineMirror: false,
        imageDigest: digest,
        mutableTag: false,
        publicPackageInstall: true,
        signed: true,
      }).code,
    ).toBe("compute_public_package_install_denied");
    expect(
      authorizeRuntimeImage({
        allowlistedDigests: [digest],
        approvedOfflineMirror: true,
        imageDigest: digest,
        mutableTag: false,
        publicPackageInstall: true,
        signed: true,
      }),
    ).toEqual({ outcome: "accepted" });
  });
});

describe("compute artifact intake", () => {
  it("admits a hashed, scanned, relative artifact and rejects traversal, bombs, and dirty scans", () => {
    expect(admitComputeArtifact(cleanArtifact)).toEqual({
      outcome: "accepted",
    });
    expect(
      admitComputeArtifact({
        ...cleanArtifact,
        outputPath: "../etc/passwd",
      }).code,
    ).toBe("compute_artifact_intake_denied");
    expect(
      admitComputeArtifact({ ...cleanArtifact, outputPath: "/tmp/out.csv" })
        .code,
    ).toBe("compute_artifact_intake_denied");
    expect(
      admitComputeArtifact({ ...cleanArtifact, count: 64 }).code,
    ).toBe("compute_artifact_intake_denied");
    expect(
      admitComputeArtifact({
        ...cleanArtifact,
        archiveExpansionBytes: 20_000,
        sizeBytes: 1_024,
      }).code,
    ).toBe("compute_artifact_intake_denied");
    expect(
      admitComputeArtifact({ ...cleanArtifact, mediaType: "application/x-elf" })
        .code,
    ).toBe("compute_artifact_intake_denied");
    expect(
      admitComputeArtifact({ ...cleanArtifact, malware: "dirty" }).code,
    ).toBe("compute_artifact_intake_denied");
    expect(
      admitComputeArtifact({ ...cleanArtifact, malware: "unavailable" }).code,
    ).toBe("compute_artifact_intake_denied");
    expect(
      admitComputeArtifact({ ...cleanArtifact, dlp: "block" }).code,
    ).toBe("compute_artifact_intake_denied");
    expect(
      admitComputeArtifact({ ...cleanArtifact, sha256: "not-a-digest" }).code,
    ).toBe("compute_artifact_intake_denied");
  });
});

describe("compute provenance and versions", () => {
  it("records a complete provenance manifest and refuses missing hashes or initiator", () => {
    expect(
      recordComputeProvenance({
        codeHash: digest,
        dependencyManifest: ["pandas==2.2.0"],
        initiatingModelId: "model_analyst",
        initiatingRunId: "run_1",
        inputHashes: [other],
        outputHash: digest,
        policyVersion: "compute-policy.v1",
        runtimeDigest: digest,
        transformations: ["csv_to_chart"],
      }),
    ).toEqual({
      outcome: "accepted",
      outputHash: digest,
      runtimeDigest: digest,
    });
    expect(
      recordComputeProvenance({
        codeHash: digest,
        dependencyManifest: [],
        initiatingRunId: "run_1",
        inputHashes: [],
        outputHash: digest,
        policyVersion: "compute-policy.v1",
        runtimeDigest: digest,
        transformations: [],
      }).code,
    ).toBe("compute_provenance_incomplete");
    expect(
      recordComputeProvenance({
        codeHash: "missing",
        dependencyManifest: [],
        initiatingModelId: "model_analyst",
        initiatingRunId: "run_1",
        inputHashes: [],
        outputHash: digest,
        policyVersion: "compute-policy.v1",
        runtimeDigest: digest,
        transformations: [],
      }).code,
    ).toBe("compute_provenance_incomplete");
  });

  it("creates a new immutable version and never overwrites the current evidence", () => {
    expect(
      createArtifactVersion({
        artifactId: "art_1",
        currentVersion: 2,
        nextContentHash: other,
        overwriteRequested: false,
      }),
    ).toEqual({ outcome: "accepted", currentVersion: 3, version: 3 });
    expect(
      createArtifactVersion({
        artifactId: "art_1",
        currentVersion: 2,
        nextContentHash: other,
        overwriteRequested: true,
      }).code,
    ).toBe("compute_artifact_version_immutable");
  });
});

describe("compute artifact preview and lifecycle", () => {
  it("requires hardened previewers, HTML sandbox without same-origin, and attachment disposition", () => {
    expect(
      safeArtifactPreview({
        contentDisposition: "attachment",
        filename: "report.pdf",
        htmlSameOrigin: false,
        htmlSandbox: "",
        mediaType: "application/pdf",
        previewer: "hardened",
      }),
    ).toEqual({
      contentDisposition: 'attachment; filename="report.pdf"',
      outcome: "accepted",
      sandbox: false,
    });
    expect(
      safeArtifactPreview({
        contentDisposition: "attachment",
        filename: "report.pdf",
        htmlSameOrigin: false,
        htmlSandbox: "",
        mediaType: "application/pdf",
        previewer: "browser_native",
      }).code,
    ).toBe("compute_artifact_preview_denied");
    expect(
      safeArtifactPreview({
        contentDisposition: "attachment",
        filename: "chart.html",
        htmlSameOrigin: true,
        htmlSandbox: "allow-scripts allow-same-origin",
        mediaType: "text/html",
        previewer: "browser_native",
      }).code,
    ).toBe("compute_artifact_preview_denied");
    expect(
      safeArtifactPreview({
        contentDisposition: "inline",
        filename: "chart.html",
        htmlSameOrigin: false,
        htmlSandbox: "allow-scripts",
        mediaType: "text/html",
        previewer: "browser_native",
      }).code,
    ).toBe("compute_artifact_preview_denied");
    expect(
      safeArtifactPreview({
        contentDisposition: "attachment",
        filename: "../secret.html",
        htmlSameOrigin: false,
        htmlSandbox: "allow-scripts",
        mediaType: "text/html",
        previewer: "browser_native",
      }).code,
    ).toBe("compute_artifact_preview_denied");
    expect(
      safeArtifactPreview({
        contentDisposition: "attachment",
        filename: "chart.html",
        htmlSameOrigin: false,
        htmlSandbox: "allow-scripts",
        mediaType: "text/html",
        previewer: "browser_native",
      }),
    ).toMatchObject({ outcome: "accepted", sandbox: true });
  });

  it("blocks delete/shred on hold or retention and requires dual control for shred/rotate", () => {
    expect(
      authorizeArtifactLifecycle({
        action: "delete",
        backupChecked: true,
        dualControl: true,
        legalHold: true,
        now: "2026-08-14T12:00:00.000Z",
        orphanedStaging: false,
        quotaBytes: 100,
        usedBytes: 1,
      }).code,
    ).toBe("data_deletion_legal_hold");
    expect(
      authorizeArtifactLifecycle({
        action: "delete",
        backupChecked: true,
        dualControl: true,
        legalHold: false,
        now: "2026-08-14T12:00:00.000Z",
        orphanedStaging: false,
        quotaBytes: 100,
        retentionUntil: "2026-12-01T00:00:00.000Z",
        usedBytes: 1,
      }).code,
    ).toBe("compute_artifact_retention_active");
    expect(
      authorizeArtifactLifecycle({
        action: "shred",
        backupChecked: false,
        dualControl: true,
        legalHold: false,
        now: "2026-08-14T12:00:00.000Z",
        orphanedStaging: false,
        quotaBytes: 100,
        usedBytes: 1,
      }).code,
    ).toBe("policy_bundle_approval_required");
    expect(
      authorizeArtifactLifecycle({
        action: "quota",
        backupChecked: true,
        dualControl: true,
        legalHold: false,
        now: "2026-08-14T12:00:00.000Z",
        orphanedStaging: false,
        quotaBytes: 10,
        usedBytes: 11,
      }).code,
    ).toBe("compute_artifact_quota_exceeded");
    expect(
      authorizeArtifactLifecycle({
        action: "shred",
        backupChecked: true,
        dualControl: true,
        legalHold: false,
        now: "2026-08-14T12:00:00.000Z",
        orphanedStaging: false,
        quotaBytes: 100,
        usedBytes: 1,
      }),
    ).toEqual({ outcome: "accepted" });
    expect(
      authorizeArtifactLifecycle({
        action: "orphan_cleanup",
        backupChecked: true,
        dualControl: true,
        legalHold: false,
        now: "2026-08-14T12:00:00.000Z",
        orphanedStaging: true,
        quotaBytes: 100,
        usedBytes: 1,
      }),
    ).toEqual({ outcome: "accepted" });
  });
});

describe("compute operations posture", () => {
  it("reports healthy, degraded lag, and unavailable worker or image capacity", () => {
    expect(
      computeOperationsPosture({
        capacityRemaining: 4,
        cleanupBacklog: 0,
        imageAvailable: true,
        leaseLagMs: 10,
        queueLagMs: 10,
        resourcePressure: false,
        workerHealthy: true,
      }),
    ).toEqual({ alerts: [], state: "healthy" });
    expect(
      computeOperationsPosture({
        capacityRemaining: 4,
        cleanupBacklog: 0,
        imageAvailable: true,
        leaseLagMs: 45_000,
        queueLagMs: 10,
        resourcePressure: false,
        workerHealthy: true,
      }),
    ).toMatchObject({ alerts: ["lease_lag"], state: "degraded" });
    expect(
      computeOperationsPosture({
        capacityRemaining: 0,
        cleanupBacklog: 12,
        imageAvailable: false,
        lastRejectionCode: "compute_runtime_uninstalled",
        leaseLagMs: 10,
        queueLagMs: 10,
        resourcePressure: true,
        workerHealthy: false,
      }),
    ).toMatchObject({
      lastRejectionCode: "compute_runtime_uninstalled",
      state: "unavailable",
    });
  });
});
