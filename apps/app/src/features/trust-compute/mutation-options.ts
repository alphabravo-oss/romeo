import { serverMutationOptions } from "../../lib/server-mutation-options";
import {
  admitComputeArtifact,
  authorizeArtifactLifecycle,
  authorizeBreakGlass,
  authorizeRuntimeImage,
  checkpointSiemExport,
  createArtifactVersion,
  evaluateSandboxPosture,
  previewComputeArtifact,
  previewComputeOperations,
  previewCryptoShred,
  recordComputeProvenance,
  sealAuditSegment,
} from "./mutations";

export function evaluateSandboxPostureMutationOptions() {
  return serverMutationOptions({
    ephemeral: true,
    resource: "compute.sandbox.posture",
    mutationFn: evaluateSandboxPosture,
  });
}

export function authorizeRuntimeImageMutationOptions() {
  return serverMutationOptions({
    ephemeral: true,
    resource: "compute.runtimeImages.authorize",
    mutationFn: authorizeRuntimeImage,
  });
}

export function admitComputeArtifactMutationOptions() {
  return serverMutationOptions({
    ephemeral: true,
    resource: "compute.artifacts.intake",
    mutationFn: admitComputeArtifact,
  });
}

export function recordComputeProvenanceMutationOptions() {
  return serverMutationOptions({
    ephemeral: true,
    resource: "compute.artifacts.provenance",
    mutationFn: recordComputeProvenance,
  });
}

export function createArtifactVersionMutationOptions() {
  return serverMutationOptions({
    ephemeral: true,
    resource: "compute.artifacts.createVersion",
    mutationFn: createArtifactVersion,
  });
}

export function previewComputeArtifactMutationOptions() {
  return serverMutationOptions({
    ephemeral: true,
    resource: "compute.artifacts.preview",
    mutationFn: previewComputeArtifact,
  });
}

export function authorizeArtifactLifecycleMutationOptions() {
  return serverMutationOptions({
    ephemeral: true,
    resource: "compute.artifacts.lifecycle",
    mutationFn: authorizeArtifactLifecycle,
  });
}

export function previewComputeOperationsMutationOptions() {
  return serverMutationOptions({
    ephemeral: true,
    resource: "compute.operations.posture",
    mutationFn: previewComputeOperations,
  });
}

export function previewCryptoShredMutationOptions() {
  return serverMutationOptions({
    ephemeral: true,
    resource: "trust.crypto.shred.preview",
    mutationFn: previewCryptoShred,
  });
}

export function authorizeBreakGlassMutationOptions() {
  return serverMutationOptions({
    ephemeral: true,
    resource: "trust.breakGlass.authorize",
    mutationFn: authorizeBreakGlass,
  });
}

export function sealAuditSegmentMutationOptions() {
  return serverMutationOptions({
    ephemeral: true,
    resource: "trust.auditSegments.seal",
    mutationFn: sealAuditSegment,
  });
}

export function checkpointSiemExportMutationOptions() {
  return serverMutationOptions({
    ephemeral: true,
    resource: "trust.siemExport.checkpoint",
    mutationFn: checkpointSiemExport,
  });
}
