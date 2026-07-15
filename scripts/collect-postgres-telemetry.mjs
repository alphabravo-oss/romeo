import { writeFileSync } from "node:fs";

import {
  argInteger,
  argValue,
  ensureParentDirectory,
  hasFlag,
  postgresEnvironment,
  printPlan,
  readDatabaseUrl,
  redactedConnection,
  repoPath,
  runPostgresCommandCapture,
} from "./lib/postgres-maintenance.mjs";

const command = argValue("--psql") ?? "psql";
const dryRun = hasFlag("--dry-run");
const configuredDatabaseUrlValue =
  argValue("--database-url") ?? process.env.DATABASE_URL;
const configuredDatabaseUrl =
  configuredDatabaseUrlValue === undefined ||
  configuredDatabaseUrlValue.length === 0
    ? undefined
    : configuredDatabaseUrlValue;
const databaseUrl =
  configuredDatabaseUrl ?? "postgres://romeo@localhost:5432/romeo";
if (!dryRun && configuredDatabaseUrl === undefined) readDatabaseUrl();
const database = postgresEnvironment(databaseUrl).PGDATABASE;
const slowOutput = optionalRepoPath(argValue("--slow-output"));
const lockOutput = optionalRepoPath(argValue("--lock-output"));
const windowMinutes = positiveInteger("--window-minutes", 60);
const slowThresholdMs = positiveInteger("--slow-threshold-ms", 1_000);
const maxBlockedSessions = argInteger("--max-blocked-sessions", 0);
const maxDeadlocks = argInteger("--max-deadlocks", 0);

if (dryRun) {
  printPlan({
    operation: "postgres.telemetry.collect",
    command,
    args: [
      "--no-align",
      "--tuples-only",
      "--set",
      "ON_ERROR_STOP=1",
      "--dbname",
      database,
      "--command",
      "<slow-query-and-lock-telemetry-sql>",
    ],
    env: {
      PGCONNECTION:
        configuredDatabaseUrl === undefined
          ? "<DATABASE_URL required for live telemetry collection>"
          : redactedConnection(databaseUrl),
    },
    thresholds: {
      windowMinutes,
      slowThresholdMs,
      maxBlockedSessions,
      maxDeadlocks,
    },
    outputs: {
      slowQueryTelemetry: slowOutput,
      lockTelemetry: lockOutput,
    },
    validation: {
      rawSqlPersisted: false,
      queryTextPersisted: false,
      queryParameterValuesPersisted: false,
      lockStatementsPersisted: false,
      rowDataPersisted: false,
      secretValuesPersisted: false,
      pgStatStatementsRequiredForSlowQueryTelemetry: true,
    },
  });
  process.exit(0);
}

const generatedAt = new Date().toISOString();
const slowEvidence = collectSlowQueryEvidence();
const lockEvidence = collectLockTelemetryEvidence();

if (slowOutput !== undefined) writeEvidence(slowOutput, slowEvidence);
if (lockOutput !== undefined) writeEvidence(lockOutput, lockEvidence);

const failed = [slowEvidence, lockEvidence].filter(
  (evidence) => evidence.status !== "passed",
);
if (failed.length > 0) {
  console.error(
    `PostgreSQL telemetry collection found blocking evidence: ${failed
      .flatMap((evidence) => evidence.failures)
      .join(", ")}`,
  );
  process.exit(1);
}

console.log("PostgreSQL telemetry evidence passed.");
if (slowOutput !== undefined)
  console.log(
    `Wrote PostgreSQL slow-query telemetry evidence to ${slowOutput}`,
  );
if (lockOutput !== undefined)
  console.log(`Wrote PostgreSQL lock telemetry evidence to ${lockOutput}`);

function collectSlowQueryEvidence() {
  const posture = readJson(slowQueryPostureSql(), "slow-query posture");
  const configured =
    posture.extensionConfigured === true && posture.viewConfigured === true;
  if (!configured) {
    return {
      schemaVersion: "romeo.postgres-slow-query-telemetry.v1",
      generatedAt,
      database: redactedConnection(databaseUrl),
      status: "failed",
      failures: ["pg_stat_statements_missing"],
      summary: {
        windowMinutes,
        fingerprintCount: 0,
        slowQueryCount: 0,
        totalCalls: 0,
        maxMeanMs: 0,
        tempFileStatementCount: 0,
      },
      validation: telemetryValidation(),
    };
  }

  const summary = readJson(
    slowQuerySummarySql(slowThresholdMs),
    "slow-query summary",
  );
  const slowQueryCount = integerValue(summary.slowQueryCount);
  return {
    schemaVersion: "romeo.postgres-slow-query-telemetry.v1",
    generatedAt,
    database: redactedConnection(databaseUrl),
    status: slowQueryCount === 0 ? "passed" : "failed",
    failures: slowQueryCount === 0 ? [] : ["slow_query_threshold_exceeded"],
    thresholds: {
      slowThresholdMs,
      windowMinutes,
    },
    summary: {
      windowMinutes,
      fingerprintCount: integerValue(summary.fingerprintCount),
      slowQueryCount,
      totalCalls: integerValue(summary.totalCalls),
      maxMeanMs: roundedNumber(summary.maxMeanMs),
      tempFileStatementCount: integerValue(summary.tempFileStatementCount),
    },
    validation: telemetryValidation(),
  };
}

