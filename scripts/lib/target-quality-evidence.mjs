import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const replayRouteModes = [
  "external_vector",
  "legacy_rag_provider",
  "lexical_fallback",
  "pgvector",
];

export function plannedTargetQualityEvidence(config) {
  return {
    schemaVersion: "romeo.target-quality-evidence.v1",
    generatedAt: new Date().toISOString(),
    status: "planned",
    mode: "dry-run",
    target: {
      deployment: "target-api",
      origin:
        config.baseUrl === undefined || config.baseUrl.length === 0
          ? undefined
          : safeOrigin(config.baseUrl),
    },
    checks: [
      "base_url_required_for_live_mode",
      "api_key_required_for_live_mode",
      "admin_analytics_summary_read",
      "admin_analytics_csv_read",
      "analytics_redaction_flags",
      "eval_release_candidate_readback",
      "eval_redaction_flags",
      ...(config.replayFile === undefined
        ? []
        : ["retrieval_replay_readback", "replay_redaction_flags"]),
      ...(config.requireVectorComparison
        ? ["retrieval_vector_route_comparison"]
        : []),
      "forbidden_sentinels_absent",
    ],
    plannedInputs: {
      agentCount: config.agentIds.length,
      replayFileConfigured: config.replayFile !== undefined,
      requireEvalPassed: config.requireEvalPassed,
      requireVectorComparison: config.requireVectorComparison,
      expectedBaselineRouteMode: config.baselineVectorRouteMode ?? "pgvector",
      expectedCandidateRouteMode:
        config.candidateVectorRouteMode ?? "external_vector",
      forbiddenStringCount: config.forbiddenStrings.length,
    },
    notes: [
      "Dry-run output is planning evidence only.",
      "Live mode stores aggregate status, counts, redaction flags, and hashes only; it does not retain analytics CSV rows, eval inputs/outputs, replay queries, expected chunk IDs, hit IDs, chunk text, provider URLs, credential refs, or secret refs.",
    ],
  };
}

export async function collectTargetQualityEvidence(config) {
  if (config.baseUrl === undefined || config.baseUrl.length === 0) {
    throw new Error("--base-url or ROMEO_BASE_URL is required.");
  }
  if (config.apiKey === undefined || config.apiKey.length === 0) {
    throw new Error("--api-key or ROMEO_API_KEY is required.");
  }

  const checks = [];
  const health = await requestJson(config, "/api/v1/health", {
    token: false,
  });
  checks.push("health_read");

  const analytics = await analyticsEvidence(config);
  checks.push("admin_analytics_summary_read");
  checks.push("admin_analytics_csv_read");
  checks.push("analytics_redaction_flags");

  const evals = [];
  for (const agentId of config.agentIds) {
    evals.push(await evalEvidence(config, agentId));
  }
  if (evals.length > 0) checks.push("eval_release_candidate_readback");
  if (evals.length > 0) checks.push("eval_redaction_flags");
  if (
    config.requireEvalPassed &&
    evals.some((item) => item.gateStatus !== "passed")
  ) {
    throw new Error("At least one release-candidate eval gate is not passed.");
  }
  if (config.requireEvalPassed && evals.length > 0) {
    checks.push("eval_gate_passed");
  }

  const replay =
    config.replayFile === undefined
      ? { checked: false }
      : await replayEvidence(config);
  if (replay.checked) {
    checks.push("retrieval_replay_readback");
    checks.push("replay_redaction_flags");
    if (replay.vectorComparison?.status === "passed") {
      checks.push("retrieval_vector_route_comparison");
    }
  }
  if (
    config.requireVectorComparison &&
    replay.vectorComparison?.status !== "passed"
  ) {
    throw new Error(
      "Required retrieval vector route comparison was not satisfied.",
    );
  }

  checks.push("forbidden_sentinels_absent");

  return {
    schemaVersion: "romeo.target-quality-evidence.v1",
    generatedAt: new Date().toISOString(),
    status: "passed",
    mode: "live",
    target: {
      deployment: "target-api",
      origin: safeOrigin(config.baseUrl),
    },
    checks,
    health: {
      status: health.status,
      bodyBytes: health.bodyBytes,
    },
    analytics,
    evals,
    replay,
    redaction: {
      rawAnalyticsCsvReturned: false,
      rawEvalInputsReturned: false,
      rawEvalOutputsReturned: false,
      rawEvalAgentIdsReturned: false,
      rawEvalWorkspaceIdsReturned: false,
      rawReplayQueriesReturned: false,
      rawReplayHitIdsReturned: false,
      rawSecretsReturned: false,
    },
  };
}

