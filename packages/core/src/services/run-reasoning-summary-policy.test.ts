import { seededSubject } from "@romeo/auth";
import { createRunEvent, encodeSseEvent } from "@romeo/ai-runtime";
import { describe, expect, it } from "vitest";

import type { RunRecord } from "../domain/entities";
import { InMemoryRomeoRepository } from "../repositories/in-memory";
import { ContentPolicyService } from "./content-policy-service";
import { RunEventSequencer } from "./run-event-sequencer";
import { ReasoningSummaryGovernor } from "./run-reasoning-summary-policy";

describe("reasoning summary governance", () => {
  it("blocks secrets split across deltas before persistence or SSE release", async () => {
    const repository = new InMemoryRomeoRepository();
    await repository.createRun(run);
    await new ContentPolicyService(repository).update({
      subject: seededSubject,
      detectors: { api_token: "block", us_ssn: "block" },
    });
    const governor = new ReasoningSummaryGovernor(repository, seededSubject);
    const first = "Private SSN 123-45-";
    const second = "6789 and token sk-abcdefghijkl";
    const third = "mnopqrstuvwxyz123456";

    await expect(governor.consume(delta(1, first))).resolves.toEqual([]);
    await expect(governor.consume(delta(2, second))).resolves.toEqual([]);
    await expect(governor.consume(delta(3, third))).resolves.toEqual([]);
    const governed = await governor.consume(completed(4));

    expect(governed).toHaveLength(1);
    expect(governed[0]).toMatchObject({
      type: "reasoning.summary.completed",
      data: {
        classification: "hidden_reasoning_omitted",
        status: "discarded",
      },
    });
    const sequencer = new RunEventSequencer();
    const persisted = await sequencer.assign(repository, governed[0]!);
    await sequencer.append(repository, [persisted]);
    const evidence = JSON.stringify({
      events: await repository.listRunEvents(run.id),
      sse: encodeSseEvent(persisted),
      audits: await repository.listAuditLogs(seededSubject.orgId),
    });
    for (const sentinel of [
      "123-45-6789",
      "sk-abcdefghijklmnopqrstuvwxyz123456",
    ])
      expect(evidence).not.toContain(sentinel);

    const replayGovernor = new ReasoningSummaryGovernor(
      repository,
      seededSubject,
    );
    expect(
      await replayGovernor.consume({
        ...delta(5, first),
        data: {
          classification: "provider_safe_summary",
          contentPolicyApplied: true,
          text: first,
        },
      }),
    ).toEqual([]);
    expect(
      await replayGovernor.consume({
        ...delta(6, second + third),
        data: {
          classification: "provider_safe_summary",
          contentPolicyApplied: true,
          text: second + third,
        },
      }),
    ).toEqual([]);
    expect(
      JSON.stringify(await replayGovernor.consume(completed(7))),
    ).not.toContain("123-45-6789");
  });

  it("releases only assembled redacted text with a durable policy marker", async () => {
    const repository = new InMemoryRomeoRepository();
    await new ContentPolicyService(repository).update({
      subject: seededSubject,
      detectors: { email_address: "redact" },
    });
    const governor = new ReasoningSummaryGovernor(repository, seededSubject);

    expect(await governor.consume(delta(1, "Contact priv"))).toEqual([]);
    expect(await governor.consume(delta(2, "ate@example.com"))).toEqual([]);
    const governed = await governor.consume(completed(3));

    expect(governed.map((event) => event.type)).toEqual([
      "reasoning.summary.delta",
      "reasoning.summary.delta",
      "reasoning.summary.completed",
    ]);
    expect(JSON.stringify(governed)).not.toContain("private@example.com");
    expect(governed[0]?.data).toMatchObject({
      classification: "provider_safe_summary",
      contentPolicyApplied: true,
    });
    expect(
      governed
        .slice(0, -1)
        .map((event) => (event.data as { text: string }).text)
        .join(""),
    ).toBe("Contact [REDACTED:EMAIL_ADDRESS]");
  });
});

function delta(sequence: number, text: string) {
  return createRunEvent({
    runId: run.id,
    sequence,
    type: "reasoning.summary.delta",
    data: { classification: "provider_safe_summary", text },
  });
}

function completed(sequence: number) {
  return createRunEvent({
    runId: run.id,
    sequence,
    type: "reasoning.summary.completed",
    data: {
      classification: "provider_safe_summary",
      status: "completed",
      durationMs: 1_200,
      reasoningTokens: 17,
    },
  });
}

const run: RunRecord = {
  id: "run_reasoning_summary_governance",
  orgId: seededSubject.orgId,
  workspaceId: "workspace_default",
  chatId: "chat_reasoning_summary_governance",
  agentId: "agent_reasoning_summary_governance",
  agentVersionId: "agent_version_reasoning_summary_governance",
  modelId: "model_reasoning_summary_governance",
  providerId: "provider_reasoning_summary_governance",
  status: "running",
  createdBy: seededSubject.id,
  createdAt: "2026-08-14T00:00:00.000Z",
};
