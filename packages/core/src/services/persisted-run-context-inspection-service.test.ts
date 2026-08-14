import { seededSubject, type AuthSubject } from "@romeo/auth";
import { describe, expect, it } from "vitest";

import type { RunRecord } from "../domain/entities";
import { InMemoryRomeoRepository } from "../repositories/in-memory";
import { PersistedRunContextInspectionService } from "./persisted-run-context-inspection-service";

const run: RunRecord = {
  id: "run_context_inspection",
  orgId: "org_default",
  workspaceId: "workspace_default",
  chatId: "chat_context_inspection",
  agentId: "agent_default",
  agentVersionId: "agent_version_default_v1",
  modelId: "model_openai_compatible_default",
  providerId: "provider_openai_compatible",
  status: "completed",
  createdBy: "user_dev_admin",
  createdAt: "2026-08-14T12:02:00.000Z",
  completedAt: "2026-08-14T12:03:00.000Z",
};

async function fixture() {
  const repository = new InMemoryRomeoRepository();
  await repository.createChat({
    id: run.chatId,
    orgId: run.orgId,
    workspaceId: run.workspaceId,
    title: "Context inspection",
    createdBy: run.createdBy,
    updatedAt: "2026-08-14T12:00:00.000Z",
  });
  await repository.createMessage({
    id: "message_context_root",
    chatId: run.chatId,
    role: "assistant",
    content: "Visible prior response",
    createdAt: "2026-08-14T12:00:00.000Z",
  });
  await repository.createMessage({
    id: "message_context_input",
    chatId: run.chatId,
    role: "user",
    content: `Visible user request ${"x".repeat(20_050)}`,
    parentId: "message_context_root",
    createdAt: "2026-08-14T12:01:00.000Z",
  });
  await repository.createRun(run);
  await repository.createMessage({
    id: `msg_run_terminal_${run.id}`,
    chatId: run.chatId,
    role: "assistant",
    content: "Visible current response",
    citations: [
      {
        chunkId: "chunk_private",
        documentId: "source_private",
        title: "Persisted source title",
      },
      {
        chunkId: "web_result_1",
        documentId: "web_result_1",
        title: "Public web result",
        sourceType: "web_search",
        sourceUri: "https://secret.example/?token=never-return",
      },
    ],
    parentId: "message_context_input",
    createdAt: run.completedAt!,
  });
  await repository.createKnowledgeSource({
    id: "source_private",
    knowledgeBaseId: "kb_default",
    orgId: run.orgId,
    workspaceId: run.workspaceId,
    fileName: "Current authorized source.pdf",
    mimeType: "application/pdf",
    sizeBytes: 42,
    status: "indexed",
    metadata: {},
    createdAt: "2026-08-14T11:00:00.000Z",
    updatedAt: "2026-08-14T11:00:00.000Z",
  });
  await repository.appendRunEvents([
    {
      id: "event_context_reasoning",
      runId: run.id,
      sequence: 1,
      schemaVersion: 1,
      type: "message.reasoning",
      data: { text: "hidden chain of thought sentinel" },
      createdAt: "2026-08-14T12:02:01.000Z",
    },
    {
      id: "event_context_summary_delta",
      runId: run.id,
      sequence: 2,
      schemaVersion: 1,
      type: "reasoning.summary.delta",
      data: {
        classification: "provider_safe_summary",
        contentPolicyApplied: true,
        text: "provider-safe-summary-context-secret",
      },
      createdAt: "2026-08-14T12:02:01.500Z",
    },
    {
      id: "event_context_summary_completed",
      runId: run.id,
      sequence: 3,
      schemaVersion: 1,
      type: "reasoning.summary.completed",
      data: {
        classification: "provider_safe_summary",
        status: "completed",
        durationMs: 1_500,
        reasoningTokens: 12,
      },
      createdAt: "2026-08-14T12:02:01.600Z",
    },
    {
      id: "event_context_retrieval",
      runId: run.id,
      sequence: 4,
      schemaVersion: 1,
      type: "retrieval.completed",
      data: {
        citationCount: 2,
        safety: {
          promptInjectionSkippedCount: 3,
          policyMatchText: "never expose policy match text",
        },
      },
      createdAt: "2026-08-14T12:02:02.000Z",
    },
    {
      id: "event_context_terminal",
      runId: run.id,
      sequence: 5,
      schemaVersion: 1,
      type: "run.completed",
      data: {
        providerFallback: {
          toModelId: "model_ollama_default",
          toProviderId: "provider_ollama",
        },
        providerBody: "never expose provider body",
      },
      createdAt: run.completedAt!,
    },
  ]);
  await repository.createToolCall({
    id: "tool_call_context",
    orgId: run.orgId,
    workspaceId: run.workspaceId,
    agentId: run.agentId,
    actorId: run.createdBy,
    toolId: "tool_sensitive",
    status: "success",
    riskLevel: "high",
    approvalRequired: true,
    inputKeys: ["secretInputKey"],
    outputKeys: ["secretOutputKey"],
    runId: run.id,
    startedAt: "2026-08-14T12:02:10.000Z",
    completedAt: "2026-08-14T12:02:11.000Z",
  });
  await repository.createUsageEvent({
    id: "usage_context_input",
    orgId: run.orgId,
    workspaceId: run.workspaceId,
    actorId: run.createdBy,
    sourceType: "run",
    sourceId: run.id,
    metric: "llm.input_token.estimated",
    quantity: 100,
    unit: "token",
    metadata: {
      historyTruncated: true,
      knowledgeHitsDropped: 2,
      rawPrompt: "never expose raw usage prompt",
    },
    createdAt: run.createdAt,
  });
  return {
    repository,
    service: new PersistedRunContextInspectionService(repository),
  };
}

