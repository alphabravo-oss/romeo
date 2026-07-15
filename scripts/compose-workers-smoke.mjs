import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";

import {
  argValue,
  assertComposeLogsRedacted,
  assertReadinessReady,
  cleanupComposeHarness,
  compose,
  composeOutput,
  createAdminApiKey,
  createComposeHarness,
  expectUnauthorizedMe,
  parsePositiveInteger,
  randomProjectName,
  waitForHealth,
  writeJsonEvidence,
  writeComposeEnv,
} from "./lib/compose-smoke-support.mjs";
import {
  assertNoSensitiveLeak,
  assertWorkerOutput,
  assertWorkflowResumeWorkerOutput,
  assertWorkflowRunStatus,
  composeLoopRestartWorkers,
  composeWorkerCommands,
  createSmokeAgent,
  createWorkflowResumePendingRun,
  parseWorkerOutput,
  workflowRuns,
} from "./lib/worker-smoke-support.mjs";

const keep = process.argv.includes("--keep");
const projectName =
  argValue("--project-name") ?? randomProjectName("romeo_workers_smoke");
const timeoutMs = parsePositiveInteger("--timeout-ms", 180000);

const harness = await createComposeHarness({ projectName, timeoutMs });
let adminToken;
let smokeAgent;
let controlledWorkflow;
let crashWorkflow;
const rawWorkerPromptSentinel = `worker_raw_prompt_${randomBytes(12).toString("hex")}`;
const crashWorkerPromptSentinel = `worker_crash_prompt_${randomBytes(12).toString("hex")}`;

try {
  writeComposeEnv(harness, { devSeededLogin: true });
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
  writeComposeEnv(harness, {
    devSeededLogin: false,
    romeoApiKey: adminToken,
    webhookRetryIntervalMs: 1000,
    workflowResumeIntervalMs: 1000,
  });
  compose(harness, ["up", "-d", "--force-recreate", "app"]);
  await waitForHealth(harness);
  await expectUnauthorizedMe(harness);
  await assertReadinessReady(harness, adminToken);

  smokeAgent = await createSmokeAgent(harness, adminToken);
  controlledWorkflow = await createWorkflowResumePendingRun(
    harness,
    adminToken,
    {
      name: "Compose worker controlled resume",
      agentId: smokeAgent.id,
      prompt: `Compose worker raw prompt redaction ${rawWorkerPromptSentinel}`,
    },
  );

  const results = [];
  for (const worker of composeWorkerCommands) {
    const result = composeOutput(harness, [
      "--profile",
      worker.profile,
      "run",
      "--rm",
      worker.service,
      ...worker.command,
    ]);
    assertNoSensitiveLeak(worker.name, `${result.stdout}\n${result.stderr}`, [
      adminToken,
      harness.postgresPassword,
      harness.s3Secret,
      harness.sessionSecret,
      harness.webhookSigningKey,
      rawWorkerPromptSentinel,
      crashWorkerPromptSentinel,
    ]);
    const parsed = parseWorkerOutput(worker.name, result.stdout);
    assertWorkerOutput(worker, parsed);
    if (worker.name === "workflow_resume") {
      assertWorkflowResumeWorkerOutput(parsed, controlledWorkflow);
      await assertWorkflowRunStatus(
        harness,
        adminToken,
        controlledWorkflow,
        "waiting_approval",
      );
    }
    results.push({
      name: worker.name,
      service: worker.service,
      iteration: parsed.iteration,
      checks: worker.numericChecks.reduce(
        (checks, key) => ({ ...checks, [key]: parsed[key] }),
        {},
      ),
    });
  }

  const restartResults = [];
  for (const worker of composeLoopRestartWorkers) {
    restartResults.push(await runLoopRestartSmoke(harness, worker));
  }

  crashWorkflow = await createWorkflowResumePendingRun(harness, adminToken, {
    name: "Compose worker crash resume",
    agentId: smokeAgent.id,
    prompt: `Compose worker crash prompt redaction ${crashWorkerPromptSentinel}`,
  });
  const crashRecovery = await runWorkflowResumeCrashRecoverySmoke(
    harness,
    adminToken,
    crashWorkflow,
  );

  assertComposeLogsRedacted(harness, [
    adminToken,
    harness.postgresPassword,
    harness.s3Secret,
    harness.sessionSecret,
    harness.webhookSigningKey,
    rawWorkerPromptSentinel,
    crashWorkerPromptSentinel,
  ]);

  writeJsonEvidence({
    schemaVersion: "romeo.compose-workers-smoke.v1",
    generatedAt: new Date().toISOString(),
    projectName,
    status: "passed",
    workerCount: results.length,
    workers: results,
    loopRestartCount: restartResults.length,
    loopRestarts: restartResults,
    smokeAgentId: smokeAgent.id,
    controlledWorkflowResume: {
      workflowId: controlledWorkflow.workflowId,
      workflowRunId: controlledWorkflow.workflowRunId,
      linkedRunId: controlledWorkflow.linkedRunId,
    },
    crashRecovery,
    checks: [
      "compose_build_and_start",
      "migration_service",
      "explicit_development_seed",
      "secure_recreate_with_seeded_login_disabled",
      "admin_readiness_ready",
      "worker_commands_ran_once",
      "worker_output_json_valid",
      "worker_output_secret_redaction",
      "worker_output_raw_content_redaction",
      "workflow_resume_controlled_pending_work",
      "loop_workers_emit_after_restart",
      "workflow_resume_sigkill_recovery",
      "workflow_resume_crash_no_duplicate_linked_run",
      "compose_logs_redacted",
    ],
  });
} finally {
  if (!keep) {
    cleanupComposeHarness(harness);
  } else {
    process.stderr.write(
      `Keeping Compose project ${projectName} and env file ${harness.envPath} for inspection.\n`,
    );
  }
}

