import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import {
  argValue,
  ensureParentDirectory,
  hasFlag,
  printPlan,
  repoPath,
} from "./lib/postgres-maintenance.mjs";
import {
  GREENFIELD_BASELINE_MIGRATION,
  REQUIRED_CASCADE_FOREIGN_KEYS,
  REQUIRED_EXTENSIONS,
  REQUIRED_INDEXES,
  REQUIRED_LIFECYCLE_COLUMNS,
  REQUIRED_TABLES,
} from "./lib/postgres-schema-contract.mjs";

const POSTGRES_IDENTIFIER_LIMIT = 63;
const migrationsDir = repoPath("packages/db/migrations");
const outputValue = argValue("--output");
const output =
  outputValue === undefined ? undefined : resolveRepoPath(outputValue);
const strict = hasFlag("--strict");
const dryRun = hasFlag("--dry-run");

if (dryRun) {
  printPlan({
    operation: "postgres.greenfield-baseline.review",
    migration: join("packages/db/migrations", GREENFIELD_BASELINE_MIGRATION),
    strict,
    output,
    checks: [
      "single_migration_file",
      "journal_matches_baseline",
      "pgvector_before_vector_tables",
      "pgvector_partitioned_by_org",
      "required_tables",
      "required_indexes",
      "required_cascade_foreign_keys",
      "lifecycle_columns",
      "identifier_lengths",
      "destructive_statement_absence",
    ],
  });
  process.exit(0);
}

const evidence = reviewBaseline();

