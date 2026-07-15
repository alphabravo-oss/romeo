import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  argValue,
  assertComposeLogsRedacted,
  cleanupComposeHarness,
  compose,
  composeFile,
  composeOutput,
  createAdminApiKey,
  createComposeHarness,
  parsePositiveInteger,
  randomProjectName,
  root,
  waitForHealth,
  writeComposeEnv,
  writeJsonEvidence,
} from "./lib/compose-smoke-support.mjs";

const keep = process.argv.includes("--keep");
const projectName =
  argValue("--project-name") ??
  randomProjectName("romeo_distributed_controls_smoke");
const timeoutMs = parsePositiveInteger("--timeout-ms", 240000);
const appReplicas = 2;
const rateLimitMax = 3;
const quotaLimit = 10;

const harness = await createComposeHarness({ projectName, timeoutMs });
const overrideFile = join(harness.tempDir, "multi-instance.override.yml");
const clientFile = join(harness.tempDir, "internal-client.mjs");
const composeFiles = [composeFile, overrideFile];

writeFileSync(
  overrideFile,
  ["services:", "  app:", "    ports: !reset []", ""].join("\n"),
);
writeFileSync(clientFile, internalClientSource());

let adminToken;
let rateLimitEvidence;
let quotaEvidence;

try {
  writeComposeEnv(harness, {
    devSeededLogin: true,
    httpRateLimitDriver: "disabled",
    quotaCoordinationDriver: "disabled",
  });
  compose(harness, ["up", "-d", "--build", "app"]);
  await waitForHealth(harness);
  compose(harness, [
    "run",
    "--rm",
    "migrate",
    "pnpm",
    "seed:postgres",
    "--",
    "--confirm-development-seed",
  ]);
  adminToken = await createAdminApiKey(harness);

  rateLimitEvidence = await runRateLimitPhase();
  quotaEvidence = await runQuotaPhase();

  assertComposeLogsRedacted(
    harness,
    [
      adminToken,
      harness.postgresPassword,
      harness.s3Secret,
      harness.sessionSecret,
      harness.webhookSigningKey,
    ],
    "Compose distributed-controls logs",
    { composeFiles },
  );

  writeJsonEvidence({
    schemaVersion: "romeo.compose-distributed-controls-smoke.v1",
    generatedAt: new Date().toISOString(),
    projectName,
    status: "passed",
    mode: "live",
    target: {
      deployment: "compose",
      appInstances: appReplicas,
      httpRateLimitDriver: "valkey",
      quotaCoordinationDriver: "valkey",
    },
    checks: [
      "compose_build_and_start",
      "explicit_development_seed",
      "secure_multi_instance_rate_limit_recreate",
      "two_app_instances_healthy_for_rate_limit",
      "valkey_backed_http_rate_limit_shared_across_instances",
      "secure_multi_instance_quota_recreate",
      "two_app_instances_healthy_for_quota",
      "quota_coordination_status_healthy",
      "quota_consumption_across_instances",
      "quota_coordination_fail_closed_on_valkey_outage",
      "compose_logs_redacted",
    ],
    httpRateLimit: rateLimitEvidence,
    quotaCoordination: quotaEvidence,
    logRedaction: {
      status: "passed",
      scanned: ["compose_logs"],
      forbiddenValues: 5,
    },
  });
} finally {
  if (!keep) {
    cleanupComposeHarness(harness, { composeFiles });
  } else {
    process.stderr.write(
      `Keeping Compose project ${projectName} and env file ${harness.envPath} for inspection.\n`,
    );
  }
}

async function runRateLimitPhase() {
  writeComposeEnv(harness, {
    devSeededLogin: false,
    httpRateLimitDriver: "valkey",
    httpRateLimitKeyPrefix: `romeo:http-rate-limit:${projectName}`,
    httpRateLimitWindowSeconds: 300,
    httpRateLimitAuthenticatedMax: rateLimitMax,
    quotaCoordinationDriver: "disabled",
  });
  compose(
    harness,
    ["up", "-d", "--force-recreate", "--scale", `app=${appReplicas}`, "app"],
    { composeFiles },
  );
  const targets = await waitForAppReplicasHealthy();

  const response = runInternalClient({
    targets,
    tokens: { admin: adminToken },
    steps: [
      meStep("rate_limit_first_instance_first", 0),
      meStep("rate_limit_second_instance_first", 1),
      meStep("rate_limit_first_instance_second", 0),
      meStep("rate_limit_second_instance_rejected", 1),
    ],
  });
  const results = response.results;
  expectStatuses(results, [200, 200, 200, 429]);
  const rejected = resultByName(results, "rate_limit_second_instance_rejected");
  if (rejected.code !== "rate_limit_exceeded") {
    throw new Error(
      `Expected shared rate-limit rejection, got ${JSON.stringify(rejected)}`,
    );
  }

  return {
    driver: "valkey",
    limit: rateLimitMax,
    windowSeconds: 300,
    appInstances: targets.length,
    sequence: results.map((result) => ({
      name: result.name,
      status: result.status,
      target: result.target.name,
      code: result.code,
      rateLimitRemaining: result.headers["ratelimit-remaining"],
    })),
  };
}

