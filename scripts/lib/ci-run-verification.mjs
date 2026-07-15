import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export function plannedCiRunVerification(config) {
  const plan = readPlan(config.planPath);
  return baseEvidence({
    blockers: [],
    checks: [
      {
        name: "live_github_actions_run_read_required",
        status: "planned",
      },
    ],
    config,
    mode: "dry-run",
    plan,
    run: undefined,
    status: "planned",
  });
}

export async function collectCiRunVerification(config) {
  const plan = readPlan(config.planPath);
  const blockers = [];
  const checks = [];
  const repository = parseRepository(config.repository);
  const token = config.token;

  if (plan.status !== "passed") {
    addBlocker(
      blockers,
      "branch_protection_plan_not_passed",
      "Branch-protection plan must pass before hosted CI verification.",
    );
  }
  if (token === undefined || token.length === 0) {
    addBlocker(
      blockers,
      "github_token_missing",
      "GITHUB_TOKEN or GH_TOKEN is required for hosted CI verification.",
    );
  }
  if (repository === undefined) {
    addBlocker(
      blockers,
      "github_repository_missing",
      "GITHUB_REPOSITORY or --repo owner/name is required.",
    );
  }
  if (blockers.length > 0) {
    return baseEvidence({
      blockers,
      checks,
      config,
      mode: "live_github_api",
      plan,
      run: undefined,
      status: "blocked",
    });
  }

  const run = await selectedWorkflowRun(config, repository, token);
  if (run.statusCode !== 200 || run.value === undefined) {
    addBlocker(
      blockers,
      "github_workflow_run_read_failed",
      "GitHub workflow run read did not return success.",
      { status: run.statusCode },
    );
    return baseEvidence({
      blockers,
      checks,
      config,
      mode: "live_github_api",
      plan,
      run: undefined,
      status: "blocked",
    });
  }

  evaluateRun({ blockers, checks, config, run: run.value });
  const jobs = await workflowRunJobs(config, repository, token, run.value.id);
  if (jobs.statusCode !== 200) {
    addBlocker(
      blockers,
      "github_workflow_jobs_read_failed",
      "GitHub workflow jobs read did not return success.",
      { status: jobs.statusCode },
    );
  } else {
    evaluateJobs({ blockers, checks, jobs: jobs.value, plan });
  }

  return baseEvidence({
    blockers,
    checks,
    config,
    mode: "live_github_api",
    plan,
    run: run.value,
    status: blockers.length === 0 ? "passed" : "blocked",
  });
}

async function selectedWorkflowRun(config, repository, token) {
  if (config.runId !== undefined && config.runId.length > 0) {
    return fetchJson(config, token, workflowRunUrl(config, repository));
  }
  const response = await fetchJson(
    config,
    token,
    workflowRunsUrl(config, repository),
  );
  if (response.statusCode !== 200) return response;
  const runs = array(response.value?.workflow_runs);
  const selected = runs.find((run) => run.status === "completed") ?? runs[0];
  return { statusCode: selected === undefined ? 404 : 200, value: selected };
}

async function workflowRunJobs(config, repository, token, runId) {
  const jobs = [];
  let totalCount = undefined;
  for (let page = 1; page <= 10; page += 1) {
    const response = await fetchJson(
      config,
      token,
      workflowRunJobsUrl(config, repository, runId, page),
    );
    if (response.statusCode !== 200) return response;
    totalCount = response.value?.total_count;
    jobs.push(...array(response.value?.jobs));
    if (typeof totalCount === "number" && jobs.length >= totalCount) break;
    if (array(response.value?.jobs).length === 0) break;
  }
  return { statusCode: 200, value: jobs };
}

function evaluateRun({ blockers, checks, config, run }) {
  checkBoolean({
    blockers,
    checks,
    code: "workflow_run_not_completed",
    name: "workflow run completed",
    value: run.status === "completed",
  });
  checkBoolean({
    blockers,
    checks,
    code: "workflow_run_not_successful",
    name: "workflow run conclusion successful",
    value: run.conclusion === "success",
  });
  checkBoolean({
    blockers,
    checks,
    code: "workflow_name_mismatch",
    name: "workflow run name matches plan",
    value: run.name === undefined || run.name === config.workflowName,
  });
  if (config.headSha !== undefined && config.headSha.length > 0) {
    checkBoolean({
      blockers,
      checks,
      code: "workflow_run_head_sha_mismatch",
      name: "workflow run head SHA matches expected release input",
      value: run.head_sha === config.headSha,
    });
  }
}

function evaluateJobs({ blockers, checks, jobs, plan }) {
  const jobsByName = new Map(
    jobs
      .map((job) => [job.name, job])
      .filter(([name]) => typeof name === "string" && name.length > 0),
  );
  const requiredNames = plan.requiredStatusChecks
    .map((item) => item.name)
    .filter((name) => typeof name === "string" && name.length > 0);
  const missing = requiredNames.filter((name) => !jobsByName.has(name));
  const failed = requiredNames.filter((name) => {
    const job = jobsByName.get(name);
    return job !== undefined && job.conclusion !== "success";
  });
  checkBoolean({
    blockers,
    checks,
    code: "required_ci_job_missing",
    details: { missingCount: missing.length, missingNames: missing },
    name: "all required CI jobs present",
    value: missing.length === 0,
  });
  checkBoolean({
    blockers,
    checks,
    code: "required_ci_job_not_successful",
    details: { failedCount: failed.length, failedNames: failed },
    name: "all required CI jobs successful",
    value: failed.length === 0,
  });
  checks.push({
    name: "hosted CI job inventory read",
    status: "pass",
    jobCount: jobs.length,
  });
}

