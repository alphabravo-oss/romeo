import { describe, expect, it } from "vitest";

import type { RunEvent } from "@romeo/ai-runtime";
import { seededSubject } from "@romeo/auth";

import type { RunRecord } from "../domain/entities";
import { InMemoryRomeoRepository } from "../repositories/in-memory";
import { recordRunTerminalUsage } from "./run-usage";
import { RunEventSequencer } from "./run-event-sequencer";
import { RunService } from "./run-service";

describe("run observability usage", () => {
  it("records metadata-only latency, throughput, recovery, and provider failures", async () => {
    const repository = new InMemoryRomeoRepository();
    const model = await repository.getModel("model_openai_compatible_default");
    if (model === undefined) throw new Error("Expected seeded model");
    const run: RunRecord = {
      id: "run_observability",
      orgId: "org_default",
      workspaceId: "workspace_default",
      chatId: "chat_welcome",
      agentId: "agent_default",
      agentVersionId: "agent_version_default_v1",
      modelId: model.id,
      providerId: model.providerId,
      status: "failed",
      createdBy: "user_dev_admin",
      createdAt: "2026-07-16T12:00:00.000Z",
      completedAt: "2026-07-16T12:00:04.000Z",
    };
    const events: RunEvent[] = [
      event(run.id, 1, "run.continuing", "2026-07-16T12:00:00.500Z", {}),
      event(run.id, 2, "message.delta", "2026-07-16T12:00:01.000Z", {
        text: "secret first",
      }),
      event(run.id, 3, "message.delta", "2026-07-16T12:00:03.000Z", {
        text: "secret second",
      }),
      event(run.id, 4, "run.failed", "2026-07-16T12:00:04.000Z", {
        errorCode: "provider_timeout",
        raw: "secret failure",
      }),
    ];

    await recordRunTerminalUsage(repository, {
      run,
      status: "failed",
      assistantContent: "secret first secret second",
      model,
      runEvents: events,
    });
    const usage = await repository.listUsageEvents(run.orgId);
    const byMetric = new Map(usage.map((item) => [item.metric, item]));

    expect(byMetric.get("run.time_to_first_token")?.quantity).toBe(1000);
    expect(byMetric.get("run.duration")?.quantity).toBe(4000);
    expect(byMetric.get("run.output_throughput")?.quantity).toBeGreaterThan(0);
    expect(byMetric.get("run.recovery")?.quantity).toBe(1);
    expect(byMetric.get("provider.error")?.metadata).toMatchObject({
      errorCode: "provider_timeout",
      providerId: run.providerId,
      modelId: run.modelId,
    });
    expect(JSON.stringify(usage)).not.toContain("secret");
  });

  it("resumes SSE after a committed sequence and records reconnect telemetry", async () => {
    const repository = new InMemoryRomeoRepository();
    const run: RunRecord = {
      id: "run_sse_resume",
      orgId: "org_default",
      workspaceId: "workspace_default",
      chatId: "chat_welcome",
      agentId: "agent_default",
      agentVersionId: "agent_version_default_v1",
      modelId: "model_openai_compatible_default",
      providerId: "provider_openai_compatible",
      status: "completed",
      createdBy: seededSubject.id,
      createdAt: "2026-07-16T12:00:00.000Z",
      completedAt: "2026-07-16T12:00:03.000Z",
    };
    await repository.createRun(run);
    await repository.appendRunEvents([
      event(run.id, 1, "run.started", "2026-07-16T12:00:00.000Z", {}),
      event(run.id, 2, "message.delta", "2026-07-16T12:00:01.000Z", {
        text: "already delivered",
      }),
      event(run.id, 3, "run.completed", "2026-07-16T12:00:03.000Z", {}),
    ]);
    const service = new RunService(repository, new RunEventSequencer());

    const resumed: RunEvent[] = [];
    for await (const item of service.events(run.id, seededSubject, 2))
      resumed.push(item);
    const usage = await repository.listUsageEvents(run.orgId);

    expect(resumed.map((item) => item.sequence)).toEqual([3]);
    expect(
      usage.filter(
        (item) => item.sourceId === run.id && item.metric === "sse.reconnect",
      ),
    ).toEqual([
      expect.objectContaining({
        quantity: 1,
        metadata: { chatId: run.chatId, afterSequence: 2 },
      }),
    ]);
    expect(usage.some((item) => item.metric === "sse.disconnect")).toBe(false);
  });
});

function event(
  runId: string,
  sequence: number,
  type: RunEvent["type"],
  createdAt: string,
  data: unknown,
): RunEvent {
  return { id: `evt_${sequence}`, runId, sequence, type, createdAt, data };
}
