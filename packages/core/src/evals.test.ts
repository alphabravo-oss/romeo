import { createApiKeyToken, hashApiKey, seededSubject } from "@romeo/auth";
import { describe, expect, it, vi } from "vitest";

import { createRomeoApi } from "./api";
import { InMemoryRomeoRepository } from "./repositories/in-memory";
import { testEnv } from "./test-support/env";
import { ContentPolicyService } from "./services/content-policy-service";
import { CapabilityService } from "./services/capability-resolver";

describe("eval API", () => {
  it("creates one privacy-minimal eval case from negative message feedback", async () => {
    const repository = new InMemoryRomeoRepository();
    const api = createRomeoApi(repository);
    const createdAt = new Date().toISOString();
    await repository.createMessage({
      id: "msg_feedback_eval_user",
      chatId: "chat_welcome",
      role: "user",
      content: "Keep only this user prompt as the regression input.",
      createdAt,
    });
    await repository.createMessage({
      id: "msg_feedback_eval_assistant",
      chatId: "chat_welcome",
      role: "assistant",
      content: "RAW_NEGATIVE_ASSISTANT_RESPONSE_MUST_NOT_PERSIST",
      parentId: "msg_feedback_eval_user",
      createdAt,
    });
    const feedbackResponse = await api.request(
      "/api/v1/chats/chat_welcome/messages/msg_feedback_eval_assistant/feedback",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          rating: "negative",
          reasonCode: "RAW_FEEDBACK_REASON_MUST_NOT_PERSIST_IN_EVAL",
        }),
      },
    );
    const request = {
      agentId: "agent_default",
      chatId: "chat_welcome",
      messageId: "msg_feedback_eval_assistant",
      suiteName: "Product feedback regressions",
    };
    const firstResponse = await api.request(
      "/api/v1/eval-cases/from-message-feedback",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      },
    );
    const first = await firstResponse.json();
    const replayResponse = await api.request(
      "/api/v1/eval-cases/from-message-feedback",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      },
    );
    const replay = await replayResponse.json();
    const cases = await repository.listEvalCases(first.data.suiteId);
    const suite = await repository.getEvalSuite(first.data.suiteId);
    const audits = (await repository.listAuditLogs("org_default")).filter(
      (log) => log.action === "eval.case.create_from_feedback",
    );
    const publicPayload = JSON.stringify({ first, replay, audits });

    expect(feedbackResponse.status).toBe(200);
    expect(firstResponse.status).toBe(201);
    expect(first.data).toMatchObject({
      created: true,
      redaction: {
        evalInputReturned: false,
        assistantContentPersisted: false,
        assistantContentReturned: false,
        feedbackReasonPersisted: false,
        feedbackReasonReturned: false,
        reviewerIdentityPersisted: false,
        reviewerIdentityReturned: false,
      },
    });
    expect(replayResponse.status).toBe(200);
    expect(replay.data).toMatchObject({
      suiteId: first.data.suiteId,
      caseId: first.data.caseId,
      created: false,
    });
    expect(suite?.name).toBe("Product feedback regressions");
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({
      id: first.data.caseId,
      input: "Keep only this user prompt as the regression input.",
      requiresCitation: false,
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]?.metadata).toMatchObject({
      agentId: "agent_default",
      suiteId: first.data.suiteId,
      chatId: "chat_welcome",
      messageId: "msg_feedback_eval_assistant",
      sourceRating: "negative",
    });
    expect(audits[0]?.metadata).not.toHaveProperty("input");
    expect(audits[0]?.metadata).not.toHaveProperty("reviewerId");
    expect(publicPayload).not.toContain(
      "Keep only this user prompt as the regression input.",
    );
    expect(JSON.stringify(cases)).not.toContain(
      "RAW_NEGATIVE_ASSISTANT_RESPONSE_MUST_NOT_PERSIST",
    );
    expect(JSON.stringify(cases)).not.toContain(
      "RAW_FEEDBACK_REASON_MUST_NOT_PERSIST_IN_EVAL",
    );
  });

  it("appends feedback to an existing agent suite and rejects non-negative sources", async () => {
    const repository = new InMemoryRomeoRepository();
    const api = createRomeoApi(repository);
    const createdAt = new Date().toISOString();
    await repository.createMessage({
      id: "msg_feedback_append_user",
      chatId: "chat_welcome",
      role: "user",
      content: "Append this prompt.",
      createdAt,
    });
    await repository.createMessage({
      id: "msg_feedback_append_assistant",
      chatId: "chat_welcome",
      role: "assistant",
      content: "An answer that received negative feedback.",
      parentId: "msg_feedback_append_user",
      createdAt,
    });
    await repository.createMessage({
      id: "msg_feedback_positive_assistant",
      chatId: "chat_welcome",
      role: "assistant",
      content: "An answer without negative feedback.",
      parentId: "msg_feedback_append_user",
      createdAt,
    });
    await api.request(
      "/api/v1/chats/chat_welcome/messages/msg_feedback_append_assistant/feedback",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rating: "negative" }),
      },
    );
    await api.request(
      "/api/v1/chats/chat_welcome/messages/msg_feedback_positive_assistant/feedback",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rating: "positive" }),
      },
    );
    const suiteResponse = await api.request("/api/v1/eval-suites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentId: "agent_default",
        name: "Existing suite",
        cases: [{ input: "Existing case." }],
      }),
    });
    const suite = await suiteResponse.json();
    const appendResponse = await api.request(
      "/api/v1/eval-cases/from-message-feedback",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agentId: "agent_default",
          chatId: "chat_welcome",
          messageId: "msg_feedback_append_assistant",
          suiteId: suite.data.suite.id,
        }),
      },
    );
    const appended = await appendResponse.json();
    const rejectedResponse = await api.request(
      "/api/v1/eval-cases/from-message-feedback",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agentId: "agent_default",
          chatId: "chat_welcome",
          messageId: "msg_feedback_positive_assistant",
          suiteId: suite.data.suite.id,
        }),
      },
    );
    const rejected = await rejectedResponse.json();
    const cases = await repository.listEvalCases(suite.data.suite.id);

    expect(appendResponse.status).toBe(201);
    expect(appended.data).toMatchObject({
      suiteId: suite.data.suite.id,
      created: true,
    });
    expect(cases.map((item) => item.input)).toEqual([
      "Existing case.",
      "Append this prompt.",
    ]);
    expect(rejectedResponse.status).toBe(409);
    expect(rejected.error.code).toBe("negative_message_feedback_required");
  });

  it("requires agent edit authority and permits a granted non-admin editor", async () => {
    const repository = new InMemoryRomeoRepository();
    const seededApi = createRomeoApi(repository, {
      startBackgroundWorkers: false,
    });
    const createdAt = new Date().toISOString();
    await repository.createMessage({
      id: "msg_feedback_auth_user",
      chatId: "chat_welcome",
      role: "user",
      content: "Authorization regression prompt.",
      createdAt,
    });
    await repository.createMessage({
      id: "msg_feedback_auth_assistant",
      chatId: "chat_welcome",
      role: "assistant",
      content: "Negatively rated answer.",
      parentId: "msg_feedback_auth_user",
      createdAt,
    });
    await seededApi.request(
      "/api/v1/chats/chat_welcome/messages/msg_feedback_auth_assistant/feedback",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rating: "negative" }),
      },
    );
    await repository.createResourceGrant({
      id: "grant_feedback_eval_editor",
      resourceType: "agent",
      resourceId: "agent_default",
      principalType: "user",
      principalId: "user_dev_admin",
      permission: "write",
    });
    const readerToken = createApiKeyToken();
    const editorToken = createApiKeyToken();
    await repository.createApiKey({
      id: "api_key_feedback_eval_reader",
      orgId: "org_default",
      userId: "user_dev_admin",
      name: "Feedback eval reader",
      hashedToken: await hashApiKey(readerToken),
      scopes: ["chats:read"],
      createdAt,
    });
    await repository.createApiKey({
      id: "api_key_feedback_eval_editor",
      orgId: "org_default",
      userId: "user_dev_admin",
      name: "Feedback eval editor",
      hashedToken: await hashApiKey(editorToken),
      scopes: ["chats:read", "agents:write"],
      createdAt,
    });
    const secureApi = createRomeoApi(repository, {
      env: testEnv({ DEV_SEEDED_LOGIN: "false" }),
      startBackgroundWorkers: false,
    });
    const body = JSON.stringify({
      agentId: "agent_default",
      chatId: "chat_welcome",
      messageId: "msg_feedback_auth_assistant",
    });
    const readerResponse = await secureApi.request(
      "/api/v1/eval-cases/from-message-feedback",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${readerToken}`,
          "content-type": "application/json",
        },
        body,
      },
    );
    const editorResponse = await secureApi.request(
      "/api/v1/eval-cases/from-message-feedback",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${editorToken}`,
          "content-type": "application/json",
        },
        body,
      },
    );

    expect(readerResponse.status).toBe(403);
    expect(editorResponse.status).toBe(201);
  });

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
    const publishResponse = await api.request(
      "/api/v1/agents/agent_default/versions",
      { method: "POST" },
    );
    const published = await publishResponse.json();
    const versionsResponse = await api.request(
      "/api/v1/agents/agent_default/versions",
    );
    const versions = await versionsResponse.json();
    const evidenceResponse = await api.request(
      "/api/v1/agents/agent_default/eval-release-candidate-evidence",
    );
    const evidence = await evidenceResponse.json();
    const evidenceSerialized = JSON.stringify(evidence);

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

  it("persists safe reasoning evidence and reconciled reported usage", async () => {
    const repository = new InMemoryRomeoRepository();
    const model = await repository.getModel("model_openai_compatible_default");
    const provider = await repository.getProvider("provider_openai_compatible");
    await repository.updateProvider({
      ...provider!,
      credentialRef: "env://EVAL_TEST_KEY",
    });
    await repository.updateModel({
      ...model!,
      pricing: { inputTokenUsd: 0.01, outputTokenUsd: 0.02 },
    });
    await new ContentPolicyService(repository).update({
      subject: seededSubject,
      detectors: { email_address: "redact" },
    });
    const rawReasoning = "RAW_PRIVATE_REASONING_private@example.com";
    const providerFetch = vi.fn<typeof fetch>(
      async () =>
        new Response(
          evalSse([
            { choices: [{ delta: { reasoning_content: rawReasoning } }] },
            { choices: [{ delta: { content: "Answer private@example.com" } }] },
            {
              choices: [],
              usage: {
                prompt_tokens: 5,
                completion_tokens: 8,
                completion_tokens_details: { reasoning_tokens: 3 },
                total_tokens: 13,
              },
            },
          ]),
          { status: 200 },
        ),
    );
    const api = createRomeoApi(repository, {
      providerFetch,
      secretResolver: {
        async check() {
          return { available: true, scheme: "env" };
        },
        async resolveValue() {
          return { available: true, scheme: "env", value: "test-key" };
        },
      },
    });
    const created = await (
      await api.request("/api/v1/eval-suites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agentId: "agent_default",
          name: "Reasoning accounting",
          cases: [
            {
              input: "Return the governed answer",
              expectedContains: "[REDACTED:EMAIL_ADDRESS]",
            },
          ],
        }),
      })
    ).json();
    const runResponse = await api.request(
      `/api/v1/eval-suites/${created.data.suite.id}/runs`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reasoningPolicy: { schemaVersion: 1, mode: "off" },
        }),
      },
    );
    const completed = await runResponse.json();
    const repeatedResponse = await api.request(
      `/api/v1/eval-suites/${created.data.suite.id}/runs`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reasoningPolicy: { schemaVersion: 1, mode: "off" },
        }),
      },
    );
    const repeated = await repeatedResponse.json();
    const comparisonResponse = await api.request(
      `/api/v1/eval-suites/${created.data.suite.id}/reasoning-comparison`,
    );
    const comparison = await comparisonResponse.json();
    await new CapabilityService(repository).updateAssignment({
      subject: seededSubject,
      capabilityId: "reasoning_policy",
      scope: { scopeType: "workspace", scopeId: "workspace_default" },
      state: "disabled",
      configuration: {},
      reason: "Eval policy cap regression",
      expectedVersion: 0,
    });
    const rejectedResponse = await api.request(
      `/api/v1/eval-suites/${created.data.suite.id}/runs`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reasoningPolicy: {
            schemaVersion: 1,
            mode: "auto",
            effort: "high",
          },
        }),
      },
    );
    const serialized = JSON.stringify({ completed, comparison });

    expect(runResponse.status).toBe(202);
    expect(completed.data.run.reasoningPolicy).toEqual({
      requested: { schemaVersion: 1, mode: "off" },
      effective: { schemaVersion: 1, mode: "off" },
    });
    expect(completed.data.run.metrics).toMatchObject({
      usage: {
        coverage: "complete",
        inputTokens: 5,
        outputTokens: 8,
        reasoningTokens: 3,
        source: "openai-compatible",
      },
      costBasis: "reported_tokens",
    });
    expect(completed.data.run.metrics.estimatedCostUsd).toBeCloseTo(0.21);
    expect(completed.data.results[0].output).toContain(
      "[REDACTED:EMAIL_ADDRESS]",
    );
    expect(comparisonResponse.status).toBe(200);
    expect(comparison.data.variants[0]).toMatchObject({
      runCount: 2,
      reportedInputTokens: 10,
      reportedOutputTokens: 16,
      reportedReasoningTokens: 6,
    });
    expect(comparison.data.variants[0].estimatedCostUsd).toBeCloseTo(0.42);
    expect(repeated.data.run.id).not.toBe(completed.data.run.id);
    expect(repeated.data.run.metrics.usage).toEqual(
      completed.data.run.metrics.usage,
    );
    expect(repeated.data.run.metrics.estimatedCostUsd).toBeCloseTo(
      completed.data.run.metrics.estimatedCostUsd,
    );
    expect(rejectedResponse.status).toBe(400);
    expect(providerFetch).toHaveBeenCalledTimes(2);
    expect(serialized).not.toContain(rawReasoning);
    expect(serialized).not.toContain("private@example.com");
  });

  it("does not persist a run or retry implicitly after a network failure", async () => {
    const repository = new InMemoryRomeoRepository();
    const provider = await repository.getProvider("provider_openai_compatible");
    await repository.updateProvider({
      ...provider!,
      credentialRef: "env://EVAL_NETWORK_KEY",
    });
    const providerFetch = vi.fn<typeof fetch>(async () => {
      throw new TypeError("network failure with sk-private-secret");
    });
    const api = createRomeoApi(repository, {
      providerFetch,
      secretResolver: {
        async check() {
          return { available: true, scheme: "env" };
        },
        async resolveValue() {
          return { available: true, scheme: "env", value: "test-key" };
        },
      },
    });
    const created = await (
      await api.request("/api/v1/eval-suites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agentId: "agent_default",
          name: "Network failure",
          cases: [{ input: "Safe input" }],
        }),
      })
    ).json();
    const response = await api.request(
      `/api/v1/eval-suites/${created.data.suite.id}/runs`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reasoningPolicy: { schemaVersion: 1, mode: "off" },
        }),
      },
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(providerFetch).toHaveBeenCalledTimes(1);
    expect(await repository.listEvalRuns("agent_default")).toEqual([]);
    expect(JSON.stringify(body)).not.toContain("sk-private-secret");
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
      metric: "llm.total_token.reported",
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
      activityEventCount: 1,
      eventCount: 1,
      estimatedCostUsd: 0.25,
    });
    expect(summary.data.window.to).toEqual(expect.any(String));
    expect(summary.data.attention.models.length).toBeGreaterThan(0);
    expect(csv).toContain("usage,org,org_default,activity_event_count,1");
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

  it("does not expose multi-model comparison workflows", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());
    const response = await api.request(
      "/api/v1/eval-suites/eval_suite_default/model-comparisons",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ modelIds: ["model_1", "model_2"] }),
      },
    );

    expect(response.status).toBe(404);
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

function evalSse(events: unknown[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const event of events)
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}
