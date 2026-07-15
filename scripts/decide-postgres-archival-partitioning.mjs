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

const reviewedTables = [
  "messages",
  "run_events",
  "audit_logs",
  "usage_events",
  "background_jobs",
  "data_connector_syncs",
  "notification_deliveries",
  "webhook_deliveries",
  "knowledge_chunks",
  "knowledge_chunk_embeddings",
  "object_records",
  "data_export_packages",
];

const allowedDecisions = new Set([
  "no_runtime_partitioning_enabled",
  "partitioning_required",
  "archival_required",
  "partitioning_and_archival_required",
]);

const command = argValue("--psql") ?? "psql";
const dryRun = hasFlag("--dry-run");
const acceptDecision = hasFlag("--accept-decision");
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
const output = optionalRepoPath(argValue("--output"));
const decision = parseDecision(argValue("--decision"));
const maxTableBytes = positiveInteger("--max-table-bytes", 50_000_000_000);
const maxEstimatedRows = positiveInteger("--max-estimated-rows", 25_000_000);
const maxDeadTupleRatioPercent = argInteger(
  "--max-dead-tuple-ratio-percent",
  20,
);

if (dryRun) {
  const plan = {
    operation: "postgres.archival_partitioning.decide",
    command,
    args: [
      "--no-align",
      "--tuples-only",
      "--set",
      "ON_ERROR_STOP=1",
      "--dbname",
      database,
      "--command",
      "<table-growth-and-maintenance-sql>",
    ],
    env: {
      PGCONNECTION:
        configuredDatabaseUrl === undefined
          ? "<DATABASE_URL required for live archival decision evidence>"
          : redactedConnection(databaseUrl),
    },
    decision: {
      value: decision,
      acceptDecision,
    },
    thresholds: {
      maxTableBytes,
      maxEstimatedRows,
      maxDeadTupleRatioPercent,
    },
    reviewedTables,
    output,
    validation: validationRules(),
  };
  if (output !== undefined) writeJson(output, plan);
  printPlan(plan);
  process.exit(0);
}

const generatedAt = new Date().toISOString();
const rawTables = readTableStats();
const tables = rawTables.map(summarizeTable);
const thresholdBreaches = tables.filter(
  (table) =>
    table.totalBytes > maxTableBytes ||
    table.estimatedRows > maxEstimatedRows ||
    table.deadTupleRatioPercent > maxDeadTupleRatioPercent,
);
const failures = decisionFailures(thresholdBreaches);
const status =
  acceptDecision && failures.length === 0
    ? "accepted"
    : acceptDecision
      ? "required"
      : "deferred";
const evidence = {
  schemaVersion: "romeo.postgres-archival-partitioning-decision.v1",
  generatedAt,
  database: redactedConnection(databaseUrl),
  status,
  decision,
  migrationRequired: decision !== "no_runtime_partitioning_enabled",
  failures,
  thresholds: {
    maxTableBytes,
    maxEstimatedRows,
    maxDeadTupleRatioPercent,
  },
  summary: {
    tableCount: tables.length,
    tablesOverThresholdCount: thresholdBreaches.length,
    largestTableBytes: Math.max(0, ...tables.map((table) => table.totalBytes)),
    largestEstimatedRows: Math.max(
      0,
      ...tables.map((table) => table.estimatedRows),
    ),
    totalBytes: tables.reduce((total, table) => total + table.totalBytes, 0),
    totalEstimatedRows: tables.reduce(
      (total, table) => total + table.estimatedRows,
      0,
    ),
  },
  tables,
  validation: validationRules(),
};

if (output !== undefined) writeJson(output, evidence);

if (evidence.status !== "accepted") {
  if (failures.length > 0) {
    console.error(
      `PostgreSQL archival/partitioning decision is not accepted: ${failures.join(
        ", ",
      )}`,
    );
    process.exit(1);
  }
  console.log(
    "PostgreSQL archival/partitioning decision evidence written as deferred.",
  );
  if (output !== undefined)
    console.log(
      `Wrote PostgreSQL archival/partitioning decision evidence to ${output}`,
    );
  process.exit(0);
}

console.log("PostgreSQL archival/partitioning decision evidence accepted.");
if (output !== undefined)
  console.log(
    `Wrote PostgreSQL archival/partitioning decision evidence to ${output}`,
  );

