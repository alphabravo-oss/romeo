import { describe, expect, it } from "vitest";

import { createRomeoApi } from "./api";
import { InMemoryRomeoRepository } from "./repositories/in-memory";
import { testEnv } from "./test-support/env";

describe("persisted run context inspection API", () => {
  it("requires authentication and returns schema-bounded visible provenance", async () => {
    const rawReasoningSentinel = "hidden API reasoning sk-live-secret";
    const unauthorized = createRomeoApi(new InMemoryRomeoRepository(), {
      env: testEnv({ DEV_SEEDED_LOGIN: "false" }),
    });
    expect(
      (
        await unauthorized.request(
          "/api/v1/chats/chat_welcome/context-inspection",
        )
      ).status,
    ).toBe(401);

    const repository = new InMemoryRomeoRepository();
    await repository.createMessage({
      id: "message_context_api_input",
      chatId: "chat_welcome",
      role: "user",
      content: "Visible API context",
      createdAt: "2026-08-14T12:00:00.000Z",
    });
    await repository.createRun({
      id: "run_context_api",
      orgId: "org_default",
      workspaceId: "workspace_default",
      chatId: "chat_welcome",
      agentId: "agent_default",
      agentVersionId: "agent_version_default_v1",
      modelId: "model_openai_compatible_default",
      providerId: "provider_openai_compatible",
      status: "completed",
      createdBy: "user_dev_admin",
      createdAt: "2026-08-14T12:00:01.000Z",
      completedAt: "2026-08-14T12:00:02.000Z",
    });
    await repository.createMessage({
      id: "msg_run_terminal_run_context_api",
      chatId: "chat_welcome",
      role: "assistant",
      content: "Visible API answer",
      parentId: "message_context_api_input",
      createdAt: "2026-08-14T12:00:02.000Z",
    });
    await repository.appendRunEvents([
      {
        id: "event_context_api_reasoning",
        runId: "run_context_api",
        sequence: 1,
        schemaVersion: 1,
        type: "message.reasoning",
        data: {
          text: rawReasoningSentinel,
          authorization: "Bearer private-upstream-credential",
        },
        createdAt: "2026-08-14T12:00:01.500Z",
      },
      {
        id: "event_context_api_completed",
        runId: "run_context_api",
        sequence: 2,
        schemaVersion: 1,
        type: "run.completed",
        data: { providerBody: "hidden API provider body" },
        createdAt: "2026-08-14T12:00:02.000Z",
      },
    ]);
    const api = createRomeoApi(repository, {
      env: testEnv({ DEV_SEEDED_LOGIN: "true" }),
    });
    const response = await api.request(
      "/api/v1/chats/chat_welcome/context-inspection?runId=run_context_api",
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    const audit = await (await api.request("/api/v1/audit-logs")).json();
    expect(body).toMatchObject({
      data: {
        run: { id: "run_context_api", status: "completed" },
        branch: { inputMessageId: "message_context_api_input" },
        messages: [
          {
            id: "message_context_api_input",
            content: "Visible API context",
          },
        ],
        checkpoints: [{ sequence: 2, type: "run.completed" }],
      },
    });
    expect(JSON.stringify(body)).not.toContain("hidden API");
    expect(JSON.stringify({ audit, body })).not.toContain(rawReasoningSentinel);
    expect(JSON.stringify({ audit, body })).not.toContain(
      "private-upstream-credential",
    );
  });
});
