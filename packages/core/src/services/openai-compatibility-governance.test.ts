import { seededSubject } from "@romeo/auth";
import { describe, expect, it, vi } from "vitest";

import { InMemoryRomeoRepository } from "../repositories/in-memory";
import { CapabilityService } from "./capability-resolver";
import { OpenAiChatCompletionsService } from "./openai-chat-completions-service";
import { OpenAiEmbeddingsService } from "./openai-embeddings-service";
import { EnvironmentSecretResolver } from "./secret-resolver";

const request = {
  model: "model_openai_compatible_default",
  messages: [{ role: "user" as const, content: "Return a safe answer." }],
};

describe("OpenAI compatibility runtime governance", () => {
  it("enforces reasoning capability before quota or provider dispatch", async () => {
    const repository = new InMemoryRomeoRepository();
    const fetchImpl = vi.fn<typeof fetch>();
    const service = new OpenAiChatCompletionsService(repository, {
      capabilities: new CapabilityService(repository, {
        disabledCapabilityIds: ["reasoning_policy"],
      }),
      fetchImpl,
    });

    await expect(
      service.complete({
        request: { ...request, reasoning: { effort: "high" } },
        subject: seededSubject,
      }),
    ).rejects.toMatchObject({
      code: "capability_platform_disabled",
      status: 403,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await repository.listUsageEvents(seededSubject.orgId)).toEqual([]);
  });

  it("enforces its own deadline when provider transport ignores abort", async () => {
    const repository = await remoteProviderRepository();
    const fetchImpl = vi.fn(() => new Promise<Response>(() => undefined));
    const service = new OpenAiChatCompletionsService(repository, {
      fetchImpl,
      providerRetryAttempts: 0,
      providerTimeoutMs: 5,
      secretResolver: providerSecrets(),
    });

    await expect(
      service.complete({ request, subject: seededSubject }),
    ).rejects.toMatchObject({ code: "provider_timeout", status: 504 });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(
      (await repository.listUsageEvents(seededSubject.orgId)).filter(
        (event) => event.metric === "run.failed",
      ),
    ).toHaveLength(1);
  });

  it("discards private provider reasoning from response and durable evidence", async () => {
    const repository = await remoteProviderRepository();
    const sentinel = "private-reasoning-sk-do-not-retain";
    const service = new OpenAiChatCompletionsService(repository, {
      fetchImpl: async () =>
        new Response(
          providerSse([
            { choices: [{ delta: { reasoning_content: sentinel } }] },
            { choices: [{ delta: { content: "Governed answer." } }] },
          ]),
          { status: 200 },
        ),
      secretResolver: providerSecrets(),
    });

    const response = await service.complete({
      request: { ...request, reasoning: { effort: "medium" } },
      subject: seededSubject,
    });
    const durable = JSON.stringify({
      audits: await repository.listAuditLogs(seededSubject.orgId),
      response,
      usage: await repository.listUsageEvents(seededSubject.orgId),
    });

    expect(response.choices[0]?.message.content).toBe("Governed answer.");
    expect(durable).not.toContain(sentinel);
  });

  it("applies cancellation deadlines and failure metering to embeddings", async () => {
    const repository = await remoteProviderRepository();
    const fetchImpl = vi.fn(() => new Promise<Response>(() => undefined));
    const service = new OpenAiEmbeddingsService(repository, {
      fetchImpl,
      providerRetryAttempts: 0,
      providerTimeoutMs: 5,
      secretResolver: providerSecrets(),
    });

    await expect(
      service.create({
        request: {
          model: "model_openai_compatible_embeddings_default",
          input: ["Bound embedding work."],
        },
        subject: seededSubject,
      }),
    ).rejects.toMatchObject({ code: "provider_timeout", status: 504 });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(
      (await repository.listUsageEvents(seededSubject.orgId)).filter(
        (event) => event.metric === "run.failed",
      ),
    ).toHaveLength(1);
  });
});

async function remoteProviderRepository() {
  const repository = new InMemoryRomeoRepository();
  const provider = await repository.getProvider("provider_openai_compatible");
  if (provider === undefined) throw new Error("Expected seeded provider.");
  provider.baseUrl = "https://provider.example.test/v1";
  provider.credentialRef = "env://ROMEO_PROVIDER_API_KEY";
  return repository;
}

function providerSecrets() {
  return new EnvironmentSecretResolver({
    ROMEO_PROVIDER_API_KEY: "provider-test-key",
  });
}

function providerSse(events: unknown[]): string {
  return `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`;
}
