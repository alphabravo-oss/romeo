import type { Organization } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { listRegisteredDataExportPackages } from "./data-export-package-registry";

export const tenantDeletionEvidenceControls = [
  "backup_retention_review",
  "external_secret_store_review",
  "external_vector_purge_review",
  "object_store_purge_plan_review",
  "operational_log_retention_review",
  "postgres_purge_plan_review",
  "support_bundle_retention_review",
] as const;

export type TenantDeletionEvidenceControl =
  (typeof tenantDeletionEvidenceControls)[number];

export type TenantDeletionEvidenceStatus =
  | "failed"
  | "not_applicable"
  | "passed";

export interface TenantDeletionEvidenceInput {
  control: TenantDeletionEvidenceControl;
  evidenceRefHash?: string;
  status: TenantDeletionEvidenceStatus;
}

export interface TenantDeletionEvidenceSummary {
  control: TenantDeletionEvidenceControl;
  evidenceRefHash?: string;
  reviewedAt: string;
  reviewedBy: string;
  status: TenantDeletionEvidenceStatus;
}

export interface TenantDeletionRequestPosture {
  status: "cancelled" | "requested";
}

export interface TenantSuspensionPosture {
  suspended: boolean;
}

export interface TenantDeletionFinalizationPreview {
  schema: "romeo.tenant-deletion-finalization-preview.v1";
  blockers: string[];
  counts: {
    activeApiKeys: number;
    activeSessions: number;
    auditLogs: number;
    backgroundJobs: number;
    dataExportPackages: number;
    fileObjects: number;
    knowledgeBases: number;
    knowledgeChunkEmbeddings: number;
    knowledgeChunks: number;
    knowledgeSourceObjects: number;
    knowledgeSources: number;
    serviceAccounts: number;
    users: number;
    workspaces: number;
  };
  evidence: {
    controls: TenantDeletionEvidenceSummary[];
    missingControls: TenantDeletionEvidenceControl[];
    requiredControls: TenantDeletionEvidenceControl[];
  };
  generatedAt: string;
  orgId: string;
  preconditions: {
    deletionRequestActive: boolean;
    evidenceComplete: boolean;
    suspended: boolean;
  };
  redaction: {
    evidenceBodiesReturned: false;
    objectStoreKeysReturned: false;
    rawEvidenceRefsReturned: false;
    rawLogsReturned: false;
    secretValuesReturned: false;
    vectorValuesReturned: false;
  };
  status: "blocked" | "ready";
  storageClasses: Array<{
    evidenceControl: TenantDeletionEvidenceControl;
    id:
      | "backups"
      | "external_secret_store"
      | "external_vector_store"
      | "object_store_artifacts"
      | "operational_logs"
      | "postgres_domain_records"
      | "support_bundles";
    status: "app_tracked" | "operator_evidence_required";
    trackedObjectCount?: number;
    trackedRecordCount?: number;
  }>;
}

interface StoredTenantDeletionEvidence {
  controls: TenantDeletionEvidenceSummary[];
  orgId: string;
  schemaVersion: "romeo.tenant-deletion-finalization-evidence.v1";
}

