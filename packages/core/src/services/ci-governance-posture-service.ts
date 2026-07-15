import { assertScope, type AuthSubject } from "@romeo/auth";
import type { RomeoEnv } from "@romeo/config";
import { readFile } from "node:fs/promises";

const planRedactionFlags = [
  "workflowBodyIncluded",
  "secretValuesIncluded",
  "tokenValuesIncluded",
  "environmentValuesIncluded",
] as const;

const hostedRunRedactionFlags = [
  "rawApiResponseReturned",
  "rawEnvironmentValuesReturned",
  "rawJobLogsReturned",
  "repositorySlugReturned",
  "runUrlReturned",
  "tokenValuesReturned",
] as const;

const branchProtectionRedactionFlags = [
  "commandOutputReturned",
  "rawApiResponseReturned",
  "rawEnvironmentValuesReturned",
  "repositorySlugReturned",
  "tokenValuesReturned",
] as const;

type CiGovernanceInvalidReason =
  | "invalid_json"
  | "read_failed"
  | "schema_mismatch";

export type CiGovernancePostureWarning =
  | "ci_branch_protection_plan_blocked"
  | "ci_branch_protection_plan_invalid"
  | "ci_branch_protection_plan_not_configured"
  | "ci_branch_protection_verification_failed"
  | "ci_branch_protection_verification_invalid"
  | "ci_branch_protection_verification_not_configured"
  | "ci_branch_protection_verification_not_live"
  | "ci_governance_evidence_missing"
  | "ci_governance_redaction_flags_unsafe"
  | "ci_hosted_run_verification_failed"
  | "ci_hosted_run_verification_invalid"
  | "ci_hosted_run_verification_not_configured"
  | "ci_hosted_run_verification_not_live";

export interface CiGovernancePostureReport {
  schema: "romeo.ci-governance-posture.v1";
  generatedAt: string;
  orgId: string;
  status: "attention_required" | "ready";
  summary: {
    planReady: boolean;
    hostedRunVerified: boolean;
    branchProtectionVerified: boolean;
    requiredStatusCheckCount: number;
    requiredWorkflowCommandCount: number;
    totalCheckCount: number;
    passedCheckCount: number;
    failedCheckCount: number;
    plannedCheckCount: number;
    blockerCount: number;
  };
  plan: CiGovernanceBranchProtectionPlanPosture;
  hostedRun: CiGovernanceHostedRunPosture;
  branchProtection: CiGovernanceBranchProtectionPosture;
  redaction: {
    branchNamesReturned: false;
    evidenceFileBodiesReturned: false;
    jobLogsReturned: false;
    rawApiResponsesReturned: false;
    rawEvidencePathsReturned: false;
    rawStatusCheckNamesReturned: false;
    repositorySlugsReturned: false;
    runUrlsReturned: false;
    secretValuesReturned: false;
    tokenValuesReturned: false;
    workflowBodiesReturned: false;
  };
  warnings: CiGovernancePostureWarning[];
}

export interface CiGovernanceBranchProtectionPlanPosture {
  configured: boolean;
  source: "configured_file" | "not_configured";
  status: "blocked" | "invalid" | "not_configured" | "passed";
  schemaVersion?: "romeo.branch-protection-plan.v1";
  generatedAt?: string;
  invalidReason?: CiGovernanceInvalidReason;
  provider?: "github" | "unknown";
  workflow: {
    configured: boolean;
    jobCount: number;
  };
  policy: CiGovernancePolicySummary;
  requiredStatusCheckCount: number;
  requiredWorkflowCommandCount: number;
  checks: CiGovernanceCheckSummary;
  blockers: CiGovernanceBlockerSummary;
  redactionSafe: boolean;
}

