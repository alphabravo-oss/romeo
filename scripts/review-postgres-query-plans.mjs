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
import { QUERY_PLAN_REVIEW_CHECKS } from "./lib/postgres-query-plan-contract.mjs";

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
const target = {
  representativeVolume: hasFlag("--representative-volume"),
  deploymentTier: safeTargetLabel(argValue("--target-tier") ?? "unspecified"),
  postgresMode: safeTargetLabel(argValue("--postgres-mode") ?? "unspecified"),
};

if (dryRun) {
  const plan = {
    operation: "postgres.query-plans.review",
    command,
    args: [
      "--no-align",
      "--tuples-only",
      "--set",
      "ON_ERROR_STOP=1",
      "--dbname",
      database,
      "--command",
      "<explain-and-index-metadata-sql>",
    ],
    env: {
      PGCONNECTION:
        configuredDatabaseUrl === undefined
          ? "<DATABASE_URL required for live query-plan review>"
          : redactedConnection(databaseUrl),
    },
    validation: validationRules(),
    target,
    checks: QUERY_PLAN_REVIEW_CHECKS.map((check) => ({
      id: check.id,
      category: check.category,
      expectedIndexes: check.expectedIndexes,
    })),
    output,
  };
  if (output !== undefined) {
    ensureParentDirectory(output);
    writeFileSync(output, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  }
  printPlan(plan);
  process.exit(0);
}

const indexMetadata = readIndexMetadata(databaseUrl);
const indexNames = new Set(indexMetadata.map((index) => index.name));
const checks = QUERY_PLAN_REVIEW_CHECKS.map((check) =>
  reviewCheck(check, databaseUrl, indexNames),
);
const missingExpectedIndexes = checks.flatMap((check) =>
  check.expectedIndexes
    .filter((index) => !index.present)
    .map((index) => `${check.id}:${index.name}`),
);
const failedChecks = checks.filter((check) => check.status === "failed");
const evidence = {
  schemaVersion: "romeo.postgres-query-plan-review.v1",
  generatedAt: new Date().toISOString(),
  database: redactedConnection(databaseUrl),
  status:
    missingExpectedIndexes.length === 0 && failedChecks.length === 0
      ? "passed"
      : "failed",
  target,
  validation: validationRules(),
  coverage: {
    checkCount: checks.length,
    categories: [...new Set(checks.map((check) => check.category))].sort(),
  },
  indexMetadata,
  missingExpectedIndexes,
  checks,
};

if (output !== undefined) {
  ensureParentDirectory(output);
  writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

if (evidence.status !== "passed") {
  const reasons = [
    ...missingExpectedIndexes.map((index) => `missing_index:${index}`),
    ...failedChecks.map((check) => `explain_failed:${check.id}`),
  ];
  console.error(`PostgreSQL query-plan review failed: ${reasons.join(", ")}`);
  process.exit(1);
}

console.log("PostgreSQL query-plan review passed.");
if (output !== undefined)
  console.log(`Wrote PostgreSQL query-plan review evidence to ${output}`);

function readIndexMetadata(databaseUrl) {
  const names = [
    ...new Set(
      QUERY_PLAN_REVIEW_CHECKS.flatMap((check) => check.expectedIndexes),
    ),
  ].sort();
  const sql = `
    SELECT COALESCE(
      json_agg(
        json_build_object('name', indexname, 'table', tablename)
        ORDER BY indexname
      ),
      '[]'::json
    )
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname IN (${names.map(sqlString).join(", ")});
  `;
  const output = runPsql(databaseUrl, sql).trim();
  const rows = parseJson(output, "index metadata");
  return rows.map((row) => ({
    name: String(row.name),
    table: String(row.table),
  }));
}

function reviewCheck(check, databaseUrl, indexNames) {
  try {
    const plan = readExplainPlan(check, databaseUrl);
    const usedIndexes = collectUsedIndexes(plan);
    return {
      id: check.id,
      category: check.category,
      description: check.description,
      status: "passed",
      expectedIndexes: check.expectedIndexes.map((name) => ({
        name,
        present: indexNames.has(name),
        usedInObservedPlan: usedIndexes.has(name),
      })),
      observedPlan: summarizePlan(plan),
    };
  } catch (error) {
    return {
      id: check.id,
      category: check.category,
      description: check.description,
      status: "failed",
      expectedIndexes: check.expectedIndexes.map((name) => ({
        name,
        present: indexNames.has(name),
        usedInObservedPlan: false,
      })),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function readExplainPlan(check, databaseUrl) {
  const sql = `EXPLAIN (FORMAT JSON, COSTS TRUE, VERBOSE FALSE, BUFFERS FALSE) ${trimSql(check.sql)};`;
  const output = runPsql(databaseUrl, sql).trim();
  const rows = parseJson(output, `EXPLAIN JSON for ${check.id}`);
  const plan = rows[0]?.Plan;
  if (!isRecord(plan)) throw new Error(`Missing Plan object for ${check.id}.`);
  return plan;
}

function runPsql(databaseUrl, sql) {
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
    relationCount: new Set(
      nodes.map((node) => node.relation).filter((value) => value !== undefined),
    ).size,
    nodeCount: nodes.length,
    nodes,
  };
}

function collectUsedIndexes(plan, usedIndexes = new Set()) {
  const indexName = safeString(plan["Index Name"]);
  if (indexName !== undefined) usedIndexes.add(indexName);
  for (const child of childPlans(plan)) collectUsedIndexes(child, usedIndexes);
  return usedIndexes;
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
  for (const child of childPlans(plan))
    collectPlanNodes(child, depth + 1, nodes);
}

function childPlans(plan) {
  const children = plan.Plans;
  if (!Array.isArray(children)) return [];
  return children.filter(isRecord);
}

function validationRules() {
  return {
    explainMode: "EXPLAIN FORMAT JSON without ANALYZE",
    rawSqlPersisted: false,
    rawRowContentPersisted: false,
    missingExpectedIndexesFail: true,
    observedIndexUseIsAdvisory: true,
    smallTablePlannerChoicesCanUseSequentialScans: true,
  };
}

function parseJson(value, label) {
  try {
    return JSON.parse(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not parse ${label}: ${message}`);
  }
}

function sqlString(value) {
  return `'${value.replace(/'/gu, "''")}'`;
}

function trimSql(sql) {
  return sql.trim().replace(/;+\s*$/u, "");
}

function resolveRepoPath(path) {
  return path.startsWith("/") ? path : repoPath(path);
}

function safeTargetLabel(value) {
  if (!/^[A-Za-z0-9._:-]{1,80}$/u.test(value)) {
    throw new Error(
      "Target labels must contain only letters, numbers, dot, underscore, colon, or dash.",
    );
  }
  return value;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