async function fetchJson(config, token, url) {
  const timeoutMs = positiveInteger(config.timeoutMs ?? 30_000, "timeoutMs");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await (config.fetchImpl ?? fetch)(url, {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "user-agent": "RomeoCiRunVerifier/0.1",
        "x-github-api-version": "2022-11-28",
      },
      signal: controller.signal,
    });
    if (!response.ok) return { statusCode: response.status };
    return { statusCode: response.status, value: await response.json() };
  } catch {
    return { statusCode: 599 };
  } finally {
    clearTimeout(timeout);
  }
}

function baseEvidence({ blockers, checks, config, mode, plan, run, status }) {
  return {
    schemaVersion: "romeo.hosted-ci-run-verification.v1",
    generatedAt: new Date().toISOString(),
    status,
    mode,
    provider: "github_actions",
    target: {
      apiOrigin: safeOrigin(config.apiUrl ?? "https://api.github.com"),
      branch: config.branch,
      repositoryHash:
        config.repository === undefined ? undefined : sha256(config.repository),
      repositorySlugReturned: false,
      workflowIdHash: sha256(String(config.workflowId)),
      workflowName: config.workflowName,
    },
    plan: {
      file: safeRelativePath(config.planPath),
      sha256: sha256File(config.planPath),
      status: plan.status,
      requiredStatusCheckCount: Array.isArray(plan.requiredStatusChecks)
        ? plan.requiredStatusChecks.length
        : 0,
    },
    run:
      run === undefined
        ? undefined
        : {
            conclusion: run.conclusion,
            event: run.event,
            headShaHash:
              typeof run.head_sha === "string"
                ? sha256(run.head_sha)
                : undefined,
            idHash: sha256(String(run.id)),
            status: run.status,
          },
    checks,
    blockers,
    redaction: {
      rawApiResponseReturned: false,
      rawEnvironmentValuesReturned: false,
      rawJobLogsReturned: false,
      repositorySlugReturned: false,
      runUrlReturned: false,
      tokenValuesReturned: false,
    },
  };
}

function checkBoolean({ blockers, checks, code, details, name, value }) {
  checks.push({ name, status: value ? "pass" : "fail", ...(details ?? {}) });
  if (!value) addBlocker(blockers, code, name, details);
}

function addBlocker(blockers, code, message, details) {
  if (blockers.some((item) => item.code === code && item.message === message)) {
    return;
  }
  blockers.push({ code, message, ...(details ?? {}) });
}

function workflowRunsUrl(config, repository) {
  const url = apiPathUrl(config, [
    "repos",
    repository.owner,
    repository.name,
    "actions",
    "workflows",
    config.workflowId,
    "runs",
  ]);
  url.searchParams.set("branch", config.branch);
  url.searchParams.set("event", config.event);
  if (config.headSha !== undefined && config.headSha.length > 0) {
    url.searchParams.set("head_sha", config.headSha);
  }
  url.searchParams.set("per_page", "10");
  url.searchParams.set("status", "completed");
  return url.toString();
}

function workflowRunUrl(config, repository) {
  return apiPathUrl(config, [
    "repos",
    repository.owner,
    repository.name,
    "actions",
    "runs",
    config.runId,
  ]).toString();
}

function workflowRunJobsUrl(config, repository, runId, page) {
  const url = apiPathUrl(config, [
    "repos",
    repository.owner,
    repository.name,
    "actions",
    "runs",
    String(runId),
    "jobs",
  ]);
  url.searchParams.set("page", String(page));
  url.searchParams.set("per_page", "100");
  return url.toString();
}

function apiPathUrl(config, parts) {
  const url = new URL(config.apiUrl ?? "https://api.github.com");
  url.pathname = [trimSlashes(url.pathname), ...parts.map(encodeURIComponent)]
    .filter(Boolean)
    .join("/");
  url.search = "";
  url.hash = "";
  return url;
}

function parseRepository(value) {
  if (typeof value !== "string") return undefined;
  const parts = value.split("/");
  if (parts.length !== 2 || parts.some((part) => part.length === 0)) {
    return undefined;
  }
  return { owner: parts[0], name: parts[1] };
}

function readPlan(path) {
  const resolved = resolve(process.cwd(), path);
  if (!existsSync(resolved)) {
    throw new Error(
      `Branch-protection plan not found at ${path}. Run pnpm ci:branch-protection-plan first.`,
    );
  }
  const plan = JSON.parse(readFileSync(resolved, "utf8"));
  if (!Array.isArray(plan.requiredStatusChecks)) {
    throw new Error("Branch-protection plan lacks requiredStatusChecks.");
  }
  return plan;
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return value;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256File(path) {
  return sha256(readFileSync(resolve(process.cwd(), path)));
}

function safeOrigin(value) {
  try {
    return new URL(value).origin;
  } catch {
    return "invalid_url";
  }
}

function safeRelativePath(path) {
  if (typeof path !== "string") return undefined;
  if (path.startsWith("/") || path.includes("..")) return "[redacted-path]";
  return path;
}

function trimSlashes(value) {
  return value.replace(/^\/+|\/+$/gu, "");
}
