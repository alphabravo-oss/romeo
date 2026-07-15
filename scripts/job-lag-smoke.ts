import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { readEnv } from "../packages/config/src/index";
import { createRomeoApi } from "../packages/core/src/api";
import { InMemoryRomeoRepository } from "../packages/core/src/repositories/in-memory";

const output = argValue("--output");
const repository = new InMemoryRomeoRepository();
const rawSentinel = `RAW_JOB_LAG_SENTINEL_${process.pid}`;
const now = Date.now();

await repository.createBackgroundJob({
  id: "job_lag_smoke_queued",
  orgId: "org_default",
  type: "tool.operation.dispatch_request",
  status: "queued",
  payload: { prompt: rawSentinel },
  createdAt: new Date(now - 20 * 60 * 1000).toISOString(),
  updatedAt: new Date(now - 20 * 60 * 1000).toISOString(),
});
await repository.createBackgroundJob({
  id: "job_lag_smoke_running",
  orgId: "org_default",
  type: "webhook.retry_due",
  status: "running",
  payload: { body: rawSentinel },
  createdAt: new Date(now - 70 * 60 * 1000).toISOString(),
  updatedAt: new Date(now - 70 * 60 * 1000).toISOString(),
});
await repository.createBackgroundJob({
  id: "job_lag_smoke_failed",
  orgId: "org_default",
  type: "webhook.retry_due",
  status: "failed",
  payload: { body: rawSentinel, errorCode: "worker_failed" },
  createdAt: new Date(now - 4 * 60 * 1000).toISOString(),
  updatedAt: new Date(now - 3 * 60 * 1000).toISOString(),
  completedAt: new Date(now - 3 * 60 * 1000).toISOString(),
});
await repository.createBackgroundJob({
  id: "job_lag_smoke_dead_letter",
  orgId: "org_default",
  type: "tool.operation.dispatch_request",
  status: "failed",
  payload: {
    deadLetter: {
      raw: rawSentinel,
      reasonCode: "max_attempts_exhausted",
    },
    errorCode: "worker_attempts_exhausted",
  },
  createdAt: new Date(now - 4 * 60 * 1000).toISOString(),
  updatedAt: new Date(now - 2 * 60 * 1000).toISOString(),
  completedAt: new Date(now - 2 * 60 * 1000).toISOString(),
});

const api = createRomeoApi(repository, {
  env: { ...readEnv(), DEV_SEEDED_LOGIN: true },
});
const response = await api.request("/api/v1/jobs/operational-summary");
const body = await response.json();
const serializedBody = JSON.stringify(body);

if (response.status !== 200)
  throw new Error(`Job lag summary returned ${response.status}.`);
if (serializedBody.includes(rawSentinel))
  throw new Error("Job lag summary leaked a raw job payload sentinel.");
if (body.data?.status !== "critical")
  throw new Error(
    `Expected critical job lag status, received ${body.data?.status}.`,
  );
assertAlert(body.data, "queued_lag_seconds");
assertAlert(body.data, "running_stale_seconds");
assertAlert(body.data, "recent_failed_jobs");
assertAlert(body.data, "dead_letter_jobs");

const evidence = {
  schemaVersion: "romeo.job-lag-smoke.v1",
  generatedAt: new Date().toISOString(),
  status: "passed",
  endpoint: "/api/v1/jobs/operational-summary",
  checks: [
    "queued_lag_alert",
    "running_stale_alert",
    "recent_failed_job_alert",
    "dead_letter_alert",
    "payload_redaction",
  ],
  summary: body.data,
  redaction: {
    rawQueuedPayloadReturned: false,
    rawRunningPayloadReturned: false,
    rawFailedPayloadReturned: false,
    rawDeadLetterPayloadReturned: false,
  },
};

const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
if (output === undefined) process.stdout.write(serialized);
else {
  const outputPath = resolve(process.env.INIT_CWD ?? process.cwd(), output);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, serialized, "utf8");
  console.log(`Wrote job lag smoke evidence to ${outputPath}`);
}

function assertAlert(
  summary: { alerts?: Array<{ metric?: string }> },
  metric: string,
): void {
  if (!summary.alerts?.some((alert) => alert.metric === metric)) {
    throw new Error(`Job lag summary missing ${metric} alert.`);
  }
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}
