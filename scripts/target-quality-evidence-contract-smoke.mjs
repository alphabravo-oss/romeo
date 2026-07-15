import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

import {
  argValue,
  fileEvidence,
  readJson,
  repoPath,
  root,
  writeJson,
} from "./lib/release-artifacts.mjs";
import { redactOutput } from "./lib/target-quality-evidence.mjs";

const outputPath = repoPath(
  argValue("--output") ?? "dist/ci/target-quality-evidence-contract-smoke.json",
);
const generatedAt = new Date().toISOString();
const tempDir = join(
  tmpdir(),
  `romeo-target-quality-smoke-${randomBytes(6).toString("hex")}`,
);
const apiKey = `quality_${randomBytes(24).toString("hex")}`;
const rawSentinel = `RAW_TARGET_QUALITY_${randomBytes(12).toString("hex")}`;
let serverMode = "passing";

mkdirSync(tempDir, { recursive: true });
const replayFile = join(tempDir, "replay.json");
writeFileSync(
  replayFile,
  `${JSON.stringify(
    {
      baseline: [
        {
          id: "baseline_quality_case",
          knowledgeBaseIds: ["kb_contract"],
          query: rawSentinel,
          expectedChunkIds: [`chunk_${rawSentinel}`],
        },
      ],
      candidate: [
        {
          id: "candidate_quality_case",
          knowledgeBaseIds: ["kb_contract"],
          query: rawSentinel,
          expectedChunkIds: [`chunk_${rawSentinel}`],
        },
      ],
    },
    null,
    2,
  )}\n`,
  "utf8",
);

const server = createServer((request, response) => {
  handleRequest(request, response).catch(() => {
    response.writeHead(500, { "content-type": "text/plain" });
    response.end("error");
  });
});

try {
  await listen(server);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const positivePath = join(tempDir, "target-quality-evidence.json");
  const leakyAnalyticsPath = join(tempDir, "leaky-analytics.json");
  const leakyEvalPath = join(tempDir, "leaky-eval.json");
  const failingEvalPath = join(tempDir, "failing-eval.json");
  const leakyReplayPath = join(tempDir, "leaky-replay.json");
  const missingVectorComparisonPath = join(
    tempDir,
    "missing-vector-comparison.json",
  );

  const positive = await runQualitySmoke(baseUrl, positivePath);
  assertPassingEvidence(positivePath);

  serverMode = "leaky-analytics";
  const leakyAnalytics = await runQualitySmoke(baseUrl, leakyAnalyticsPath, {
    expectFailure: true,
  });

  serverMode = "leaky-eval";
  const leakyEval = await runQualitySmoke(baseUrl, leakyEvalPath, {
    expectFailure: true,
  });

  serverMode = "failing-eval";
  const failingEval = await runQualitySmoke(baseUrl, failingEvalPath, {
    expectFailure: true,
  });

  serverMode = "leaky-replay";
  const leakyReplay = await runQualitySmoke(baseUrl, leakyReplayPath, {
    expectFailure: true,
  });

  serverMode = "missing-vector-comparison";
  const missingVectorComparison = await runQualitySmoke(
    baseUrl,
    missingVectorComparisonPath,
    {
      expectFailure: true,
    },
  );

  assertNoSecretLeak([
    positivePath,
    positive.stdoutFile,
    positive.stderrFile,
    leakyAnalytics.stdoutFile,
    leakyAnalytics.stderrFile,
    leakyEval.stdoutFile,
    leakyEval.stderrFile,
    failingEval.stdoutFile,
    failingEval.stderrFile,
    leakyReplay.stdoutFile,
    leakyReplay.stderrFile,
    missingVectorComparison.stdoutFile,
    missingVectorComparison.stderrFile,
  ]);

  writeJson(outputPath, {
    schemaVersion: "romeo.target-quality-evidence-contract-smoke.v1",
    generatedAt,
    status: "passed",
    checks: [
      check("admin analytics JSON and CSV readback", positive),
      check("release-candidate eval readback", positive),
      check("retrieval replay comparison readback", positive),
      check("analytics redaction leak rejection", leakyAnalytics),
      check("eval redaction leak rejection", leakyEval),
      check("failing eval gate rejection when required", failingEval),
      check("retrieval replay redaction leak rejection", leakyReplay),
      check(
        "retrieval vector route comparison rejection",
        missingVectorComparison,
      ),
      { name: "target quality token and sentinel redaction", status: "passed" },
    ],
    evidence: {
      positive: fileEvidence(positivePath, "target-quality-evidence.json"),
      leakyAnalyticsStdout: fileEvidence(
        leakyAnalytics.stdoutFile,
        "leaky-analytics.stdout",
      ),
      leakyAnalyticsStderr: fileEvidence(
        leakyAnalytics.stderrFile,
        "leaky-analytics.stderr",
      ),
      leakyEvalStdout: fileEvidence(leakyEval.stdoutFile, "leaky-eval.stdout"),
      leakyEvalStderr: fileEvidence(leakyEval.stderrFile, "leaky-eval.stderr"),
      failingEvalStdout: fileEvidence(
        failingEval.stdoutFile,
        "failing-eval.stdout",
      ),
      failingEvalStderr: fileEvidence(
        failingEval.stderrFile,
        "failing-eval.stderr",
      ),
      leakyReplayStdout: fileEvidence(
        leakyReplay.stdoutFile,
        "leaky-replay.stdout",
      ),
      leakyReplayStderr: fileEvidence(
        leakyReplay.stderrFile,
        "leaky-replay.stderr",
      ),
      missingVectorComparisonStdout: fileEvidence(
        missingVectorComparison.stdoutFile,
        "missing-vector-comparison.stdout",
      ),
      missingVectorComparisonStderr: fileEvidence(
        missingVectorComparison.stderrFile,
        "missing-vector-comparison.stderr",
      ),
    },
  });
  console.log(`Wrote target quality evidence contract smoke to ${outputPath}`);
} finally {
  await close(server);
  rmSync(tempDir, { recursive: true, force: true });
}

