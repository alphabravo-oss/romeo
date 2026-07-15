import type {
  DataRightsCoverageReport,
  DataRightsRetentionEvidenceSummary,
  DataRightsStorageClassCoverage,
  DataRightsWorkflowCoverage,
} from "../domain/entities";
import { defaultDataRightsRetentionEvidence } from "./data-rights-retention-evidence";

export function buildDataRightsCoverageReport(input: {
  orgId: string;
  generatedAt: string;
  retentionEvidence?: {
    operationalLogs: DataRightsRetentionEvidenceSummary;
    backups: DataRightsRetentionEvidenceSummary;
    redaction: {
      backupLocationReturned: false;
      evidenceFileBodiesReturned: false;
      logContentReturned: false;
      objectStoreKeysReturned: false;
      rawEvidencePathsReturned: false;
      secretValuesReturned: false;
    };
  };
}): DataRightsCoverageReport {
  const deletionWorkflows: DataRightsWorkflowCoverage[] = [
    {
      id: "governed_chat_deletion",
      status: "implemented",
      scope:
        "Chat-owned database records, message parts, linked runs/events, comments, notifications, usage events, grants, favorites, and folder memberships.",
      evidence: [
        "POST /api/v1/governance/data-deletions/preview",
        "POST /api/v1/governance/data-deletions/execute",
        "governance.data_deletion.execute audit metadata",
      ],
      limitations: [
        "Legal holds block execution until cleared.",
        "Audit rows keep metadata-only deletion evidence instead of being erased by the deletion workflow.",
        "Immutable or externally retained backups age out through the deployment backup-retention policy.",
      ],
    },
    {
      id: "knowledge_source_delete",
      status: "partial",
      scope:
        "Knowledge-source deletion clears current source objects, chunks, pgvector rows, and scoped external-vector records when Qdrant routing is active.",
      evidence: [
        "DELETE /api/v1/knowledge-bases/{knowledgeBaseId}/sources/{sourceId}",
        "GET /api/v1/admin/rag/posture",
        "pnpm smoke:compose:tiered-rag",
      ],
      limitations: [
        "Live external-vector restore/delete proof remains target-environment evidence.",
        "Deleted source content can remain in immutable backup windows until backup retention expires.",
      ],
    },
    {
      id: "file_object_delete",
      status: "partial",
      scope:
        "Native and governed file deletion remove current object bytes before marking metadata deleted.",
      evidence: [
        "DELETE /api/v1/files/{fileId}",
        "POST /api/v1/governance/data-deletions/preview",
        "POST /api/v1/governance/data-deletions/execute",
        "GET /api/v1/files",
      ],
      limitations: [
        "Attachment-specific and backup-retained copies follow their owning workflow and backup-retention policy.",
      ],
    },
  ];

  const exportWorkflows: DataRightsWorkflowCoverage[] = [
    {
      id: "access_review_export",
      status: "implemented",
      scope:
        "Role-scoped identity, grant, connector ownership, support access, and worker posture export.",
      evidence: [
        "GET /api/v1/access-review/report",
        "GET /api/v1/access-review/report.csv",
      ],
      limitations: [
        "API key hashes, session hashes, support reason text, connector configs, secret refs, OAuth token envelopes, background job payloads, and tool payloads are intentionally omitted.",
      ],
    },
    {
      id: "compliance_report_export",
      status: "implemented",
      scope:
        "Sanitized governance control export for the current organization.",
      evidence: [
        "GET /api/v1/governance/compliance-report",
        "GET /api/v1/governance/compliance-report.csv",
      ],
      limitations: [
        "The report is posture evidence, not a full customer-content export.",
      ],
    },
    {
      id: "customer_content_export",
      status: "partial",
      scope:
        "Governed JSON export across authorized org or workspace chat, prompt, knowledge, file, connector, workflow, usage, RAG/vector policy posture, and org-level background-job metadata records with explicit content and bounded object-byte flags.",
      evidence: [
        "POST /api/v1/governance/data-exports/preview",
        "POST /api/v1/governance/data-exports/execute",
        "GET /api/v1/governance/data-exports/packages",
        "POST /api/v1/governance/data-exports/packages",
        "DELETE /api/v1/governance/data-exports/packages/{packageId}",
        "GET /api/v1/governance/data-exports/packages/{packageId}/content",
        "POST /api/v1/governance/retention/enforce",
        "governance.data_export.execute audit metadata",
        "governance.data_export.package.create audit metadata",
        "governance.data_export.package.delete audit metadata",
        "governance.retention.enforce audit metadata",
      ],
      limitations: [
        "Object bytes are optional and bounded by per-object and total export limits.",
        "Package artifacts store the governed JSON export behind authorized server readback and expose only hashed storage metadata.",
        "Object keys, embedding vectors, external vector IDs, vector endpoints, collection names, namespaces, connector secret refs, raw connector configs, worker payload values, operational logs, and backup locations are excluded.",
        "External vector stores are represented by metadata-only policy posture; live external-vector restore/delete proof remains deployment evidence.",
        "Background jobs are exported as metadata only; workspace-scoped exports include first-class workspace-keyed jobs and omit org-level jobs that cannot be attributed to one workspace.",
        "Large binary archive formats beyond the governed JSON package remain deployment-specific only if a selected deployment requires them.",
        "Deployment-specific backup/log destruction evidence remains operator evidence.",
      ],
    },
  ];

  return {
    schema: "romeo.data-rights-coverage.v1",
    orgId: input.orgId,
    generatedAt: input.generatedAt,
    supportedDeletionResourceTypes: ["chat", "file_object", "knowledge_source"],
    deletionWorkflows,
    exportWorkflows,
    storageClasses: storageClasses(),
    retentionEvidence:
      input.retentionEvidence ?? defaultDataRightsRetentionEvidence(),
    backupRetention: {
      status: "externally_governed",
      posture:
        "Database and object-store backups are retained and destroyed by the configured backup platform and retention policy, not by request-path deletion APIs.",
      evidence: [
        "pnpm backup:postgres",
        "pnpm restore:postgres",
        "pnpm backup:object-store",
        "pnpm restore:object-store",
        "pnpm smoke:compose:backup-restore",
        "pnpm evidence:data-rights-retention",
      ],
      limitations: [
        "Per-record deletion from immutable backups is not claimed.",
        "Operators must document the selected backup retention window and deletion SLA for each deployment, then mount reviewed `romeo.data-rights-retention-evidence.v1` evidence when they want the API to report it as satisfied.",
      ],
    },
    supportBundles: {
      status: "implemented",
      evidence: ["pnpm support:bundle", "pnpm smoke:support-bundle-redaction"],
      redaction:
        "Support bundles summarize schemas, statuses, hashes, safe configuration posture, migration inventory, and log metadata only; they do not embed raw logs, report bodies, secrets, prompts, provider payloads, connector payloads, tokens, object keys, vector values, or document bodies.",
    },
    openGaps: [
      "Customer-content JSON export and object-store-backed JSON package creation are implemented for current Postgres/object-store records; separate large binary archive formats remain future work only if a selected deployment requires them.",
      "Live external-vector restore/delete proof remains deployment evidence.",
      "Operational-log and backup destruction remain external retention controls until reviewed `romeo.data-rights-retention-evidence.v1` files are mounted for the selected deployment.",
      "Storage-class deletion coverage should expand as new persistent product surfaces are added.",
    ],
  };
}

