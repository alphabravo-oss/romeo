import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import ts from "typescript";

const root = resolve(import.meta.dirname, "..");
const inventoryPath = resolve(root, "docs/security/data-inventory.json");
const evidencePath = resolve(root, "dist/ci/data-inventory.json");
const classificationNames = [
  "public",
  "internal",
  "confidential",
  "restricted",
] as const;
type Classification = (typeof classificationNames)[number];

interface InventoryStore {
  id: string;
  kind: string;
  classification: Classification;
  contains: string[];
  prohibited: string[];
  retentionAuthority: string;
  encryption: string;
}

interface Inventory {
  schemaVersion: string;
  reviewedAt: string;
  owners: string[];
  classifications: Record<
    Classification,
    { rank: number; description: string }
  >;
  database: {
    schemaModules: string[];
    classificationByTable: Record<Classification, string[]>;
    restrictedColumnNames: string[];
    requirements: Record<string, string>;
  };
  stores: InventoryStore[];
}

interface SchemaTable {
  name: string;
  columns: string[];
}

const requiredStoreIds = [
  "postgres_primary",
  "postgres_wal_and_backups",
  "object_store_uploads",
  "object_store_generated_media_and_artifacts",
  "valkey_operational_state",
  "postgres_vector_and_search_indexes",
  "application_logs_metrics_and_traces",
  "audit_records",
  "browser_and_ssr_query_caches",
  "worker_and_runner_ephemeral_storage",
  "support_and_release_evidence",
  "release_and_airgap_artifacts",
] as const;

const minimumRestrictedTables = [
  "api_keys",
  "delegated_oauth_connections",
  "device_authorizations",
  "local_mfa_factors",
  "local_password_credentials",
  "provider_credentials",
  "sessions",
  "system_settings",
  "user_sessions",
  "users",
] as const;

const requiredRestrictedColumns = [
  "authConfig",
  "credentialHash",
  "credentialRef",
  "hashedRefreshToken",
  "hashedToken",
  "idempotencyKey",
  "keyHash",
  "leaseToken",
  "objectKey",
  "passwordHash",
  "requestHash",
  "secretEncrypted",
  "secretRef",
  "token",
] as const;

const tables = await loadSchemaTables();

const inventory = JSON.parse(
  await readFile(inventoryPath, "utf8"),
) as Inventory;

if (process.argv.includes("--self-test")) {
  runSelfTests(inventory, tables);
  console.log("Enterprise data-inventory self-test passed.");
  process.exit(0);
}

