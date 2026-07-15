import type { RomeoEnv } from "@romeo/config";
import { readFile } from "node:fs/promises";

import type {
  DataRightsCoverageReport,
  DataRightsRetentionEvidenceControl,
  DataRightsRetentionEvidenceInvalidReason,
  DataRightsRetentionEvidenceSummary,
} from "../domain/entities";

const retentionEvidenceSchemaVersion =
  "romeo.data-rights-retention-evidence.v1" as const;

export async function readDataRightsRetentionEvidence(
  env: RomeoEnv,
): Promise<DataRightsCoverageReport["retentionEvidence"]> {
  return retentionEvidenceReport({
    operationalLogs: await readRetentionEvidence(
      env.DATA_RIGHTS_OPERATIONAL_LOG_RETENTION_EVIDENCE_PATH,
      "operational_logs",
    ),
    backups: await readRetentionEvidence(
      env.DATA_RIGHTS_BACKUP_RETENTION_EVIDENCE_PATH,
      "backups",
    ),
  });
}

export function defaultDataRightsRetentionEvidence(): DataRightsCoverageReport["retentionEvidence"] {
  return retentionEvidenceReport({
    operationalLogs: externalRequiredSummary("operational_logs"),
    backups: externalRequiredSummary("backups"),
  });
}

function retentionEvidenceReport(input: {
  operationalLogs: DataRightsRetentionEvidenceSummary;
  backups: DataRightsRetentionEvidenceSummary;
}): DataRightsCoverageReport["retentionEvidence"] {
  return {
    operationalLogs: input.operationalLogs,
    backups: input.backups,
    redaction: {
      backupLocationReturned: false,
      evidenceFileBodiesReturned: false,
      logContentReturned: false,
      objectStoreKeysReturned: false,
      rawEvidencePathsReturned: false,
      secretValuesReturned: false,
    },
  };
}

async function readRetentionEvidence(
  path: string,
  expectedControl: DataRightsRetentionEvidenceControl,
): Promise<DataRightsRetentionEvidenceSummary> {
  const configuredPath = path.trim();
  if (configuredPath.length === 0) {
    return externalRequiredSummary(expectedControl);
  }

  let raw: string;
  try {
    raw = await readFile(configuredPath, "utf8");
  } catch {
    return invalidSummary(expectedControl, "read_failed");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return invalidSummary(expectedControl, "invalid_json");
  }

  if (
    !isRecord(parsed) ||
    parsed.schemaVersion !== retentionEvidenceSchemaVersion
  ) {
    return invalidSummary(expectedControl, "schema_mismatch");
  }
  if (parsed.control !== expectedControl) {
    return invalidSummary(expectedControl, "control_mismatch");
  }

  const retentionDays = safePositiveInteger(parsed.retentionDays);
  const destructionValidated =
    typeof parsed.destructionValidated === "boolean"
      ? parsed.destructionValidated
      : undefined;
  if (retentionDays === undefined || destructionValidated === undefined) {
    return invalidSummary(expectedControl, "required_fields_missing");
  }

  const evidenceStatus = evidenceStatusValue(parsed.status);
  const failureCodes = stringArray(parsed.failureCodes);
  const reviewedSystemCount = safeNonNegativeInteger(
    parsed.reviewedSystemCount,
  );
  const encryptedAtRest =
    typeof parsed.encryptedAtRest === "boolean"
      ? parsed.encryptedAtRest
      : undefined;
  const immutableWindowDays = safeNonNegativeInteger(
    parsed.immutableWindowDays,
  );
  const status =
    evidenceStatus === "passed" &&
    destructionValidated &&
    failureCodes.length === 0
      ? "satisfied"
      : "failed";

  return {
    requiredForProduction: true,
    control: expectedControl,
    status,
    evidence: {
      configured: true,
      schemaVersion: retentionEvidenceSchemaVersion,
      ...(typeof parsed.generatedAt === "string"
        ? { generatedAt: parsed.generatedAt }
        : {}),
      evidenceStatus,
      retentionDays,
      destructionValidated,
      ...(encryptedAtRest === undefined ? {} : { encryptedAtRest }),
      ...(immutableWindowDays === undefined ? {} : { immutableWindowDays }),
      reviewedSystemCount: reviewedSystemCount ?? 0,
      failureCodes,
    },
  };
}

function externalRequiredSummary(
  control: DataRightsRetentionEvidenceControl,
): DataRightsRetentionEvidenceSummary {
  return {
    requiredForProduction: true,
    control,
    status: "external_required",
    evidence: {
      configured: false,
      reviewedSystemCount: 0,
      failureCodes: [],
    },
  };
}

function invalidSummary(
  control: DataRightsRetentionEvidenceControl,
  invalidReason: DataRightsRetentionEvidenceInvalidReason,
): DataRightsRetentionEvidenceSummary {
  return {
    requiredForProduction: true,
    control,
    status: "invalid",
    evidence: {
      configured: true,
      reviewedSystemCount: 0,
      failureCodes: [],
      invalidReason,
    },
  };
}

function evidenceStatusValue(value: unknown): "failed" | "passed" | "unknown" {
  return value === "failed" || value === "passed" ? value : "unknown";
}

function safePositiveInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return undefined;
  }
  return value;
}

function safeNonNegativeInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return undefined;
  }
  return value;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is string => typeof item === "string" && item.length > 0,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