export interface CiGovernanceHostedRunPosture {
  configured: boolean;
  source: "configured_file" | "not_configured";
  status: "blocked" | "invalid" | "not_configured" | "passed" | "planned";
  schemaVersion?: "romeo.hosted-ci-run-verification.v1";
  generatedAt?: string;
  mode?: "dry-run" | "live_github_api" | "unknown";
  invalidReason?: CiGovernanceInvalidReason;
  provider?: "github_actions" | "unknown";
  plan: {
    status?: "blocked" | "passed" | "planned" | "unknown";
    requiredStatusCheckCount: number;
  };
  run: {
    observed: boolean;
    completed: boolean;
    successful: boolean;
  };
  jobs: {
    inventoryRead: boolean;
    observedJobCount: number;
    missingRequiredJobCount: number;
    failedRequiredJobCount: number;
  };
  checks: CiGovernanceCheckSummary;
  blockers: CiGovernanceBlockerSummary;
  redactionSafe: boolean;
}

export interface CiGovernanceBranchProtectionPosture {
  configured: boolean;
  source: "configured_file" | "not_configured";
  status: "blocked" | "invalid" | "not_configured" | "passed" | "planned";
  schemaVersion?: "romeo.branch-protection-verification.v1";
  generatedAt?: string;
  mode?: "dry-run" | "live_github_api" | "unknown";
  invalidReason?: CiGovernanceInvalidReason;
  provider?: "github" | "unknown";
  plan: {
    status?: "blocked" | "passed" | "planned" | "unknown";
    requiredStatusCheckCount: number;
    policy: CiGovernancePolicySummary;
  };
  controls: {
    evaluatedCount: number;
    passedCount: number;
    failedCount: number;
    plannedCount: number;
  };
  checks: CiGovernanceCheckSummary;
  blockers: CiGovernanceBlockerSummary;
  redactionSafe: boolean;
}

export interface CiGovernancePolicySummary {
  requirePullRequest: boolean;
  requireConversationResolution: boolean;
  requireLinearHistory: boolean;
  requireSignedCommits: boolean;
  requireUpToDateBeforeMerge: boolean;
  dismissStaleApprovals: boolean;
  restrictBypassToReleaseAdmins: boolean;
  requireCodeOwnerReviews: boolean;
  requiredApprovingReviewCount?: number;
}

export interface CiGovernanceCheckSummary {
  total: number;
  passed: number;
  failed: number;
  planned: number;
  unknown: number;
}

export interface CiGovernanceBlockerSummary {
  total: number;
  codes: string[];
}

export class CiGovernancePostureService {
  constructor(private readonly env: RomeoEnv) {}

  async report(subject: AuthSubject): Promise<CiGovernancePostureReport> {
    assertScope(subject, "admin:read");

    const plan = await summarizePlan(this.env.CI_BRANCH_PROTECTION_PLAN_PATH);
    const hostedRun = await summarizeHostedRun(
      this.env.CI_HOSTED_RUN_VERIFICATION_PATH,
    );
    const branchProtection = await summarizeBranchProtection(
      this.env.CI_BRANCH_PROTECTION_VERIFICATION_PATH,
    );
    const warnings = ciGovernanceWarnings({
      branchProtection,
      hostedRun,
      plan,
    });
    const totalChecks = [
      plan.checks,
      hostedRun.checks,
      branchProtection.checks,
    ];

    return {
      schema: "romeo.ci-governance-posture.v1",
      generatedAt: new Date().toISOString(),
      orgId: subject.orgId,
      status: warnings.length === 0 ? "ready" : "attention_required",
      summary: {
        planReady: plan.status === "passed",
        hostedRunVerified: hostedRun.status === "passed",
        branchProtectionVerified: branchProtection.status === "passed",
        requiredStatusCheckCount: Math.max(
          plan.requiredStatusCheckCount,
          hostedRun.plan.requiredStatusCheckCount,
          branchProtection.plan.requiredStatusCheckCount,
        ),
        requiredWorkflowCommandCount: plan.requiredWorkflowCommandCount,
        totalCheckCount: sumChecks(totalChecks, "total"),
        passedCheckCount: sumChecks(totalChecks, "passed"),
        failedCheckCount: sumChecks(totalChecks, "failed"),
        plannedCheckCount: sumChecks(totalChecks, "planned"),
        blockerCount:
          plan.blockers.total +
          hostedRun.blockers.total +
          branchProtection.blockers.total,
      },
      plan,
      hostedRun,
      branchProtection,
      redaction: ciGovernanceRedaction(),
      warnings,
    };
  }
}

