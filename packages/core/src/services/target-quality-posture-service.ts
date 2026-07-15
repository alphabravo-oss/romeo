import { assertScope, type AuthSubject } from "@romeo/auth";
import type { RomeoEnv } from "@romeo/config";
import { readFile } from "node:fs/promises";

const targetQualityEvidenceSchema = "romeo.target-quality-evidence.v1";

const requiredTargetQualityChecks = [
  "health_read",
  "admin_analytics_summary_read",
  "admin_analytics_csv_read",
  "analytics_redaction_flags",
  "eval_release_candidate_readback",
  "eval_redaction_flags",
  "eval_gate_passed",
  "retrieval_replay_readback",
  "replay_redaction_flags",
  "forbidden_sentinels_absent",
] as const;

const analyticsRedactionFields = [
  "rawEvalInputsReturned",
  "rawEvalOutputsReturned",
  "rawJobPayloadsReturned",
  "rawProviderConfigReturned",
  "rawToolInputsReturned",
  "rawUsageMetadataReturned",
] as const;

const evalRedactionFields = [
  "rawEvalInputsReturned",
  "rawEvalOutputsReturned",
  "rawHumanRatingCommentsReturned",
  "rawRubricTermsReturned",
] as const;

const replayRedactionFields = [
  "rawQueriesReturned",
  "rawChunkTextReturned",
  "rawExpectedChunkIdsReturned",
  "rawHitIdsReturned",
  "vectorValuesReturned",
] as const;

const topLevelRedactionFields = [
  "rawAnalyticsCsvReturned",
  "rawEvalInputsReturned",
  "rawEvalOutputsReturned",
  "rawEvalAgentIdsReturned",
  "rawEvalWorkspaceIdsReturned",
  "rawReplayQueriesReturned",
  "rawReplayHitIdsReturned",
  "rawSecretsReturned",
] as const;

type TargetQualityRouteModeCounts = {
  external_vector: number;
  legacy_rag_provider: number;
  lexical_fallback: number;
  pgvector: number;
};

type TargetQualityInvalidReason =
  | "invalid_json"
  | "read_failed"
  | "schema_mismatch";

export interface TargetQualityPostureReport {
  schema: "romeo.target-quality-posture.v1";
  generatedAt: string;
  orgId: string;
  status: "attention_required" | "ready";
  evidence: {
    configured: boolean;
    source: "configured_file" | "not_configured";
    status: "failed" | "invalid" | "not_configured" | "planned" | "satisfied";
    schemaVersion?: typeof targetQualityEvidenceSchema;
    generatedAt?: string;
    evidenceStatus?: "failed" | "passed" | "planned" | "unknown";
    mode?: "dry-run" | "live" | "unknown";
    invalidReason?: TargetQualityInvalidReason;
    failureCodes: string[];
  };
  target: {
    deployment: "target-api" | "unknown";
    originConfigured: boolean;
  };
  checks: {
    total: number;
    requiredTotal: number;
    requiredPresent: number;
    missingRequired: string[];
  };
  health: {
    checked: boolean;
    status?: string;
    bodyBytes: number;
  };
  analytics: {
    status: "failed" | "passed" | "unknown";
    summaryStatus?: string;
    evalStatus?: string;
    evalSuiteCount: number;
    evalRunCount: number;
    usageEventCount: number;
    providerStatus?: string;
    jobStatus?: string;
    toolCallCount: number;
    csvBytes: number;
    csvSha256Present: boolean;
    redactionPassed: boolean;
  };
  evals: {
    reportCount: number;
    passedReportCount: number;
    gatePassedCount: number;
    publishBlockedCount: number;
    failedSuiteCount: number;
    missingSuiteCount: number;
    reasonCodes: string[];
    redactionPassed: boolean;
  };
  replay: {
    checked: boolean;
    status: "failed" | "passed" | "unknown";
    kind?: "compare" | "single";
    outcome?: string;
    replayStatus?: string;
    caseCount: number;
    matchedExpectedChunkCount: number;
    averagePrecision?: number | null;
    averageRecall?: number | null;
    routeModeCounts: {
      baseline?: TargetQualityRouteModeCounts;
      candidate?: TargetQualityRouteModeCounts;
      single?: TargetQualityRouteModeCounts;
    };
    vectorComparison?: {
      required: boolean;
      status: "failed" | "passed" | "unknown";
      expectedBaselineRouteMode?: "external_vector" | "pgvector" | "unknown";
      expectedCandidateRouteMode?: "external_vector" | "pgvector" | "unknown";
      baselineMatchedCount: number;
      candidateMatchedCount: number;
      baselineTotalRouteCount: number;
      candidateTotalRouteCount: number;
    };
    redactionPassed: boolean;
  };
  redaction: {
    evidenceFileBodyReturned: false;
    rawAnalyticsCsvReturned: false;
    rawEvalAgentIdsReturned: false;
    rawEvalInputsReturned: false;
    rawEvalOutputsReturned: false;
    rawEvalWorkspaceIdsReturned: false;
    rawEvidencePathReturned: false;
    rawReplayHitIdsReturned: false;
    rawReplayQueriesReturned: false;
    rawSecretsReturned: false;
    rawTargetUrlReturned: false;
  };
  warnings: Array<
    | "target_quality_analytics_missing"
    | "target_quality_eval_gate_not_passed"
    | "target_quality_evidence_failed"
    | "target_quality_evidence_invalid"
    | "target_quality_evidence_not_configured"
    | "target_quality_evidence_not_live"
    | "target_quality_health_not_ok"
    | "target_quality_redaction_missing"
    | "target_quality_replay_missing"
  >;
}

