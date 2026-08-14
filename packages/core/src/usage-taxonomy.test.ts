import { describe, expect, it } from "vitest";

import type { UsageEvent } from "./domain/entities";
import { InMemoryRomeoRepository } from "./repositories/in-memory";
import { createSeedData } from "./repositories/seed-data";
import { USAGE_METRIC_DEFINITIONS } from "./usage-taxonomy";
import { assertUsageEventTaxonomy } from "./usage-taxonomy-validation";

const requiredMetrics = [
  "llm.input_token.reported",
  "llm.cached_input_token.reported",
  "llm.reasoning_token.reported",
  "image.generated",
  "image.input",
  "audio.input_second",
  "audio.output_second",
  "video.input_second",
  "compute.cpu_millisecond",
  "compute.memory_byte_millisecond",
  "retrieval.unit",
  "storage.byte",
] as const;

const validEvent: UsageEvent = {
  id: "usage_taxonomy",
  orgId: "org_default",
  workspaceId: "workspace_default",
  actorId: "user_dev_admin",
  sourceType: "run",
  sourceId: "run_taxonomy",
  metric: "run.started",
  quantity: 1,
  unit: "run",
  metadata: {},
  createdAt: "2026-08-14T12:00:00.000Z",
};

describe("canonical usage and cost taxonomy", () => {
  it("registers every enterprise AI measurement class with bounded semantics", () => {
    for (const metric of requiredMetrics)
      expect(USAGE_METRIC_DEFINITIONS[metric]).toBeDefined();

    expect(USAGE_METRIC_DEFINITIONS).toMatchObject({
      "llm.cached_input_token.reported": {
        category: "text_token",
        unit: "token",
        overlapPolicy: "component_of_total",
        billable: false,
      },
      "llm.reasoning_token.reported": {
        category: "text_token",
        unit: "token",
        overlapPolicy: "component_of_total",
        billable: false,
      },
      "llm.total_token.reported": {
        category: "text_token",
        unit: "token",
        overlapPolicy: "non_additive",
        billable: false,
      },
      "image.cost.micro_usd": {
        category: "cost",
        unit: "micro_usd",
      },
    });
  });

  it("rejects unregistered, mismatched, and unsafe usage values", () => {
    expect(() =>
      assertUsageEventTaxonomy({
        ...validEvent,
        metric: "provider.raw_tokens",
      }),
    ).toThrow("Unregistered usage metric");
    expect(() =>
      assertUsageEventTaxonomy({ ...validEvent, unit: "event" }),
    ).toThrow("requires unit run");
    expect(() =>
      assertUsageEventTaxonomy({ ...validEvent, sourceType: "voice" }),
    ).toThrow("does not allow source type voice");
    expect(() =>
      assertUsageEventTaxonomy({ ...validEvent, quantity: -1 }),
    ).toThrow("finite nonnegative quantity");
    expect(() =>
      assertUsageEventTaxonomy({ ...validEvent, quantity: Number.NaN }),
    ).toThrow("finite nonnegative quantity");
    expect(() =>
      assertUsageEventTaxonomy({
        ...validEvent,
        metric: "image.cost.micro_usd",
        quantity: 1.5,
        unit: "micro_usd",
      }),
    ).toThrow("safe-integer quantity");
    expect(() =>
      assertUsageEventTaxonomy({
        ...validEvent,
        metric: "run.output_throughput",
        quantity: 12.5,
        unit: "token_per_second",
      }),
    ).not.toThrow();
    expect(() =>
      assertUsageEventTaxonomy({
        ...validEvent,
        metadata: { prompt: "confidential prompt" },
      }),
    ).toThrow("forbidden key");
    expect(() =>
      assertUsageEventTaxonomy({
        ...validEvent,
        metadata: { diagnostic: "Bearer secret-token-value" },
      }),
    ).toThrow("metadata value is invalid");
    expect(() =>
      assertUsageEventTaxonomy({
        ...validEvent,
        metadata: { diagnostic: new Date() },
      }),
    ).toThrow("metadata value is invalid");
    expect(() =>
      assertUsageEventTaxonomy({
        ...validEvent,
        metadata: { ["x".repeat(101)]: true },
      }),
    ).toThrow("forbidden key");
  });

  it("enforces the taxonomy at in-memory repository create and update boundaries", async () => {
    const repository = new InMemoryRomeoRepository();
    await expect(repository.createUsageEvent(validEvent)).resolves.toEqual(
      validEvent,
    );
    await expect(
      repository.updateUsageEvent({ ...validEvent, unit: "count" }),
    ).rejects.toThrow("identity and classification are immutable");
    await expect(
      repository.updateUsageEvent({
        ...validEvent,
        metadata: { outputText: "must not persist" },
      }),
    ).rejects.toThrow("forbidden key");
    await expect(
      repository.createUsageEvent({
        ...validEvent,
        id: "usage_unknown",
        metric: "unknown.metric",
      }),
    ).rejects.toThrow("Unregistered usage metric");
  });

  it("allows privacy-only cleanup of historical rows without allowing reclassification", async () => {
    const legacy: UsageEvent = {
      ...validEvent,
      id: "usage_legacy_voice",
      sourceType: "voice",
      sourceId: "voice_legacy",
      metric: "voice.preview.generated",
      quantity: 900,
      unit: "ms",
      metadata: { storageKey: "legacy/internal/object.wav" },
    };
    const seed = createSeedData();
    seed.usageEvents.push(legacy);
    const repository = new InMemoryRomeoRepository(seed);

    await expect(
      repository.updateUsageEvent({
        ...legacy,
        metadata: { storageKeyHash: "safe-hash", deleted: true },
      }),
    ).resolves.toMatchObject({
      unit: "ms",
      quantity: 900,
      metadata: { storageKeyHash: "safe-hash", deleted: true },
    });
    await expect(
      repository.updateUsageEvent({ ...legacy, quantity: 1 }),
    ).rejects.toThrow("requires unit event");
    await expect(
      repository.updateUsageEvent({ ...legacy, actorId: "user_other" }),
    ).rejects.toThrow("identity and classification are immutable");
    await expect(
      repository.updateUsageEvent({
        ...legacy,
        metadata: { storageKeyHash: "safe-hash", secret: "must not persist" },
      }),
    ).rejects.toThrow("forbidden key");
  });
});
