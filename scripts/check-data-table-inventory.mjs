#!/usr/bin/env node

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const componentRoot = path.join(root, "apps/app/src/components");
const inventoryPath = path.join(
  root,
  "docs/architecture/data-table-inventory.json",
);
const registryPath = path.join(
  root,
  "packages/core/src/services/inventoried-table-resources.ts",
);
const inventory = JSON.parse(await readFile(inventoryPath, "utf8"));
const validClassifications = new Set(inventory.classifications);
const validStatuses = new Set(["implemented", "migration_required"]);
const tablePagesEndpoint = "POST /api/v1/admin/table-pages";
const failures = [];
const actual = new Map();

for (const name of await readdir(componentRoot)) {
  if (!name.endsWith(".tsx") || name === "DataTable.tsx") continue;
  const relative = `apps/app/src/components/${name}`;
  const source = await readFile(path.join(componentRoot, name), "utf8");
  const count = source.match(/<DataTable\b/gu)?.length ?? 0;
  if (count > 0) actual.set(relative, count);
}

const registrySource = await readFile(registryPath, "utf8");
const registeredIds = new Set(
  [
    ...registrySource.matchAll(/^\s+([a-z][a-z0-9_]*):\s*defineResource\(/gmu),
  ].map((match) => match[1]),
);
const requiredLoaders = {
  support_access_requests: {
    required: ["supportRequestReports", "listAuditLogs"],
    forbidden: ["listUsers"],
  },
  support_sessions: {
    required: ["toSupportSessionReport", "getUserSession"],
    forbidden: ["listUsers"],
  },
  governance_export_packages: {
    required: ["listGovernedDataExportPackages"],
    forbidden: ["listResourceGrants"],
  },
};
for (const [id, contract] of Object.entries(requiredLoaders)) {
  const block = resourceBlock(registrySource, id);
  if (block === undefined) {
    failures.push(`${id}: missing inventoriedTableResources loader`);
    continue;
  }
  for (const token of contract.required) {
    if (!block.includes(token)) {
      failures.push(`${id}: loader must call ${token}`);
    }
  }
  for (const token of contract.forbidden) {
    if (block.includes(token)) {
      failures.push(`${id}: loader must not call ${token}`);
    }
  }
}

const declared = new Map();
const datasetIds = new Set();
for (const component of inventory.components) {
  if (declared.has(component.file)) {
    failures.push(`duplicate component inventory: ${component.file}`);
    continue;
  }
  declared.set(component.file, component.datasets.length);
  const source = await readFile(path.join(root, component.file), "utf8");
  const bindings = tablePageBindings(source);
  const unusedStates = unusedInventoriedServerState(source);
  for (const ident of unusedStates) {
    failures.push(
      `${component.file}: ${ident}.serverState is attached without data={${ident}.rows}`,
    );
  }
  const tablePageDatasets = [];
  for (const dataset of component.datasets) {
    if (datasetIds.has(dataset.id)) {
      failures.push(`duplicate dataset id: ${dataset.id}`);
    }
    datasetIds.add(dataset.id);
    if (!validClassifications.has(dataset.classification)) {
      failures.push(
        `${dataset.id}: invalid classification ${dataset.classification}`,
      );
    }
    if (!validStatuses.has(dataset.status)) {
      failures.push(`${dataset.id}: invalid status ${dataset.status}`);
    }
    if (
      dataset.status === "implemented" &&
      dataset.classification === "server-driven"
    ) {
      if (
        !source.includes("serverPagination=") &&
        !source.includes("serverState=")
      ) {
        failures.push(
          `${dataset.id}: marked implemented server-driven but ${component.file} has no serverPagination/serverState`,
        );
      }
      if (dataset.endpoint === tablePagesEndpoint) {
        tablePageDatasets.push(dataset.id);
        if (!registeredIds.has(dataset.id)) {
          failures.push(
            `${dataset.id}: table-pages dataset missing from inventoriedTableResources`,
          );
        }
      }
    }
  }
  if (tablePageDatasets.length > bindings.length) {
    failures.push(
      `${component.file}: ${tablePageDatasets.length} table-pages datasets (${tablePageDatasets.join(", ")}) but ${bindings.length} IDENT.serverState/IDENT.rows bindings`,
    );
  }
}

for (const [file, count] of actual) {
  if (!declared.has(file))
    failures.push(`unclassified DataTable file: ${file}`);
  else if (declared.get(file) !== count) {
    failures.push(
      `${file}: inventory has ${declared.get(file)} datasets but source has ${count} DataTable instances`,
    );
  }
}
for (const file of declared.keys()) {
  if (!actual.has(file)) failures.push(`stale inventory file: ${file}`);
}

if (failures.length > 0) {
  console.error("DataTable inventory contract failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  const total = [...actual.values()].reduce((sum, value) => sum + value, 0);
  const migrations = inventory.components
    .flatMap((entry) => entry.datasets)
    .filter((dataset) => dataset.status === "migration_required").length;
  console.log(
    `DataTable inventory passed: ${total} instances across ${actual.size} files; ${migrations} server migrations remain.`,
  );
}

function dataTableBlocks(source) {
  return source.match(/<DataTable\b[\s\S]*?\/>/gu) ?? [];
}

function tablePageBindings(source) {
  const bindings = [];
  for (const table of dataTableBlocks(source)) {
    const state = table.match(/serverState=\{([A-Za-z_][\w]*)\.serverState\}/u);
    if (state === null) continue;
    const ident = state[1];
    if (usesIdentRows(table, ident)) bindings.push(ident);
  }
  return bindings;
}

function unusedInventoriedServerState(source) {
  const unused = [];
  for (const table of dataTableBlocks(source)) {
    const state = table.match(/serverState=\{([A-Za-z_][\w]*)\.serverState\}/u);
    if (state === null) continue;
    const ident = state[1];
    if (!usesIdentRows(table, ident)) unused.push(ident);
  }
  return unused;
}

function usesIdentRows(table, ident) {
  return new RegExp(
    `data=\\{(?:[A-Za-z_][\\w]*\\(\\s*)?(?:[A-Za-z_][\\w]*\\(\\s*)?\\s*${ident}\\.rows\\b`,
    "u",
  ).test(table);
}

function resourceBlock(source, id) {
  const match = new RegExp(`^\\s+${id}:\\s*defineResource\\(`, "mu").exec(
    source,
  );
  if (match === null) return undefined;
  const after = source.slice(match.index + match[0].length);
  const next = after.search(/^\s+[a-z][a-z0-9_]*:\s*defineResource\(/mu);
  return next < 0 ? after : after.slice(0, next);
}