async function summarizePlan(
  evidencePath: string,
): Promise<CiGovernanceBranchProtectionPlanPosture> {
  const configuredPath = evidencePath.trim();
  if (configuredPath.length === 0) {
    return emptyPlan("not_configured", [], true);
  }

  const result = await readJson(configuredPath);
  if (result.status === "invalid") {
    return emptyPlan(
      "invalid",
      [result.invalidReason],
      false,
      result.invalidReason,
    );
  }

  const data = result.data;
  if (data.schemaVersion !== "romeo.branch-protection-plan.v1") {
    return emptyPlan("invalid", ["schema_mismatch"], false, "schema_mismatch");
  }

  const checks = checkSummary(data.checks);
  const blockers = blockerSummary(data.blockers);
  const redactionSafe = allRedactionFlagsFalse(
    data.redaction,
    planRedactionFlags,
  );
  const status =
    stringValue(data.status) === "passed" &&
    blockers.total === 0 &&
    redactionSafe
      ? "passed"
      : "blocked";
  const workflow = recordValue(data.workflow);
  const policy = policySummary(data.policy);
  const generatedAt = stringValue(data.generatedAt);

  return {
    configured: true,
    source: "configured_file",
    status,
    schemaVersion: "romeo.branch-protection-plan.v1",
    ...(generatedAt === undefined ? {} : { generatedAt }),
    provider: providerValue(data.provider, "github"),
    workflow: {
      configured: stringValue(workflow.name) !== undefined,
      jobCount: numberValue(workflow.jobCount) ?? 0,
    },
    policy,
    requiredStatusCheckCount: recordArray(data.requiredStatusChecks).length,
    requiredWorkflowCommandCount: namedCheckCount(
      data.checks,
      "workflow runs ",
    ),
    checks,
    blockers,
    redactionSafe,
  };
}

function emptyPlan(
  status: "invalid" | "not_configured",
  failureCodes: string[],
  redactionSafe: boolean,
  invalidReason?: CiGovernanceInvalidReason,
): CiGovernanceBranchProtectionPlanPosture {
  return {
    configured: status !== "not_configured",
    source: status === "not_configured" ? "not_configured" : "configured_file",
    status,
    ...(invalidReason === undefined ? {} : { invalidReason }),
    workflow: { configured: false, jobCount: 0 },
    policy: emptyPolicySummary(),
    requiredStatusCheckCount: 0,
    requiredWorkflowCommandCount: 0,
    checks: emptyCheckSummary(),
    blockers: { total: failureCodes.length, codes: failureCodes },
    redactionSafe,
  };
}

async function summarizeHostedRun(
  evidencePath: string,
): Promise<CiGovernanceHostedRunPosture> {
  const configuredPath = evidencePath.trim();
  if (configuredPath.length === 0) {
    return emptyHostedRun("not_configured", [], true);
  }

  const result = await readJson(configuredPath);
  if (result.status === "invalid") {
    return emptyHostedRun(
      "invalid",
      [result.invalidReason],
      false,
      result.invalidReason,
    );
  }

  const data = result.data;
  if (data.schemaVersion !== "romeo.hosted-ci-run-verification.v1") {
    return emptyHostedRun(
      "invalid",
      ["schema_mismatch"],
      false,
      "schema_mismatch",
    );
  }

  const mode = liveEvidenceMode(data.mode);
  const checks = checkSummary(data.checks);
  const blockers = blockerSummary(data.blockers);
  const redactionSafe = allRedactionFlagsFalse(
    data.redaction,
    hostedRunRedactionFlags,
  );
  const evidenceStatus = evidenceStatusValue(data.status);
  const status = liveEvidencePostureStatus({
    blockers,
    evidenceStatus,
    mode,
    redactionSafe,
  });
  const plan = recordValue(data.plan);
  const run = recordValue(data.run);
  const generatedAt = stringValue(data.generatedAt);

  return {
    configured: true,
    source: "configured_file",
    status,
    schemaVersion: "romeo.hosted-ci-run-verification.v1",
    ...(generatedAt === undefined ? {} : { generatedAt }),
    mode,
    provider: providerValue(data.provider, "github_actions"),
    plan: {
      status: evidenceStatusValue(plan.status),
      requiredStatusCheckCount: numberValue(plan.requiredStatusCheckCount) ?? 0,
    },
    run: {
      observed: isRecord(data.run),
      completed: stringValue(run.status) === "completed",
      successful: stringValue(run.conclusion) === "success",
    },
    jobs: hostedRunJobSummary(data.checks),
    checks,
    blockers,
    redactionSafe,
  };
}