function collectLockTelemetryEvidence() {
  const summary = readJson(lockTelemetrySummarySql(), "lock telemetry summary");
  const blockedSessionMax = integerValue(summary.blockedSessionMax);
  const deadlockCount = integerValue(summary.deadlockCount);
  const failures = [];
  if (blockedSessionMax > maxBlockedSessions) {
    failures.push("blocked_session_threshold_exceeded");
  }
  if (deadlockCount > maxDeadlocks)
    failures.push("deadlock_threshold_exceeded");

  return {
    schemaVersion: "romeo.postgres-lock-telemetry.v1",
    generatedAt,
    database: redactedConnection(databaseUrl),
    status: failures.length === 0 ? "passed" : "failed",
    failures,
    thresholds: {
      windowMinutes,
      maxBlockedSessions,
      maxDeadlocks,
    },
    summary: {
      windowMinutes,
      blockedSessionMax,
      longestWaitMs: roundedNumber(summary.longestWaitMs),
      deadlockCount,
      lockTypeCounts: isRecord(summary.lockTypeCounts)
        ? safeCountRecord(summary.lockTypeCounts)
        : {},
    },
    validation: telemetryValidation(),
  };
}

function slowQueryPostureSql() {
  return `
SELECT json_build_object(
  'extensionConfigured', EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements'
  ),
  'viewConfigured', to_regclass('pg_stat_statements') IS NOT NULL
);
`.trim();
}

function slowQuerySummarySql(thresholdMs) {
  return `
SELECT json_build_object(
  'fingerprintCount', COUNT(*)::int,
  'slowQueryCount', COUNT(*) FILTER (WHERE mean_exec_time >= ${thresholdMs})::int,
  'totalCalls', COALESCE(SUM(calls), 0)::bigint,
  'maxMeanMs', COALESCE(MAX(mean_exec_time), 0),
  'tempFileStatementCount', COUNT(*) FILTER (WHERE temp_blks_written > 0)::int
)
FROM pg_stat_statements;
`.trim();
}

function lockTelemetrySummarySql() {
  return `
WITH blocked AS (
  SELECT
    l.locktype,
    EXTRACT(
      EPOCH FROM (
        now() - COALESCE(a.query_start, a.xact_start, a.backend_start, now())
      )
    ) * 1000 AS wait_ms
  FROM pg_locks l
  LEFT JOIN pg_stat_activity a ON a.pid = l.pid
  WHERE NOT l.granted
),
lock_type_counts AS (
  SELECT locktype, COUNT(*)::int AS count
  FROM blocked
  GROUP BY locktype
),
deadlock_summary AS (
  SELECT COALESCE(deadlocks, 0)::int AS deadlock_count
  FROM pg_stat_database
  WHERE datname = current_database()
)
SELECT json_build_object(
  'blockedSessionMax', (SELECT COUNT(*)::int FROM blocked),
  'longestWaitMs', COALESCE((SELECT MAX(wait_ms) FROM blocked), 0),
  'deadlockCount', COALESCE((SELECT deadlock_count FROM deadlock_summary), 0),
  'lockTypeCounts', COALESCE(
    (SELECT json_object_agg(locktype, count) FROM lock_type_counts),
    '{}'::json
  )
);
`.trim();
}

function readJson(sql, label) {
  const output = runPostgresCommandCapture({
    command,
    databaseUrl,
    args: [
      "--no-align",
      "--tuples-only",
      "--set",
      "ON_ERROR_STOP=1",
      "--dbname",
      database,
      "--command",
      sql,
    ],
  }).trim();
  try {
    return JSON.parse(output);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not parse ${label}: ${message}`);
  }
}

function telemetryValidation() {
  return {
    rawSqlPersisted: false,
    queryTextPersisted: false,
    queryParameterValuesPersisted: false,
    lockStatementsPersisted: false,
    rowDataPersisted: false,
    secretValuesPersisted: false,
  };
}

function writeEvidence(path, evidence) {
  ensureParentDirectory(path);
  writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

function optionalRepoPath(path) {
  if (path === undefined) return undefined;
  return path.startsWith("/") ? path : repoPath(path);
}

function positiveInteger(name, fallback) {
  const value = argValue(name);
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function integerValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value));
  }
  if (typeof value === "string" && /^[0-9]+$/u.test(value)) {
    return Number.parseInt(value, 10);
  }
  return 0;
}

function roundedNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Number(value.toFixed(2));
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return Number(parsed.toFixed(2));
  }
  return 0;
}

function safeCountRecord(record) {
  return Object.fromEntries(
    Object.entries(record)
      .filter((entry) => /^[A-Za-z0-9_ -]{1,80}$/u.test(entry[0]))
      .map((entry) => [entry[0], integerValue(entry[1])]),
  );
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
