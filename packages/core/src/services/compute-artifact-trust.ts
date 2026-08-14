const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/u;
const SAFE_RELATIVE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[\w./@-]{1,240}$/u;
const SAFE_DOWNLOAD_NAME = /^[\w.-]{1,80}$/u;

export const SANDBOX_LIMITS = {
  pidLimit: { min: 8, max: 256 },
  cpuMillis: { min: 100, max: 60_000 },
  memoryBytes: { min: 32 * 1024 * 1024, max: 4 * 1024 * 1024 * 1024 },
  diskBytes: { min: 16 * 1024 * 1024, max: 2 * 1024 * 1024 * 1024 },
  wallSeconds: { min: 1, max: 600 },
} as const;

export const ARTIFACT_INTAKE_LIMITS = {
  maxCount: 32,
  maxSizeBytes: 50 * 1024 * 1024,
  maxArchiveEntries: 100,
  maxArchiveExpansionBytes: 100 * 1024 * 1024,
  maxExpansionRatio: 10,
} as const;

export const COMPUTE_OPS_THRESHOLDS = {
  leaseLagMs: 30_000,
  queueLagMs: 60_000,
  cleanupBacklog: 10,
} as const;

const ADMITTED_MEDIA_TYPES = new Set([
  "application/json",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
  "text/csv",
  "text/html",
  "text/plain",
]);

const HARDENED_PREVIEW_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
]);

export type ComputeTrustDenial =
  | "compute_sandbox_posture_denied"
  | "compute_runtime_image_unverified"
  | "compute_public_package_install_denied"
  | "compute_artifact_intake_denied"
  | "compute_provenance_incomplete"
  | "compute_artifact_version_immutable"
  | "compute_artifact_preview_denied"
  | "compute_artifact_quota_exceeded"
  | "compute_artifact_retention_active"
  | "data_deletion_legal_hold"
  | "policy_bundle_approval_required";

export type ComputeTrustDecision<TAccepted extends object = object> =
  | ({ outcome: "accepted" } & TAccepted)
  | { outcome: "denied"; code: ComputeTrustDenial };

export function isSha256Digest(value: string): boolean {
  return SHA256_DIGEST.test(value);
}

function inLimit(
  value: number,
  range: { readonly min: number; readonly max: number },
): boolean {
  return Number.isInteger(value) && value >= range.min && value <= range.max;
}

export function evaluateSandboxPosture(input: {
  allowPrivilegeEscalation: boolean;
  apparmor: boolean;
  capabilities: readonly string[];
  cpuMillis: number;
  diskBytes: number;
  hostNamespaces: boolean;
  jobScopedTmp: boolean;
  memoryBytes: number;
  nonRoot: boolean;
  pidLimit: number;
  privileged: boolean;
  rootReadOnly: boolean;
  seccomp: boolean;
  teardown: "deterministic" | "best_effort";
  wallSeconds: number;
}): ComputeTrustDecision {
  const hardened =
    input.nonRoot &&
    input.rootReadOnly &&
    !input.allowPrivilegeEscalation &&
    input.seccomp &&
    input.apparmor &&
    input.capabilities.length === 0 &&
    inLimit(input.pidLimit, SANDBOX_LIMITS.pidLimit) &&
    inLimit(input.cpuMillis, SANDBOX_LIMITS.cpuMillis) &&
    inLimit(input.memoryBytes, SANDBOX_LIMITS.memoryBytes) &&
    inLimit(input.diskBytes, SANDBOX_LIMITS.diskBytes) &&
    inLimit(input.wallSeconds, SANDBOX_LIMITS.wallSeconds) &&
    input.jobScopedTmp &&
    input.teardown === "deterministic" &&
    !input.hostNamespaces &&
    !input.privileged;
  if (!hardened)
    return { outcome: "denied", code: "compute_sandbox_posture_denied" };
  return { outcome: "accepted" };
}

export function authorizeRuntimeImage(input: {
  allowlistedDigests: readonly string[];
  approvedOfflineMirror: boolean;
  imageDigest: string;
  mutableTag: boolean;
  publicPackageInstall: boolean;
  signed: boolean;
}): ComputeTrustDecision {
  if (
    !isSha256Digest(input.imageDigest) ||
    !input.signed ||
    input.mutableTag ||
    !input.allowlistedDigests.includes(input.imageDigest)
  )
    return { outcome: "denied", code: "compute_runtime_image_unverified" };
  if (input.publicPackageInstall && !input.approvedOfflineMirror)
    return { outcome: "denied", code: "compute_public_package_install_denied" };
  return { outcome: "accepted" };
}