export function positiveInteger(raw, fallback, label) {
  if (raw === undefined) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return value;
}

export function safeOrigin(value) {
  return new URL(value).origin;
}

export function repeatedArgValues(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name) values.push(process.argv[index + 1]);
  }
  return values.filter(
    (value) => typeof value === "string" && value.length > 0,
  );
}

export function readReplayInput(path) {
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (Array.isArray(parsed.cases)) {
    return {
      endpoint: "/api/v1/admin/rag/replay",
      body: { cases: parsed.cases },
      kind: "single",
    };
  }
  if (Array.isArray(parsed.baseline) && Array.isArray(parsed.candidate)) {
    return {
      endpoint: "/api/v1/admin/rag/replay/compare",
      body: { baseline: parsed.baseline, candidate: parsed.candidate },
      kind: "compare",
    };
  }
  throw new Error(
    "--replay-file must contain either { cases } or { baseline, candidate } arrays.",
  );
}

export function normalizeVectorRouteMode(value, fallback, label) {
  const selected = value ?? fallback;
  const normalized = selected === "qdrant" ? "external_vector" : selected;
  if (!replayRouteModes.includes(normalized)) {
    throw new Error(
      `${label} must be one of ${replayRouteModes.join(", ")} or qdrant.`,
    );
  }
  return normalized;
}

export function redactOutput(value, secrets) {
  let redacted = value;
  for (const secret of secrets.filter(Boolean)) {
    redacted = redacted.replaceAll(secret, "[redacted]");
  }
  return redacted.replaceAll(/Bearer\s+\S+/gu, "Bearer [redacted]");
}

async function analyticsEvidence(config) {
  const summaryResponse = await requestJson(
    config,
    "/api/v1/admin/analytics/summary",
  );
  const summary = summaryResponse.data;
  assertRedactionFlags(summary?.redaction, [
    "rawEvalInputsReturned",
    "rawEvalOutputsReturned",
    "rawJobPayloadsReturned",
    "rawProviderConfigReturned",
    "rawToolInputsReturned",
    "rawUsageMetadataReturned",
  ]);
  assertForbiddenAbsent(summary, config.forbiddenStrings, "analytics_json");

  const csv = await requestText(config, "/api/v1/admin/analytics/summary.csv");
  assertForbiddenAbsent(csv.text, config.forbiddenStrings, "analytics_csv");
  return {
    status: "passed",
    summaryStatus: summary?.status,
    evalStatus: summary?.evals?.status,
    evalSuiteCount: summary?.evals?.suiteCount,
    evalRunCount: summary?.evals?.generatedRunCount,
    usageEventCount: summary?.usage?.eventCount,
    estimatedCostUsd: summary?.usage?.estimatedCostUsd,
    providerStatus: summary?.providers?.status,
    jobStatus: summary?.jobs?.status,
    toolCallCount: summary?.tools?.totalCount,
    csv: {
      bytes: csv.bodyBytes,
      sha256: sha256String(csv.text),
      returned: false,
    },
    redaction: redactionResult(summary.redaction),
  };
}