export class TargetQualityPostureService {
  constructor(private readonly env: RomeoEnv) {}

  async report(subject: AuthSubject): Promise<TargetQualityPostureReport> {
    assertScope(subject, "admin:read");
    const evidence = await readTargetQualityEvidence(
      this.env.TARGET_QUALITY_EVIDENCE_PATH,
    );
    const generatedAt = new Date().toISOString();
    if (evidence.status === "not_configured") {
      return emptyReport({
        generatedAt,
        orgId: subject.orgId,
        warnings: ["target_quality_evidence_not_configured"],
      });
    }
    if (evidence.status === "invalid") {
      return emptyReport({
        generatedAt,
        invalidReason: evidence.invalidReason,
        orgId: subject.orgId,
        warnings: ["target_quality_evidence_invalid"],
      });
    }

    const summary = summarizeTargetQualityEvidence(evidence.data);
    return {
      schema: "romeo.target-quality-posture.v1",
      generatedAt,
      orgId: subject.orgId,
      status: summary.warnings.length === 0 ? "ready" : "attention_required",
      ...summary,
    };
  }
}

type ReadEvidenceResult =
  | { status: "not_configured" }
  | { status: "invalid"; invalidReason: TargetQualityInvalidReason }
  | { status: "valid"; data: Record<string, unknown> };

async function readTargetQualityEvidence(
  path: string,
): Promise<ReadEvidenceResult> {
  const configuredPath = path.trim();
  if (configuredPath.length === 0) return { status: "not_configured" };
  let raw: string;
  try {
    raw = await readFile(configuredPath, "utf8");
  } catch {
    return { status: "invalid", invalidReason: "read_failed" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: "invalid", invalidReason: "invalid_json" };
  }
  if (
    !isRecord(parsed) ||
    parsed.schemaVersion !== targetQualityEvidenceSchema
  ) {
    return { status: "invalid", invalidReason: "schema_mismatch" };
  }
  return { status: "valid", data: parsed };
}

function emptyReport(input: {
  generatedAt: string;
  invalidReason?: TargetQualityInvalidReason;
  orgId: string;
  warnings: TargetQualityPostureReport["warnings"];
}): TargetQualityPostureReport {
  return {
    schema: "romeo.target-quality-posture.v1",
    generatedAt: input.generatedAt,
    orgId: input.orgId,
    status: "attention_required",
    evidence: {
      configured: input.invalidReason !== undefined,
      source:
        input.invalidReason === undefined
          ? "not_configured"
          : "configured_file",
      status: input.invalidReason === undefined ? "not_configured" : "invalid",
      ...(input.invalidReason === undefined
        ? {}
        : { invalidReason: input.invalidReason }),
      failureCodes:
        input.invalidReason === undefined ? [] : [input.invalidReason],
    },
    target: {
      deployment: "unknown",
      originConfigured: false,
    },
    checks: {
      total: 0,
      requiredTotal: requiredTargetQualityChecks.length,
      requiredPresent: 0,
      missingRequired: [...requiredTargetQualityChecks],
    },
    health: {
      checked: false,
      bodyBytes: 0,
    },
    analytics: {
      status: "unknown",
      evalSuiteCount: 0,
      evalRunCount: 0,
      usageEventCount: 0,
      toolCallCount: 0,
      csvBytes: 0,
      csvSha256Present: false,
      redactionPassed: false,
    },
    evals: {
      reportCount: 0,
      passedReportCount: 0,
      gatePassedCount: 0,
      publishBlockedCount: 0,
      failedSuiteCount: 0,
      missingSuiteCount: 0,
      reasonCodes: [],
      redactionPassed: false,
    },
    replay: {
      checked: false,
      status: "unknown",
      caseCount: 0,
      matchedExpectedChunkCount: 0,
      routeModeCounts: {},
      redactionPassed: false,
    },
    redaction: postureRedaction(),
    warnings: input.warnings,
  };
}