async function handleRequest(request, response) {
  const url = new URL(request.url, "http://127.0.0.1");
  if (url.pathname !== "/api/v1/health" && !hasBearer(request, apiKey)) {
    return text(response, 401, "unauthorized");
  }
  if (url.pathname === "/api/v1/health") {
    return json(response, 200, { status: "ok" });
  }
  if (url.pathname === "/api/v1/admin/analytics/summary") {
    return json(response, 200, analyticsSummary());
  }
  if (url.pathname === "/api/v1/admin/analytics/summary.csv") {
    return text(
      response,
      200,
      serverMode === "leaky-analytics"
        ? `category,dimension,id,metric,value\nleak,raw,raw,value,${rawSentinel}\n`
        : "category,dimension,id,metric,value\noverall,org,org_contract,status,healthy\n",
      "text/csv",
    );
  }
  if (
    url.pathname ===
    "/api/v1/agents/agent_contract/eval-release-candidate-evidence"
  ) {
    return json(response, 200, evalEvidence());
  }
  if (url.pathname === "/api/v1/admin/rag/replay/compare") {
    await collectBody(request);
    return json(response, 200, replayComparison());
  }
  return text(response, 404, "not found");
}

function runQualitySmoke(baseUrl, evidencePath, options = {}) {
  const modeName = serverMode;
  const stdoutFile = join(
    tempDir,
    `${modeName}-${options.expectFailure ? "failure" : "success"}.stdout`,
  );
  const stderrFile = join(
    tempDir,
    `${modeName}-${options.expectFailure ? "failure" : "success"}.stderr`,
  );
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        repoPath("scripts/target-quality-evidence-smoke.mjs"),
        "--base-url",
        baseUrl,
        "--api-key",
        apiKey,
        "--agent-id",
        "agent_contract",
        "--require-eval-passed",
        "--require-vector-comparison",
        "--baseline-vector-route-mode",
        "pgvector",
        "--candidate-vector-route-mode",
        "external_vector",
        "--replay-file",
        replayFile,
        "--forbidden-string",
        rawSentinel,
        "--output",
        evidencePath,
      ],
      {
        cwd: root,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => {
      const failed = code !== 0;
      const secrets = [apiKey, rawSentinel];
      writeFileSync(stdoutFile, redactOutput(stdout, secrets), "utf8");
      writeFileSync(stderrFile, redactOutput(stderr, secrets), "utf8");
      if (failed !== Boolean(options.expectFailure)) {
        reject(
          new Error(
            [
              `target-quality-evidence-smoke exited ${code}; expected failure=${Boolean(options.expectFailure)}`,
              `stdout: ${redactOutput(stdout, secrets).trim()}`,
              `stderr: ${redactOutput(stderr, secrets).trim()}`,
            ].join("\n"),
          ),
        );
        return;
      }
      resolve({
        stdout: redactOutput(stdout, secrets),
        stderr: redactOutput(stderr, secrets),
        stdoutFile,
        stderrFile,
      });
    });
  });
}

