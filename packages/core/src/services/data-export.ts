import type { AuthSubject } from "@romeo/auth";
import type { ObjectStore } from "@romeo/storage";

import type {
  DataExportDocument,
  DataExportPreview,
  DataExportRequest,
  DataExportResolvedRequest,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { collectDataExport } from "./data-export-collector";
import { exportLimits, warningsFor } from "./data-export-support";

const defaultMaxObjectBytes = 1_000_000;
const hardMaxObjectBytes = 5_000_000;
const exclusions = [
  "object_store_keys",
  "embedding_vectors",
  "provider_payloads",
  "connector_secret_refs",
  "connector_raw_config",
  "webhook_payloads",
  "background_job_payloads",
  "operational_logs",
  "backup_locations",
];

export async function previewDataExport(input: {
  repository: RomeoRepository;
  subject: AuthSubject;
  request: DataExportRequest;
}): Promise<DataExportPreview> {
  const request = normalizeDataExportRequest(input.request);
  const collected = await collectDataExport({
    repository: input.repository,
    subject: input.subject,
    request,
    includeData: false,
  });
  return {
    schema: "romeo.data-export-preview.v1",
    orgId: input.subject.orgId,
    request,
    counts: collected.counts,
    limits: exportLimits(request),
    warnings: warningsFor(request, collected.counts),
    exclusions,
    previewedAt: new Date().toISOString(),
  };
}

export async function executeDataExport(input: {
  repository: RomeoRepository;
  objectStore: ObjectStore;
  subject: AuthSubject;
  request: DataExportRequest;
}): Promise<DataExportDocument> {
  const request = normalizeDataExportRequest(input.request);
  const collected = await collectDataExport({
    repository: input.repository,
    objectStore: input.objectStore,
    subject: input.subject,
    request,
    includeData: true,
  });
  return {
    schema: "romeo.data-export.v1",
    orgId: input.subject.orgId,
    request,
    counts: collected.counts,
    limits: exportLimits(request),
    warnings: warningsFor(request, collected.counts),
    exclusions,
    data: collected.data,
    exportedAt: new Date().toISOString(),
  };
}

function normalizeDataExportRequest(
  request: DataExportRequest,
): DataExportResolvedRequest {
  if (request.scope !== "org" && request.scope !== "workspace") {
    throw new ApiError(
      "invalid_data_export_scope",
      "Data export scope must be org or workspace.",
      400,
    );
  }
  if (request.scope === "workspace" && request.workspaceId === undefined) {
    throw new ApiError(
      "data_export_workspace_required",
      "workspaceId is required for workspace data exports.",
      400,
    );
  }
  if (request.scope === "org" && request.workspaceId !== undefined) {
    throw new ApiError(
      "data_export_workspace_not_allowed",
      "workspaceId can only be supplied for workspace data exports.",
      400,
    );
  }
  const maxObjectBytes = request.maxObjectBytes ?? defaultMaxObjectBytes;
  if (
    !Number.isInteger(maxObjectBytes) ||
    maxObjectBytes < 0 ||
    maxObjectBytes > hardMaxObjectBytes
  ) {
    throw new ApiError(
      "invalid_data_export_object_limit",
      `maxObjectBytes must be an integer between 0 and ${hardMaxObjectBytes}.`,
      400,
    );
  }
  return {
    scope: request.scope,
    ...(request.workspaceId === undefined
      ? {}
      : { workspaceId: request.workspaceId }),
    includeContent: request.includeContent === true,
    includeObjectBytes: request.includeObjectBytes === true,
    maxObjectBytes,
  };
}