function summarizeTargetQualityEvidence(
  data: Record<string, unknown>,
): Omit<
  TargetQualityPostureReport,
  "generatedAt" | "orgId" | "schema" | "status"
> {
  const checks = asStringArray(data.checks);
  const checkSet = new Set(checks);
  const missingRequired = requiredTargetQualityChecks.filter(
    (check) => !checkSet.has(check),
  );
  const target = isRecord(data.target) ? data.target : {};
  const analytics = summarizeAnalytics(data.analytics);
  const evals = summarizeEvals(data.evals);
  const replay = summarizeReplay(data.replay);
  const failureCodes = targetQualityFailureCodes({
    data,
    missingRequired,
    analytics,
    evals,
    replay,
    target,
  });
  const evidenceStatus = safeEvidenceStatus(data.status);
  const mode = safeEvidenceMode(data.mode);
  const evidencePostureStatus =
    failureCodes.length === 0
      ? "satisfied"
      : evidenceStatus === "planned" || mode === "dry-run"
        ? "planned"
        : "failed";
  return {
    evidence: {
      configured: true,
      source: "configured_file",
      status: evidencePostureStatus,
      schemaVersion: targetQualityEvidenceSchema,
      ...(typeof data.generatedAt === "string"
        ? { generatedAt: data.generatedAt }
        : {}),
      evidenceStatus,
      mode,
      failureCodes,
    },
    target: {
      deployment: target.deployment === "target-api" ? "target-api" : "unknown",
      originConfigured: safeOrigin(target.origin) !== undefined,
    },
    checks: {
      total: checks.length,
      requiredTotal: requiredTargetQualityChecks.length,
      requiredPresent:
        requiredTargetQualityChecks.length - missingRequired.length,
      missingRequired,
    },
    health: {
      checked: checkSet.has("health_read"),
      ...(typeof (isRecord(data.health) ? data.health.status : undefined) ===
      "string"
        ? { status: safeToken((data.health as Record<string, unknown>).status) }
        : {}),
      bodyBytes: safeCount(isRecord(data.health) ? data.health.bodyBytes : 0),
    },
    analytics,
    evals,
    replay,
    redaction: postureRedaction(),
    warnings: targetQualityWarnings(failureCodes),
  };
}

