import type { BaseModel } from "@romeo/providers";
import { describe, expect, it } from "vitest";

import { createRomeoApi } from "./api";
import { InMemoryRomeoRepository } from "./repositories/in-memory";
import { buildCanonicalRunContext } from "./services/run-context-builder";

// Bare chat is request-time prompt suppression, not a special managed model: with assistants off
// the selected model's system prompt is simply not sent, so the provider model answers as itself.
// The agent is still selected and its version still pinned, which is what keeps a bare run
// attributable and keeps its safety settings enforcing.

const testModel = {
  id: "model_test",
  providerId: "provider_test",
  name: "test",
  displayName: "Test model",
  enabled: true,
  contextWindow: 128_000,
} as BaseModel;

const deployWindowMemory = {
  id: "content_memory",
  workspaceId: "workspace_default",
  kind: "memory",
  scope: "workspace",
  title: "Deploy window",
  body: "Ship on Tuesdays.",
  enabled: true,
  pinned: false,
  expired: false,
  ownerId: "user_dev_admin",
  createdAt: "2026-07-15T10:00:00.000Z",
  updatedAt: "2026-07-15T10:00:00.000Z",
} as const;

function assembledMessages(
  assistantsEnabled: boolean,
  memories: (typeof deployWindowMemory)[] = [deployWindowMemory],
) {
  return buildCanonicalRunContext({
    agentVersion: {
      memoryPolicy: { mode: "disabled" },
      systemPrompt: "You are Ada, the release captain.",
    },
    assistantsEnabled,
    history: [],
    knowledgeHits: [],
    memories: [...memories],
    model: testModel,
    preferences: { customInstructions: "Answer in limericks." },
    userContent: "Who are you?",
  }).messages;
}

describe("bare chat prompt suppression", () => {
  it("sends no system turn with assistants off and nothing else to say", () => {
    const messages = assembledMessages(false, []);

    expect(messages.some((message) => message.role === "system")).toBe(false);
    expect(messages[0]?.role).toBe("user");
  });

  it("withholds the persona and its personalization with assistants off", () => {
    // Both belong to the assistant, and the surface that shows or clears personalization is hidden
    // while assistants are off — keeping either would steer a supposedly bare reply with an
    // instruction the reader cannot see or remove.
    const suppressed = JSON.stringify(assembledMessages(false));

    expect(suppressed).not.toContain("Ada");
    expect(suppressed).not.toContain("Answer in limericks.");
  });

  it("still sends the user's own memories with assistants off", () => {
    // Memories are not the assistant's. Settings -> Memory stays visible with assistants off and
    // tells the user their memories may be sent as context, so dropping them here would make that
    // panel lie. The turn that carries them holds nothing of the persona.
    const systemTurns = assembledMessages(false).filter(
      (message) => message.role === "system",
    );

    expect(systemTurns).toHaveLength(1);
    expect(systemTurns[0]?.content).toContain("Ship on Tuesdays.");
    expect(systemTurns[0]?.content).not.toContain("Ada");
    expect(systemTurns[0]?.content).not.toContain("Answer in limericks.");
  });

  it("sends the persona system turn with assistants on", () => {
    const systemTurns = assembledMessages(true).filter(
      (message) => message.role === "system",
    );

    expect(systemTurns).toHaveLength(1);
    expect(systemTurns[0]?.content).toContain("Ada");
  });

  it("charges the suppressed prompt no context budget", () => {
    const bare = buildCanonicalRunContext({
      agentVersion: { memoryPolicy: { mode: "disabled" }, systemPrompt: "x" },
      assistantsEnabled: false,
      history: [],
      knowledgeHits: [],
      memories: [],
      model: testModel,
      preferences: {},
      userContent: "Who are you?",
    });
    const withoutPromptAtAll = buildCanonicalRunContext({
      agentVersion: { memoryPolicy: { mode: "disabled" }, systemPrompt: "" },
      assistantsEnabled: true,
      history: [],
      knowledgeHits: [],
      memories: [],
      model: testModel,
      preferences: {},
      userContent: "Who are you?",
    });

    expect(bare.estimatedInputTokens).toBe(
      withoutPromptAtAll.estimatedInputTokens,
    );
  });
});

