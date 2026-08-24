import { readFileSync } from "node:fs";

const files = {
  access: "packages/core/src/services/file-access-service.ts",
  alerts: "deploy/monitoring/prometheus-rules.yaml",
  direct: "packages/core/src/services/file-direct-upload-service.ts",
  compose: "deploy/compose/compose.yml",
  lifecycle: "packages/core/src/services/file-lifecycle.ts",
  pipeline: "packages/core/src/services/file-pipeline-support.ts",
  query: "apps/app/src/features/files/query-options.ts",
  readiness: "packages/core/src/services/internal-readiness-service.ts",
  resumable: "packages/core/src/services/file-resumable-upload-service.ts",
  scheduled: "packages/core/src/services/scheduled-runtime-workers.ts",
  storage: "packages/storage/src/types.ts",
  upload: "packages/core/src/services/file-service.ts",
  values: "deploy/helm/values.yaml",
  worker: "packages/core/src/services/file-lifecycle-worker.ts",
};

export function validateFileLifecycleWorkerPolicy(source) {
  const errors = [];
  requireText(errors, source.scheduled, 'name: "file_lifecycle"');
  requireText(
    errors,
    source.scheduled,
    'scopes: ["files:read", "files:write"]',
  );
  requireText(errors, source.scheduled, "services.files.processLifecycleJob");
  requireText(errors, source.scheduled, "signal: runInput.signal");
  requireText(errors, source.readiness, 'worker("file_lifecycle", 1_000)');
  requireText(errors, source.values, "SCHEDULED_TENANT_WORK_OWNER: internal");
  requireText(errors, source.compose, "SCHEDULED_TENANT_WORK_OWNER:");
  requireText(errors, source.lifecycle, "fileLifecycleMaxAttempts = 5");
  requireText(errors, source.worker, "fileLifecycleRetryDelayMs");
  requireText(errors, source.worker, "fileLifecycleDeadLetter");
  requireText(errors, source.worker, "AbortSignal.any");
  requireText(errors, source.storage, "signal?: AbortSignal");
  requireText(errors, source.query, "fileLifecycleRefreshIntervalMs = 2_000");
  requireText(errors, source.alerts, "RomeoFileLifecycleQueueLag");
  requireText(errors, source.alerts, "RomeoFileLifecycleDeadLetters");
  requireText(errors, source.access, 'transitionFileLifecycle(file, "failed"');
  requireText(
    errors,
    source.access,
    'transitionFileLifecycle(failed, "quarantined"',
  );
  for (const requestSource of [
    source.upload,
    source.direct,
    source.resumable,
  ]) {
    if (requestSource.includes(".processFileLifecycle("))
      errors.push("upload request path executes file lifecycle work inline");
  }
  if (source.pipeline.includes("async processFileLifecycle("))
    errors.push("dead synchronous file lifecycle wrapper remains reachable");
  return errors;
}

const source = Object.fromEntries(
  Object.entries(files).map(([name, file]) => [
    name,
    readFileSync(new URL(`../${file}`, import.meta.url), "utf8"),
  ]),
);
const errors = validateFileLifecycleWorkerPolicy(source);
if (errors.length > 0) throw new Error(errors.join("\n"));

for (const [name, sentinel] of [
  ["scheduled", 'name: "file_lifecycle"'],
  ["readiness", 'worker("file_lifecycle", 1_000)'],
  ["worker", "fileLifecycleDeadLetter"],
  ["storage", "signal?: AbortSignal"],
  ["query", "fileLifecycleRefreshIntervalMs = 2_000"],
  ["alerts", "RomeoFileLifecycleQueueLag"],
]) {
  const tampered = {
    ...source,
    [name]: source[name].split(sentinel).join(""),
  };
  if (validateFileLifecycleWorkerPolicy(tampered).length === 0)
    throw new Error(`negative self-test accepted missing ${name} policy`);
}

process.stdout.write(
  "file lifecycle worker policy passed (including negative self-tests)\n",
);

function requireText(errors, source, expected) {
  if (!source.includes(expected))
    errors.push(`missing policy marker: ${expected}`);
}