export async function buildTenantDeletionFinalizationPreview(input: {
  deletionRequest?: TenantDeletionRequestPosture;
  organization: Organization;
  repository: RomeoRepository;
  suspension: TenantSuspensionPosture;
}): Promise<TenantDeletionFinalizationPreview> {
  const [counts, evidence] = await Promise.all([
    tenantDeletionCounts(input.repository, input.organization.id),
    readTenantDeletionFinalizationEvidence(
      input.repository,
      input.organization.id,
    ),
  ]);
  const missingControls = missingEvidenceControls(evidence);
  const deletionRequestActive = input.deletionRequest?.status === "requested";
  const suspended = input.suspension.suspended;
  const evidenceComplete = missingControls.length === 0;
  const blockers = [
    ...(deletionRequestActive ? [] : ["deletion_request_required"]),
    ...(suspended ? [] : ["tenant_suspension_required"]),
    ...missingControls.map((control) => `evidence_required:${control}`),
  ];
  const trackedObjectCount =
    counts.fileObjects +
    counts.knowledgeSourceObjects +
    counts.dataExportPackages;
  const trackedRecordCount =
    counts.users +
    counts.workspaces +
    counts.serviceAccounts +
    counts.activeApiKeys +
    counts.activeSessions +
    counts.backgroundJobs +
    counts.auditLogs +
    counts.knowledgeBases +
    counts.knowledgeSources +
    counts.knowledgeChunks +
    counts.knowledgeChunkEmbeddings +
    counts.fileObjects;

  return {
    schema: "romeo.tenant-deletion-finalization-preview.v1",
    blockers,
    counts,
    evidence: {
      controls: evidence,
      missingControls,
      requiredControls: [...tenantDeletionEvidenceControls],
    },
    generatedAt: new Date().toISOString(),
    orgId: input.organization.id,
    preconditions: {
      deletionRequestActive,
      evidenceComplete,
      suspended,
    },
    redaction: {
      evidenceBodiesReturned: false,
      objectStoreKeysReturned: false,
      rawEvidenceRefsReturned: false,
      rawLogsReturned: false,
      secretValuesReturned: false,
      vectorValuesReturned: false,
    },
    status: blockers.length === 0 ? "ready" : "blocked",
    storageClasses: [
      {
        evidenceControl: "postgres_purge_plan_review",
        id: "postgres_domain_records",
        status: "app_tracked",
        trackedRecordCount,
      },
      {
        evidenceControl: "object_store_purge_plan_review",
        id: "object_store_artifacts",
        status: "app_tracked",
        trackedObjectCount,
      },
      {
        evidenceControl: "external_secret_store_review",
        id: "external_secret_store",
        status: "operator_evidence_required",
      },
      {
        evidenceControl: "external_vector_purge_review",
        id: "external_vector_store",
        status: "operator_evidence_required",
      },
      {
        evidenceControl: "backup_retention_review",
        id: "backups",
        status: "operator_evidence_required",
      },
      {
        evidenceControl: "operational_log_retention_review",
        id: "operational_logs",
        status: "operator_evidence_required",
      },
      {
        evidenceControl: "support_bundle_retention_review",
        id: "support_bundles",
        status: "operator_evidence_required",
      },
    ],
  };
}

export async function recordTenantDeletionFinalizationEvidence(input: {
  controls: TenantDeletionEvidenceInput[];
  orgId: string;
  repository: RomeoRepository;
  reviewedAt: string;
  reviewedBy: string;
}): Promise<TenantDeletionEvidenceSummary[]> {
  const existing = await readTenantDeletionFinalizationEvidence(
    input.repository,
    input.orgId,
  );
  const byControl = new Map(
    existing.map((control) => [control.control, control]),
  );
  for (const control of input.controls) {
    byControl.set(control.control, {
      control: control.control,
      ...(control.evidenceRefHash === undefined
        ? {}
        : { evidenceRefHash: control.evidenceRefHash }),
      reviewedAt: input.reviewedAt,
      reviewedBy: input.reviewedBy,
      status: control.status,
    });
  }
  const controls = [...byControl.values()].sort((left, right) =>
    left.control.localeCompare(right.control),
  );
  await input.repository.upsertSystemSetting({
    key: tenantDeletionFinalizationEvidenceKey(input.orgId),
    updatedAt: input.reviewedAt,
    value: {
      schemaVersion: "romeo.tenant-deletion-finalization-evidence.v1",
      orgId: input.orgId,
      controls,
    },
  });
  return controls;
}

export async function readTenantDeletionFinalizationEvidence(
  repository: RomeoRepository,
  orgId: string,
): Promise<TenantDeletionEvidenceSummary[]> {
  const setting = await repository.getSystemSetting(
    tenantDeletionFinalizationEvidenceKey(orgId),
  );
  if (setting === undefined) return [];
  return parseTenantDeletionFinalizationEvidence(setting.value, orgId);
}

export function tenantDeletionFinalizationEvidenceKey(orgId: string): string {
  return `tenant_lifecycle.deletion_finalization_evidence.v1:${orgId}`;
}

function missingEvidenceControls(
  evidence: TenantDeletionEvidenceSummary[],
): TenantDeletionEvidenceControl[] {
  const satisfied = new Set(
    evidence
      .filter(
        (control) =>
          control.status === "passed" || control.status === "not_applicable",
      )
      .map((control) => control.control),
  );
  return tenantDeletionEvidenceControls.filter(
    (control) => !satisfied.has(control),
  );
}