function analyticsSummary() {
  return {
    status: "healthy",
    generatedAt,
    orgId: "org_contract",
    evals: {
      agentCount: 1,
      agents: [],
      averageLatestScore: 1,
      byModel: [],
      failedSuiteCount: 0,
      generatedRunCount: 1,
      missingSuiteCount: 0,
      passedSuiteCount: 1,
      releaseGate: {
        failedSuiteCount: 0,
        missingSuiteCount: 0,
        requiredSuiteCount: 1,
        status: "passed",
      },
      status: "passed",
      suiteCount: 1,
      suites: [],
    },
    usage: {
      byProvider: [],
      eventCount: 1,
      estimatedCostUsd: 0.01,
      totals: [],
    },
    providers: {
      alertCount: 0,
      availableProviderCount: 1,
      criticalAlertCount: 0,
      degradedProviderCount: 0,
      providerCount: 1,
      status: "healthy",
      unavailableProviderCount: 0,
    },
    tools: {
      approvalRequiredCount: 0,
      blockedCount: 0,
      byTool: [],
      failureCount: 0,
      pendingApprovalCount: 0,
      successCount: 1,
      totalCount: 1,
    },
    jobs: {
      alertCount: 0,
      completed: 1,
      criticalAlertCount: 0,
      deadLettered: 0,
      failed: 0,
      queued: 0,
      running: 0,
      status: "healthy",
      total: 1,
    },
    redaction: {
      rawEvalInputsReturned: serverMode === "leaky-analytics",
      rawEvalOutputsReturned: false,
      rawJobPayloadsReturned: false,
      rawProviderConfigReturned: false,
      rawToolInputsReturned: false,
      rawUsageMetadataReturned: false,
    },
  };
}

function evalEvidence() {
  return {
    schema: "romeo.eval-release-candidate-evidence.v1",
    orgId: "org_contract",
    workspaceId: "workspace_contract",
    agentId: "agent_contract",
    generatedAt,
    candidate: {
      baseModelId: "model_contract",
      draftUpdatedAt: generatedAt,
    },
    gate: {
      status: serverMode === "failing-eval" ? "failed" : "passed",
      publishBlocked: serverMode === "failing-eval",
      reasonCodes: serverMode === "failing-eval" ? ["eval_suite_failed"] : [],
      suiteCount: 1,
      passedSuiteCount: serverMode === "failing-eval" ? 0 : 1,
      failedSuiteCount: serverMode === "failing-eval" ? 1 : 0,
      missingSuiteCount: 0,
      averageScore: serverMode === "failing-eval" ? 0.25 : 1,
      evaluatedAt: generatedAt,
    },
    suites: [],
    redaction: {
      rawEvalInputsReturned: false,
      rawEvalOutputsReturned: serverMode === "leaky-eval",
      rawHumanRatingCommentsReturned: false,
      rawRubricTermsReturned: false,
    },
  };
}

function replayComparison() {
  const redaction = {
    rawQueriesReturned: false,
    rawChunkTextReturned: serverMode === "leaky-replay",
    rawExpectedChunkIdsReturned: false,
    rawHitIdsReturned: false,
    vectorValuesReturned: false,
  };
  return {
    orgId: "org_contract",
    generatedAt,
    outcome: "unchanged",
    baseline: replayReport(redaction, "pgvector"),
    candidate: replayReport(
      redaction,
      serverMode === "missing-vector-comparison"
        ? "pgvector"
        : "external_vector",
    ),
    deltas: {
      averageLatencyMs: 0,
      averagePrecision: 0,
      averageRecall: 0,
      expectedChunkCount: 0,
      hitCount: 0,
      matchedExpectedChunkCount: 0,
    },
    redaction,
  };
}

