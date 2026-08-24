#!/usr/bin/env node

import { access, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const sources = {
  api: await load("packages/core/src/api.ts"),
  routes: await load("packages/core/src/http/routes/retired-workflows.ts"),
  migration: await load("packages/db/migrations/0032_retire_workflows.sql"),
  schema: await load("packages/db/src/schema/workflows.ts"),
  dataInventory: await load("docs/security/data-inventory.json"),
  tableInventory: await load("docs/architecture/data-table-inventory.json"),
  deprecations: await load("docs/api/deprecation-ledger.json"),
  retirement: await load("docs/api/workflow-retirement.md"),
  browserTypes: await load(
    "packages/core/src/services/browser-automation-task-types.ts",
  ),
};
const legacyBrowserModuleExists =
  (await exists("packages/core/src/services/workflow-browser-tasks.ts")) ||
  (await exists("packages/core/src/services/workflow-browser-task-types.ts"));

runSelfTests();
const failures = validate({ ...sources, legacyBrowserModuleExists });
if (failures.length > 0) {
  console.error("Workflow retirement inventory failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    "Workflow retirement inventory passed: 9 compatibility tombstones, retained governed data, no active UI or stale browser module taxonomy.",
  );
}

function validate(input) {
  const failures = [];
  const registeredTombstones = input.routes.match(
    /app\.openapi\([^,]+,\s*retiredWorkflow\);/gu,
  );
  if (registeredTombstones?.length !== 9) {
    failures.push(
      "retired workflow route set must contain exactly 9 tombstones",
    );
  }
  if (!input.api.includes("registerRetiredWorkflowRoutes(app)")) {
    failures.push("API must register the retired workflow tombstones");
  }
  if (
    /\b(?:DROP|DELETE\s+FROM|TRUNCATE|ALTER\s+TABLE[\s\S]{0,80}DROP)\b/iu.test(
      input.migration,
    )
  ) {
    failures.push("workflow retirement migration must be metadata-only");
  }
  for (const table of ["workflow_definitions", "workflow_runs"]) {
    if (!input.schema.includes(table)) {
      failures.push(`${table}: retained schema is missing`);
    }
    if (!input.dataInventory.includes(`"${table}"`)) {
      failures.push(`${table}: governed data inventory entry is missing`);
    }
  }
  if (
    input.tableInventory.includes("WorkflowsPanel.tsx") ||
    /"id":\s*"(?:workflows|workflow_templates|workflow_runs)"/u.test(
      input.tableInventory,
    )
  ) {
    failures.push(
      "retired workflow UI must not appear in the live table inventory",
    );
  }
  let deprecations;
  try {
    deprecations = JSON.parse(input.deprecations).operations;
  } catch {
    failures.push("deprecation ledger must be valid JSON");
  }
  if (
    !Array.isArray(deprecations) ||
    deprecations.filter((entry) =>
      String(entry.operationId ?? "").startsWith("workflows."),
    ).length !== 9
  ) {
    failures.push("deprecation ledger must bind all 9 workflow operations");
  }
  if (
    !input.retirement.includes("2027-02-23") ||
    !input.retirement.includes("zero-usage evidence")
  ) {
    failures.push(
      "retirement documentation must retain sunset and usage gates",
    );
  }
  if (input.legacyBrowserModuleExists) {
    failures.push(
      "active browser modules must use browser-automation taxonomy",
    );
  }
  if (
    !input.browserTypes.includes("Persisted job discriminator") ||
    !input.browserTypes.includes('"workflow.browser_task.dispatch_request"')
  ) {
    failures.push(
      "historical browser job discriminator must be explicitly documented and preserved",
    );
  }
  return failures;
}

function runSelfTests() {
  const valid = {
    api: "registerRetiredWorkflowRoutes(app)",
    routes: Array.from(
      { length: 9 },
      (_, index) => `app.openapi(route${index}, retiredWorkflow);`,
    ).join("\n"),
    migration: "COMMENT ON TABLE workflow_definitions IS 'retired';",
    schema: "workflow_definitions workflow_runs",
    dataInventory: '"workflow_definitions" "workflow_runs"',
    tableInventory: "{}",
    deprecations: JSON.stringify({
      operations: Array.from({ length: 9 }, (_, index) => ({
        operationId: `workflows.operation${index}`,
      })),
    }),
    retirement: "2027-02-23 zero-usage evidence",
    browserTypes:
      'Persisted job discriminator "workflow.browser_task.dispatch_request"',
    legacyBrowserModuleExists: false,
  };
  if (validate(valid).length !== 0) {
    throw new Error("workflow retirement inventory valid self-test failed");
  }
  for (const mutation of [
    { migration: "DROP TABLE workflow_runs" },
    { tableInventory: '"file":"WorkflowsPanel.tsx"' },
    { legacyBrowserModuleExists: true },
    { routes: "app.openapi(route0, retiredWorkflow);" },
  ]) {
    if (validate({ ...valid, ...mutation }).length === 0) {
      throw new Error(
        `workflow retirement inventory negative self-test failed: ${JSON.stringify(mutation)}`,
      );
    }
  }
}

async function load(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

async function exists(relativePath) {
  try {
    await access(path.join(root, relativePath));
    return true;
  } catch {
    return false;
  }
}
