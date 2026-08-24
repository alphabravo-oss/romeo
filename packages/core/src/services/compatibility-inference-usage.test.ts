import { seededSubject } from "@romeo/auth";
import { describe, expect, it } from "vitest";

import { InMemoryRomeoRepository } from "../repositories/in-memory";
import { startCompatibilityInferenceUsage } from "./compatibility-inference-usage";

describe("OpenAI compatibility inference usage", () => {
  it("persists correlated lifecycle and provider token cost without content", async () => {
    const repository = new InMemoryRomeoRepository();
    const model = await repository.getModel("model_openai_compatible_default");
    if (model === undefined) throw new Error("Expected seeded model.");
    model.pricing = { inputTokenUsd: 0.001, outputTokenUsd: 0.002 };
    const meter = await startCompatibilityInferenceUsage({
      estimatedInputTokens: 7,
      model,
      operation: "chat_completions",
      providerId: model.providerId,
      repository,
      subject: seededSubject,
    });

    await meter.succeed({
      estimatedOutputTokens: 3,
      usage: {
        source: "openai-compatible",
        inputTokens: 7,
        cachedInputTokens: 2,
        outputTokens: 3,
        reasoningTokens: 1,
        totalTokens: 10,
      },
    });
    await meter.succeed({ usage: { totalTokens: 999 } });

    const events = await repository.listUsageEvents(seededSubject.orgId);
    expect(events.map((event) => event.metric).sort()).toEqual(
      [
        "llm.cached_input_token.reported",
        "llm.input_token.estimated",
        "llm.input_token.reported",
        "llm.output_token.estimated",
        "llm.output_token.reported",
        "llm.reasoning_token.reported",
        "llm.total_token.reported",
        "run.completed",
        "run.duration",
        "run.started",
      ].sort(),
    );
    expect(new Set(events.map((event) => event.sourceId)).size).toBe(1);
    expect(
      events.find((event) => event.metric === "llm.input_token.reported"),
    ).toMatchObject({ metadata: { estimatedCostUsd: 0.007 } });
    expect(
      events.find((event) => event.metric === "llm.output_token.reported"),
    ).toMatchObject({ metadata: { estimatedCostUsd: 0.006 } });
    expect(JSON.stringify(events)).not.toMatch(
      /prompt|response|completion text/iu,
    );
    expect(await repository.listAuditLogs(seededSubject.orgId)).toContainEqual(
      expect.objectContaining({
        action: "model.request",
        outcome: "success",
        resourceId: model.id,
        metadata: expect.objectContaining({
          compatibilityProtocol: "openai",
          operation: "chat_completions",
          providerId: model.providerId,
          sourceId: events[0]?.sourceId,
        }),
      }),
    );
  });

  it("records one terminal failure without fabricated provider usage", async () => {
    const repository = new InMemoryRomeoRepository();
    const model = await repository.getModel("model_openai_compatible_default");
    if (model === undefined) throw new Error("Expected seeded model.");
    const meter = await startCompatibilityInferenceUsage({
      estimatedInputTokens: 1,
      model,
      operation: "embeddings",
      providerId: model.providerId,
      repository,
      subject: seededSubject,
    });

    await Promise.all([meter.fail(), meter.fail()]);

    const events = await repository.listUsageEvents(seededSubject.orgId);
    expect(
      events.filter((event) => event.metric === "run.failed"),
    ).toHaveLength(1);
    expect(events.some((event) => event.metric.endsWith(".reported"))).toBe(
      false,
    );
  });
});