function emptyHostedRun(
  status: "invalid" | "not_configured",
  failureCodes: string[],
  redactionSafe: boolean,
  invalidReason?: CiGovernanceInvalidReason,
): CiGovernanceHostedRunPosture {
  return {
    configured: status !== "not_configured",
    source: status === "not_configured" ? "not_configured" : "configured_file",
    status,
    ...(invalidReason === undefined ? {} : { invalidReason }),
    plan: { requiredStatusCheckCount: 0 },
    run: { observed: false, completed: false, successful: false },
    jobs: {
      inventoryRead: false,
      observedJobCount: 0,
      missingRequiredJobCount: 0,
      failedRequiredJobCount: 0,
    },
    checks: emptyCheckSummary(),
    blockers: { total: failureCodes.length, codes: failureCodes },
    redactionSafe,
  };
}

async function summarizeBranchProtection(
  evidencePath: string,
): Promise<CiGovernanceBranchProtectionPosture> {
  const configuredPath = evidencePath.trim();
  if (configuredPath.length === 0) {
    return emptyBranchProtection("not_configured", [], true);
  }

  const result = await readJson(configuredPath);
  if (result.status === "invalid") {
    return emptyBranchProtection(
      "invalid",
      [result.invalidReason],
      false,
      result.invalidReason,
    );
  }

  const data = result.data;
  if (data.schemaVersion !== "romeo.branch-protection-verification.v1") {
    return emptyBranchProtection(
      "invalid",
      ["schema_mismatch"],
      false,
      "schema_mismatch",
    );
  }

  const mode = liveEvidenceMode(data.mode);
  const checks = checkSummary(data.checks);
  const blockers = blockerSummary(data.blockers);
  const redactionSafe = allRedactionFlagsFalse(
    data.redaction,
    branchProtectionRedactionFlags,
  );
  const evidenceStatus = evidenceStatusValue(data.status);
  const status = liveEvidencePostureStatus({
    blockers,
    evidenceStatus,
    mode,
    redactionSafe,
  });
  const plan = recordValue(data.plan);
  const generatedAt = stringValue(data.generatedAt);

  return {
    configured: true,
    source: "configured_file",
    status,
    schemaVersion: "romeo.branch-protection-verification.v1",
    ...(generatedAt === undefined ? {} : { generatedAt }),
    mode,
    provider: providerValue(data.provider, "github"),
    plan: {
      status: evidenceStatusValue(plan.status),
      requiredStatusCheckCount: numberValue(plan.requiredStatusCheckCount) ?? 0,
      policy: policySummary(recordValue(plan.policy)),
    },
    controls: {
      evaluatedCount: checks.passed + checks.failed,
      passedCount: checks.passed,
      failedCount: checks.failed,
      plannedCount: checks.planned,
    },
    checks,
    blockers,
    redactionSafe,
  };
}

function emptyBranchProtection(
  status: "invalid" | "not_configured",
  failureCodes: string[],
  redactionSafe: boolean,
  invalidReason?: CiGovernanceInvalidReason,
): CiGovernanceBranchProtectionPosture {
  return {
    configured: status !== "not_configured",
    source: status === "not_configured" ? "not_configured" : "configured_file",
    status,
    ...(invalidReason === undefined ? {} : { invalidReason }),
    plan: {
      requiredStatusCheckCount: 0,
      policy: emptyPolicySummary(),
    },
    controls: {
      evaluatedCount: 0,
      passedCount: 0,
      failedCount: 0,
      plannedCount: 0,
    },
    checks: emptyCheckSummary(),
    blockers: { total: failureCodes.length, codes: failureCodes },
    redactionSafe,
  };
}