function replayReport(redaction, routeMode) {
  return {
    orgId: "org_contract",
    generatedAt,
    status: "passed",
    caseCount: 1,
    cases: [
      {
        authorizedKnowledgeBaseCount: 1,
        expectedChunkCount: 1,
        fallbackReasons: {},
        hitCount: 1,
        latencyMs: 1,
        matchedExpectedChunkCount: 1,
        precision: 1,
        recall: 1,
        retrievalRouteModes: {
          external_vector: routeMode === "external_vector" ? 1 : 0,
          legacy_rag_provider: 0,
          lexical_fallback: 0,
          pgvector: routeMode === "pgvector" ? 1 : 0,
        },
        skippedKnowledgeBaseCount: 0,
        status: "passed",
      },
    ],
    metrics: {
      averageLatencyMs: 1,
      averagePrecision: 1,
      averageRecall: 1,
      expectedChunkCount: 1,
      hitCount: 1,
      matchedExpectedChunkCount: 1,
    },
    redaction,
  };
}

function assertPassingEvidence(path) {
  const evidence = readJson(path);
  if (
    evidence.schemaVersion !== "romeo.target-quality-evidence.v1" ||
    evidence.status !== "passed" ||
    evidence.mode !== "live"
  ) {
    throw new Error(
      "Positive target quality smoke did not produce live evidence.",
    );
  }
  const checks = new Set(evidence.checks ?? []);
  for (const required of [
    "admin_analytics_summary_read",
    "admin_analytics_csv_read",
    "analytics_redaction_flags",
    "eval_release_candidate_readback",
    "eval_redaction_flags",
    "eval_gate_passed",
    "retrieval_replay_readback",
    "replay_redaction_flags",
    "retrieval_vector_route_comparison",
    "forbidden_sentinels_absent",
  ]) {
    if (!checks.has(required)) {
      throw new Error(`Positive target quality smoke missed ${required}.`);
    }
  }
  if (
    evidence.replay?.vectorComparison?.status !== "passed" ||
    evidence.replay.vectorComparison.expectedBaselineRouteMode !== "pgvector" ||
    evidence.replay.vectorComparison.expectedCandidateRouteMode !==
      "external_vector"
  ) {
    throw new Error(
      "Positive target quality smoke did not prove vector route comparison.",
    );
  }
  const serialized = JSON.stringify(evidence);
  if (
    serialized.includes(apiKey) ||
    serialized.includes(rawSentinel) ||
    serialized.includes("agent_contract") ||
    serialized.includes("workspace_contract")
  ) {
    throw new Error(
      "Positive target quality evidence leaked a secret, sentinel, or raw eval subject ID.",
    );
  }
  const evalSubject = evidence.evals?.[0]?.subject;
  if (
    evalSubject?.agentIdPresent !== true ||
    evalSubject?.workspaceIdPresent !== true ||
    typeof evalSubject?.agentIdHash !== "string" ||
    typeof evalSubject?.workspaceIdHash !== "string"
  ) {
    throw new Error("Positive target quality evidence missed subject hashes.");
  }
}

function assertNoSecretLeak(paths) {
  for (const path of paths) {
    const content = readFileSync(path, "utf8");
    if (content.includes("Bearer")) {
      throw new Error(`${path} leaked an Authorization scheme.`);
    }
    if (content.includes(apiKey) || content.includes(rawSentinel)) {
      throw new Error(`${path} leaked a generated secret or raw sentinel.`);
    }
  }
}

function check(name, command) {
  return {
    name,
    status: "passed",
    stdoutSha256: sha256String(command.stdout),
    stderrSha256: sha256String(command.stderr),
  };
}

function hasBearer(request, token) {
  return request.headers.authorization === `Bearer ${token}`;
}

function json(response, status, value) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify({ data: value }));
}

function text(response, status, value, contentType = "text/plain") {
  response.writeHead(status, { "content-type": contentType });
  response.end(value);
}

function collectBody(request) {
  return new Promise((resolve) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

function listen(input) {
  return new Promise((resolve) => input.listen(0, "127.0.0.1", resolve));
}

function close(input) {
  return new Promise((resolve) => input.close(resolve));
}

function sha256String(value) {
  return createHash("sha256").update(value).digest("hex");
}
