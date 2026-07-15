import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export function plannedBranchProtectionVerification(config) {
  const plan = readPlan(config.planPath);
  return baseEvidence({
    blockers: [],
    checks: [
      {
        name: "live_github_branch_protection_read_required",
        status: "planned",
      },
    ],
    config,
    mode: "dry-run",
    plan,
    status: "planned",
  });
}

export async function collectBranchProtectionVerification(config) {
  const plan = readPlan(config.planPath);
  const blockers = [];
  const checks = [];
  const token = config.token;
  const repository = parseRepository(config.repository);

  if (plan.status !== "passed") {
    addBlocker(
      blockers,
      "branch_protection_plan_not_passed",
      "Branch-protection plan must pass before live verification.",
    );
  }
  if (token === undefined || token.length === 0) {
    addBlocker(
      blockers,
      "github_token_missing",
      "GITHUB_TOKEN or GH_TOKEN is required for live branch-protection verification.",
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
      status: "blocked",
    });
  }

  const response = await fetchProtection(config, repository, token);
  if (!response.ok) {
    addBlocker(
      blockers,
      "github_branch_protection_read_failed",
      "GitHub branch-protection API read did not return success.",
      { status: response.status },
    );
    return baseEvidence({
      blockers,
      checks,
      config,
      mode: "live_github_api",
      plan,
      status: "blocked",
    });
  }

  const protection = await response.json();
  evaluateProtection({ blockers, checks, plan, protection });
  return baseEvidence({
    blockers,
    checks,
    config,
    mode: "live_github_api",
    plan,
    status: blockers.length === 0 ? "passed" : "blocked",
  });
}

function evaluateProtection({ blockers, checks, plan, protection }) {
  const policy = plan.policy ?? {};
  const reviews = protection.required_pull_request_reviews;
  checkBoolean({
    blockers,
    checks,
    code: "pull_request_reviews_missing",
    name: "pull request reviews required",
    value: reviews !== undefined,
  });
  if (reviews !== undefined) {
    checkBoolean({
      blockers,
      checks,
      code: "dismiss_stale_approvals_disabled",
      name: "stale approval dismissal enabled",
      value:
        policy.dismissStaleApprovals !== true ||
        reviews.dismiss_stale_reviews === true,
    });
    checkBoolean({
      blockers,
      checks,
      code: "code_owner_reviews_disabled",
      name: "code owner reviews enabled",
      value:
        policy.requireCodeOwnerReviews !== true ||
        reviews.require_code_owner_reviews === true,
    });
    const requiredApprovals = Number(policy.requiredApprovingReviewCount ?? 0);
    checkBoolean({
      blockers,
      checks,
      code: "required_approval_count_too_low",
      name: "required approving review count enforced",
      value:
        Number(reviews.required_approving_review_count ?? 0) >=
        requiredApprovals,
    });
  }

  const statusChecks = protection.required_status_checks;
  checkBoolean({
    blockers,
    checks,
    code: "required_status_checks_missing",
    name: "required status checks configured",
    value: statusChecks !== undefined,
  });
  if (statusChecks !== undefined) {
    checkBoolean({
      blockers,
      checks,
      code: "status_checks_not_strict",
      name: "status checks require up-to-date branch",
      value:
        policy.requireUpToDateBeforeMerge !== true ||
        statusChecks.strict === true,
    });
    const configuredNames = statusCheckNames(statusChecks);
    const expectedNames = plan.requiredStatusChecks
      .map((item) => item.name)
      .filter((value) => typeof value === "string" && value.length > 0);
    const missing = expectedNames.filter((name) => !configuredNames.has(name));
    checkBoolean({
      blockers,
      checks,
      code: "required_status_check_missing",
      details: { missingCount: missing.length, missingNames: missing },
      name: "all planned status checks required",
      value: missing.length === 0,
    });
  }

  checkBoolean({
    blockers,
    checks,
    code: "linear_history_disabled",
    name: "linear history required",
    value:
      policy.requireLinearHistory !== true ||
      protection.required_linear_history?.enabled === true,
  });
  checkBoolean({
    blockers,
    checks,
    code: "signed_commits_disabled",
    name: "signed commits required",
    value:
      policy.requireSignedCommits !== true ||
      protection.required_signatures?.enabled === true,
  });
  checkBoolean({
    blockers,
    checks,
    code: "conversation_resolution_disabled",
    name: "conversation resolution required",
    value:
      policy.requireConversationResolution !== true ||
      protection.required_conversation_resolution?.enabled === true,
  });
  checkBoolean({
    blockers,
    checks,
    code: "admin_enforcement_disabled",
    name: "administrator enforcement enabled",
    value: protection.enforce_admins?.enabled === true,
  });
}

async function fetchProtection(config, repository, token) {
  const timeoutMs = positiveInteger(config.timeoutMs ?? 30_000, "timeoutMs");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const url = branchProtectionUrl(config.apiUrl, repository, config.branch);
  try {
    return await (config.fetchImpl ?? fetch)(url, {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "user-agent": "RomeoBranchProtectionVerifier/0.1",
        "x-github-api-version": "2022-11-28",
      },
      signal: controller.signal,
    });
  } catch {
    return new Response("{}", { status: 599 });
  } finally {
    clearTimeout(timeout);
  }
}

function baseEvidence({ blockers, checks, config, mode, plan, status }) {
  return {
    schemaVersion: "romeo.branch-protection-verification.v1",
    generatedAt: new Date().toISOString(),
    status,
    mode,
    provider: "github",
    target: {
      apiOrigin: safeOrigin(config.apiUrl ?? "https://api.github.com"),
      branch: config.branch,
      repositoryHash:
        config.repository === undefined ? undefined : sha256(config.repository),
      repositorySlugReturned: false,
    },
    plan: {
      file: safeRelativePath(config.planPath),
      sha256: sha256File(config.planPath),
      status: plan.status,
      requiredStatusCheckCount: Array.isArray(plan.requiredStatusChecks)
        ? plan.requiredStatusChecks.length
        : 0,
      policy: {
        requirePullRequest: plan.policy?.requirePullRequest === true,
        requireConversationResolution:
          plan.policy?.requireConversationResolution === true,
        requireLinearHistory: plan.policy?.requireLinearHistory === true,
        requireSignedCommits: plan.policy?.requireSignedCommits === true,
        requireUpToDateBeforeMerge:
          plan.policy?.requireUpToDateBeforeMerge === true,
        dismissStaleApprovals: plan.policy?.dismissStaleApprovals === true,
        requiredApprovingReviewCount: plan.policy?.requiredApprovingReviewCount,
        requireCodeOwnerReviews: plan.policy?.requireCodeOwnerReviews === true,
      },
    },
    checks,
    blockers,
    redaction: {
      commandOutputReturned: false,
      rawApiResponseReturned: false,
      rawEnvironmentValuesReturned: false,
      repositorySlugReturned: false,
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

function statusCheckNames(statusChecks) {
  return new Set([
    ...array(statusChecks.contexts).filter((item) => typeof item === "string"),
    ...array(statusChecks.checks)
      .map((item) => item?.context)
      .filter((item) => typeof item === "string"),
  ]);
}

function branchProtectionUrl(apiUrl, repository, branch) {
  const base = new URL(apiUrl ?? "https://api.github.com");
  base.pathname = [
    trimSlashes(base.pathname),
    "repos",
    encodeURIComponent(repository.owner),
    encodeURIComponent(repository.name),
    "branches",
    encodeURIComponent(branch),
    "protection",
  ]
    .filter(Boolean)
    .join("/");
  base.search = "";
  base.hash = "";
  return base.toString();
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