function ciGovernanceWarnings(input: {
  plan: CiGovernanceBranchProtectionPlanPosture;
  hostedRun: CiGovernanceHostedRunPosture;
  branchProtection: CiGovernanceBranchProtectionPosture;
}): CiGovernancePostureWarning[] {
  const warnings: CiGovernancePostureWarning[] = [];
  if (
    !input.plan.configured &&
    !input.hostedRun.configured &&
    !input.branchProtection.configured
  ) {
    warnings.push("ci_governance_evidence_missing");
  }

  if (input.plan.status === "not_configured") {
    warnings.push("ci_branch_protection_plan_not_configured");
  } else if (input.plan.status === "invalid") {
    warnings.push("ci_branch_protection_plan_invalid");
  } else if (input.plan.status === "blocked") {
    warnings.push("ci_branch_protection_plan_blocked");
  }

  if (input.hostedRun.status === "not_configured") {
    warnings.push("ci_hosted_run_verification_not_configured");
  } else if (input.hostedRun.status === "invalid") {
    warnings.push("ci_hosted_run_verification_invalid");
  } else if (input.hostedRun.status === "planned") {
    warnings.push("ci_hosted_run_verification_not_live");
  } else if (input.hostedRun.status === "blocked") {
    warnings.push("ci_hosted_run_verification_failed");
  }

  if (input.branchProtection.status === "not_configured") {
    warnings.push("ci_branch_protection_verification_not_configured");
  } else if (input.branchProtection.status === "invalid") {
    warnings.push("ci_branch_protection_verification_invalid");
  } else if (input.branchProtection.status === "planned") {
    warnings.push("ci_branch_protection_verification_not_live");
  } else if (input.branchProtection.status === "blocked") {
    warnings.push("ci_branch_protection_verification_failed");
  }

  if (
    !input.plan.redactionSafe ||
    !input.hostedRun.redactionSafe ||
    !input.branchProtection.redactionSafe
  ) {
    warnings.push("ci_governance_redaction_flags_unsafe");
  }

  return [...new Set(warnings)];
}

function liveEvidencePostureStatus(input: {
  blockers: CiGovernanceBlockerSummary;
  evidenceStatus: "blocked" | "passed" | "planned" | "unknown";
  mode: "dry-run" | "live_github_api" | "unknown";
  redactionSafe: boolean;
}): "blocked" | "passed" | "planned" {
  if (input.mode === "dry-run" || input.evidenceStatus === "planned") {
    return "planned";
  }
  return input.evidenceStatus === "passed" &&
    input.blockers.total === 0 &&
    input.redactionSafe
    ? "passed"
    : "blocked";
}

function ciGovernanceRedaction(): CiGovernancePostureReport["redaction"] {
  return {
    branchNamesReturned: false,
    evidenceFileBodiesReturned: false,
    jobLogsReturned: false,
    rawApiResponsesReturned: false,
    rawEvidencePathsReturned: false,
    rawStatusCheckNamesReturned: false,
    repositorySlugsReturned: false,
    runUrlsReturned: false,
    secretValuesReturned: false,
    tokenValuesReturned: false,
    workflowBodiesReturned: false,
  };
}

type ReadJsonResult =
  | { status: "valid"; data: Record<string, unknown> }
  | { status: "invalid"; invalidReason: CiGovernanceInvalidReason };

async function readJson(path: string): Promise<ReadJsonResult> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return { status: "invalid", invalidReason: "read_failed" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: "invalid", invalidReason: "invalid_json" };
  }

  if (!isRecord(parsed)) {
    return { status: "invalid", invalidReason: "schema_mismatch" };
  }
  return { status: "valid", data: parsed };
}

