import { writeFileSync } from "node:fs";

import {
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

const schemaVersion = "romeo.pgvector-physical-isolation-review.v1";
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
const outputValue = argValue("--output");
const output =
  outputValue === undefined ? undefined : resolveRepoPath(outputValue);
const expectedIsolationMode =
  argValue("--expected-mode") ?? "pgvector_partitioned_by_org";
const tableName = argValue("--table") ?? "knowledge_chunk_embeddings";

if (expectedIsolationMode !== "pgvector_partitioned_by_org") {
  throw new Error(
    "Only --expected-mode pgvector_partitioned_by_org is currently supported.",
  );
}

if (dryRun) {
  const plan = {
    schemaVersion,
    generatedAt: new Date().toISOString(),
    status: "planned",
    mode: "dry-run",
    target: {
      database: configuredDatabaseUrl ? redactedConnection(databaseUrl) : "",
      expectedIsolationMode,
      table: tableName,
    },
    checks: [
      "table_exists",
      "table_is_partitioned",
      "partition_key_contains_org_id",
      "at_least_one_partition_exists",
      "hnsw_vector_index_present",
      "sanitized_explain_plan_captured",
    ],
    output,
  };
  if (output !== undefined) {
    ensureParentDirectory(output);
    writeFileSync(output, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  }
  printPlan(plan);
  process.exit(0);
}

const metadata = readPartitionMetadata();
const explainPlan = readExplainPlan();
const checks = {
  tableExists: metadata.tableExists,
  tablePartitioned: metadata.tablePartitioned,
  partitionKeyIncludesOrgId: metadata.partitionKeyIncludesOrgId,
  partitionCount: metadata.partitionCount,
  hnswIndexCount: metadata.hnswIndexCount,
  queryPlanReviewed: explainPlan !== undefined,
};
const failures = failureCodes(checks);
const evidence = {
  schemaVersion,
  generatedAt: new Date().toISOString(),
  status: failures.length === 0 ? "passed" : "failed",
  mode: "live",
  target: {
    database: redactedConnection(databaseUrl),
    expectedIsolationMode,
    table: tableName,
  },
  checks,
  partitionMetadata: {
    partitionStrategy: metadata.partitionStrategy,
    partitionKeyColumnCount: metadata.partitionKeyColumnCount,
    partitionBoundCount: metadata.partitionCount,
  },
  queryPlan: explainPlan,
  failures,
  redaction: {
    databaseUrlReturned: false,
    rawSqlReturned: false,
    rowDataReturned: false,
    vectorValuesReturned: false,
    secretValuesReturned: false,
  },
};

writeEvidence(evidence);

if (evidence.status !== "passed") {
  console.error(
    `pgvector physical isolation review failed: ${failures.join(", ")}`,
  );
  process.exit(1);
}

console.log("pgvector physical isolation review passed.");
if (output !== undefined)
  console.log(`Wrote pgvector physical isolation evidence to ${output}`);

function readPartitionMetadata() {
  const sql = `
WITH target AS (
  SELECT c.oid, c.relkind, pg_get_partkeydef(c.oid) AS partition_key
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = ${sqlString(tableName)}
),
partitioned AS (
  SELECT
    t.oid,
    t.relkind,
    t.partition_key,
    pt.partstrat,
    array_length(pt.partattrs, 1) AS partition_key_column_count
  FROM target t
  LEFT JOIN pg_partitioned_table pt ON pt.partrelid = t.oid
),
partitions AS (
  SELECT count(*)::int AS partition_count
  FROM pg_inherits i
  JOIN target t ON t.oid = i.inhparent
),
hnsw_indexes AS (
  SELECT count(*)::int AS hnsw_index_count
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename LIKE ${sqlString(`${tableName}%`)}
    AND indexdef ILIKE '%USING hnsw%'
    AND indexdef ILIKE '%vector_cosine_ops%'
)
SELECT json_build_object(
  'tableExists', EXISTS (SELECT 1 FROM target),
  'tablePartitioned', COALESCE((SELECT relkind = 'p' FROM partitioned), false),
  'partitionKeyIncludesOrgId', COALESCE((SELECT partition_key ILIKE '%org_id%' FROM partitioned), false),
  'partitionStrategy', COALESCE((SELECT partstrat FROM partitioned), ''),
  'partitionKeyColumnCount', COALESCE((SELECT partition_key_column_count FROM partitioned), 0),
  'partitionCount', (SELECT partition_count FROM partitions),
  'hnswIndexCount', (SELECT hnsw_index_count FROM hnsw_indexes)
);
`;
  const output = runPsql(sql).trim();
  const parsed = parseJson(output, "pgvector partition metadata");
  return {
    tableExists: parsed.tableExists === true,
    tablePartitioned: parsed.tablePartitioned === true,
    partitionKeyIncludesOrgId: parsed.partitionKeyIncludesOrgId === true,
    partitionStrategy:
      typeof parsed.partitionStrategy === "string"
        ? parsed.partitionStrategy
        : "",
    partitionKeyColumnCount: numberOrZero(parsed.partitionKeyColumnCount),
    partitionCount: numberOrZero(parsed.partitionCount),
    hnswIndexCount: numberOrZero(parsed.hnswIndexCount),
  };
}

function readExplainPlan() {
  const sql = `EXPLAIN (FORMAT JSON, COSTS TRUE, VERBOSE FALSE, BUFFERS FALSE)
    SELECT id
    FROM ${identifier(tableName)}
    WHERE org_id = 'org_default'
      AND workspace_id = 'workspace_default'
      AND knowledge_base_id = 'kb_default'
      AND embedding_provider = 'local'
      AND embedding_model = 'mock-embedding'
      AND dimensions = 1536
    ORDER BY embedding <=> '${zeroVector(1536)}'::vector, chunk_id ASC
    LIMIT 20;`;
  const output = runPsql(sql).trim();
  const rows = parseJson(output, "pgvector EXPLAIN JSON");
  const plan = rows[0]?.Plan;
  if (!isRecord(plan)) return undefined;
  return summarizePlan(plan);
}

function failureCodes(checks) {
  const failures = [];
  if (!checks.tableExists) failures.push("table_missing");
  if (!checks.tablePartitioned) failures.push("table_not_partitioned");
  if (!checks.partitionKeyIncludesOrgId)
    failures.push("partition_key_missing_org_id");
  if (checks.partitionCount < 1) failures.push("no_partitions");
  if (checks.hnswIndexCount < 1) failures.push("missing_hnsw_vector_index");
  if (!checks.queryPlanReviewed) failures.push("query_plan_missing");
  return failures;
}

function runPsql(sql) {
  return runPostgresCommandCapture({
    command,
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
    databaseUrl,
  });
}

function summarizePlan(plan) {
  const nodes = [];
  collectPlanNodes(plan, 0, nodes);
  return {
    rootNodeType: safeString(plan["Node Type"]),
    totalCost: roundedNumber(plan["Total Cost"]),
    planRows: integerOrUndefined(plan["Plan Rows"]),
    partitionRelationsObserved: nodes.filter((node) =>
      node.relation?.startsWith(`${tableName}_`),
    ).length,
    nodeCount: nodes.length,
    nodes,
  };
}

function collectPlanNodes(plan, depth, nodes) {
  nodes.push(
    omitUndefined({
      depth,
      nodeType: safeString(plan["Node Type"]),
      relation: safeString(plan["Relation Name"]),
      index: safeString(plan["Index Name"]),
      planRows: integerOrUndefined(plan["Plan Rows"]),
      startupCost: roundedNumber(plan["Startup Cost"]),
      totalCost: roundedNumber(plan["Total Cost"]),
    }),
  );
  const children = Array.isArray(plan.Plans) ? plan.Plans : [];
  for (const child of children) {
    if (isRecord(child)) collectPlanNodes(child, depth + 1, nodes);
  }
}

function writeEvidence(evidence) {
  if (output !== undefined) {
    ensureParentDirectory(output);
    writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  } else {
    console.log(JSON.stringify(evidence, null, 2));
  }
}

function identifier(value) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/u.test(value)) {
    throw new Error(`Unsafe PostgreSQL identifier: ${value}`);
  }
  return `"${value}"`;
}

function sqlString(value) {
  return `'${value.replace(/'/gu, "''")}'`;
}

function zeroVector(dimensions) {
  return `[${Array.from({ length: dimensions }, () => "0").join(",")}]`;
}

function parseJson(value, label) {
  try {
    return JSON.parse(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not parse ${label}: ${message}`);
  }
}

function resolveRepoPath(path) {
  return path.startsWith("/") ? path : repoPath(path);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberOrZero(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function safeString(value) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function integerOrUndefined(value) {
  return Number.isInteger(value) ? value : undefined;
}

function roundedNumber(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? Number(value.toFixed(2))
    : undefined;
}

function omitUndefined(record) {
  return Object.fromEntries(
    Object.entries(record).filter((entry) => entry[1] !== undefined),
  );
}