describe("PersistedRunContextInspectionService", () => {
  it("returns bounded actual provenance without hidden payloads", async () => {
    const { service } = await fixture();
    const result = await service.inspect({
      chatId: run.chatId,
      runId: run.id,
      subject: seededSubject,
    });

    expect(result).toMatchObject({
      run: { id: run.id, agentVersionId: run.agentVersionId },
      branch: {
        inputMessageId: "message_context_input",
        parentMessageId: "message_context_root",
      },
      model: {
        id: "model_ollama_default",
        displayName: "Ollama llama3.2",
        available: true,
      },
      provider: {
        id: "provider_ollama",
        displayName: "Local Ollama",
        available: true,
      },
      knowledge: {
        totalCitationCount: 2,
        revokedOrUnavailableCount: 0,
      },
      tools: [
        {
          toolId: "tool_sensitive",
          status: "success",
          riskLevel: "high",
          approvalRequired: true,
        },
      ],
    });
    expect(result?.messages).toHaveLength(2);
    expect(result?.messages[1]).toMatchObject({
      id: "message_context_input",
      contentTruncated: true,
    });
    expect(result?.messages[1]?.content).toHaveLength(20_000);
    expect(result?.checkpoints.map((item) => item.type)).toEqual([
      "reasoning.summary.completed",
      "retrieval.completed",
      "run.completed",
    ]);
    expect(result?.knowledge.citations).toEqual([
      {
        chunkId: "chunk_private",
        documentId: "source_private",
        title: "Current authorized source.pdf",
      },
      {
        chunkId: "web_result_1",
        documentId: "web_result_1",
        title: "Public web result",
        sourceType: "web_search",
      },
    ]);
    expect(result?.transformations).toEqual([
      { type: "content_policy_applied" },
      { type: "history_trimmed" },
      { type: "knowledge_dropped", count: 2 },
      { type: "knowledge_prompt_injection_filtered", count: 3 },
      { type: "provider_fallback" },
    ]);
    const serialized = JSON.stringify(result);
    for (const secret of [
      "hidden chain of thought sentinel",
      "provider-safe-summary-context-secret",
      "never expose policy match text",
      "never expose provider body",
      "never expose raw usage prompt",
      "secretInputKey",
      "secretOutputKey",
      "token=never-return",
    ])
      expect(serialized).not.toContain(secret);
  });

  it("rechecks current knowledge and run access without leaking other chats", async () => {
    const { service } = await fixture();
    const { adminRole: _adminRole, ...nonAdminSubject } = seededSubject;
    const withoutKnowledge: AuthSubject = {
      ...nonAdminSubject,
      isAdmin: false,
      scopes: ["chats:read", "runs:read"],
    };
    const result = await service.inspect({
      chatId: run.chatId,
      subject: withoutKnowledge,
    });
    expect(result?.knowledge).toMatchObject({
      totalCitationCount: 2,
      revokedOrUnavailableCount: 1,
      citations: [
        {
          documentId: "web_result_1",
          sourceType: "web_search",
        },
      ],
    });

    await expect(
      service.inspect({
        chatId: run.chatId,
        subject: {
          ...withoutKnowledge,
          id: "other_user",
          orgId: "other_org",
          workspaceIds: ["other_workspace"],
        },
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("returns an authorized empty state and privacy-safe missing run", async () => {
    const repository = new InMemoryRomeoRepository();
    const service = new PersistedRunContextInspectionService(repository);
    await expect(
      service.inspect({ chatId: "chat_welcome", subject: seededSubject }),
    ).resolves.toBeNull();
    await expect(
      service.inspect({
        chatId: "chat_welcome",
        runId: "missing_run",
        subject: seededSubject,
      }),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
  });
});
