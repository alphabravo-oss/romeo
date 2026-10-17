import { assertScope, type AuthSubject } from "@romeo/auth";
import type { RomeoEnv } from "@romeo/config";
import {
  analyzePostgresConnectionSecurity,
  type PostgresConnectionSecurityPosture,
} from "./postgres-connection-security";

export type PostgresOperationalPostureStatus = "attention_required" | "ready";

export type PostgresOperationalWarningCode =
  "postgres_connection_security_warning";

export interface PostgresOperationalPostureReport {
  schema: "romeo.postgres-operational-posture.v1";
  generatedAt: string;
  orgId: string;
  status: PostgresOperationalPostureStatus;
  repository: {
    driver: RomeoEnv["REPOSITORY_DRIVER"];
    databaseUrlConfigured: boolean;
    postgresRequiredForProduction: boolean;
  };
  pool: {
    maxConnectionsPerProcess: number;
    source: "POSTGRES_POOL_MAX";
    sizingGuide: "docs/deployment-sizing.md";
    budgetFormula: string;
  };
  connectionSecurity: PostgresConnectionSecurityPosture;
  redaction: {
    databaseUrlReturned: false;
    queryParameterValuesReturned: false;
    rawSqlReturned: false;
    rowDataReturned: false;
    secretValuesReturned: false;
  };
  warnings: PostgresOperationalWarningCode[];
}

export class PostgresOperationalPostureService {
  constructor(private readonly env: RomeoEnv) {}

  report(subject: AuthSubject): PostgresOperationalPostureReport {
    assertScope(subject, "admin:read");

    const warnings: PostgresOperationalWarningCode[] = [];
    const connectionSecurity = analyzePostgresConnectionSecurity(
      this.env.DATABASE_URL,
    );
    if (connectionSecurity.warningCodes.length > 0) {
      warnings.push("postgres_connection_security_warning");
    }
    return {
      schema: "romeo.postgres-operational-posture.v1",
      generatedAt: new Date().toISOString(),
      orgId: subject.orgId,
      status: warnings.length === 0 ? "ready" : "attention_required",
      repository: {
        driver: this.env.REPOSITORY_DRIVER,
        databaseUrlConfigured: this.env.DATABASE_URL.trim().length > 0,
        postgresRequiredForProduction: true,
      },
      pool: {
        maxConnectionsPerProcess: this.env.POSTGRES_POOL_MAX,
        source: "POSTGRES_POOL_MAX",
        sizingGuide: "docs/deployment-sizing.md",
        budgetFormula:
          "app_max_replicas * POSTGRES_POOL_MAX + maintenance + workers + scaler <= usable_database_connections",
      },
      connectionSecurity,
      redaction: {
        databaseUrlReturned: false,
        queryParameterValuesReturned: false,
        rawSqlReturned: false,
        rowDataReturned: false,
        secretValuesReturned: false,
      },
      warnings,
    };
  }
}
