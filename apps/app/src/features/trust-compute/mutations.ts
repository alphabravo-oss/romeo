import {
  computeArtifactsCreateVersion,
  computeArtifactsIntake,
  computeArtifactsLifecycle,
  computeArtifactsPreview,
  computeArtifactsProvenance,
  computeOperationsPosture,
  computeRuntimeImagesAuthorize,
  computeSandboxPosture,
  trustAuditSegmentsSeal,
  trustBreakGlassAuthorize,
  trustCryptoShredPreview,
  trustSiemExportCheckpoint,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

import type {
  ComputeArtifactsCreateVersionData,
  ComputeArtifactsIntakeData,
  ComputeArtifactsLifecycleData,
  ComputeArtifactsPreviewData,
  ComputeArtifactsProvenanceData,
  ComputeOperationsPostureData,
  ComputeRuntimeImagesAuthorizeData,
  ComputeSandboxPostureData,
  TrustAuditSegmentsSealData,
  TrustBreakGlassAuthorizeData,
  TrustCryptoShredPreviewData,
  TrustSiemExportCheckpointData,
} from "@romeo/api-client/generated/sdk";

async function unwrap<T>(work: () => Promise<{ data: { data: T } }>): Promise<T> {
  configureBrowserApiClients();
  return (await work()).data.data;
}

export function evaluateSandboxPosture(body: ComputeSandboxPostureData["body"]) {
  return unwrap(() => computeSandboxPosture({ body, throwOnError: true }));
}

export function authorizeRuntimeImage(
  body: ComputeRuntimeImagesAuthorizeData["body"],
) {
  return unwrap(() =>
    computeRuntimeImagesAuthorize({ body, throwOnError: true }),
  );
}

export function admitComputeArtifact(body: ComputeArtifactsIntakeData["body"]) {
  return unwrap(() => computeArtifactsIntake({ body, throwOnError: true }));
}

export function recordComputeProvenance(
  body: ComputeArtifactsProvenanceData["body"],
) {
  return unwrap(() => computeArtifactsProvenance({ body, throwOnError: true }));
}

export function createArtifactVersion(
  body: ComputeArtifactsCreateVersionData["body"],
) {
  return unwrap(() =>
    computeArtifactsCreateVersion({ body, throwOnError: true }),
  );
}

export function previewComputeArtifact(
  body: ComputeArtifactsPreviewData["body"],
) {
  return unwrap(() => computeArtifactsPreview({ body, throwOnError: true }));
}

export function authorizeArtifactLifecycle(
  body: ComputeArtifactsLifecycleData["body"],
) {
  return unwrap(() => computeArtifactsLifecycle({ body, throwOnError: true }));
}

export function previewComputeOperations(
  body: ComputeOperationsPostureData["body"],
) {
  return unwrap(() => computeOperationsPosture({ body, throwOnError: true }));
}

export function previewCryptoShred(body: TrustCryptoShredPreviewData["body"]) {
  return unwrap(() => trustCryptoShredPreview({ body, throwOnError: true }));
}

export function authorizeBreakGlass(body: TrustBreakGlassAuthorizeData["body"]) {
  return unwrap(() => trustBreakGlassAuthorize({ body, throwOnError: true }));
}

export function sealAuditSegment(body: TrustAuditSegmentsSealData["body"]) {
  return unwrap(() => trustAuditSegmentsSeal({ body, throwOnError: true }));
}

export function checkpointSiemExport(body: TrustSiemExportCheckpointData["body"]) {
  return unwrap(() => trustSiemExportCheckpoint({ body, throwOnError: true }));
}
