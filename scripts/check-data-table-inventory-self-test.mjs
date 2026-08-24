#!/usr/bin/env node

import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const checker = fileURLToPath(
  new URL("./check-data-table-inventory.mjs", import.meta.url),
);
const temporaryRoot = await mkdtemp(
  path.join(tmpdir(), "romeo-data-table-inventory-"),
);
const validTableSource =
  "export const View = () => <DataTable serverState={state.serverState} data={state.rows} />;\n";
const registrySource = `
  background_jobs: defineResource({ nativePagination: true }),
  data_connector_sync_runs: defineResource({ nativePagination: true }),
  notification_deliveries: defineResource({ nativePagination: true }),
  notifications: defineResource({ nativePagination: true }),
  support_access_requests: defineResource({ nativePagination: true }),
  support_sessions: defineResource({ nativePagination: true }),
  tool_trace_calls: defineResource({ nativePagination: true }),
  usage_events: defineResource({ nativePagination: true }),
  governance_export_packages: defineResource({ nativePagination: true }),
  valid_table: defineResource(validTable),
`;
const typedRegistrySource = `
  valid_table: defineResource({
    scope: "organization",
    sortFields: ["createdAt"],
  }),
`;

try {
  await runCase({
    name: "valid inventory",
    inventory: inventoryFor([component("ValidTable.tsx", dataset())]),
    sources: { "ValidTable.tsx": validTableSource },
    status: 0,
    patterns: [/DataTable inventory passed/u],
  });
  await runCase({
    name: "missing file",
    inventory: inventoryFor([component("MissingTable.tsx", dataset())]),
    sources: { "ValidTable.tsx": validTableSource },
    status: 1,
    patterns: [/missing inventory file: .*MissingTable\.tsx/u],
    forbidden: [/ENOENT/u],
  });
  await runCase({
    name: "duplicate dataset",
    inventory: inventoryFor([
      component("ValidTable.tsx", dataset()),
      component("SecondTable.tsx", dataset()),
    ]),
    sources: {
      "ValidTable.tsx": validTableSource,
      "SecondTable.tsx": validTableSource,
    },
    status: 1,
    patterns: [/duplicate dataset id: valid_table/u],
  });
  await runCase({
    name: "mixed server state and rows",
    inventory: inventoryFor([component("ValidTable.tsx", dataset())]),
    sources: {
      "ValidTable.tsx":
        "export const View = () => <DataTable serverState={state.serverState} data={other.rows} />;\n",
    },
    status: 1,
    patterns: [/serverState is attached without data=\{state\.rows\}/u],
  });
  await runCase({
    name: "invalid scope",
    inventory: inventoryFor([
      component("ValidTable.tsx", { ...dataset(), scope: "tenant" }),
    ]),
    sources: { "ValidTable.tsx": validTableSource },
    status: 1,
    patterns: [/valid_table: invalid scope tenant/u],
  });
  await runCase({
    name: "unsupported sort",
    inventory: inventoryFor([
      component("ValidTable.tsx", {
        ...dataset(),
        capabilities: ["updated_at_sort"],
      }),
    ]),
    sources: { "ValidTable.tsx": validTableSource },
    status: 1,
    patterns: [/valid_table: unsupported capability updated_at_sort/u],
  });
  await runCase({
    name: "native load-all fallback",
    inventory: inventoryFor([component("ValidTable.tsx", dataset())]),
    sources: { "ValidTable.tsx": validTableSource },
    coreRegistrySource: registrySource.replace(
      "usage_events: defineResource({ nativePagination: true })",
      "usage_events: defineResource({ nativePagination: true, load: listUsageEvents })",
    ),
    status: 1,
    patterns: [
      /usage_events: native resource must not retain a load-all fallback/u,
    ],
  });
  console.log(
    "DataTable inventory self-test passed: 7 positive/negative cases.",
  );
} finally {
  await rm(temporaryRoot, { force: true, recursive: true });
}

async function runCase({
  name,
  inventory,
  sources,
  status,
  patterns,
  forbidden = [],
  coreRegistrySource = registrySource,
}) {
  const caseRoot = path.join(temporaryRoot, name.replaceAll(" ", "-"));
  const componentRoot = path.join(caseRoot, "apps/app/src/components");
  const docsRoot = path.join(caseRoot, "docs/architecture");
  const coreRoot = path.join(caseRoot, "packages/core/src/services");
  const appLibRoot = path.join(caseRoot, "apps/app/src/lib");
  await Promise.all([
    mkdir(componentRoot, { recursive: true }),
    mkdir(docsRoot, { recursive: true }),
    mkdir(coreRoot, { recursive: true }),
    mkdir(appLibRoot, { recursive: true }),
  ]);
  await Promise.all([
    ...Object.entries(sources).map(([file, source]) =>
      writeFile(path.join(componentRoot, file), source, "utf8"),
    ),
    writeFile(
      path.join(docsRoot, "data-table-inventory.json"),
      `${JSON.stringify(inventory, null, 2)}\n`,
      "utf8",
    ),
    writeFile(
      path.join(coreRoot, "inventoried-table-resources.ts"),
      coreRegistrySource,
      "utf8",
    ),
    writeFile(
      path.join(appLibRoot, "inventoried-table-resource-registry.ts"),
      typedRegistrySource,
      "utf8",
    ),
  ]);
  const result = spawnSync(process.execPath, [checker], {
    cwd: caseRoot,
    encoding: "utf8",
  });
  const output = `${result.stdout}${result.stderr}`;
  if (result.status !== status) {
    throw new Error(
      `${name}: expected exit ${status}, received ${result.status}\n${output}`,
    );
  }
  for (const pattern of patterns) {
    if (!pattern.test(output)) {
      throw new Error(`${name}: missing ${pattern}\n${output}`);
    }
  }
  for (const pattern of forbidden) {
    if (pattern.test(output)) {
      throw new Error(`${name}: unexpectedly matched ${pattern}\n${output}`);
    }
  }
}

function inventoryFor(components) {
  return {
    schemaVersion: 1,
    classifications: ["bounded-client", "virtualized-client", "server-driven"],
    components,
  };
}

function component(file, entry) {
  return {
    file: `apps/app/src/components/${file}`,
    datasets: [entry],
  };
}

function dataset() {
  return {
    id: "valid_table",
    classification: "server-driven",
    status: "implemented",
    endpoint: "POST /api/v1/admin/table-pages",
    capabilities: ["created_at_sort"],
  };
}