if (output !== undefined) {
  ensureParentDirectory(output);
  writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

if (evidence.status === "failed") {
  console.error(
    `Greenfield baseline review failed: ${evidence.failures.join(", ")}`,
  );
  process.exit(1);
}

if (strict && evidence.status !== "passed") {
  console.error(
    `Greenfield baseline review needs decisions: ${evidence.decisionsRequired
      .map((decision) => decision.code)
      .join(", ")}`,
  );
  process.exit(1);
}

console.log(`Greenfield baseline review ${evidence.status}.`);
if (output !== undefined)
  console.log(`Wrote greenfield baseline review evidence to ${output}`);

function reviewBaseline() {
  const sqlFiles = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  const migrationPath = join(migrationsDir, GREENFIELD_BASELINE_MIGRATION);
  const sql = readFileSync(migrationPath, "utf8");
  const journal = JSON.parse(
    readFileSync(join(migrationsDir, "meta", "_journal.json"), "utf8"),
  );
  const statements = splitStatements(sql);
  const tableColumns = extractTableColumns(sql);
  const indexes = extractIndexes(sql);
  const foreignKeys = extractForeignKeys(sql);

  const failures = [
    ...singleMigrationFailures(sqlFiles),
    ...journalFailures(journal),
    ...pgvectorFailures(statements),
    ...requiredValueFailures("missing_table", REQUIRED_TABLES, [
      ...tableColumns.keys(),
    ]),
    ...requiredValueFailures(
      "missing_index",
      REQUIRED_INDEXES,
      indexes.map((index) => index.name),
    ),
    ...cascadeForeignKeyFailures(foreignKeys),
    ...lifecycleColumnFailures(tableColumns),
    ...destructiveStatementFailures(statements),
  ];

  const identifierFindings = identifierLengthFindings({
    indexes,
    foreignKeys,
    tables: [...tableColumns.keys()],
  });
  const decisionsRequired = identifierFindings
    .filter((finding) => finding.length > POSTGRES_IDENTIFIER_LIMIT)
    .map((finding) => ({
      code: "identifier_will_be_truncated",
      objectType: finding.objectType,
      name: finding.name,
      length: finding.length,
      limit: POSTGRES_IDENTIFIER_LIMIT,
      note: "Shorten before baseline lock or explicitly accept PostgreSQL identifier truncation.",
    }));

  const status =
    failures.length > 0
      ? "failed"
      : decisionsRequired.length > 0
        ? "needs_decision"
        : "passed";

  return {
    schemaVersion: "romeo.greenfield-baseline-review.v1",
    generatedAt: new Date().toISOString(),
    migration: {
      file: join("packages/db/migrations", basename(migrationPath)),
      sqlFileCount: sqlFiles.length,
      statementCount: statements.length,
      tableCount: tableColumns.size,
      indexCount: indexes.length,
      foreignKeyCount: foreignKeys.length,
    },
    status,
    failures,
    decisionsRequired,
    checks: {
      requiredExtensions: REQUIRED_EXTENSIONS,
      requiredTableCount: REQUIRED_TABLES.length,
      requiredIndexCount: REQUIRED_INDEXES.length,
      requiredCascadeForeignKeys: REQUIRED_CASCADE_FOREIGN_KEYS,
      lifecycleTables: Object.keys(REQUIRED_LIFECYCLE_COLUMNS).sort(),
      identifierLimit: POSTGRES_IDENTIFIER_LIMIT,
      identifiersOverLimit: identifierFindings.filter(
        (finding) => finding.length > POSTGRES_IDENTIFIER_LIMIT,
      ),
    },
  };
}

function splitStatements(sql) {
  return sql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function singleMigrationFailures(sqlFiles) {
  if (sqlFiles.length === 1 && sqlFiles[0] === GREENFIELD_BASELINE_MIGRATION) {
    return [];
  }
  return [
    `migration_files_expected:${GREENFIELD_BASELINE_MIGRATION}:actual:${sqlFiles.join(",")}`,
  ];
}

function journalFailures(journal) {
  const entries = Array.isArray(journal.entries) ? journal.entries : [];
  if (
    entries.length === 1 &&
    entries[0]?.tag === GREENFIELD_BASELINE_MIGRATION.replace(/\.sql$/u, "")
  ) {
    return [];
  }
  return ["journal_does_not_match_single_greenfield_baseline"];
}

function pgvectorFailures(statements) {
  const extensionIndex = statements.findIndex((statement) =>
    statement.includes('CREATE EXTENSION IF NOT EXISTS "vector"'),
  );
  const embeddingTableIndex = statements.findIndex((statement) =>
    statement.includes('CREATE TABLE "knowledge_chunk_embeddings"'),
  );
  const vectorIndexIndex = statements.findIndex((statement) =>
    statement.includes(
      'CREATE INDEX "knowledge_chunk_embeddings_vector_hnsw_idx"',
    ),
  );
  const failures = [];
  if (extensionIndex < 0) failures.push("missing_extension_statement:vector");
  if (embeddingTableIndex < 0)
    failures.push("missing_vector_table:knowledge_chunk_embeddings");
  if (vectorIndexIndex < 0)
    failures.push(
      "missing_vector_index:knowledge_chunk_embeddings_vector_hnsw_idx",
    );
  if (
    !/CREATE TABLE "knowledge_chunk_embeddings"[\s\S]+?PARTITION BY HASH \("org_id"\);/u.test(
      statements.join("\n"),
    )
  ) {
    failures.push("knowledge_chunk_embeddings_not_hash_partitioned_by_org_id");
  }
  if (
    !statements.some((statement) =>
      statement.includes(
        'CREATE TABLE "knowledge_chunk_embeddings_p00" PARTITION OF "knowledge_chunk_embeddings"',
      ),
    )
  ) {
    failures.push("knowledge_chunk_embeddings_partition_missing:p00");
  }
  if (
    !statements.some((statement) =>
      statement.includes(
        'CONSTRAINT "knowledge_chunk_embeddings_org_id_id_pk" PRIMARY KEY("org_id","id")',
      ),
    )
  ) {
    failures.push(
      "knowledge_chunk_embeddings_partition_safe_primary_key_missing",
    );
  }
  if (
    extensionIndex >= 0 &&
    embeddingTableIndex >= 0 &&
    extensionIndex > embeddingTableIndex
  ) {
    failures.push("vector_extension_after_vector_table");
  }
  return failures;
}

function requiredValueFailures(code, required, actual) {
  const actualSet = new Set(actual);
  return required
    .filter((value) => !actualSet.has(value))
    .map((value) => `${code}:${value}`);
}

function cascadeForeignKeyFailures(foreignKeys) {
  return REQUIRED_CASCADE_FOREIGN_KEYS.flatMap((required) => {
    const match = foreignKeys.find(
      (foreignKey) =>
        foreignKey.constraint === required.constraint &&
        foreignKey.table === required.table &&
        foreignKey.column === required.column &&
        foreignKey.referencesTable === required.referencesTable &&
        foreignKey.onDelete === "cascade",
    );
    return match === undefined
      ? [
          `missing_cascade_fk:${required.table}.${required.column}->${required.referencesTable}`,
        ]
      : [];
  });
}

function lifecycleColumnFailures(tableColumns) {
  const failures = [];
  for (const [table, requiredColumns] of Object.entries(
    REQUIRED_LIFECYCLE_COLUMNS,
  )) {
    const columns = tableColumns.get(table);
    if (columns === undefined) {
      failures.push(`missing_lifecycle_table:${table}`);
      continue;
    }
    for (const column of requiredColumns) {
      if (!columns.includes(column))
        failures.push(`missing_lifecycle_column:${table}.${column}`);
    }
  }
  return failures;
}

function destructiveStatementFailures(statements) {
  const destructivePatterns = [
    /\bDROP\s+TABLE\b/iu,
    /\bDROP\s+COLUMN\b/iu,
    /\bALTER\s+TABLE\b[\s\S]*\bDROP\b/iu,
    /\bTRUNCATE\b/iu,
    /\bDELETE\s+FROM\b/iu,
  ];
  return statements.flatMap((statement, index) =>
    destructivePatterns.some((pattern) => pattern.test(statement))
      ? [`destructive_statement:${index + 1}`]
      : [],
  );
}

function identifierLengthFindings({ indexes, foreignKeys, tables }) {
  return [
    ...tables.map((name) => ({
      objectType: "table",
      name,
      length: Buffer.byteLength(name),
    })),
    ...indexes.map((index) => ({
      objectType: index.unique ? "unique_index" : "index",
      name: index.name,
      length: Buffer.byteLength(index.name),
    })),
    ...foreignKeys.map((foreignKey) => ({
      objectType: "foreign_key",
      name: foreignKey.constraint,
      length: Buffer.byteLength(foreignKey.constraint),
    })),
  ].sort(
    (left, right) =>
      right.length - left.length || left.name.localeCompare(right.name),
  );
}

function extractTableColumns(sql) {
  const tables = new Map();
  const tablePattern = /CREATE TABLE "([^"]+)" \(([\s\S]*?)\);/gu;
  for (const match of sql.matchAll(tablePattern)) {
    const table = match[1];
    const body = match[2] ?? "";
    const columns = body
      .split("\n")
      .map((line) => line.trim())
      .map((line) => line.match(/^"([^"]+)"/u)?.[1])
      .filter((column) => column !== undefined);
    tables.set(table, columns);
  }
  return tables;
}