function targetQualityFailureCodes(input: {
  analytics: TargetQualityPostureReport["analytics"];
  data: Record<string, unknown>;
  evals: TargetQualityPostureReport["evals"];
  missingRequired: readonly string[];
  replay: TargetQualityPostureReport["replay"];
  target: Record<string, unknown>;
}): string[] {
  const failures: string[] = [];
  if (input.data.mode !== "live") failures.push("target_quality_not_live");
  if (input.target.deployment !== "target-api") {
    failures.push("target_quality_wrong_target");
  }
  if (safeOrigin(input.target.origin) === undefined) {
    failures.push("target_quality_missing_origin");
  }
  for (const check of input.missingRequired) {
    failures.push(`target_quality_missing_check:${check}`);
  }
  if (isRecord(input.data.health) && input.data.health.status !== "ok") {
    failures.push("target_quality_health_not_ok");
  }
  if (!isRecord(input.data.health)) {
    failures.push("target_quality_health_missing");
  }
  if (input.analytics.status !== "passed") {
    failures.push("target_quality_analytics_missing");
  }
  if (!input.analytics.csvSha256Present) {
    failures.push("target_quality_csv_hash_missing");
  }
  if (!input.analytics.redactionPassed) {
    failures.push("target_quality_analytics_redaction_missing");
  }
  if (input.evals.reportCount < 1) {
    failures.push("target_quality_missing_eval_evidence");
  }
  if (evalSubjectRawIdsReturned(input.data.evals)) {
    failures.push("target_quality_eval_subject_raw_ids_returned");
  }
  if (!evalSubjectHashesPresent(input.data.evals)) {
    failures.push("target_quality_eval_subject_hash_missing");
  }
  if (
    input.evals.reportCount < 1 ||
    input.evals.passedReportCount !== input.evals.reportCount
  ) {
    failures.push("target_quality_eval_not_passed");
  }
  if (
    input.evals.reportCount < 1 ||
    input.evals.gatePassedCount !== input.evals.reportCount
  ) {
    failures.push("target_quality_eval_gate_not_passed");
  }
  if (input.evals.publishBlockedCount > 0) {
    failures.push("target_quality_eval_publish_blocked");
  }
  if (!input.evals.redactionPassed) {
    failures.push("target_quality_eval_redaction_missing");
  }
  if (!input.replay.checked || input.replay.status !== "passed") {
    failures.push("target_quality_replay_missing");
  }
  if (input.replay.vectorComparison?.required === true) {
    if (input.replay.kind !== "compare") {
      failures.push("target_quality_vector_comparison_requires_compare");
    }
    if (input.replay.vectorComparison.status !== "passed") {
      failures.push("target_quality_vector_comparison_not_passed");
    }
    if (
      input.replay.vectorComparison.expectedBaselineRouteMode !== "pgvector" ||
      input.replay.vectorComparison.expectedCandidateRouteMode !==
        "external_vector"
    ) {
      failures.push("target_quality_vector_comparison_route_invalid");
    }
    if (
      input.replay.vectorComparison.baselineMatchedCount < 1 ||
      input.replay.vectorComparison.candidateMatchedCount < 1
    ) {
      failures.push("target_quality_vector_comparison_incomplete");
    }
  }
  if (!input.replay.redactionPassed) {
    failures.push("target_quality_replay_redaction_missing");
  }
  if (!topLevelRedactionPassed(input.data.redaction)) {
    failures.push("target_quality_top_level_redaction_missing");
  }
  if (input.data.status !== "passed") {
    failures.push("target_quality_status_not_passed");
  }
  return uniqueSorted(failures);
}

function targetQualityWarnings(
  failureCodes: string[],
): TargetQualityPostureReport["warnings"] {
  const warnings = new Set<TargetQualityPostureReport["warnings"][number]>();
  for (const failureCode of failureCodes) {
    if (failureCode === "target_quality_not_live") {
      warnings.add("target_quality_evidence_not_live");
    } else if (failureCode.includes("analytics")) {
      warnings.add("target_quality_analytics_missing");
    } else if (failureCode.includes("eval")) {
      warnings.add("target_quality_eval_gate_not_passed");
    } else if (failureCode.includes("replay")) {
      warnings.add("target_quality_replay_missing");
    } else if (failureCode.includes("redaction")) {
      warnings.add("target_quality_redaction_missing");
    } else if (failureCode.includes("health")) {
      warnings.add("target_quality_health_not_ok");
    } else {
      warnings.add("target_quality_evidence_failed");
    }
  }
  return [...warnings].sort();
}

function summarizeAnalytics(
  input: unknown,
): TargetQualityPostureReport["analytics"] {
  const analytics = isRecord(input) ? input : {};
  const csv = isRecord(analytics.csv) ? analytics.csv : {};
  return {
    status: safeCheckStatus(analytics.status),
    ...(typeof analytics.summaryStatus === "string"
      ? { summaryStatus: safeToken(analytics.summaryStatus) }
      : {}),
    ...(typeof analytics.evalStatus === "string"
      ? { evalStatus: safeToken(analytics.evalStatus) }
      : {}),
    evalSuiteCount: safeCount(analytics.evalSuiteCount),
    evalRunCount: safeCount(analytics.evalRunCount),
    usageEventCount: safeCount(analytics.usageEventCount),
    ...(typeof analytics.providerStatus === "string"
      ? { providerStatus: safeToken(analytics.providerStatus) }
      : {}),
    ...(typeof analytics.jobStatus === "string"
      ? { jobStatus: safeToken(analytics.jobStatus) }
      : {}),
    toolCallCount: safeCount(analytics.toolCallCount),
    csvBytes: safeCount(csv.bytes),
    csvSha256Present: typeof csv.sha256 === "string" && csv.sha256.length > 0,
    redactionPassed: passedRedactionChecks(
      analytics.redaction,
      analyticsRedactionFields,
    ),
  };
}

