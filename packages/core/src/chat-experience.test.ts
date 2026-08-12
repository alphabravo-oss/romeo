import { describe, expect, it } from "vitest";

import { createRomeoApi } from "./api";
import { InMemoryRomeoRepository } from "./repositories/in-memory";
import { createRuntimeSeedData } from "./repositories/seed-data";
import { EnvironmentSecretResolver } from "./services/secret-resolver";

describe("chat experience", () => {
  it("keeps the product runtime empty until the user starts a chat", () => {
    const seed = createRuntimeSeedData("2026-07-29T12:00:00.000Z");

    expect(seed.chats).toEqual([]);
    expect(
      seed.models.some((model) => model.id === "model_ollama_default"),
    ).toBe(false);
    expect(
      seed.models.find(
        (model) => model.id === "model_openai_compatible_default",
      )?.available,
    ).toBe(false);
    expect(
      seed.grants.some(
        (grant) =>
          grant.resourceType === "chat" && grant.resourceId === "chat_welcome",
      ),
    ).toBe(false);
  });

  it("always reports custom models on, including legacy rows without the field", async () => {
    const repository = new InMemoryRomeoRepository();
    await repository.upsertSystemSetting({
      key: "chat_experience.v1:org_default",
      value: { suggestions: [], autoTitleEnabled: true },
      updatedAt: "2026-07-29T12:00:00.000Z",
    });
    const api = createRomeoApi(repository, { startBackgroundWorkers: false });

    const response = await api.request("/api/v1/chat-experience");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.autoTitleEnabled).toBe(true);
    // Dual bare/assistant mode is retired.
    expect(body.data.assistantsEnabled).toBe(true);
  });

  it("ignores client attempts to turn custom models off", async () => {
    const repository = new InMemoryRomeoRepository();
    const api = createRomeoApi(repository, { startBackgroundWorkers: false });
    const put = (body: Record<string, unknown>) =>
      api.request("/api/v1/admin/chat-experience", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const legacyBody = { autoTitleEnabled: true, suggestions: [] };

    const off = await put({ ...legacyBody, assistantsEnabled: false });
    expect(off.status).toBe(200);
    expect((await off.json()).data.assistantsEnabled).toBe(true);

    const omitted = await put(legacyBody);
    expect(omitted.status).toBe(200);
    expect((await omitted.json()).data.assistantsEnabled).toBe(true);
  });

  it("audits chat-experience updates without reintroducing bare mode", async () => {
    const repository = new InMemoryRomeoRepository();
    const api = createRomeoApi(repository, { startBackgroundWorkers: false });
    const read = async () => {
      const response = await api.request("/api/v1/chat-experience");
      return (await response.json()).data;
    };
    const initial = await read();
    const put = (assistantsEnabled: boolean) =>
      api.request("/api/v1/admin/chat-experience", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...initial, assistantsEnabled }),
      });

    await put(true);
    await put(false);
    const settled = await read();
    const recorded = (await repository.listAuditLogs("org_default"))
      .filter((event) => event.action === "chat_experience.update")
      .map((event) => event.metadata.assistantsEnabled);

    expect(recorded).toHaveLength(2);
    expect(recorded.every((value) => value === true)).toBe(true);
    expect(settled.assistantsEnabled).toBe(true);
    expect(settled.suggestions).toEqual(initial.suggestions);
  });

  it("stores admin-managed starters and generates a governed title", async () => {
    const repository = new InMemoryRomeoRepository();
    const provider = await repository.getProvider("provider_openai_compatible");
    if (provider === undefined) throw new Error("Missing provider fixture");
    await repository.updateProvider({
      ...provider,
      baseUrl: "https://api.example.test/v1",
      credentialRef: "env://ROMEO_TITLE_TEST_KEY",
    });
    const api = createRomeoApi(repository, {
      startBackgroundWorkers: false,
      providerFetch: async () =>
        new Response(
          providerSse([
            {
              choices: [
                {
                  delta: { content: "Secure Milestone Rollout" },
                  finish_reason: "stop",
                },
              ],
            },
          ]),
          {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          },
        ),
      secretResolver: new EnvironmentSecretResolver({
        ROMEO_TITLE_TEST_KEY: "title-test-key",
      }),
    });

    const defaultsResponse = await api.request("/api/v1/chat-experience");
    const defaults = await defaultsResponse.json();
    expect(defaultsResponse.status).toBe(200);
    expect(defaults.data.autoTitleEnabled).toBe(true);
    expect(defaults.data.assistantsEnabled).toBe(true);
    expect(defaults.data.suggestions).toHaveLength(3);

    const settingsResponse = await api.request(
      "/api/v1/admin/chat-experience",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          autoTitleEnabled: true,
          assistantsEnabled: true,
          suggestions: [
            {
              title: "Review release readiness",
              prompt: "Review the release readiness evidence and gaps.",
            },
          ],
        }),
      },
    );
    expect(settingsResponse.status).toBe(200);
    const savedResponse = await api.request("/api/v1/chat-experience");
    const saved = await savedResponse.json();
    expect(saved.data.assistantsEnabled).toBe(true);

    const importedResponse = await api.request("/api/v1/chats/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        title: "Draft a secure rollout plan for Milestone 1",
        messages: [
          {
            id: "message_title_user",
            role: "user",
            content: "Draft a secure rollout plan for Milestone 1.",
          },
        ],
      }),
    });
    const imported = await importedResponse.json();
    const titleResponse = await api.request(
      `/api/v1/chats/${imported.data.id}/generate-title`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          modelId: "model_openai_compatible_default",
        }),
      },
    );
    const titled = await titleResponse.json();
    const audit = await repository.listAuditLogs("org_default");

    expect(titleResponse.status).toBe(200);
    expect(titled.data.title).toBe("Secure Milestone Rollout");
    expect(
      audit.some(
        (event) =>
          event.action === "chat_experience.update" &&
          event.metadata?.assistantsEnabled === true,
      ),
    ).toBe(true);
  });
});

function providerSse(events: unknown[]): ReadableStream<Uint8Array> {
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