const errors = validateInventory(inventory, tables);
if (errors.length > 0) {
  console.error("Enterprise data inventory failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

const tableClassifications = tableClassificationMap(inventory);
const restrictedColumns = new Set(inventory.database.restrictedColumnNames);
const expandedTables = tables.map((table) => {
  const tableClassification = tableClassifications.get(table.name)!;
  return {
    name: table.name,
    classification: tableClassification,
    columns: table.columns.map((name) => ({
      name,
      classification:
        tableClassification === "restricted" || restrictedColumns.has(name)
          ? ("restricted" as const)
          : tableClassification,
    })),
  };
});
const columnCount = expandedTables.reduce(
  (total, table) => total + table.columns.length,
  0,
);
const classificationCounts = Object.fromEntries(
  classificationNames.map((classification) => [
    classification,
    expandedTables.reduce(
      (count, table) =>
        count +
        table.columns.filter(
          (column) => column.classification === classification,
        ).length,
      0,
    ),
  ]),
);

await mkdir(dirname(evidencePath), { recursive: true });
await writeFile(
  evidencePath,
  `${JSON.stringify(
    {
      schemaVersion: "romeo.enterprise-data-inventory-evidence.v1",
      inventorySchemaVersion: inventory.schemaVersion,
      reviewedAt: inventory.reviewedAt,
      status: "passed",
      tableCount: expandedTables.length,
      columnCount,
      storeCount: inventory.stores.length,
      classificationCounts,
      tables: expandedTables,
      stores: inventory.stores.map(({ id, kind, classification }) => ({
        id,
        kind,
        classification,
      })),
      contentBodiesIncluded: false,
      tenantOrRecordIdentifiersIncluded: false,
      secretsIncluded: false,
    },
    null,
    2,
  )}\n`,
);

console.log(
  `Enterprise data inventory passed: ${expandedTables.length} tables, ${columnCount} columns, ${inventory.stores.length} stores.`,
);

function validateInventory(
  value: Inventory,
  schemaTables: SchemaTable[],
): string[] {
  const errors: string[] = [];
  if (value.schemaVersion !== "romeo.enterprise-data-inventory.v1")
    errors.push("schemaVersion is not the supported v1 identifier");
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value.reviewedAt))
    errors.push("reviewedAt must be an ISO calendar date");
  if (!Array.isArray(value.owners) || value.owners.length < 2)
    errors.push("at least two accountable owners are required");
  if (
    value.database.schemaModules.length !== 1 ||
    value.database.schemaModules[0] !== "packages/db/src/schema/index.ts"
  )
    errors.push("database schemaModules must name the canonical Drizzle index");

  const ranks = classificationNames.map(
    (classification) => value.classifications[classification]?.rank,
  );
  if (ranks.some((rank, index) => rank !== index))
    errors.push("classification ranks must increase public through restricted");
  for (const classification of classificationNames) {
    if (
      typeof value.classifications[classification]?.description !== "string" ||
      value.classifications[classification].description.trim().length < 20
    )
      errors.push(`${classification} requires a meaningful description`);
  }

  const expectedTables = new Set(schemaTables.map((table) => table.name));
  const assignedTables = new Map<string, Classification>();
  for (const classification of classificationNames) {
    const names = value.database.classificationByTable[classification];
    if (!Array.isArray(names)) {
      errors.push(`database table list ${classification} is missing`);
      continue;
    }
    for (const name of names) {
      if (assignedTables.has(name))
        errors.push(`database table ${name} is classified more than once`);
      else assignedTables.set(name, classification);
      if (!expectedTables.has(name))
        errors.push(`inventory includes unknown database table ${name}`);
    }
  }
  for (const name of expectedTables)
    if (!assignedTables.has(name))
      errors.push(`database table ${name} is not classified`);
  for (const name of minimumRestrictedTables)
    if (assignedTables.get(name) !== "restricted")
      errors.push(`security-sensitive table ${name} must be restricted`);

  const allColumns = new Set(schemaTables.flatMap((table) => table.columns));
  const restrictedColumns = new Set(value.database.restrictedColumnNames);
  if (restrictedColumns.size !== value.database.restrictedColumnNames.length)
    errors.push("restrictedColumnNames contains a duplicate");
  for (const name of restrictedColumns)
    if (!allColumns.has(name))
      errors.push(`restricted column rule ${name} matches no schema column`);
  for (const name of requiredRestrictedColumns)
    if (!restrictedColumns.has(name))
      errors.push(`required restricted column ${name} is not escalated`);
  if (
    Object.values(value.database.requirements).some(
      (requirement) =>
        typeof requirement !== "string" || requirement.trim().length < 30,
    )
  )
    errors.push("every database handling requirement must be meaningful");

  const storeIds = new Set<string>();
  for (const store of value.stores) {
    if (storeIds.has(store.id)) errors.push(`store ${store.id} is duplicated`);
    storeIds.add(store.id);
    if (!classificationNames.includes(store.classification))
      errors.push(`store ${store.id} has an invalid classification`);
    if (store.contains.length === 0 || store.prohibited.length === 0)
      errors.push(`store ${store.id} requires contains and prohibited rules`);
    if (
      store.retentionAuthority.trim().length < 20 ||
      store.encryption.trim().length < 20
    )
      errors.push(`store ${store.id} lacks retention or encryption authority`);
  }
  for (const id of requiredStoreIds)
    if (!storeIds.has(id)) errors.push(`required store ${id} is missing`);

  const telemetry = value.stores.find(
    (store) => store.id === "application_logs_metrics_and_traces",
  );
  const telemetryProhibitions = telemetry?.prohibited.join(" ") ?? "";
  for (const sentinel of [
    "prompts",
    "credentials",
    "raw errors",
    "storage keys",
  ])
    if (!telemetryProhibitions.includes(sentinel))
      errors.push(`telemetry must explicitly prohibit ${sentinel}`);
  const clientCaches = value.stores.find(
    (store) => store.id === "browser_and_ssr_query_caches",
  );
  if (!clientCaches?.prohibited.join(" ").includes("cross-request"))
    errors.push("client caches must prohibit cross-request reuse");

  return errors;
}