async function evalEvidence(config, agentId) {
  const response = await requestJson(
    config,
    `/api/v1/agents/${encodeURIComponent(agentId)}/eval-release-candidate-evidence`,
  );
  const evidence = response.data;
  if (evidence?.schema !== "romeo.eval-release-candidate-evidence.v1") {
    throw new Error("Release-candidate eval evidence schema mismatch.");
  }
  assertRedactionFlags(evidence.redaction, [
    "rawEvalInputsReturned",
    "rawEvalOutputsReturned",
    "rawHumanRatingCommentsReturned",
    "rawRubricTermsReturned",
  ]);
  assertForbiddenAbsent(evidence, config.forbiddenStrings, "eval_evidence");
  return {
    status: "passed",
    subject: evalSubjectEvidence({
      agentId: evidence.agentId ?? agentId,
      workspaceId: evidence.workspaceId,
    }),
    gateStatus: evidence.gate?.status,
    publishBlocked: evidence.gate?.publishBlocked === true,
    reasonCodes: evidence.gate?.reasonCodes ?? [],
    suiteCount: evidence.gate?.suiteCount,
    passedSuiteCount: evidence.gate?.passedSuiteCount,
    failedSuiteCount: evidence.gate?.failedSuiteCount,
    missingSuiteCount: evidence.gate?.missingSuiteCount,
    averageScore: evidence.gate?.averageScore ?? null,
    evaluatedAt: evidence.gate?.evaluatedAt ?? null,
    redaction: redactionResult(evidence.redaction),
  };
}

async function replayEvidence(config) {
  const replayInput = readReplayInput(config.replayFile);
  const response = await requestJson(config, replayInput.endpoint, {
    method: "POST",
    body: replayInput.body,
  });
  const report = response.data;
  const redaction =
    replayInput.kind === "compare" ? report?.redaction : report?.redaction;
  assertRedactionFlags(redaction, [
    "rawQueriesReturned",
    "rawChunkTextReturned",
    "rawExpectedChunkIdsReturned",
    "rawHitIdsReturned",
    "vectorValuesReturned",
  ]);
  assertForbiddenAbsent(report, config.forbiddenStrings, "retrieval_replay");
  if (replayInput.kind === "compare") {
    const routeModeCounts = {
      baseline: routeModeCountsFromReport(report?.baseline),
      candidate: routeModeCountsFromReport(report?.candidate),
    };
    const vectorComparison = vectorComparisonEvidence(config, routeModeCounts);
    return {
      checked: true,
      status: "passed",
      kind: "compare",
      outcome: report?.outcome,
      baselineStatus: report?.baseline?.status,
      candidateStatus: report?.candidate?.status,
      baselineCaseCount: report?.baseline?.caseCount,
      candidateCaseCount: report?.candidate?.caseCount,
      deltas: {
        averagePrecision: report?.deltas?.averagePrecision ?? null,
        averageRecall: report?.deltas?.averageRecall ?? null,
        matchedExpectedChunkCount:
          report?.deltas?.matchedExpectedChunkCount ?? 0,
      },
      routeModeCounts,
      ...(vectorComparison === undefined ? {} : { vectorComparison }),
      redaction: redactionResult(redaction),
    };
  }
  const routeModeCounts = routeModeCountsFromReport(report);
  return {
    checked: true,
    status: "passed",
    kind: "single",
    replayStatus: report?.status,
    caseCount: report?.caseCount,
    matchedExpectedChunkCount: report?.metrics?.matchedExpectedChunkCount,
    averagePrecision: report?.metrics?.averagePrecision ?? null,
    averageRecall: report?.metrics?.averageRecall ?? null,
    routeModeCounts,
    redaction: redactionResult(redaction),
  };
}

function routeModeCountsFromReport(report) {
  const counts = Object.fromEntries(replayRouteModes.map((mode) => [mode, 0]));
  const cases = Array.isArray(report?.cases) ? report.cases : [];
  for (const replayCase of cases) {
    const routeModes = replayCase?.retrievalRouteModes ?? {};
    for (const mode of replayRouteModes) {
      counts[mode] += nonNegativeInteger(routeModes[mode]);
    }
  }
  return counts;
}