export function admitComputeArtifact(input: {
  archiveEntries: number;
  archiveExpansionBytes: number;
  count: number;
  dlp: "allow" | "block" | "unavailable";
  malware: "clean" | "dirty" | "unavailable";
  mediaType: string;
  outputPath: string;
  sha256: string;
  sizeBytes: number;
}): ComputeTrustDecision {
  const pathOk =
    SAFE_RELATIVE_PATH.test(input.outputPath) &&
    !input.outputPath.includes("\\") &&
    !input.outputPath.includes("\0");
  const archiveOk =
    Number.isInteger(input.archiveEntries) &&
    input.archiveEntries >= 0 &&
    input.archiveEntries <= ARTIFACT_INTAKE_LIMITS.maxArchiveEntries &&
    Number.isInteger(input.archiveExpansionBytes) &&
    input.archiveExpansionBytes >= 0 &&
    input.archiveExpansionBytes <= ARTIFACT_INTAKE_LIMITS.maxArchiveExpansionBytes &&
    input.archiveExpansionBytes <=
      input.sizeBytes * ARTIFACT_INTAKE_LIMITS.maxExpansionRatio;
  const sizeOk =
    Number.isInteger(input.count) &&
    input.count >= 1 &&
    input.count <= ARTIFACT_INTAKE_LIMITS.maxCount &&
    Number.isInteger(input.sizeBytes) &&
    input.sizeBytes >= 1 &&
    input.sizeBytes <= ARTIFACT_INTAKE_LIMITS.maxSizeBytes;
  if (
    !pathOk ||
    !sizeOk ||
    !archiveOk ||
    !ADMITTED_MEDIA_TYPES.has(input.mediaType) ||
    !isSha256Digest(input.sha256) ||
    input.malware !== "clean" ||
    input.dlp !== "allow"
  )
    return { outcome: "denied", code: "compute_artifact_intake_denied" };
  return { outcome: "accepted" };
}

export function recordComputeProvenance(input: {
  codeHash: string;
  dependencyManifest: readonly string[];
  initiatingModelId?: string;
  initiatingRunId: string;
  initiatingToolId?: string;
  inputHashes: readonly string[];
  outputHash: string;
  policyVersion: string;
  runtimeDigest: string;
  transformations: readonly string[];
}): ComputeTrustDecision<{
  outputHash: string;
  runtimeDigest: string;
}> {
  const initiator =
    input.initiatingRunId.trim().length > 0 &&
    ((input.initiatingModelId ?? "").trim().length > 0 ||
      (input.initiatingToolId ?? "").trim().length > 0);
  const hashes = [
    input.runtimeDigest,
    input.codeHash,
    input.outputHash,
    ...input.inputHashes,
  ];
  if (
    !initiator ||
    input.policyVersion.trim().length === 0 ||
    input.dependencyManifest.length > 64 ||
    input.transformations.length > 32 ||
    hashes.some((value) => !isSha256Digest(value))
  )
    return { outcome: "denied", code: "compute_provenance_incomplete" };
  return {
    outcome: "accepted",
    outputHash: input.outputHash,
    runtimeDigest: input.runtimeDigest,
  };
}

export function createArtifactVersion(input: {
  artifactId: string;
  currentVersion: number;
  nextContentHash: string;
  overwriteRequested: boolean;
}): ComputeTrustDecision<{ currentVersion: number; version: number }> {
  if (
    input.overwriteRequested ||
    input.artifactId.trim().length === 0 ||
    !Number.isInteger(input.currentVersion) ||
    input.currentVersion < 0 ||
    !isSha256Digest(input.nextContentHash)
  )
    return { outcome: "denied", code: "compute_artifact_version_immutable" };
  const version = input.currentVersion + 1;
  return { outcome: "accepted", currentVersion: version, version };
}