function summarizeEvals(input: unknown): TargetQualityPostureReport["evals"] {
  const evals = asRecords(input);
  const reasonCodes = uniqueSorted(
    evals.flatMap((item) => safeTokens(item.reasonCodes)),
  );
  return {
    reportCount: evals.length,
    passedReportCount: evals.filter((item) => item.status === "passed").length,
    gatePassedCount: evals.filter((item) => item.gateStatus === "passed")
      .length,
    publishBlockedCount: evals.filter((item) => item.publishBlocked === true)
      .length,
    failedSuiteCount: evals.reduce(
      (total, item) => total + safeCount(item.failedSuiteCount),
      0,
    ),
    missingSuiteCount: evals.reduce(
      (total, item) => total + safeCount(item.missingSuiteCount),
      0,
    ),
    reasonCodes,
    redactionPassed:
      evals.length > 0 &&
      evals.every((item) =>
        passedRedactionChecks(item.redaction, evalRedactionFields),
      ),
  };
}

function summarizeReplay(input: unknown): TargetQualityPostureReport["replay"] {
  const replay = isRecord(input) ? input : {};
  const kind =
    replay.kind === "compare" || replay.kind === "single"
      ? replay.kind
      : undefined;
  const caseCount =
    kind === "compare"
      ? safeCount(replay.baselineCaseCount) +
        safeCount(replay.candidateCaseCount)
      : safeCount(replay.caseCount);
  const deltas = isRecord(replay.deltas) ? replay.deltas : {};
  const averagePrecision =
    kind === "compare"
      ? safeNullableNumber(deltas.averagePrecision)
      : safeNullableNumber(replay.averagePrecision);
  const averageRecall =
    kind === "compare"
      ? safeNullableNumber(deltas.averageRecall)
      : safeNullableNumber(replay.averageRecall);
  const routeModeCounts = summarizeReplayRouteModeCounts(
    replay.routeModeCounts,
    kind,
  );
  const vectorComparison = summarizeVectorComparison(replay.vectorComparison);
  return {
    checked: replay.checked === true,
    status: safeCheckStatus(replay.status),
    ...(kind === undefined ? {} : { kind }),
    ...(typeof replay.outcome === "string"
      ? { outcome: safeToken(replay.outcome) }
      : {}),
    ...(typeof replay.replayStatus === "string"
      ? { replayStatus: safeToken(replay.replayStatus) }
      : {}),
    caseCount,
    matchedExpectedChunkCount:
      kind === "compare"
        ? safeCount(deltas.matchedExpectedChunkCount)
        : safeCount(replay.matchedExpectedChunkCount),
    ...(averagePrecision === undefined ? {} : { averagePrecision }),
    ...(averageRecall === undefined ? {} : { averageRecall }),
    routeModeCounts,
    ...(vectorComparison === undefined ? {} : { vectorComparison }),
    redactionPassed: passedRedactionChecks(
      replay.redaction,
      replayRedactionFields,
    ),
  };
}

function summarizeReplayRouteModeCounts(
  input: unknown,
  kind: "compare" | "single" | undefined,
): TargetQualityPostureReport["replay"]["routeModeCounts"] {
  const counts = isRecord(input) ? input : {};
  if (kind === "compare") {
    return {
      baseline: routeModeCounts(counts.baseline),
      candidate: routeModeCounts(counts.candidate),
    };
  }
  if (kind === "single") {
    return { single: routeModeCounts(counts) };
  }
  return {};
}

function routeModeCounts(input: unknown): TargetQualityRouteModeCounts {
  const counts = isRecord(input) ? input : {};
  return {
    external_vector: safeCount(counts.external_vector),
    legacy_rag_provider: safeCount(counts.legacy_rag_provider),
    lexical_fallback: safeCount(counts.lexical_fallback),
    pgvector: safeCount(counts.pgvector),
  };
}