function readTableStats() {
  const outputText = runPostgresCommandCapture({
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
      tableStatsSql(),
    ],
  }).trim();
  try {
    const parsed = JSON.parse(outputText);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not parse table growth metadata: ${message}`);
  }
}

function tableStatsSql() {
  return `
SELECT COALESCE(
  json_agg(
    json_build_object(
      'name', s.relname,
      'estimatedRows', GREATEST(c.reltuples, 0)::bigint,
      'totalBytes', pg_total_relation_size(s.relid)::bigint,
      'deadTuples', GREATEST(s.n_dead_tup, 0)::bigint,
      'sequentialScans', GREATEST(s.seq_scan, 0)::bigint,
      'lastVacuumSeen', s.last_vacuum IS NOT NULL OR s.last_autovacuum IS NOT NULL
    )
    ORDER BY pg_total_relation_size(s.relid) DESC, s.relname ASC
  ),
  '[]'::json
)
FROM pg_stat_user_tables s
JOIN pg_class c ON c.oid = s.relid
WHERE s.schemaname = 'public'
  AND s.relname IN (${reviewedTables.map(sqlString).join(", ")});
`.trim();
}

function summarizeTable(input) {
  const estimatedRows = safeInteger(input.estimatedRows);
  const deadTuples = safeInteger(input.deadTuples);
  const totalBytes = safeInteger(input.totalBytes);
  const deadTupleRatioPercent =
    estimatedRows <= 0
      ? 0
      : Number(((deadTuples / estimatedRows) * 100).toFixed(2));
  return {
    name: safeTableName(input.name),
    estimatedRows,
    totalBytes,
    deadTuples,
    deadTupleRatioPercent,
    sequentialScans: safeInteger(input.sequentialScans),
    lastVacuumSeen: input.lastVacuumSeen === true,
    recommendation: tableRecommendation({
      estimatedRows,
      totalBytes,
      deadTupleRatioPercent,
    }),
  };
}

function tableRecommendation(table) {
  const overRows = table.estimatedRows > maxEstimatedRows;
  const overBytes = table.totalBytes > maxTableBytes;
  const overDeadTuples = table.deadTupleRatioPercent > maxDeadTupleRatioPercent;
  if (overRows && overBytes) return "evaluate_partitioning_and_archival";
  if (overRows || overBytes) return "evaluate_partitioning";
  if (overDeadTuples) return "evaluate_vacuum_or_archival";
  return "no_action_required";
}

function decisionFailures(thresholdBreaches) {
  if (
    acceptDecision &&
    decision === "no_runtime_partitioning_enabled" &&
    thresholdBreaches.length > 0
  ) {
    return ["decision_conflicts_with_table_thresholds"];
  }
  return [];
}

function validationRules() {
  return {
    rawRowContentPersisted: false,
    rawSqlPersisted: false,
    tableNamesOnly: true,
    rowSamplesPersisted: false,
    migrationGenerated: false,
    explicitAcceptanceRequired: true,
    thresholdConflictsFail: true,
  };
}

function parseDecision(value) {
  const parsed = value ?? "no_runtime_partitioning_enabled";
  if (!allowedDecisions.has(parsed)) {
    throw new Error(
      `--decision must be one of: ${Array.from(allowedDecisions).join(", ")}`,
    );
  }
  return parsed;
}

function positiveInteger(name, fallback) {
  const value = argValue(name);
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0)
    throw new Error(`${name} must be a positive integer.`);
  return parsed;
}

function safeInteger(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value));
  }
  if (typeof value === "string" && /^[0-9]+$/u.test(value)) {
    const parsed = Number.parseInt(value, 10);
    return Number.isSafeInteger(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
  }
  return 0;
}

function safeTableName(value) {
  if (typeof value === "string" && /^[A-Za-z0-9_]{1,80}$/u.test(value)) {
    return value;
  }
  return "unknown_table";
}

function sqlString(value) {
  return `'${value.replace(/'/gu, "''")}'`;
}

function optionalRepoPath(path) {
  if (path === undefined) return undefined;
  return path.startsWith("/") ? path : repoPath(path);
}

function writeJson(path, payload) {
  ensureParentDirectory(path);
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}