export function safeArtifactPreview(input: {
  contentDisposition: string;
  filename: string;
  htmlSameOrigin: boolean;
  htmlSandbox: string;
  mediaType: string;
  previewer: "hardened" | "browser_native";
}): ComputeTrustDecision<{
  contentDisposition: string;
  sandbox: boolean;
}> {
  const filenameOk =
    SAFE_DOWNLOAD_NAME.test(input.filename) && !input.filename.includes("..");
  const disposition = input.contentDisposition.trim().toLowerCase();
  const attachment =
    disposition.startsWith("attachment") && !disposition.includes("inline");
  const hardenedRequired = HARDENED_PREVIEW_TYPES.has(input.mediaType);
  const html = input.mediaType === "text/html";
  const htmlSafe =
    !html ||
    (!input.htmlSameOrigin &&
      !/\ballow-same-origin\b/iu.test(input.htmlSandbox) &&
      input.htmlSandbox.trim().length > 0);
  if (
    !filenameOk ||
    !attachment ||
    (hardenedRequired && input.previewer !== "hardened") ||
    !htmlSafe ||
    !ADMITTED_MEDIA_TYPES.has(input.mediaType)
  )
    return { outcome: "denied", code: "compute_artifact_preview_denied" };
  return {
    contentDisposition: `attachment; filename="${input.filename}"`,
    outcome: "accepted",
    sandbox: html,
  };
}

export function authorizeArtifactLifecycle(input: {
  action:
    | "quota"
    | "retention"
    | "legal_hold"
    | "export"
    | "delete"
    | "purge"
    | "rotate"
    | "shred"
    | "orphan_cleanup";
  backupChecked: boolean;
  dualControl: boolean;
  legalHold: boolean;
  now: string;
  orphanedStaging: boolean;
  quotaBytes: number;
  retentionUntil?: string;
  usedBytes: number;
}): ComputeTrustDecision {
  if (
    input.action === "quota" &&
    (input.usedBytes > input.quotaBytes || input.quotaBytes < 0)
  )
    return { outcome: "denied", code: "compute_artifact_quota_exceeded" };
  const destructive =
    input.action === "delete" ||
    input.action === "purge" ||
    input.action === "shred";
  if (destructive && input.legalHold)
    return { outcome: "denied", code: "data_deletion_legal_hold" };
  const retentionMs = Date.parse(input.retentionUntil ?? "");
  if (
    destructive &&
    input.action !== "shred" &&
    Number.isFinite(retentionMs) &&
    Date.parse(input.now) < retentionMs
  )
    return { outcome: "denied", code: "compute_artifact_retention_active" };
  if (
    (input.action === "shred" || input.action === "rotate") &&
    (!input.backupChecked || !input.dualControl)
  )
    return { outcome: "denied", code: "policy_bundle_approval_required" };
  if (input.action === "orphan_cleanup" && !input.orphanedStaging)
    return { outcome: "accepted" };
  return { outcome: "accepted" };
}

export type ComputeOperationsAlert =
  | "worker_unhealthy"
  | "lease_lag"
  | "queue_lag"
  | "resource_pressure"
  | "image_unavailable"
  | "cleanup_backlog"
  | "capacity_exhausted";

export function computeOperationsPosture(input: {
  capacityRemaining: number;
  cleanupBacklog: number;
  imageAvailable: boolean;
  lastRejectionCode?: string;
  leaseLagMs: number;
  queueLagMs: number;
  resourcePressure: boolean;
  workerHealthy: boolean;
}): {
  alerts: ComputeOperationsAlert[];
  lastRejectionCode?: string;
  state: "healthy" | "degraded" | "unavailable";
} {
  const alerts: ComputeOperationsAlert[] = [];
  if (!input.workerHealthy) alerts.push("worker_unhealthy");
  if (!input.imageAvailable) alerts.push("image_unavailable");
  if (input.capacityRemaining <= 0) alerts.push("capacity_exhausted");
  if (input.leaseLagMs > COMPUTE_OPS_THRESHOLDS.leaseLagMs)
    alerts.push("lease_lag");
  if (input.queueLagMs > COMPUTE_OPS_THRESHOLDS.queueLagMs)
    alerts.push("queue_lag");
  if (input.resourcePressure) alerts.push("resource_pressure");
  if (input.cleanupBacklog > COMPUTE_OPS_THRESHOLDS.cleanupBacklog)
    alerts.push("cleanup_backlog");
  const blocking = alerts.some(
    (alert) =>
      alert === "worker_unhealthy" ||
      alert === "image_unavailable" ||
      alert === "capacity_exhausted",
  );
  return {
    alerts,
    state: blocking ? "unavailable" : alerts.length > 0 ? "degraded" : "healthy",
    ...(input.lastRejectionCode === undefined
      ? {}
      : { lastRejectionCode: input.lastRejectionCode }),
  };
}
