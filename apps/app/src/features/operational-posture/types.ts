export type {
  GaEvidencePostureGate,
  GaEvidencePostureReport,
  PostgresOperationalPostureReport,
} from "@romeo/api-client/generated/sdk";

import type { PostgresOperationalPostureReport } from "@romeo/api-client/generated/sdk";

export type PostgresOperationalWarningCode =
  PostgresOperationalPostureReport["warnings"][number];
