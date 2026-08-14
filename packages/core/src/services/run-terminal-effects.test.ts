import { seededSubject } from "@romeo/auth";
import { describe, expect, it } from "vitest";

import type { BackgroundJob, RunRecord } from "../domain/entities";
import { InMemoryRomeoRepository } from "../repositories/in-memory";
import { RunEventSequencer } from "./run-event-sequencer";
import { RunService } from "./run-service";
import { persistTerminalRun } from "./run-terminal-effects";
import { selectUsageCostEventIds } from "./usage-cost-reconciliation";
import type { WebhookEmitter } from "./webhook-service";

describe("run terminal effects", () => {
  it("records reported reasoning once when terminal completion races", async () => {
    const repository = new InMemoryRomeoRepository();
    const seededModel = await repository.getModel(
      "model_openai_compatible_default",
    );
    if (seededModel === undefined) throw new Error("Expected seeded model.");
    const model = {
      ...seededModel,
      pricing: { inputTokenUsd: 0.001, outputTokenUsd: 0.002 },
    };
    const run: RunRecord = {
      id: "run_terminal_reasoning_race",
      orgId: "org_default",
      workspaceId: "workspace_default",
      chatId: "chat_welcome",
      agentId: "agent_default",
      agentVersionId: "agent_version_default_v1",
      modelId: model.id,
      providerId: model.providerId,
      status: "running",
      createdBy: "user_dev_admin",
      createdAt: "2026-07-16T12:00:00.000Z",
    };
    await repository.createRun(run);
    const complete = () =>
      persistTerminalRun(repository, new RunEventSequencer(), {
        run,
        status: "completed",
        assistantContent: "",
        model,
        providerUsage: {
          outputTokens: 30,
          reasoningTokens: 20,
          source: "openai-compatible",
        },
      });

    await Promise.all([complete(), complete()]);
    const runUsage = (await repository.listUsageEvents(run.orgId)).filter(
      (event) => event.sourceId === run.id,
    );
    expect(
      runUsage.filter(
        (event) => event.metric === "llm.reasoning_token.reported",
      ),
    ).toHaveLength(1);
    expect(
      runUsage.filter((event) => event.metric === "llm.output_token.reported"),
    ).toHaveLength(1);
    expect([...selectUsageCostEventIds(runUsage)]).toEqual([
      expect.stringMatching(/^usage_/u),
    ]);
    const selected = runUsage.find((event) =>
      selectUsageCostEventIds(runUsage).has(event.id),
    );
    expect(selected?.metric).toBe("llm.output_token.reported");
  });

  it("allows only one of two service replicas to finalize a run", async () => {
    const repository = new InMemoryRomeoRepository();
    let webhookEmissions = 0;
    const webhooks: WebhookEmitter = {
      emit: async () => {
        webhookEmissions += 1;
        return [];
      },
    };
    const first = new RunService(repository, new RunEventSequencer(), webhooks);
    const second = new RunService(
      repository,
      new RunEventSequencer(),
      webhooks,
    );
    const run: RunRecord = {
      id: "run_terminal_replica_race",
      orgId: "org_default",
      workspaceId: "workspace_default",
      chatId: "chat_welcome",
      agentId: "agent_default",
      agentVersionId: "agent_version_default_v1",
      modelId: "model_openai_compatible_default",
      providerId: "provider_openai_compatible",
      status: "running",
      createdBy: "user_dev_admin",
      createdAt: "2026-07-16T12:00:00.000Z",
    };
    await repository.createRun(run);
    const beforeVersion = BigInt(
      (await repository.getChat(run.chatId))?.transcriptVersion ?? "0",
    );

    await Promise.all([
      first.cancel(run.id, seededSubject),
      second.cancel(run.id, seededSubject),
    ]);
    await waitFor(() => webhookEmissions === 1);
    const [usage, audits, jobs] = await Promise.all([
      repository.listUsageEvents(run.orgId),
      repository.listAuditLogs(run.orgId),
      repository.listBackgroundJobs(run.orgId),
    ]);
    const terminalMessages = (await repository.listMessages(run.chatId)).filter(
      (message) => message.id === `msg_run_terminal_${run.id}`,
    );
    expect(terminalMessages).toHaveLength(1);
    expect(
      BigInt((await repository.getChat(run.chatId))?.transcriptVersion ?? "0"),
    ).toBeGreaterThan(beforeVersion);

    expect(
      usage.filter(
        (event) =>
          event.sourceId === run.id && event.metric === "run.cancelled",
      ),
    ).toHaveLength(1);
    expect(audits.filter((audit) => audit.resourceId === run.id)).toHaveLength(
      1,
    );
    expect(
      jobs.filter((job) => job.id === `job_run_terminal_${run.id}`),
    ).toHaveLength(1);
  });

  it("reclaims a crashed webhook outbox dispatch without duplicating terminal records", async () => {
    const repository = new InMemoryRomeoRepository();
    let attempts = 0;
    const idempotencyKeys: string[] = [];
    const webhooks: WebhookEmitter = {
      emit: async (input) => {
        attempts += 1;
        if (input.idempotencyKey !== undefined)
          idempotencyKeys.push(input.idempotencyKey);
        if (attempts === 1) throw new Error("simulated worker crash");
        return [];
      },
    };
    const service = new RunService(
      repository,
      new RunEventSequencer(),
      webhooks,
    );
    const run: RunRecord = {
      id: "run_terminal_outbox_recovery",
      orgId: "org_default",
      workspaceId: "workspace_default",
      chatId: "chat_welcome",
      agentId: "agent_default",
      agentVersionId: "agent_version_default_v1",
      modelId: "model_openai_compatible_default",
      providerId: "provider_openai_compatible",
      status: "running",
      createdBy: "user_dev_admin",
      createdAt: "2026-07-16T12:00:00.000Z",
    };
    await repository.createRun(run);

    await service.cancel(run.id, seededSubject);
    await waitFor(() => attempts === 1);
    const leased = await terminalJob(repository, run.id);
    expect(leased.status).toBe("running");
    await repository.updateBackgroundJob({
      ...leased,
      updatedAt: "2020-01-01T00:00:00.000Z",
    });

    await service.runTerminalOutboxOnce();
    await waitFor(() => attempts === 2);
    const recovered = await terminalJob(repository, run.id);
    const [usage, audits] = await Promise.all([
      repository.listUsageEvents(run.orgId),
      repository.listAuditLogs(run.orgId),
    ]);

    expect(recovered.status).toBe("completed");
    expect(idempotencyKeys).toEqual([
      `job_run_terminal_${run.id}`,
      `job_run_terminal_${run.id}`,
    ]);
    expect(
      usage.filter(
        (event) =>
          event.sourceId === run.id && event.metric === "run.cancelled",
      ),
    ).toHaveLength(1);
    expect(
      audits.filter(
        (audit) =>
          audit.resourceId === run.id && audit.action === "run.cancelled",
      ),
    ).toHaveLength(1);

    await service.runTerminalOutboxOnce();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(attempts).toBe(2);
  });
});

async function terminalJob(
  repository: InMemoryRomeoRepository,
  runId: string,
): Promise<BackgroundJob> {
  const job = (await repository.listBackgroundJobs("org_default")).find(
    (candidate) => candidate.id === `job_run_terminal_${runId}`,
  );
  if (job === undefined) throw new Error("Expected terminal outbox job.");
  return job;
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 40; index += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for terminal effect.");
}