function storageClasses(): DataRightsStorageClassCoverage[] {
  return [
    {
      id: "postgres_domain_records",
      label: "Postgres domain records",
      containsCustomerContent: true,
      deletionCoverage: "partial",
      exportCoverage: "partial",
      retentionCoverage: "partial",
      deletionEvidence: [
        "governed_chat_deletion",
        "knowledge_source_delete",
        "file_object_delete",
      ],
      exportEvidence: [
        "access_review_export",
        "compliance_report_export",
        "customer_content_export",
      ],
      limitations: [
        "Governed deletion supports chats, file objects, and knowledge sources; live external-vector restore/delete proof remains deployment evidence.",
      ],
    },
    {
      id: "object_store_artifacts",
      label: "Object-store artifacts",
      containsCustomerContent: true,
      deletionCoverage: "partial",
      exportCoverage: "partial",
      retentionCoverage: "partial",
      deletionEvidence: [
        "knowledge_source_delete",
        "file_object_delete",
        "retention_enforcement",
      ],
      exportEvidence: ["customer_content_export"],
      limitations: [
        "Direct object keys are never returned by this report.",
        "Governed export-package retention removes expired package artifacts and registry entries through the retention enforcement path.",
        "Backup-retained object copies age out through external backup retention.",
      ],
    },
    {
      id: "pgvector_embeddings",
      label: "Postgres pgvector embeddings",
      containsCustomerContent: false,
      deletionCoverage: "partial",
      exportCoverage: "partial",
      retentionCoverage: "partial",
      deletionEvidence: ["knowledge_source_delete"],
      exportEvidence: ["customer_content_export"],
      limitations: [
        "Embedding vectors are treated as sensitive derived data and are not exported through governance reports.",
      ],
    },
    {
      id: "external_vector_store",
      label: "External vector store",
      containsCustomerContent: false,
      deletionCoverage: "partial",
      exportCoverage: "partial",
      retentionCoverage: "external_retention_required",
      deletionEvidence: ["knowledge_source_delete"],
      exportEvidence: ["customer_content_export"],
      limitations: [
        "Governed data exports include metadata-only external-vector policy posture; vector IDs, vector values, collection names, namespaces, endpoint URLs, and secret refs are not returned.",
        "Deployment-managed Qdrant routing sends scoped delete/tombstone requests when active, but live restore/delete proof is environment evidence.",
        "Collection names, namespaces, endpoint URLs, secret refs, vector IDs, and vector values are not returned.",
      ],
    },
    {
      id: "audit_usage_metadata",
      label: "Audit and usage metadata",
      containsCustomerContent: false,
      deletionCoverage: "partial",
      exportCoverage: "implemented",
      retentionCoverage: "implemented",
      deletionEvidence: ["governed_chat_deletion"],
      exportEvidence: ["access_review_export", "compliance_report_export"],
      limitations: [
        "Deletion audit rows intentionally retain metadata-only evidence and counts.",
      ],
    },
    {
      id: "background_jobs",
      label: "Background job metadata and artifacts",
      containsCustomerContent: true,
      deletionCoverage: "partial",
      exportCoverage: "partial",
      retentionCoverage: "partial",
      deletionEvidence: ["retention_enforcement"],
      exportEvidence: ["customer_content_export"],
      limitations: [
        "Governed data exports include job IDs, optional workspace IDs, types, statuses, and timestamps only; job payload values and artifact storage keys are excluded.",
        "Workspace-scoped exports include first-class workspace-keyed jobs and intentionally omit org-level jobs that cannot be attributed to one workspace.",
        "Browser automation artifact retention is implemented; broader worker payload deletion follows each worker domain contract.",
      ],
    },
    {
      id: "operational_logs",
      label: "Operational logs",
      containsCustomerContent: false,
      deletionCoverage: "external_retention_required",
      exportCoverage: "partial",
      retentionCoverage: "external_retention_required",
      deletionEvidence: [],
      exportEvidence: ["support_bundle"],
      limitations: [
        "Romeo support bundles summarize log files by basename, hash, and size only; log storage retention is controlled by the deployment logging platform.",
      ],
    },
    {
      id: "backups",
      label: "Database and object-store backups",
      containsCustomerContent: true,
      deletionCoverage: "external_retention_required",
      exportCoverage: "external_retention_required",
      retentionCoverage: "external_retention_required",
      deletionEvidence: [],
      exportEvidence: [],
      limitations: [
        "Immutable backup deletion is not performed through request-path APIs.",
        "Backup retention, legal hold, and destruction evidence must come from the selected backup platform.",
      ],
    },
  ];
}