function vectorComparisonEvidence(config, routeModeCounts) {
  if (!config.requireVectorComparison) return undefined;
  const baselineRouteMode = config.baselineVectorRouteMode ?? "pgvector";
  const candidateRouteMode =
    config.candidateVectorRouteMode ?? "external_vector";
  const baselineMatchedCount =
    routeModeCounts.baseline?.[baselineRouteMode] ?? 0;
  const candidateMatchedCount =
    routeModeCounts.candidate?.[candidateRouteMode] ?? 0;
  return {
    required: true,
    status:
      baselineMatchedCount > 0 && candidateMatchedCount > 0
        ? "passed"
        : "failed",
    expectedBaselineRouteMode: baselineRouteMode,
    expectedCandidateRouteMode: candidateRouteMode,
    baselineMatchedCount,
    candidateMatchedCount,
    baselineTotalRouteCount: totalRouteCount(routeModeCounts.baseline),
    candidateTotalRouteCount: totalRouteCount(routeModeCounts.candidate),
  };
}

function totalRouteCount(counts) {
  return replayRouteModes.reduce(
    (total, mode) => total + nonNegativeInteger(counts?.[mode]),
    0,
  );
}

async function requestJson(config, path, options = {}) {
  const response = await request(config, path, {
    ...options,
    accept: "application/json",
  });
  return {
    status: response.status,
    bodyBytes: response.bodyBytes,
    data:
      response.text.length === 0 ? undefined : JSON.parse(response.text).data,
  };
}

async function requestText(config, path, options = {}) {
  const response = await request(config, path, {
    ...options,
    accept: "text/csv, text/plain, */*",
  });
  return response;
}

async function request(config, path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  timeout.unref?.();
  try {
    const response = await fetch(
      new URL(path, normalizedBaseUrl(config.baseUrl)),
      {
        method: options.method ?? "GET",
        headers: {
          accept: options.accept ?? "application/json",
          ...(options.body === undefined
            ? {}
            : { "content-type": "application/json" }),
          ...(options.token === undefined
            ? { authorization: `Bearer ${config.apiKey}` }
            : options.token === false
              ? {}
              : { authorization: `Bearer ${options.token}` }),
        },
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      },
    );
    const text = await response.text();
    if (response.status !== 200) {
      throw new Error(`${path} returned HTTP ${response.status}.`);
    }
    return {
      status: response.status,
      text,
      bodyBytes: Buffer.byteLength(text),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function assertRedactionFlags(redaction, fields) {
  const missing = fields.filter((field) => redaction?.[field] !== false);
  if (missing.length > 0) {
    throw new Error(`Redaction flags failed for ${missing.join(", ")}.`);
  }
}

function assertForbiddenAbsent(value, forbiddenStrings, label) {
  const serialized =
    typeof value === "string" ? value : JSON.stringify(value ?? {});
  for (const forbidden of forbiddenStrings) {
    if (serialized.includes(forbidden)) {
      throw new Error(`Forbidden sentinel appeared in ${label}.`);
    }
  }
}

function nonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function redactionResult(redaction) {
  return Object.fromEntries(
    Object.entries(redaction ?? {}).map(([field, value]) => [
      field,
      value === false,
    ]),
  );
}

function evalSubjectEvidence(input) {
  const agentId =
    typeof input.agentId === "string" && input.agentId.length > 0
      ? input.agentId
      : undefined;
  const workspaceId =
    typeof input.workspaceId === "string" && input.workspaceId.length > 0
      ? input.workspaceId
      : undefined;
  return {
    agentIdPresent: agentId !== undefined,
    workspaceIdPresent: workspaceId !== undefined,
    ...(agentId === undefined
      ? {}
      : { agentIdHash: sha256String(`agent:${agentId}`) }),
    ...(workspaceId === undefined
      ? {}
      : { workspaceIdHash: sha256String(`workspace:${workspaceId}`) }),
  };
}

function normalizedBaseUrl(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function sha256String(value) {
  return createHash("sha256").update(value).digest("hex");
}