function extractIndexes(sql) {
  const indexes = [];
  const indexPattern = /CREATE (UNIQUE )?INDEX "([^"]+)"/gu;
  for (const match of sql.matchAll(indexPattern)) {
    indexes.push({ name: match[2], unique: match[1] !== undefined });
  }
  return indexes;
}

function extractForeignKeys(sql) {
  const foreignKeys = [];
  const foreignKeyPattern =
    /ALTER TABLE "([^"]+)" ADD CONSTRAINT "([^"]+)" FOREIGN KEY \("([^"]+)"\) REFERENCES "public"\."([^"]+)"\("([^"]+)"\) ON DELETE ([a-z ]+) ON UPDATE ([a-z ]+);/giu;
  for (const match of sql.matchAll(foreignKeyPattern)) {
    foreignKeys.push({
      table: match[1],
      constraint: match[2],
      column: match[3],
      referencesTable: match[4],
      referencesColumn: match[5],
      onDelete: normalizeAction(match[6]),
      onUpdate: normalizeAction(match[7]),
    });
  }
  return foreignKeys;
}

function normalizeAction(value) {
  return value.trim().replace(/\s+/gu, " ").toLowerCase();
}

function resolveRepoPath(path) {
  return path.startsWith("/") ? path : repoPath(path);
}
