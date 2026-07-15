import { describe, expect, it } from "vitest";

import { toAgentRecord, toAgentVersionRecord } from "./agent-repository";
import {
  toEvalCaseRecord,
  toEvalResultHumanRatingRecord,
} from "./eval-repository";

describe("agent repository mappers", () => {
  it("maps agent rows without exposing the internal slug", () => {
    const agent = toAgentRecord({
      id: "agent_1",
      orgId: "org_1",
      workspaceId: "workspace_1",
      name: "Support Agent",
      slug: "agent_1",
      createdBy: "user_1",
      baseModelId: "model_1",
      systemPrompt: "Help safely.",
      parameters: { temperature: 0.2, unsafe: { nested: true } },
      memoryPolicy: { mode: "recent_messages", maxMessages: 4 },
      safetySettings: {
        maxUserInputLength: 2000,
        blockedTerms: ["secret", 42],
      },
      voiceProfileId: null,
      publishedVersionId: "agent_version_1",
      createdAt: new Date("2026-06-27T00:00:00.000Z"),
      updatedAt: new Date("2026-06-27T00:05:00.000Z"),
    });

    expect(agent).toEqual({
      id: "agent_1",
      orgId: "org_1",
      workspaceId: "workspace_1",
      name: "Support Agent",
      createdBy: "user_1",
      baseModelId: "model_1",
      systemPrompt: "Help safely.",
      parameters: { temperature: 0.2, unsafe: { nested: true } },
      memoryPolicy: { mode: "recent_messages", maxMessages: 4 },
      safetySettings: {
        maxUserInputLength: 2000,
        blockedTerms: ["secret"],
      },
      publishedVersionId: "agent_version_1",
      updatedAt: "2026-06-27T00:05:00.000Z",
    });
    expect(JSON.stringify(agent)).not.toContain("slug");
  });

  it("maps published version binding snapshots conservatively", () => {
    const version = toAgentVersionRecord({
      id: "agent_version_1",
      agentId: "agent_1",
      orgId: "org_1",
      workspaceId: "workspace_1",
      version: 2,
      status: "draft",
      baseModelId: "model_1",
      systemPrompt: "Help safely.",
      parameters: {},
      memoryPolicy: {},
      safetySettings: [],
      voiceProfileId: null,
      knowledgeBaseBindings: [
        { knowledgeBaseId: "kb_1", enabled: false },
        { enabled: true },
      ],
      toolBindings: [
        { toolId: "tool_1", enabled: true, approvalRequired: true },
        { enabled: true },
      ],
      createdBy: "user_1",
      publishedAt: null,
      createdAt: new Date("2026-06-27T00:00:00.000Z"),
    });

    expect(version.status).toBe("published");
    expect(version.memoryPolicy).toEqual({ mode: "disabled" });
    expect(version.safetySettings).toEqual({});
    expect(version.knowledgeBaseBindings).toEqual([
      { knowledgeBaseId: "kb_1", enabled: false },
    ]);
    expect(version.toolBindings).toEqual([
      { toolId: "tool_1", enabled: true, approvalRequired: true },
    ]);
    expect(version.publishedAt).toBe("2026-06-27T00:00:00.000Z");
  });
});

describe("eval repository mappers", () => {
  it("maps eval rubric JSON with bounded primitive tool-call arguments", () => {
    const evalCase = toEvalCaseRecord({
      id: "case_1",
      orgId: "org_1",
      suiteId: "suite_1",
      input: "Answer with citations.",
      expectedContains: null,
      rubric: {
        mustContain: ["Romeo", 1],
        mustNotContain: ["secret"],
        minLength: 20,
        expectedToolCalls: [
          {
            name: "ticket.lookup",
            arguments: { ticketId: "T-1", includeHistory: true, nested: {} },
          },
          { arguments: { invalid: true } },
        ],
        requiredCitations: ["kb_1"],
      },
      requiresCitation: true,
      createdAt: new Date("2026-06-27T00:00:00.000Z"),
    });

    expect(evalCase.expectedContains).toBeUndefined();
    expect(evalCase.rubric).toEqual({
      mustContain: ["Romeo"],
      mustNotContain: ["secret"],
      minLength: 20,
      expectedToolCalls: [
        {
          name: "ticket.lookup",
          arguments: { ticketId: "T-1", includeHistory: true },
        },
      ],
      requiredCitations: ["kb_1"],
    });
  });

  it("normalizes invalid human ratings without dropping reviewer metadata", () => {
    const rating = toEvalResultHumanRatingRecord({
      id: "rating_1",
      orgId: "org_1",
      runId: "run_1",
      resultId: "result_1",
      reviewerId: "user_1",
      rating: "excellent",
      comment: null,
      createdAt: new Date("2026-06-27T00:00:00.000Z"),
      updatedAt: new Date("2026-06-27T00:05:00.000Z"),
    });

    expect(rating).toEqual({
      id: "rating_1",
      orgId: "org_1",
      runId: "run_1",
      resultId: "result_1",
      reviewerId: "user_1",
      rating: "neutral",
      createdAt: "2026-06-27T00:00:00.000Z",
      updatedAt: "2026-06-27T00:05:00.000Z",
    });
  });
});
