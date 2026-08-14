const digest = `sha256:${"ab".repeat(32)}`;

export const hardenedSandboxPreview = {
  allowPrivilegeEscalation: false,
  apparmor: true,
  capabilities: [] as string[],
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

export const publicRuntimeImagePreview = {
  allowlistedDigests: [digest],
  approvedOfflineMirror: false,
  imageDigest: digest,
  mutableTag: false,
  publicPackageInstall: true,
  signed: true,
};

export const traversalArtifactPreview = {
  archiveEntries: 1,
  archiveExpansionBytes: 100,
  count: 1,
  dlp: "allow" as const,
  malware: "clean" as const,
  mediaType: "text/csv",
  outputPath: "../secret.csv",
  sha256: digest,
  sizeBytes: 100,
};

export const completeProvenancePreview = {
  codeHash: digest,
  dependencyManifest: ["pandas==2.2.0"],
  initiatingModelId: "model_analyst",
  initiatingRunId: "run_preview",
  inputHashes: [digest],
  outputHash: digest,
  policyVersion: "compute-policy.v1",
  runtimeDigest: digest,
  transformations: ["csv_to_chart"],
};

export const overwriteVersionPreview = {
  artifactId: "art_preview",
  currentVersion: 1,
  nextContentHash: digest,
  overwriteRequested: true,
};

export const htmlSameOriginPreview = {
  contentDisposition: "attachment",
  filename: "chart.html",
  htmlSameOrigin: true,
  htmlSandbox: "allow-same-origin",
  mediaType: "text/html",
  previewer: "browser_native" as const,
};

export const holdDeletePreview = {
  action: "delete" as const,
  backupChecked: true,
  dualControl: true,
  legalHold: true,
  orphanedStaging: false,
  quotaBytes: 100,
  usedBytes: 1,
};

export const unavailableOpsPreview = {
  capacityRemaining: 0,
  cleanupBacklog: 0,
  imageAvailable: true,
  lastRejectionCode: "compute_runtime_uninstalled",
  leaseLagMs: 0,
  queueLagMs: 0,
  resourcePressure: false,
  workerHealthy: true,
};

export const cryptoShredPreview = {
  approverIds: ["user_reviewer"],
  backupChecked: true,
  legalHold: false,
};

export const mandatoryBreakGlassPreview = {
  approverId: "user_reviewer",
  reason: "Sealed legal hold investigation",
  requestedControls: ["tenant_encryption"],
  ttlMinutes: 30,
};

export const auditSegmentPreview = {
  eventIds: ["audit_preview_1", "audit_preview_2"],
  signingKeyVersion: "audit-signing.v1",
};

export const siemCheckpointPreview = {
  attempt: 0,
  destination: "worm_compatible" as const,
  sealedAt: "2026-08-14T12:00:00.000Z",
  segmentHash: "preview-segment",
};
