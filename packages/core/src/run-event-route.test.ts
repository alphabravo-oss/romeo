import { seededSubject } from "@romeo/auth";
import { describe, expect, it } from "vitest";

import { createRomeoApi } from "./api";
import type { RunRecord } from "./domain/entities";
import { InMemoryRomeoRepository } from "./repositories/in-memory";
import { RunEventSequencer } from "./services/run-event-sequencer";
import { ContentPolicyService } from "./services/content-policy-service";

describe("run event route", () => {
  it("supports Last-Event-ID and emits production-safe SSE headers", async () => {
    const repository = await completedRunRepository();
    const api = createRomeoApi(repository);

    const response = await api.request(`/api/v1/runs/${run.id}/events`, {
      headers: { "last-event-id": "0" },
    });
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("cache-control")).toBe(
      "no-store, no-transform",
    );
    expect(response.headers.get("x-accel-buffering")).toBe("no");
    expect(text).toContain("retry: 1000");
    expect(text).toContain("id: 1");
    expect(text).toContain("event: run.completed");
    expect(text).toContain('"schemaVersion":1');
  });

  it("rejects conflicting query and header cursors", async () => {
    const repository = await completedRunRepository();
    const api = createRomeoApi(repository);

    const response = await api.request(
      `/api/v1/runs/${run.id}/events?after=0`,
      { headers: { "last-event-id": "1" } },
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("conflicting_run_event_cursor");
  });

  it("closes immediately when a terminal run cursor is already caught up", async () => {
    const repository = await completedRunRepository();
    const api = createRomeoApi(repository);

    const response = await api.request(`/api/v1/runs/${run.id}/events`, {
      headers: { "last-event-id": "1" },
    });

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("retry: 1000\n\n");
  });

  it("redacts malicious historical reasoning from persistence and SSE", async () => {
    const rawSentinel = "raw-private-persisted-trace-secret";
    const repository = new InMemoryRomeoRepository();
    await repository.createRun(run);
    await repository.appendRunEvents([
      event(1, "message.reasoning", {
        text: rawSentinel,
        authorization: "Bearer hidden",
      }),
      event(2, "run.completed", {}),
    ]);
    const response = await createRomeoApi(repository).request(
      `/api/v1/runs/${run.id}/events`,
    );
    const sse = await response.text();

    expect(sse).toContain('"classification":"hidden_reasoning_omitted"');
    expect(sse).not.toContain(rawSentinel);
    expect(sse).not.toContain("authorization");

    const sequencedRepository = new InMemoryRomeoRepository();
    await sequencedRepository.createRun(run);
    await new RunEventSequencer().append(sequencedRepository, [
      event(1, "message.reasoning", { text: rawSentinel }),
    ]);
    expect(
      JSON.stringify(await sequencedRepository.listRunEvents(run.id)),
    ).toBe(
      JSON.stringify([
        event(1, "message.reasoning", {
          classification: "hidden_reasoning_omitted",
        }),
      ]),
    );
  });

  it("rechecks assembled persisted summaries before SSE replay", async () => {
    const repository = new InMemoryRomeoRepository();
    await repository.createRun(run);
    await new ContentPolicyService(repository).update({
      subject: seededSubject,
      detectors: { us_ssn: "block" },
    });
    await repository.appendRunEvents([
      event(1, "reasoning.summary.delta", {
        classification: "provider_safe_summary",
        contentPolicyApplied: true,
        text: "persisted split 123-45-",
      }),
      event(2, "reasoning.summary.delta", {
        classification: "provider_safe_summary",
        contentPolicyApplied: true,
        text: "6789",
      }),
      event(3, "reasoning.summary.completed", {
        classification: "provider_safe_summary",
        status: "completed",
      }),
      event(4, "run.completed", {}),
    ]);

    const sse = await (
      await createRomeoApi(repository).request(`/api/v1/runs/${run.id}/events`)
    ).text();

    expect(sse).toContain('"status":"discarded"');
    expect(sse).not.toContain("123-45-6789");
    expect(sse).not.toContain("persisted split");
  });
});

function event(
  sequence: number,
  type:
    | "message.reasoning"
    | "reasoning.summary.completed"
    | "reasoning.summary.delta"
    | "run.completed",
  data: Record<string, unknown>,
) {
  return {
    id: `evt_${run.id}_${sequence}`,
    runId: run.id,
    sequence,
    schemaVersion: 1 as const,
    type,
    data,
    createdAt: `2026-08-13T12:00:0${sequence}.000Z`,
  };
}

const run: RunRecord = {
  id: "run_route_event_delivery",
  orgId: "org_default",
  workspaceId: "workspace_default",
  chatId: "chat_welcome",
  agentId: "agent_default",
  agentVersionId: "agent_version_default_v1",
  modelId: "model_openai_compatible_default",
  providerId: "provider_openai_compatible",
  status: "completed",
  createdBy: "user_dev_admin",
  createdAt: "2026-08-13T12:00:00.000Z",
  completedAt: "2026-08-13T12:00:01.000Z",
};

async function completedRunRepository(): Promise<InMemoryRomeoRepository> {
  const repository = new InMemoryRomeoRepository();
  await repository.createRun(run);
  await repository.appendRunEvents([
    {
      id: "evt_run_route_event_delivery_1",
      runId: run.id,
      sequence: 1,
      type: "run.completed",
      data: {},
      createdAt: "2026-08-13T12:00:01.000Z",
    },
  ]);
  return repository;
}