describe("bare chat over the API", () => {
  it("suppresses the seeded persona's system turn until assistants are turned on", async () => {
    // Through the real routes, on the seeded persona managed model: this is the case the previous
    // pass-through-agent design missed, because no deployment ever had that seeded row.
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      startBackgroundWorkers: false,
    });
    const chat = await createChat(api);
    const persona = await agent(api, "agent_default");

    const off = await previewContext(api, chat.id, "agent_default");
    await setAssistantsEnabled(api, true);
    const on = await previewContext(api, chat.id, "agent_default");
    await setAssistantsEnabled(api, false);
    const offAgain = await previewContext(api, chat.id, "agent_default");

    const personaTurns = on.messages.filter(
      (message) => message.role === "system",
    );
    expect(persona.systemPrompt.trim().length).toBeGreaterThan(0);
    expect(off.messages.some((message) => message.role === "system")).toBe(
      false,
    );
    expect(personaTurns).toHaveLength(1);
    expect(personaTurns[0]?.content).toBe(persona.systemPrompt);
    expect(offAgain.messages.some((message) => message.role === "system")).toBe(
      false,
    );
  });

  it("still pins the agent version and enforces safety settings while bare", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      startBackgroundWorkers: false,
    });
    const updateResponse = await api.request("/api/v1/agents/agent_default", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        safetySettings: { blockedTerms: ["classified"] },
      }),
    });
    const publishResponse = await api.request(
      "/api/v1/agents/agent_default/versions",
      { method: "POST" },
    );
    const published = await publishResponse.json();
    const chat = await createChat(api);

    const blockedResponse = await startRun(
      api,
      chat.id,
      "Summarize the classified rollout.",
    );
    const blocked = await blockedResponse.json();
    const allowedResponse = await startRun(api, chat.id, "Summarize deploys.");
    const allowed = await allowedResponse.json();
    const preview = await previewContext(api, chat.id, "agent_default");

    expect(updateResponse.status).toBe(200);
    expect(publishResponse.status).toBe(201);
    // Bare, so nothing identifies the model in the request...
    expect(preview.messages.some((message) => message.role === "system")).toBe(
      false,
    );
    // ...yet the version the safety settings were published on is still what the run is attributed
    // to, which is the whole reason suppression happens at request time instead of via an agent
    // with an empty prompt.
    expect(blockedResponse.status).toBe(400);
    expect(blocked.error.code).toBe("agent_safety_blocked_term");
    expect(allowedResponse.status).toBe(202);
    expect(allowed.data.agentVersionId).toBe(published.data.id);
  });
});

async function agent(
  api: ReturnType<typeof createRomeoApi>,
  agentId: string,
): Promise<{ systemPrompt: string }> {
  const response = await api.request(`/api/v1/agents/${agentId}`);
  const body = await response.json();
  if (response.status !== 200) throw new Error(JSON.stringify(body));
  return body.data;
}

async function createChat(
  api: ReturnType<typeof createRomeoApi>,
): Promise<{ id: string }> {
  const response = await api.request("/api/v1/chats", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      workspaceId: "workspace_default",
      title: "Bare chat",
    }),
  });
  const body = await response.json();
  if (response.status !== 201) throw new Error(JSON.stringify(body));
  return body.data;
}

async function startRun(
  api: ReturnType<typeof createRomeoApi>,
  chatId: string,
  content: string,
): Promise<Response> {
  return api.request("/api/v1/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chatId, agentId: "agent_default", content }),
  });
}

async function previewContext(
  api: ReturnType<typeof createRomeoApi>,
  chatId: string,
  agentId: string,
): Promise<{ messages: Array<{ content: string; role: string }> }> {
  const response = await api.request("/api/v1/runs/context-preview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chatId, agentId, content: "Who are you?" }),
  });
  const body = await response.json();
  if (response.status !== 200) throw new Error(JSON.stringify(body));
  return body.data;
}

async function readChatExperience(
  api: ReturnType<typeof createRomeoApi>,
): Promise<{
  assistantsEnabled: boolean;
  suggestions: Array<{ prompt: string; title: string }>;
}> {
  const response = await api.request("/api/v1/chat-experience");
  const body = await response.json();
  if (response.status !== 200) throw new Error(JSON.stringify(body));
  return body.data;
}

async function setAssistantsEnabled(
  api: ReturnType<typeof createRomeoApi>,
  assistantsEnabled: boolean,
): Promise<void> {
  const current = await readChatExperience(api);
  const response = await api.request("/api/v1/admin/chat-experience", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...current, assistantsEnabled }),
  });
  if (response.status !== 200)
    throw new Error(JSON.stringify(await response.json()));
}