async function runQuotaPhase() {
  writeComposeEnv(harness, {
    devSeededLogin: false,
    httpRateLimitDriver: "disabled",
    quotaCoordinationDriver: "valkey",
    quotaCoordinationKeyPrefix: `romeo:quota:${projectName}`,
    quotaCoordinationTimeoutMs: 750,
  });
  compose(harness, ["up", "-d", "valkey"], { composeFiles });
  compose(
    harness,
    ["up", "-d", "--force-recreate", "--scale", `app=${appReplicas}`, "app"],
    { composeFiles },
  );
  const targets = await waitForAppReplicasHealthy();

  const beforeOutage = runInternalClient({
    targets,
    tokens: { admin: adminToken },
    steps: [
      {
        name: "quota_coordination_status_healthy",
        targetIndex: 0,
        method: "GET",
        path: "/api/v1/quotas/distributed-status",
        tokenRef: "admin",
        capture: "quotaStatus",
      },
      {
        name: "quota_bucket_created",
        targetIndex: 0,
        method: "POST",
        path: "/api/v1/quotas",
        tokenRef: "admin",
        expectedStatus: 201,
        body: {
          scopeType: "org",
          metric: "tool.call",
          limit: quotaLimit,
          resetInterval: "none",
        },
        capture: "quota",
      },
      toolStep("quota_tool_first_instance", 0),
      toolStep("quota_tool_second_instance", 1),
      {
        name: "quota_usage_readback",
        targetIndex: 1,
        method: "GET",
        path: "/api/v1/quotas",
        tokenRef: "admin",
        capture: "quotas",
      },
    ],
  });
  expectStatuses(beforeOutage.results, [200, 201, 200, 200, 200]);
  const status = resultByName(
    beforeOutage.results,
    "quota_coordination_status_healthy",
  ).data;
  if (
    status.driver !== "valkey" ||
    status.healthy !== true ||
    status.failClosed !== true
  ) {
    throw new Error(
      `Quota coordination status is not healthy/fail-closed: ${JSON.stringify(status)}`,
    );
  }
  const usage = resultByName(beforeOutage.results, "quota_usage_readback").data;
  const toolQuota = usage.quotas.find((quota) => quota.metric === "tool.call");
  if (toolQuota === undefined || toolQuota.used < 2) {
    throw new Error(
      `Quota usage did not include both app instances: ${JSON.stringify(usage)}`,
    );
  }

  compose(harness, ["stop", "valkey"], { composeFiles });
  const outage = runInternalClient({
    targets,
    tokens: { admin: adminToken },
    steps: [toolStep("quota_coordination_outage_fail_closed", 0)],
  });
  expectStatuses(outage.results, [503]);
  const failed = resultByName(
    outage.results,
    "quota_coordination_outage_fail_closed",
  );
  if (failed.code !== "quota_coordination_unavailable") {
    throw new Error(
      `Expected quota coordination fail-closed response, got ${JSON.stringify(failed)}`,
    );
  }

  return {
    driver: "valkey",
    appInstances: targets.length,
    status,
    usageReadback: toolQuota,
    failClosed: {
      status: failed.status,
      code: failed.code,
      target: failed.target.name,
    },
  };
}

function meStep(name, targetIndex) {
  return {
    name,
    targetIndex,
    method: "GET",
    path: "/api/v1/me",
    tokenRef: "admin",
    capture: "me",
  };
}

function toolStep(name, targetIndex) {
  return {
    name,
    targetIndex,
    method: "POST",
    path: "/api/v1/tools/tool_calculator/execute",
    tokenRef: "admin",
    body: {
      agentId: "agent_default",
      input: { expression: "2 + 2" },
    },
    capture: "tool",
  };
}

function expectStatuses(results, statuses) {
  if (results.length !== statuses.length) {
    throw new Error(
      `Expected ${statuses.length} results, received ${results.length}.`,
    );
  }
  for (const [index, status] of statuses.entries()) {
    if (results[index]?.status !== status) {
      throw new Error(
        `Unexpected status at step ${index}: ${JSON.stringify(results[index])}, expected ${status}.`,
      );
    }
  }
}

function resultByName(results, name) {
  const result = results.find((item) => item.name === name);
  if (result === undefined) throw new Error(`Missing client result ${name}.`);
  return result;
}

async function waitForAppReplicasHealthy() {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = "";
  while (Date.now() < deadline) {
    const targets = appReplicaTargets();
    if (targets.length === appReplicas) {
      const inspected = targets.map((target) =>
        inspectContainerState(target.id),
      );
      lastStatus = inspected
        .map((state) => `${state.name}:${state.status}:${state.health}`)
        .join(", ");
      if (
        inspected.every(
          (state) => state.status === "running" && state.health === "healthy",
        )
      ) {
        return inspected.map((state) => ({
          id: state.id,
          ip: state.ip,
          name: state.name,
        }));
      }
    } else {
      lastStatus = `expected ${appReplicas} replicas, saw ${targets.length}`;
    }
    await sleep(1000);
  }
  throw new Error(
    `Timed out waiting for ${appReplicas} healthy app replicas. Last status: ${lastStatus}`,
  );
}