function tableClassificationMap(value: Inventory) {
  const result = new Map<string, Classification>();
  for (const classification of classificationNames)
    for (const table of value.database.classificationByTable[classification])
      result.set(table, classification);
  return result;
}

function runSelfTests(value: Inventory, schemaTables: SchemaTable[]): void {
  const cases: Array<[string, (candidate: Inventory) => void]> = [
    [
      "missing table",
      (candidate) =>
        candidate.database.classificationByTable.confidential.pop(),
    ],
    [
      "duplicate table",
      (candidate) =>
        candidate.database.classificationByTable.internal.push("api_keys"),
    ],
    [
      "unknown table",
      (candidate) =>
        candidate.database.classificationByTable.internal.push(
          "future_unknown",
        ),
    ],
    [
      "credential downgrade",
      (candidate) => {
        candidate.database.classificationByTable.restricted =
          candidate.database.classificationByTable.restricted.filter(
            (name) => name !== "api_keys",
          );
        candidate.database.classificationByTable.internal.push("api_keys");
      },
    ],
    [
      "missing restricted column",
      (candidate) => {
        candidate.database.restrictedColumnNames =
          candidate.database.restrictedColumnNames.filter(
            (name) => name !== "objectKey",
          );
      },
    ],
    [
      "missing store",
      (candidate) => {
        candidate.stores = candidate.stores.filter(
          (store) => store.id !== "postgres_wal_and_backups",
        );
      },
    ],
    [
      "telemetry content leak",
      (candidate) => {
        const telemetry = candidate.stores.find(
          (store) => store.id === "application_logs_metrics_and_traces",
        );
        if (telemetry !== undefined) telemetry.prohibited = ["secrets"];
      },
    ],
  ];
  for (const [name, mutate] of cases) {
    const candidate = structuredClone(value);
    mutate(candidate);
    if (validateInventory(candidate, schemaTables).length === 0)
      throw new Error(`Data-inventory self-test did not reject ${name}.`);
  }
}

async function loadSchemaTables(): Promise<SchemaTable[]> {
  const schemaDirectory = resolve(root, "packages/db/src/schema");
  const files = (await readdir(schemaDirectory))
    .filter((file) => file.endsWith(".ts") && file !== "index.ts")
    .sort();
  const result: SchemaTable[] = [];
  for (const file of files) {
    const path = resolve(schemaDirectory, file);
    const source = ts.createSourceFile(
      path,
      await readFile(path, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "pgTable"
      ) {
        const [nameNode, columnsNode] = node.arguments;
        if (
          nameNode === undefined ||
          !ts.isStringLiteral(nameNode) ||
          columnsNode === undefined ||
          !ts.isObjectLiteralExpression(columnsNode)
        )
          throw new Error(`Unsupported pgTable declaration in ${path}.`);
        const columns = columnsNode.properties.map((property) => {
          if (!ts.isPropertyAssignment(property))
            throw new Error(
              `Unsupported column declaration in ${path}:${nameNode.text}.`,
            );
          const name = property.name;
          if (ts.isIdentifier(name) || ts.isStringLiteral(name))
            return name.text;
          throw new Error(
            `Computed database column name in ${path}:${nameNode.text} is not inventory-safe.`,
          );
        });
        result.push({ name: nameNode.text, columns: columns.sort() });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  const names = new Set<string>();
  for (const table of result) {
    if (names.has(table.name))
      throw new Error(`Duplicate pgTable declaration ${table.name}.`);
    names.add(table.name);
  }
  return result.sort((left, right) => left.name.localeCompare(right.name));
}