async function runLoopRestartSmoke(harness, worker) {
  compose(harness, ["--profile", worker.profile, "up", "-d", worker.service]);
  const beforeRestartIterations = await waitForServiceIterations(
    harness,
    worker.service,
    1,
  );
  compose(harness, ["restart", worker.service]);
  const afterRestartIterations = await waitForServiceIterations(
    harness,
    worker.service,
    beforeRestartIterations + 1,
  );
  compose(harness, ["stop", worker.service]);
  return {
    name: worker.name,
    service: worker.service,
    beforeRestartIterations,
    afterRestartIterations,
  };
}

async function waitForServiceIterations(harness, service, minimumCount) {
  const deadline = Date.now() + harness.timeoutMs;
  let count = 0;
  while (Date.now() < deadline) {
    const logs = composeOutput(harness, ["logs", "--no-color", service], {
      allowFailure: true,
    });
    count = countOccurrences(`${logs.stdout}\n${logs.stderr}`, '"iteration"');
    if (count >= minimumCount) return count;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(
    `${service} did not emit ${minimumCount} worker loop iteration log entries.`,
  );
}

function countOccurrences(text, needle) {
  if (needle.length === 0) return 0;
  let count = 0;
  let index = text.indexOf(needle);
  while (index >= 0) {
    count += 1;
    index = text.indexOf(needle, index + needle.length);
  }
  return count;
}

async function runWorkflowResumeCrashRecoverySmoke(harness, token, workflow) {
  const service = "workflow-resume-worker";
  const baselineIterations = serviceIterationCount(harness, service);
  compose(harness, ["--profile", "workers", "up", "-d", service]);
  const killedContainerId = killComposeService(harness, service);
  const afterKillBaselineIterations = serviceIterationCount(harness, service);
  compose(harness, ["--profile", "workers", "up", "-d", service]);
  const afterCrashIterations = await waitForServiceIterations(
    harness,
    service,
    afterKillBaselineIterations + 1,
  );
  const recovered = await assertWorkflowRunStatus(
    harness,
    token,
    workflow,
    "waiting_approval",
  );
  compose(harness, ["stop", service]);

  const step = recovered.steps.find((item) => item.stepId === "step_1");
  if (step?.output?.runId !== workflow.linkedRunId) {
    throw new Error(
      "Workflow resume crash recovery created a duplicate linked run.",
    );
  }
  const runs = await workflowRuns(harness, token, workflow.workflowId);
  if (runs.filter((item) => item.id === workflow.workflowRunId).length !== 1) {
    throw new Error(
      "Workflow resume crash recovery duplicated the workflow run.",
    );
  }
  return {
    service,
    signal: "SIGKILL",
    killedContainerId,
    workflowId: workflow.workflowId,
    workflowRunId: workflow.workflowRunId,
    linkedRunId: workflow.linkedRunId,
    baselineIterations,
    afterKillBaselineIterations,
    afterCrashIterations,
    recoveredStatus: recovered.status,
  };
}

function killComposeService(harness, service) {
  const containerId = composeOutput(harness, ["ps", "-q", service], {
    allowFailure: true,
  }).stdout.trim();
  if (containerId.length === 0) {
    throw new Error(`${service} did not have a running container to kill.`);
  }
  const result = spawnSync(
    "docker",
    ["kill", "--signal", "KILL", containerId],
    {
      encoding: "utf8",
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `docker kill failed for ${service}: ${result.stdout}\n${result.stderr}`,
    );
  }
  return containerId;
}

function serviceIterationCount(harness, service) {
  const logs = composeOutput(harness, ["logs", "--no-color", service], {
    allowFailure: true,
  });
  return countOccurrences(`${logs.stdout}\n${logs.stderr}`, '"iteration"');
}
