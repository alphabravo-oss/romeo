import { apiJson } from "./http";
import type { Envelope } from "./types";
import type {
  GaEvidencePostureReport,
  JobOperationalSummary,
  PostgresOperationalPostureReport,
  QuotaCoordinationStatus,
} from "./posture-types";

export async function getGaEvidencePosture(): Promise<GaEvidencePostureReport> {
  const response = await apiJson<Envelope<GaEvidencePostureReport>>(
    "/api/v1/admin/ga/evidence-posture",
  );
  return response.data;
}

export async function getPostgresOperationalPosture(): Promise<PostgresOperationalPostureReport> {
  const response = await apiJson<Envelope<PostgresOperationalPostureReport>>(
    "/api/v1/admin/postgres/operational-posture",
  );
  return response.data;
}

export async function getJobsOperationalSummary(): Promise<JobOperationalSummary> {
  const response = await apiJson<Envelope<JobOperationalSummary>>(
    "/api/v1/jobs/operational-summary",
  );
  return response.data;
}

export async function getQuotasDistributedStatus(): Promise<QuotaCoordinationStatus> {
  const response = await apiJson<Envelope<QuotaCoordinationStatus>>(
    "/api/v1/quotas/distributed-status",
  );
  return response.data;
}