function appReplicaTargets() {
  const result = composeOutput(harness, ["ps", "-q", "app"], {
    allowFailure: true,
    composeFiles,
  });
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((id) => ({ id }));
}

function inspectContainerState(id) {
  const inspect = spawnSync(
    "docker",
    ["inspect", "--format", "{{json .}}", id],
    { encoding: "utf8" },
  );
  if (inspect.status !== 0) {
    throw new Error(
      `docker inspect failed for ${id}.\nSTDOUT:\n${inspect.stdout}\nSTDERR:\n${inspect.stderr}`,
    );
  }
  const data = JSON.parse(inspect.stdout);
  const networks = Object.values(data.NetworkSettings?.Networks ?? {});
  const ip = networks.find((network) => network?.IPAddress)?.IPAddress;
  if (typeof ip !== "string" || ip.length === 0) {
    throw new Error(`App container ${id} has no inspectable network IP.`);
  }
  return {
    id,
    ip,
    name: String(data.Name ?? id).replace(/^\//, ""),
    status: data.State?.Status,
    health: data.State?.Health?.Status ?? "none",
  };
}

function runInternalClient(plan) {
  const env = {
    ...process.env,
    ROMEO_SMOKE_PLAN: JSON.stringify(plan),
  };
  const result = spawnSync(
    "docker",
    [
      "compose",
      "-f",
      composeFile,
      "-f",
      overrideFile,
      "--env-file",
      harness.envPath,
      "-p",
      harness.projectName,
      "run",
      "--rm",
      "--no-deps",
      "-T",
      "-e",
      "ROMEO_SMOKE_PLAN",
      "-v",
      `${harness.tempDir}:/romeo-smoke:ro`,
      "app",
      "node",
      "/romeo-smoke/internal-client.mjs",
    ],
    {
      cwd: root,
      encoding: "utf8",
      env,
      timeout: timeoutMs,
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `internal Compose client failed.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }
  return JSON.parse(result.stdout);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function internalClientSource() {
  return `
const plan = JSON.parse(process.env.ROMEO_SMOKE_PLAN ?? "{}");
const results = [];

for (const step of plan.steps ?? []) {
  const target = plan.targets?.[step.targetIndex];
  if (target === undefined) throw new Error(\`Missing target for \${step.name}\`);
  const headers = { accept: "application/json" };
  if (step.body !== undefined) headers["content-type"] = "application/json";
  if (step.tokenRef !== undefined) {
    const token = plan.tokens?.[step.tokenRef];
    if (typeof token !== "string" || token.length === 0) {
      throw new Error(\`Missing token for \${step.name}\`);
    }
    headers.authorization = \`Bearer \${token}\`;
  }
  const response = await fetch(\`http://\${target.ip}:3000\${step.path}\`, {
    method: step.method ?? "GET",
    headers,
    body: step.body === undefined ? undefined : JSON.stringify(step.body),
  });
  const text = await response.text();
  let body;
  try {
    body = text.length === 0 ? undefined : JSON.parse(text);
  } catch {
    body = undefined;
  }
  results.push({
    name: step.name,
    status: response.status,
    target: { name: target.name },
    code: body?.error?.code,
    headers: selectedHeaders(response.headers),
    data: sanitize(step.capture, body?.data),
  });
}

process.stdout.write(JSON.stringify({ results }, null, 2));

function selectedHeaders(headers) {
  return Object.fromEntries(
    ["ratelimit-limit", "ratelimit-remaining", "ratelimit-reset", "retry-after"]
      .map((name) => [name, headers.get(name)])
      .filter(([, value]) => value !== null),
  );
}

function sanitize(capture, data) {
  if (capture === "quotaStatus") {
    return {
      driver: data?.driver,
      enabled: data?.enabled,
      configured: data?.configured,
      healthy: data?.healthy,
      failClosed: data?.details?.failClosed,
      statusCode: data?.details?.statusCode,
    };
  }
  if (capture === "quotas") {
    return {
      quotas: Array.isArray(data)
        ? data.map((quota) => ({
            metric: quota.metric,
            scopeType: quota.scopeType,
            limit: quota.limit,
            used: quota.used,
            resetInterval: quota.resetInterval,
          }))
        : [],
    };
  }
  if (capture === "quota") {
    return {
      metric: data?.metric,
      scopeType: data?.scopeType,
      limit: data?.limit,
      used: data?.used,
      resetInterval: data?.resetInterval,
    };
  }
  if (capture === "tool") {
    return {
      resultType: data?.result === undefined ? undefined : typeof data.result,
    };
  }
  if (capture === "me") {
    return {
      subjectType: data?.subject?.type,
      orgIdPresent: typeof data?.subject?.orgId === "string",
    };
  }
  return undefined;
}
`;
}