function summarizeVectorComparison(
  input: unknown,
): TargetQualityPostureReport["replay"]["vectorComparison"] | undefined {
  if (!isRecord(input)) return undefined;
  return {
    required: input.required === true,
    status: safeCheckStatus(input.status),
    expectedBaselineRouteMode: safeRouteMode(input.expectedBaselineRouteMode),
    expectedCandidateRouteMode: safeRouteMode(input.expectedCandidateRouteMode),
    baselineMatchedCount: safeCount(input.baselineMatchedCount),
    candidateMatchedCount: safeCount(input.candidateMatchedCount),
    baselineTotalRouteCount: safeCount(input.baselineTotalRouteCount),
    candidateTotalRouteCount: safeCount(input.candidateTotalRouteCount),
  };
}

function postureRedaction(): TargetQualityPostureReport["redaction"] {
  return {
    evidenceFileBodyReturned: false,
    rawAnalyticsCsvReturned: false,
    rawEvalAgentIdsReturned: false,
    rawEvalInputsReturned: false,
    rawEvalOutputsReturned: false,
    rawEvalWorkspaceIdsReturned: false,
    rawEvidencePathReturned: false,
    rawReplayHitIdsReturned: false,
    rawReplayQueriesReturned: false,
    rawSecretsReturned: false,
    rawTargetUrlReturned: false,
  };
}

function safeEvidenceStatus(
  input: unknown,
): "failed" | "passed" | "planned" | "unknown" {
  if (input === "failed" || input === "passed" || input === "planned") {
    return input;
  }
  return "unknown";
}

function safeCheckStatus(input: unknown): "failed" | "passed" | "unknown" {
  return input === "failed" || input === "passed" ? input : "unknown";
}

function safeEvidenceMode(input: unknown): "dry-run" | "live" | "unknown" {
  if (input === "dry-run" || input === "live") return input;
  return "unknown";
}

function topLevelRedactionPassed(input: unknown): boolean {
  if (!isRecord(input)) return false;
  return topLevelRedactionFields.every((field) => input[field] === false);
}

function evalSubjectRawIdsReturned(input: unknown): boolean {
  return asRecords(input).some(
    (item) =>
      Object.hasOwn(item, "agentId") || Object.hasOwn(item, "workspaceId"),
  );
}

function evalSubjectHashesPresent(input: unknown): boolean {
  const evals = asRecords(input);
  return (
    evals.length > 0 &&
    evals.every((item) => {
      const subject = isRecord(item.subject) ? item.subject : {};
      return (
        subject.agentIdPresent === true &&
        subject.workspaceIdPresent === true &&
        validSha256(subject.agentIdHash) &&
        validSha256(subject.workspaceIdHash)
      );
    })
  );
}

function validSha256(input: unknown): boolean {
  return typeof input === "string" && /^[a-f0-9]{64}$/u.test(input);
}

function passedRedactionChecks(
  input: unknown,
  fields: readonly string[],
): boolean {
  if (!isRecord(input)) return false;
  return fields.every((field) => input[field] === true);
}

function safeOrigin(input: unknown): string | undefined {
  if (typeof input !== "string" || input.length === 0) return undefined;
  try {
    const url = new URL(input);
    if (url.pathname !== "/" || url.search.length > 0 || url.hash.length > 0) {
      return undefined;
    }
    return url.origin;
  } catch {
    return undefined;
  }
}

function safeCount(input: unknown): number {
  return typeof input === "number" && Number.isSafeInteger(input) && input >= 0
    ? input
    : 0;
}

function safeNullableNumber(input: unknown): number | null | undefined {
  if (input === null) return null;
  return typeof input === "number" && Number.isFinite(input)
    ? input
    : undefined;
}

function safeRouteMode(
  input: unknown,
): "external_vector" | "pgvector" | "unknown" {
  return input === "external_vector" || input === "pgvector"
    ? input
    : "unknown";
}

function safeTokens(input: unknown): string[] {
  return asStringArray(input).map(safeToken);
}

function safeToken(input: unknown): string {
  return typeof input === "string" && /^[A-Za-z0-9:._-]+$/u.test(input)
    ? input
    : "redacted_value";
}

function asStringArray(input: unknown): string[] {
  return Array.isArray(input)
    ? input.filter((item): item is string => typeof item === "string")
    : [];
}

function asRecords(input: unknown): Array<Record<string, unknown>> {
  return Array.isArray(input) ? input.filter(isRecord) : [];
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}
