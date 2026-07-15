import { describe, expect, it } from "vitest";

import { createRomeoApi } from "./api";
import { InMemoryRomeoRepository } from "./repositories/in-memory";

describe("eval API", () => {
  it("creates and runs a passing eval suite, then allows publish", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());
    const createResponse = await api.request("/api/v1/eval-suites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentId: "agent_default",
        name: "Golden prompt",
        cases: [
          {
            input: "Say Romeo eval pass",
            expectedContains: "Romeo OpenAI-compatible response:",
          },
        ],
      }),
    });
    const created = await createResponse.json();

    const runResponse = await api.request(
      `/api/v1/eval-suites/${created.data.suite.id}/runs`,
      { method: "POST" },
    );
    const run = await runResponse.json();

    const runsResponse = await api.request(
      "/api/v1/agents/agent_default/eval-runs",
    );
    const runs = await runsResponse.json();

    const resultsResponse = await api.request(
      `/api/v1/eval-runs/${run.data.run.id}/results`,
    );
    const results = await resultsResponse.json();
    await api.request(`/api/v1/eval-run-results/${results.data[0].id}/rating`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        rating: "pass",
        comment: "RAW_HUMAN_RATING_COMMENT",
      }),
    });
    const dashboardResponse = await api.request(
      "/api/v1/agents/agent_default/eval-dashboard",
    );
    const dashboard = await dashboardResponse.json();
    const evidenceResponse = await api.request(
      "/api/v1/agents/agent_default/eval-release-candidate-evidence",
    );
    const evidence = await evidenceResponse.json();
    const evidenceSerialized = JSON.stringify(evidence);

    const publishResponse = await api.request(
      "/api/v1/agents/agent_default/versions",
      { method: "POST" },
    );
    const published = await publishResponse.json();
    const versionsResponse = await api.request(
      "/api/v1/agents/agent_default/versions",
    );
    const versions = await versionsResponse.json();

    expect(createResponse.status).toBe(201);
    expect(created.data.cases).toHaveLength(1);
    expect(runResponse.status).toBe(202);
    expect(run.data.run.status).toBe("passed");
    expect(run.data.run.score).toBe(1);
    expect(runs.data[0].id).toBe(run.data.run.id);
    expect(dashboardResponse.status).toBe(200);
    expect(dashboard.data).toMatchObject({
      agentId: "agent_default",
      status: "passed",
      suiteCount: 1,
      runCount: 1,
      averageLatestScore: 1,
    });
    expect(dashboard.data.suites[0]).toMatchObject({
      suiteId: created.data.suite.id,
      latestRunId: run.data.run.id,
      status: "passed",
      score: 1,
    });
    expect(dashboard.data.trend[0]).toMatchObject({
      runId: run.data.run.id,
      suiteId: created.data.suite.id,
      status: "passed",
      score: 1,
    });
    expect(JSON.stringify(dashboard.data)).not.toContain(
      "Romeo OpenAI-compatible response:",
    );
    expect(results.data[0].status).toBe("passed");
    expect(results.data[0].output).toContain(
      "Romeo OpenAI-compatible response:",
    );
    expect(evidenceResponse.status).toBe(200);
    expect(evidence.data.schema).toBe(
      "romeo.eval-release-candidate-evidence.v1",
    );
    expect(evidence.data.gate).toMatchObject({
      status: "passed",
      publishBlocked: false,
      suiteCount: 1,
      passedSuiteCount: 1,
      failedSuiteCount: 0,
      missingSuiteCount: 0,
      averageScore: 1,
    });
    expect(evidence.data.suites[0]).toMatchObject({
      suiteId: created.data.suite.id,
      latestRunId: run.data.run.id,
      status: "passed",
      score: 1,
      caseCount: 1,
      resultCount: 1,
      passedResultCount: 1,
      failedResultCount: 0,
      humanRatingCounts: { pass: 1, neutral: 0, fail: 0, total: 1 },
    });
    expect(evidence.data.suites[0].requirementCounts).toMatchObject({
      expectedContainsCases: 1,
    });
    expect(evidence.data.suites[0].toolEvaluation).toEqual({
      expectedToolCalls: { total: 0, passed: 0, failed: 0 },
      expectedToolOutcomes: { total: 0, passed: 0, failed: 0 },
      failedToolExpectationCaseCount: 0,
    });
    expect(evidence.data.redaction).toEqual({
      rawEvalInputsReturned: false,
      rawEvalOutputsReturned: false,
      rawHumanRatingCommentsReturned: false,
      rawRubricTermsReturned: false,
      rawToolArgumentsReturned: false,
      rawToolNamesReturned: false,
      rawToolOutputKeysReturned: false,
      rawToolResultBodiesReturned: false,
    });
    expect(evidenceSerialized).not.toContain("Say Romeo eval pass");
    expect(evidenceSerialized).not.toContain(
      "Romeo OpenAI-compatible response:",
    );
    expect(evidenceSerialized).not.toContain("RAW_HUMAN_RATING_COMMENT");
    expect(publishResponse.status).toBe(201);
    expect(published.data.evalSummary).toMatchObject({
      status: "passed",
      suiteCount: 1,
      passedSuiteCount: 1,
      failedSuiteCount: 0,
      missingSuiteCount: 0,
      averageScore: 1,
    });
    expect(published.data.evalSummary.suites[0]).toMatchObject({
      suiteId: created.data.suite.id,
      runId: run.data.run.id,
      status: "passed",
      score: 1,
    });
    expect(versions.data[0].evalSummary.status).toBe("passed");
  });

  it("summarizes admin analytics without raw eval, usage, job, or tool payloads", async () => {
    const repository = new InMemoryRomeoRepository();
    const api = createRomeoApi(repository);
    const now = new Date().toISOString();
    await repository.createUsageEvent({
      id: "usage_admin_analytics",
      orgId: "org_default",
      workspaceId: "workspace_default",
      actorId: "user_default",
      sourceType: "run",
      sourceId: "run_admin_analytics",
      metric: "tokens.total",
      quantity: 42,
      unit: "token",
      metadata: {
        estimatedCostUsd: 0.25,
        providerId: "provider_openai",
        rawSentinel: "RAW_USAGE_METADATA_SENTINEL",
      },
      createdAt: now,
    });
    await repository.createBackgroundJob({
      id: "job_admin_analytics",
      orgId: "org_default",
      type: "tool.operation.dispatch_request",
      status: "failed",
      payload: { rawSentinel: "RAW_JOB_PAYLOAD_SENTINEL" },
      createdAt: now,
      updatedAt: now,
      completedAt: now,
    });
    await repository.createToolCall({
      id: "tool_call_admin_analytics",
      orgId: "org_default",
      workspaceId: "workspace_default",
      agentId: "agent_default",
      actorId: "user_default",
      toolId: "tool_search",
      status: "failure",
      riskLevel: "medium",
      approvalRequired: true,
      inputKeys: ["query"],
      outputKeys: [],
      errorCode: "tool_failed",
      startedAt: now,
      completedAt: now,
    });
    const createResponse = await api.request("/api/v1/eval-suites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentId: "agent_default",
        name: "Analytics redaction",
        cases: [
          {
            input: "RAW_EVAL_INPUT_SENTINEL",
            expectedContains: "Romeo OpenAI-compatible response:",
          },
        ],
      }),
    });
    const created = await createResponse.json();
    await api.request(`/api/v1/eval-suites/${created.data.suite.id}/runs`, {
      method: "POST",
    });

    const summaryResponse = await api.request(
      "/api/v1/admin/analytics/summary",
    );
    const summary = await summaryResponse.json();
    const csvResponse = await api.request(
      "/api/v1/admin/analytics/summary.csv",
    );
    const csv = await csvResponse.text();
    const serialized = JSON.stringify(summary.data);

    expect(summaryResponse.status).toBe(200);
    expect(summary.data.evals).toMatchObject({
      suiteCount: 1,
      generatedRunCount: 1,
      status: "passed",
      releaseGate: {
        requiredSuiteCount: 1,
        status: "passed",
      },
    });
    expect(summary.data.usage).toMatchObject({
      eventCount: 1,
      estimatedCostUsd: 0.25,
    });
    expect(summary.data.tools.byTool[0]).toMatchObject({
      toolId: "tool_search",
      totalCount: 1,
      failureCount: 1,
      approvalRequiredCount: 1,
    });
    expect(summary.data.jobs.failed).toBeGreaterThanOrEqual(1);
    expect(summary.data.redaction).toEqual({
      rawEvalInputsReturned: false,
      rawEvalOutputsReturned: false,
      rawJobPayloadsReturned: false,
      rawProviderConfigReturned: false,
      rawToolInputsReturned: false,
      rawUsageMetadataReturned: false,
    });
    expect(csvResponse.status).toBe(200);
    expect(csv).toContain("eval,org,org_default,suite_count,1");
    for (const rawValue of [
      "RAW_EVAL_INPUT_SENTINEL",
      "Romeo OpenAI-compatible response:",
      "RAW_USAGE_METADATA_SENTINEL",
      "RAW_JOB_PAYLOAD_SENTINEL",
    ]) {
      expect(serialized).not.toContain(rawValue);
      expect(csv).not.toContain(rawValue);
    }
  });

  it("blocks publishing when an eval suite has not passed", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());
    const createResponse = await api.request("/api/v1/eval-suites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentId: "agent_default",
        name: "Failing prompt",
        cases: [
          {
            input: "Say Romeo eval fail",
            expectedContains: "not in output",
          },
        ],
      }),
    });
    const created = await createResponse.json();

    const blockedBeforeRun = await api.request(
      "/api/v1/agents/agent_default/versions",
      { method: "POST" },
    );
    const blockedBeforeRunBody = await blockedBeforeRun.json();
    const missingEvidenceResponse = await api.request(
      "/api/v1/agents/agent_default/eval-release-candidate-evidence",
    );
    const missingEvidence = await missingEvidenceResponse.json();

    const runResponse = await api.request(
      `/api/v1/eval-suites/${created.data.suite.id}/runs`,
      { method: "POST" },
    );
    const run = await runResponse.json();

    const blockedAfterRun = await api.request(
      "/api/v1/agents/agent_default/versions",
      { method: "POST" },
    );
    const blockedAfterRunBody = await blockedAfterRun.json();
    const failedEvidenceResponse = await api.request(
      "/api/v1/agents/agent_default/eval-release-candidate-evidence",
    );
    const failedEvidence = await failedEvidenceResponse.json();
    const failedEvidenceSerialized = JSON.stringify(failedEvidence);

    expect(blockedBeforeRun.status).toBe(409);
    expect(blockedBeforeRunBody.error.code).toBe("eval_gate_failed");
    expect(missingEvidence.data.gate).toMatchObject({
      status: "missing",
      publishBlocked: true,
      reasonCodes: ["eval_suite_missing_run"],
    });
    expect(run.data.run.status).toBe("failed");
    expect(blockedAfterRun.status).toBe(409);
    expect(blockedAfterRunBody.error.code).toBe("eval_gate_failed");
    expect(failedEvidence.data.gate).toMatchObject({
      status: "failed",
      publishBlocked: true,
      reasonCodes: ["eval_suite_failed"],
    });
    expect(failedEvidenceSerialized).not.toContain("Say Romeo eval fail");
    expect(failedEvidenceSerialized).not.toContain("not in output");
  });

  it("scores structured rubric checks with partial credit", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());
    const createResponse = await api.request("/api/v1/eval-suites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentId: "agent_default",
        name: "Rubric prompt",
        cases: [
          {
            input: "Say Romeo rubric pass",
            rubric: {
              mustContain: [
                "Romeo OpenAI-compatible response:",
                "definitely-not-generated-token",
              ],
              mustNotContain: ["forbidden-token"],
            },
          },
        ],
      }),
    });
    const created = await createResponse.json();

    const runResponse = await api.request(
      `/api/v1/eval-suites/${created.data.suite.id}/runs`,
      { method: "POST" },
    );
    const run = await runResponse.json();
    const resultsResponse = await api.request(
      `/api/v1/eval-runs/${run.data.run.id}/results`,
    );
    const results = await resultsResponse.json();

    expect(createResponse.status).toBe(201);
    expect(created.data.cases[0].rubric.mustContain).toHaveLength(2);
    expect(run.data.run.status).toBe("failed");
    expect(run.data.run.score).toBeCloseTo(2 / 3);
    expect(results.data[0].score).toBeCloseTo(2 / 3);
    expect(results.data[0].checks.rubric.mustContain).toEqual([
      { term: "Romeo OpenAI-compatible response:", passed: true },
      { term: "definitely-not-generated-token", passed: false },
    ]);
    expect(results.data[0].checks.rubric.mustNotContain).toEqual([
      { term: "forbidden-token", passed: true },
    ]);
  });

  it("scores expected tool calls from fenced tool-call output", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());
    const createResponse = await api.request("/api/v1/eval-suites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentId: "agent_default",
        name: "Tool call prompt",
        cases: [
          {
            input:
              'Return this call:\n```romeo-tool-call\n{"name":"search","arguments":{"query":"Romeo","limit":3}}\n```',
            rubric: {
              expectedToolCalls: [
                { name: "search", arguments: { query: "Romeo", limit: 3 } },
              ],
            },
          },
        ],
      }),
    });
    const created = await createResponse.json();

    const runResponse = await api.request(
      `/api/v1/eval-suites/${created.data.suite.id}/runs`,
      { method: "POST" },
    );
    const run = await runResponse.json();
    const resultsResponse = await api.request(
      `/api/v1/eval-runs/${run.data.run.id}/results`,
    );
    const results = await resultsResponse.json();
    const evidenceResponse = await api.request(
      "/api/v1/agents/agent_default/eval-release-candidate-evidence",
    );
    const evidence = await evidenceResponse.json();
    const evidenceSerialized = JSON.stringify(evidence);

    expect(createResponse.status).toBe(201);
    expect(created.data.cases[0].rubric.expectedToolCalls).toEqual([
      { name: "search", arguments: { query: "Romeo", limit: 3 } },
    ]);
    expect(run.data.run.status).toBe("passed");
    expect(results.data[0].checks.rubric.expectedToolCalls).toEqual([
      {
        name: "search",
        arguments: { query: "Romeo", limit: 3 },
        passed: true,
      },
    ]);
  });

  it("scores expected tool outcomes from fenced metadata-only output", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());
    const createResponse = await api.request("/api/v1/eval-suites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentId: "agent_default",
        name: "Tool outcome prompt",
        cases: [
          {
            input:
              'Return these outcomes:\n```romeo-tool-outcome\n[{"name":"search","status":"success","outputKeys":["results","count"]},{"name":"write_issue","status":"failure","errorCode":"tool_approval_rejected"}]\n```',
            rubric: {
              expectedToolOutcomes: [
                { name: "search", status: "success", outputKeys: ["results"] },
                {
                  name: "write_issue",
                  status: "failure",
                  errorCode: "tool_approval_rejected",
                },
                { name: "missing_tool", status: "success" },
              ],
            },
          },
        ],
      }),
    });
    const created = await createResponse.json();

    const runResponse = await api.request(
      `/api/v1/eval-suites/${created.data.suite.id}/runs`,
      { method: "POST" },
    );
    const run = await runResponse.json();
    const resultsResponse = await api.request(
      `/api/v1/eval-runs/${run.data.run.id}/results`,
    );
    const results = await resultsResponse.json();
    const evidenceResponse = await api.request(
      "/api/v1/agents/agent_default/eval-release-candidate-evidence",
    );
    const evidence = await evidenceResponse.json();
    const evidenceSerialized = JSON.stringify(evidence);

    expect(createResponse.status).toBe(201);
    expect(created.data.cases[0].rubric.expectedToolOutcomes).toEqual([
      { name: "search", status: "success", outputKeys: ["results"] },
      {
        name: "write_issue",
        status: "failure",
        errorCode: "tool_approval_rejected",
      },
      { name: "missing_tool", status: "success" },
    ]);
    expect(run.data.run.status).toBe("failed");
    expect(run.data.run.score).toBeCloseTo(2 / 3);
    expect(results.data[0].checks.rubric.expectedToolOutcomes).toEqual([
      {
        name: "search",
        status: "success",
        outputKeys: ["results"],
        passed: true,
      },
      {
        name: "write_issue",
        status: "failure",
        errorCode: "tool_approval_rejected",
        passed: true,
      },
      { name: "missing_tool", status: "success", passed: false },
    ]);
    expect(
      JSON.stringify(results.data[0].checks.rubric.expectedToolOutcomes),
    ).not.toContain("count");
    expect(evidence.data.suites[0].requirementCounts).toMatchObject({
      toolExpectationCases: 1,
      expectedToolCallCases: 0,
      expectedToolOutcomeCases: 1,
    });
    expect(evidence.data.suites[0].toolEvaluation).toEqual({
      expectedToolCalls: { total: 0, passed: 0, failed: 0 },
      expectedToolOutcomes: { total: 3, passed: 2, failed: 1 },
      failedToolExpectationCaseCount: 1,
    });
    expect(evidence.data.redaction.rawToolNamesReturned).toBe(false);
    expect(evidence.data.redaction.rawToolArgumentsReturned).toBe(false);
    expect(evidence.data.redaction.rawToolOutputKeysReturned).toBe(false);
    expect(evidence.data.redaction.rawToolResultBodiesReturned).toBe(false);
    expect(evidenceSerialized).not.toContain("write_issue");
    expect(evidenceSerialized).not.toContain("results");
    expect(evidenceSerialized).not.toContain("tool_approval_rejected");
  });

  it("scores required citation references from eval output", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());
    const createResponse = await api.request("/api/v1/eval-suites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentId: "agent_default",
        name: "Citation prompt",
        cases: [
          {
            input:
              "Answer with [source:chunk_access].\nCitations:\n- [1] access.md (chunk_policy)",
            requiresCitation: true,
            rubric: { requiredCitations: ["chunk_access", "chunk_missing"] },
          },
        ],
      }),
    });
    const created = await createResponse.json();

    const runResponse = await api.request(
      `/api/v1/eval-suites/${created.data.suite.id}/runs`,
      { method: "POST" },
    );
    const run = await runResponse.json();
    const resultsResponse = await api.request(
      `/api/v1/eval-runs/${run.data.run.id}/results`,
    );
    const results = await resultsResponse.json();

    expect(createResponse.status).toBe(201);
    expect(created.data.cases[0].rubric.requiredCitations).toEqual([
      "chunk_access",
      "chunk_missing",
    ]);
    expect(run.data.run.status).toBe("failed");
    expect(run.data.run.score).toBeCloseTo(2 / 3);
    expect(results.data[0].checks.citationPassed).toBe(true);
    expect(results.data[0].checks.observedCitations).toEqual([
      "chunk_access",
      "chunk_policy",
    ]);
    expect(results.data[0].checks.rubric.requiredCitations).toEqual([
      { citation: "chunk_access", passed: true },
      { citation: "chunk_missing", passed: false },
    ]);
    expect(results.data[0].checks.rubric.observedCitations).toEqual([
      "chunk_access",
      "chunk_policy",
    ]);
  });

  it("compares an eval suite across multiple models without returning raw outputs", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());
    const createResponse = await api.request("/api/v1/eval-suites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentId: "agent_default",
        name: "Model comparison prompt",
        cases: [{ input: "Say Romeo model comparison" }],
      }),
    });
    const created = await createResponse.json();

    const compareResponse = await api.request(
      `/api/v1/eval-suites/${created.data.suite.id}/model-comparisons`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          modelIds: ["model_openai_compatible_default", "model_ollama_default"],
        }),
      },
    );
    const comparison = await compareResponse.json();
    const runsResponse = await api.request(
      "/api/v1/agents/agent_default/eval-runs",
    );
    const runs = await runsResponse.json();
    const auditResponse = await api.request(
      "/api/v1/audit-logs?action=eval.model_compare.complete",
    );
    const audit = await auditResponse.json();

    expect(compareResponse.status).toBe(202);
    expect(comparison.data.suiteId).toBe(created.data.suite.id);
    expect(comparison.data.comparisons).toHaveLength(2);
    expect(
      comparison.data.comparisons.map(
        (item: { modelId: string }) => item.modelId,
      ),
    ).toEqual(["model_openai_compatible_default", "model_ollama_default"]);
    expect(comparison.data.comparisons[0]).toMatchObject({
      status: "passed",
      score: 1,
      resultCount: 1,
      passedResultCount: 1,
      failedResultCount: 0,
    });
    expect(JSON.stringify(comparison.data)).not.toContain(
      "Romeo OpenAI-compatible response:",
    );
    expect(JSON.stringify(comparison.data)).not.toContain(
      "Romeo Ollama response:",
    );
    expect(runs.data).toHaveLength(2);
    expect(audit.data[0].metadata).toMatchObject({
      suiteId: created.data.suite.id,
      modelCount: 2,
      modelIds: ["model_openai_compatible_default", "model_ollama_default"],
    });
  });

  it("records and updates human ratings for eval run results", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());
    const createResponse = await api.request("/api/v1/eval-suites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentId: "agent_default",
        name: "Human review prompt",
        cases: [
          {
            input: "Say Romeo human rating",
            expectedContains: "Romeo OpenAI-compatible response:",
          },
        ],
      }),
    });
    const created = await createResponse.json();
    const runResponse = await api.request(
      `/api/v1/eval-suites/${created.data.suite.id}/runs`,
      { method: "POST" },
    );
    const run = await runResponse.json();
    const resultId = run.data.results[0].id;

    const firstRatingResponse = await api.request(
      `/api/v1/eval-run-results/${resultId}/rating`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          rating: "neutral",
          comment: "Needs another reviewer.",
        }),
      },
    );
    const firstRating = await firstRatingResponse.json();
    const updatedRatingResponse = await api.request(
      `/api/v1/eval-run-results/${resultId}/rating`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rating: "pass", comment: "Looks good." }),
      },
    );
    const updatedRating = await updatedRatingResponse.json();
    const ratingsResponse = await api.request(
      `/api/v1/eval-runs/${run.data.run.id}/ratings`,
    );
    const ratings = await ratingsResponse.json();
    const auditResponse = await api.request(
      "/api/v1/audit-logs?action=eval.result.rate",
    );
    const audit = await auditResponse.json();

    expect(firstRatingResponse.status).toBe(200);
    expect(firstRating.data.rating).toBe("neutral");
    expect(firstRating.data.comment).toBe("Needs another reviewer.");
    expect(updatedRatingResponse.status).toBe(200);
    expect(updatedRating.data.id).toBe(firstRating.data.id);
    expect(updatedRating.data.rating).toBe("pass");
    expect(ratings.data).toHaveLength(1);
    expect(ratings.data[0].resultId).toBe(resultId);
    expect(audit.data).toHaveLength(2);
    const passAudit = audit.data.find(
      (log: { metadata: { rating?: string } }) =>
        log.metadata.rating === "pass",
    );
    expect(passAudit).toBeDefined();
    if (passAudit === undefined)
      throw new Error("Expected pass rating audit log.");
    expect(passAudit.metadata).toMatchObject({
      rating: "pass",
      hasComment: true,
    });
    expect(passAudit.metadata).not.toHaveProperty("comment");
  });
});
