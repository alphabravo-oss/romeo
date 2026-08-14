import { seededSubject } from "@romeo/auth";
import { describe, expect, it, vi } from "vitest";

import { createRomeoApi } from "./api";
import type { RunRecord } from "./domain/entities";
import {
  createRuntimeSeedData,
  InMemoryRomeoRepository,
} from "./repositories/in-memory";
import { ChatService } from "./services/chat-service";
import {
  ContentPolicyService,
  enforceContentPolicyText,
  enforceContentPolicyValue,
} from "./services/content-policy-service";
import { OpenAiEmbeddingsService } from "./services/openai-embeddings-service";
import { OpenWebUiCompatibilityService } from "./services/openwebui-compatibility-service";
import { RunEventSequencer } from "./services/run-event-sequencer";
import { persistTerminalRun } from "./services/run-terminal-effects";
import { reasoningPolicySettingKey } from "./services/reasoning-capability-policy";
import { EnvironmentSecretResolver } from "./services/secret-resolver";

describe("content policy", () => {
  it("detects Luhn-valid cards, email, SSN and API tokens without returning raw matches", async () => {
    const repository = new InMemoryRomeoRepository();
    const service = new ContentPolicyService(repository);
    await service.update({
      subject: seededSubject,
      detectors: {
        credit_card: "audit",
        email_address: "audit",
        us_ssn: "audit",
        api_token: "audit",
      },
    });
    const sentinel =
      "card 4242 4242 4242 4242 invalid 4242 4242 4242 4241 email private@example.com ssn 123-45-6789 token sk-abcdefghijklmnopqrstuvwxyz123456";
    const result = await service.simulate({
      subject: seededSubject,
      content: sentinel,
    });

    expect(result.detections).toEqual([
      { code: "credit_card", count: 1, action: "audit" },
      { code: "email_address", count: 1, action: "audit" },
      { code: "us_ssn", count: 1, action: "audit" },
      { code: "api_token", count: 1, action: "audit" },
    ]);
    expect(JSON.stringify(result)).not.toContain("private@example.com");
    const audits = await repository.listAuditLogs(seededSubject.orgId);
    expect(JSON.stringify(audits)).not.toContain("private@example.com");
    expect(JSON.stringify(audits)).not.toContain("4242 4242");
    expect(JSON.stringify(audits)).not.toContain(
      "sk-abcdefghijklmnopqrstuvwxyz",
    );
  });

  it("redacts nested values while preserving object shape", async () => {
    const repository = new InMemoryRomeoRepository();
    const service = new ContentPolicyService(repository);
    await service.update({
      subject: seededSubject,
      detectors: { email_address: "redact", us_ssn: "redact" },
    });
    const result = await enforceContentPolicyValue(repository, seededSubject, {
      recipient: "private@example.com",
      nested: ["SSN 123-45-6789", 7],
    });

    expect(result.value).toEqual({
      recipient: "[REDACTED:EMAIL_ADDRESS]",
      nested: ["SSN [REDACTED:US_SSN]", 7],
    });
  });

  it("blocks before provider target resolution or transport side effects", async () => {
    const repository = new InMemoryRomeoRepository();
    const policy = new ContentPolicyService(repository);
    await policy.update({
      subject: seededSubject,
      detectors: { api_token: "block" },
    });
    const fetchImpl = vi.fn<typeof fetch>();
    const embeddings = new OpenAiEmbeddingsService(repository, { fetchImpl });

    await expect(
      embeddings.create({
        subject: seededSubject,
        request: {
          model: "model-that-does-not-exist",
          input: ["sk-abcdefghijklmnopqrstuvwxyz123456"],
        },
      }),
    ).rejects.toMatchObject({
      code: "content_policy_blocked",
      status: 403,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await repository.listUsageEvents(seededSubject.orgId)).toEqual([]);
  });

  it("provides authorized admin report, update and privacy-safe simulation APIs", async () => {
    const repository = new InMemoryRomeoRepository();
    const api = createRomeoApi(repository);
    const update = await api.request("/api/v1/admin/content-policy", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        detectors: { email_address: "redact", credit_card: "block" },
      }),
    });
    const report = await api.request("/api/v1/admin/content-policy");
    const sentinel = "secret-person@example.com card 4242424242424242";
    const simulation = await api.request(
      "/api/v1/admin/content-policy/simulate",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: sentinel }),
      },
    );
    const updateBody = await update.json();
    const reportBody = await report.json();
    const simulationBody = await simulation.json();

    expect(update.status).toBe(200);
    expect(report.status).toBe(200);
    expect(simulation.status).toBe(200);
    expect(updateBody.data.detectors.email_address).toBe("redact");
    expect(reportBody.data.redaction).toEqual({
      rawContentReturned: false,
      rawMatchesReturned: false,
      detectorPatternsReturned: false,
    });
    expect(simulationBody.data.action).toBe("block");
    expect(JSON.stringify(simulationBody)).not.toContain(
      "secret-person@example.com",
    );
    expect(JSON.stringify(await repository.listSystemSettings())).not.toContain(
      sentinel,
    );
  });

  it("rejects non-admin report, update, and simulation requests without echoing content", async () => {
    const repository = new InMemoryRomeoRepository();
    const api = createRomeoApi(repository);
    const authorization = await api.request("/api/v1/device-authorizations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "limited", scopes: ["me:read"] }),
    });
    const credentials = await authorization.json();
    const headers = {
      authorization: `Bearer ${credentials.data.accessToken}`,
      "content-type": "application/json",
    };
    const sentinel = "unauthorized-route-secret@example.com";
    const [report, update, simulation] = await Promise.all([
      api.request("/api/v1/admin/content-policy", { headers }),
      api.request("/api/v1/admin/content-policy", {
        method: "PATCH",
        headers,
        body: JSON.stringify({ detectors: { email_address: "redact" } }),
      }),
      api.request("/api/v1/admin/content-policy/simulate", {
        method: "POST",
        headers,
        body: JSON.stringify({ content: sentinel }),
      }),
    ]);

    expect([report.status, update.status, simulation.status]).toEqual([
      403, 403, 403,
    ]);
    expect(
      JSON.stringify(
        await Promise.all([report.json(), update.json(), simulation.json()]),
      ),
    ).not.toContain(sentinel);
    expect(await repository.listSystemSettings()).toEqual([]);
  });

  it("governs chat-transfer, OpenWebUI import, and channel content before persistence", async () => {
    const repository = new InMemoryRomeoRepository();
    const policy = new ContentPolicyService(repository);
    await policy.update({
      subject: seededSubject,
      detectors: { email_address: "redact", api_token: "block" },
    });
    const chats = new ChatService(repository);
    const compatibility = new OpenWebUiCompatibilityService(repository);

    const chatsBeforeBlockedImport =
      await repository.listChats("workspace_default");
    await expect(
      chats.importChat({
        workspaceId: "workspace_default",
        subject: seededSubject,
        messages: [
          {
            role: "user",
            content: "sk-abcdefghijklmnopqrstuvwxyz123456",
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "content_policy_blocked", status: 403 });
    expect(await repository.listChats("workspace_default")).toHaveLength(
      chatsBeforeBlockedImport.length,
    );

    const transferred = await chats.importChat({
      workspaceId: "workspace_default",
      subject: seededSubject,
      messages: [{ role: "user", content: "transfer-secret@example.com" }],
    });
    const imported = await compatibility.createChat(seededSubject, {
      chat: {
        title: "Governed import",
        messages: [{ role: "user", content: "openwebui-secret@example.com" }],
      },
    });
    const channel = await compatibility.createChannel(seededSubject, {
      name: "Governed channel",
    });
    const posted = await compatibility.postChannelMessage(
      seededSubject,
      channel.id,
      { content: "channel-secret@example.com" },
    );
    const persisted = [
      ...(await repository.listMessages(transferred.id)),
      ...(await repository.listMessages(imported.id)),
    ];

    expect(persisted.map((message) => message.content)).toEqual([
      "[REDACTED:EMAIL_ADDRESS]",
      "[REDACTED:EMAIL_ADDRESS]",
    ]);
    expect(posted.content).toBe("[REDACTED:EMAIL_ADDRESS]");
    const repositoryState = JSON.stringify({
      messages: await Promise.all(
        (await repository.listChats("workspace_default")).map((chat) =>
          repository.listMessages(chat.id),
        ),
      ),
      audits: await repository.listAuditLogs(seededSubject.orgId),
    });
    for (const sentinel of [
      "sk-abcdefghijklmnopqrstuvwxyz123456",
      "transfer-secret@example.com",
      "openwebui-secret@example.com",
      "channel-secret@example.com",
    ]) {
      expect(repositoryState).not.toContain(sentinel);
    }
  });

  it("redacts assembled provider output before assistant-message persistence", async () => {
    const repository = new InMemoryRomeoRepository(createRuntimeSeedData());
    await new ContentPolicyService(repository).update({
      subject: seededSubject,
      detectors: { email_address: "redact" },
    });
    const run: RunRecord = {
      id: "run_content_policy_output",
      orgId: seededSubject.orgId,
      workspaceId: "workspace_default",
      chatId: "chat_welcome",
      agentId: "agent_default",
      agentVersionId: "agent_version_default_v1",
      modelId: "model_openai_compatible_default",
      providerId: "provider_openai_compatible",
      status: "running",
      createdBy: seededSubject.id,
      createdAt: "2026-08-13T12:00:00.000Z",
    };
    await repository.createRun(run);

    await persistTerminalRun(repository, new RunEventSequencer(), {
      run,
      subject: seededSubject,
      status: "completed",
      assistantContent: "Contact provider-output-secret@example.com",
    });

    const assistant = await repository.getMessage(`msg_run_terminal_${run.id}`);
    expect(assistant?.content).toBe("Contact [REDACTED:EMAIL_ADDRESS]");
    expect(
      JSON.stringify({
        assistant,
        audits: await repository.listAuditLogs(seededSubject.orgId),
      }),
    ).not.toContain("provider-output-secret@example.com");
  });

  it("blocks a provider-safe summary secret split across chunks without blocking the answer", async () => {
    const repository = new InMemoryRomeoRepository();
    await new ContentPolicyService(repository).update({
      subject: seededSubject,
      detectors: { us_ssn: "block" },
    });
    await repository.upsertSystemSetting({
      key: reasoningPolicySettingKey(seededSubject.orgId),
      value: {
        policy: {
          schemaVersion: 1,
          mode: "summary",
          retainSummary: true,
        },
      },
      updatedAt: "2026-08-14T12:00:00.000Z",
    });
    const provider = await repository.getProvider("provider_openai_compatible");
    const model = await repository.getModel("model_openai_compatible_default");
    if (provider === undefined || model === undefined)
      throw new Error("Expected seeded provider target");
    await repository.updateProvider({
      ...provider,
      type: "openai-responses-compatible",
      baseUrl: "https://responses.example.test/v1",
      credentialRef: "env://ROMEO_PROVIDER_API_KEY",
      capabilities: { ...provider.capabilities, reasoning: true },
    });
    await repository.updateModel({
      ...model,
      capabilities: { ...model.capabilities, reasoning: true },
    });
    let providerCalls = 0;
    const api = createRomeoApi(repository, {
      providerFetch: async () => {
        providerCalls += 1;
        return new Response(
          responsesSse([
            {
              type: "response.reasoning_summary_text.delta",
              delta: "Checked SSN 123-45-",
            },
            {
              type: "response.reasoning_summary_text.delta",
              delta: "6789 privately.",
            },
            { type: "response.output_text.delta", delta: "Public answer." },
            {
              type: "response.completed",
              response: {
                usage: {
                  input_tokens: 3,
                  output_tokens: 8,
                  output_tokens_details: { reasoning_tokens: 4 },
                },
              },
            },
          ]),
          { status: 200 },
        );
      },
      secretResolver: new EnvironmentSecretResolver({
        ROMEO_PROVIDER_API_KEY: "provider-api-key",
      }),
    });
    const chat = await (
      await api.request("/api/v1/chats", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: "workspace_default",
          title: "Governed summary",
        }),
      })
    ).json();
    const startResponse = await api.request("/api/v1/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chatId: chat.data.id,
        agentId: "agent_default",
        content: "Summarize safely.",
        reasoningPolicy: {
          schemaVersion: 1,
          mode: "summary",
          retainSummary: true,
        },
      }),
    });
    const started = await startResponse.json();
    expect(started).toMatchObject({ data: { id: expect.any(String) } });
    expect(startResponse.status).toBe(202);
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if ((await repository.getRun(started.data.id))?.status !== "running")
        break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    const events = await repository.listRunEvents(started.data.id);
    const assistant = await repository.getMessage(
      `msg_run_terminal_${started.data.id}`,
    );
    const evidence = JSON.stringify({
      events,
      assistant,
      audits: await repository.listAuditLogs(seededSubject.orgId),
      sse: await (
        await api.request(`/api/v1/runs/${started.data.id}/events`)
      ).text(),
    });
    expect(events.at(-1)).toMatchObject({ type: "run.completed" });
    expect(assistant?.content).toBe("Public answer.");
    expect(providerCalls).toBe(1);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "reasoning.summary.completed",
        data: expect.objectContaining({
          classification: "hidden_reasoning_omitted",
          status: "discarded",
          reasoningTokens: 4,
        }),
      }),
    );
    expect(evidence).not.toContain("123-45-6789");
    expect(evidence).not.toContain("Checked SSN");
  });

  it("keeps disabled detectors inert", async () => {
    const repository = new InMemoryRomeoRepository();
    const result = await enforceContentPolicyText(
      repository,
      seededSubject,
      "private@example.com 4242424242424242 123-45-6789",
    );
    expect(result.evaluation).toEqual({ action: "allow", detections: [] });
  });
});

function responsesSse(events: unknown[]): ReadableStream<Uint8Array> {
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