async function tenantDeletionCounts(
  repository: RomeoRepository,
  orgId: string,
): Promise<TenantDeletionFinalizationPreview["counts"]> {
  const [users, workspaces, serviceAccounts, apiKeys, sessions, jobs, audits] =
    await Promise.all([
      repository.listUsers(orgId),
      repository.listWorkspaces(orgId),
      repository.listServiceAccounts(orgId),
      repository.listApiKeys(orgId),
      Promise.all(
        (await repository.listUsers(orgId)).map((user) =>
          repository.listUserSessions(orgId, user.id),
        ),
      ),
      repository.listBackgroundJobs(orgId),
      repository.listAuditLogs(orgId),
    ]);
  const files = await repository.listFileObjects(orgId);
  const dataExportPackages = await listRegisteredDataExportPackages({
    repository,
    orgId,
  });
  let knowledgeBases = 0;
  let knowledgeSources = 0;
  let knowledgeSourceObjects = 0;
  let knowledgeChunks = 0;
  let knowledgeChunkEmbeddings = 0;
  for (const workspace of workspaces) {
    const bases = await repository.listKnowledgeBases(workspace.id);
    knowledgeBases += bases.length;
    for (const base of bases) {
      const [sources, chunks, embeddings] = await Promise.all([
        repository.listKnowledgeSources(base.id),
        repository.listKnowledgeChunks(base.id),
        repository.listKnowledgeChunkEmbeddings(base.id),
      ]);
      knowledgeSources += sources.length;
      knowledgeSourceObjects += sources.filter(
        (source) => source.objectKey !== undefined,
      ).length;
      knowledgeChunks += chunks.length;
      knowledgeChunkEmbeddings += embeddings.length;
    }
  }
  return {
    activeApiKeys: apiKeys.filter((apiKey) => apiKey.revokedAt === undefined)
      .length,
    activeSessions: sessions
      .flat()
      .filter((session) => session.revokedAt === undefined).length,
    auditLogs: audits.length,
    backgroundJobs: jobs.length,
    dataExportPackages: dataExportPackages.packages.length,
    fileObjects: files.filter((file) => file.status !== "deleted").length,
    knowledgeBases,
    knowledgeChunkEmbeddings,
    knowledgeChunks,
    knowledgeSourceObjects,
    knowledgeSources,
    serviceAccounts: serviceAccounts.length,
    users: users.length,
    workspaces: workspaces.length,
  };
}

function parseTenantDeletionFinalizationEvidence(
  value: Record<string, unknown>,
  orgId: string,
): TenantDeletionEvidenceSummary[] {
  if (
    value.schemaVersion !== "romeo.tenant-deletion-finalization-evidence.v1" ||
    value.orgId !== orgId ||
    !Array.isArray(value.controls)
  ) {
    return [];
  }
  return value.controls
    .map(parseEvidenceSummary)
    .filter(
      (control): control is TenantDeletionEvidenceSummary =>
        control !== undefined,
    )
    .sort((left, right) => left.control.localeCompare(right.control));
}

function parseEvidenceSummary(
  value: unknown,
): TenantDeletionEvidenceSummary | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined;
  const record = value as Record<string, unknown>;
  if (
    !isEvidenceControl(record.control) ||
    !isEvidenceStatus(record.status) ||
    typeof record.reviewedAt !== "string" ||
    typeof record.reviewedBy !== "string" ||
    (record.evidenceRefHash !== undefined &&
      typeof record.evidenceRefHash !== "string")
  ) {
    return undefined;
  }
  return {
    control: record.control,
    ...(record.evidenceRefHash === undefined
      ? {}
      : { evidenceRefHash: record.evidenceRefHash }),
    reviewedAt: record.reviewedAt,
    reviewedBy: record.reviewedBy,
    status: record.status,
  };
}

function isEvidenceControl(
  value: unknown,
): value is TenantDeletionEvidenceControl {
  return (
    typeof value === "string" &&
    tenantDeletionEvidenceControls.includes(
      value as TenantDeletionEvidenceControl,
    )
  );
}

function isEvidenceStatus(
  value: unknown,
): value is TenantDeletionEvidenceStatus {
  return value === "failed" || value === "not_applicable" || value === "passed";
}
