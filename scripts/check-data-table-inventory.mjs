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
const typedRegistryPath = path.join(
  root,
  "apps/app/src/lib/inventoried-table-resource-registry.ts",
);
const inventory = JSON.parse(await readFile(inventoryPath, "utf8"));
const validClassifications = new Set(inventory.classifications);
const validStatuses = new Set(["implemented", "migration_required"]);
const validScopes = new Set(["organization", "parent", "workspace"]);
const validCapabilities = new Set([
  "opaque_cursor_history",
  "created_at_sort",
  "server_filters",
  "debounced_search_cancellation",
  "page_size",
  "estimated_total",
  "stale_cursor_recovery",
]);
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
const typedRegistrySource = await readFile(typedRegistryPath, "utf8");
const registeredIds = new Set(
  [
    ...registrySource.matchAll(/^\s+([a-z][a-z0-9_]*):\s*defineResource\(/gmu),
  ].map((match) => match[1]),
);
const typedRegisteredIds = new Set(
  [
    ...typedRegistrySource.matchAll(
      /^\s+([a-z][a-z0-9_]*):\s*defineResource\(/gmu,
    ),
  ].map((match) => match[1]),
);
const requiredLoaders = {};
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

const requiredNativePagination = [
  "background_jobs",
  "data_connector_sync_runs",
  "governance_export_packages",
  "notification_deliveries",
  "notifications",
  "support_access_requests",
  "support_sessions",
  "tool_trace_calls",
  "usage_events",
];
for (const id of requiredNativePagination) {
  const block = resourceBlock(registrySource, id);
  if (block === undefined || !block.includes("nativePagination: true")) {
    failures.push(
      `${id}: high-cardinality resource must use native pagination`,
    );
  } else if (/\bload\s*:/u.test(block)) {
    failures.push(`${id}: native resource must not retain a load-all fallback`);
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
  let source;
  try {
    source = await readFile(path.join(root, component.file), "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      failures.push(`missing inventory file: ${component.file}`);
      continue;
    }
    throw error;
  }
  const bindings = tablePageBindings(source);
  let declaredBindingCount = 0;
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
    if (dataset.scope !== undefined && !validScopes.has(dataset.scope)) {
      failures.push(`${dataset.id}: invalid scope ${dataset.scope}`);
    }
    for (const capability of dataset.capabilities ?? []) {
      if (!validCapabilities.has(capability)) {
        failures.push(`${dataset.id}: unsupported capability ${capability}`);
      }
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
        const typedBlock = resourceBlock(typedRegistrySource, dataset.id);
        const registeredScope = typedBlock?.match(
          /\bscope:\s*"(organization|parent|workspace)"/u,
        )?.[1];
        if (!typedRegisteredIds.has(dataset.id) || typedBlock === undefined) {
          failures.push(
            `${dataset.id}: table-pages dataset missing from the typed application registry`,
          );
        } else if (registeredScope === undefined) {
          failures.push(
            `${dataset.id}: typed application registry has no valid scope`,
          );
        } else if (
          dataset.scope !== undefined &&
          dataset.scope !== registeredScope
        ) {
          failures.push(
            `${dataset.id}: inventory scope ${dataset.scope} does not match typed registry scope ${registeredScope}`,
          );
        }
        if (dataset.binding !== undefined) {
          if (hasDeclaredTableBinding(source, dataset.binding)) {
            declaredBindingCount += 1;
          } else {
            failures.push(
              `${dataset.id}: declared serverState/data binding is not present in one DataTable`,
            );
          }
        }
        if (!registeredIds.has(dataset.id)) {
          failures.push(
            `${dataset.id}: table-pages dataset missing from inventoriedTableResources`,
          );
        }
      }
    }
  }
  if (tablePageDatasets.length > bindings.length + declaredBindingCount) {
    failures.push(
      `${component.file}: ${tablePageDatasets.length} table-pages datasets (${tablePageDatasets.join(", ")}) but ${bindings.length + declaredBindingCount} verified serverState/data bindings`,
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

function hasDeclaredTableBinding(source, binding) {
  if (
    typeof binding !== "object" ||
    binding === null ||
    typeof binding.serverState !== "string" ||
    typeof binding.rows !== "string" ||
    !/^[A-Za-z_][\w]*$/u.test(binding.serverState) ||
    !/^[A-Za-z_][\w]*$/u.test(binding.rows)
  ) {
    return false;
  }
  return dataTableBlocks(source).some(
    (table) =>
      new RegExp(
        `serverState=\\{${escapeRegex(binding.serverState)}\\}`,
        "u",
      ).test(table) &&
      new RegExp(`data=\\{${escapeRegex(binding.rows)}\\}`, "u").test(table),
  );
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
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