function checkSummary(value: unknown): CiGovernanceCheckSummary {
  return recordArray(value).reduce<CiGovernanceCheckSummary>(
    (summary, check) => {
      summary.total += 1;
      const status = stringValue(check.status);
      if (status === "pass") summary.passed += 1;
      else if (status === "fail") summary.failed += 1;
      else if (status === "planned") summary.planned += 1;
      else summary.unknown += 1;
      return summary;
    },
    emptyCheckSummary(),
  );
}

function emptyCheckSummary(): CiGovernanceCheckSummary {
  return { total: 0, passed: 0, failed: 0, planned: 0, unknown: 0 };
}

function blockerSummary(value: unknown): CiGovernanceBlockerSummary {
  const codes = recordArray(value)
    .map((blocker) => stringValue(blocker.code))
    .filter((code): code is string => code !== undefined && code.length > 0);
  return { total: codes.length, codes };
}

function hostedRunJobSummary(
  value: unknown,
): CiGovernanceHostedRunPosture["jobs"] {
  const checks = recordArray(value);
  const inventory = checks.find(
    (check) => stringValue(check.name) === "hosted CI job inventory read",
  );
  const missing = checks.find(
    (check) => stringValue(check.name) === "all required CI jobs present",
  );
  const failed = checks.find(
    (check) => stringValue(check.name) === "all required CI jobs successful",
  );
  return {
    inventoryRead: stringValue(inventory?.status) === "pass",
    observedJobCount: numberValue(inventory?.jobCount) ?? 0,
    missingRequiredJobCount: numberValue(missing?.missingCount) ?? 0,
    failedRequiredJobCount: numberValue(failed?.failedCount) ?? 0,
  };
}

function namedCheckCount(value: unknown, prefix: string): number {
  return recordArray(value).filter((check) =>
    stringValue(check.name)?.startsWith(prefix),
  ).length;
}

function sumChecks(
  summaries: CiGovernanceCheckSummary[],
  key: keyof CiGovernanceCheckSummary,
): number {
  return summaries.reduce((total, summary) => total + summary[key], 0);
}

function policySummary(value: unknown): CiGovernancePolicySummary {
  const policy = recordValue(value);
  const requiredApprovingReviewCount = numberValue(
    policy.requiredApprovingReviewCount,
  );
  return {
    requirePullRequest: policy.requirePullRequest === true,
    requireConversationResolution:
      policy.requireConversationResolution === true,
    requireLinearHistory: policy.requireLinearHistory === true,
    requireSignedCommits: policy.requireSignedCommits === true,
    requireUpToDateBeforeMerge: policy.requireUpToDateBeforeMerge === true,
    dismissStaleApprovals: policy.dismissStaleApprovals === true,
    restrictBypassToReleaseAdmins:
      policy.restrictBypassToReleaseAdmins === true,
    requireCodeOwnerReviews: policy.requireCodeOwnerReviews === true,
    ...(requiredApprovingReviewCount === undefined
      ? {}
      : { requiredApprovingReviewCount }),
  };
}

function emptyPolicySummary(): CiGovernancePolicySummary {
  return {
    requirePullRequest: false,
    requireConversationResolution: false,
    requireLinearHistory: false,
    requireSignedCommits: false,
    requireUpToDateBeforeMerge: false,
    dismissStaleApprovals: false,
    restrictBypassToReleaseAdmins: false,
    requireCodeOwnerReviews: false,
  };
}

function allRedactionFlagsFalse(
  value: unknown,
  flags: readonly string[],
): boolean {
  const redaction = recordValue(value);
  return flags.every((flag) => redaction[flag] === false);
}

function providerValue<T extends string>(
  value: unknown,
  expected: T,
): T | "unknown" {
  return value === expected ? expected : "unknown";
}

function liveEvidenceMode(
  value: unknown,
): "dry-run" | "live_github_api" | "unknown" {
  return value === "dry-run" || value === "live_github_api" ? value : "unknown";
}

function evidenceStatusValue(
  value: unknown,
): "blocked" | "passed" | "planned" | "unknown" {
  if (value === "blocked" || value === "passed" || value === "planned") {
    return value;
  }
  return "unknown";
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => isRecord(item))
    : [];
}

function recordValue(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return Number.isFinite(value) ? Number(value) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
