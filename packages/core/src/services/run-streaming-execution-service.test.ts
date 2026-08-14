import { seededSubject } from "@romeo/auth";
import { ProviderCircuitBreaker } from "@romeo/ai-runtime";
import { MemoryObjectStore } from "@romeo/storage";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RunRecord } from "../domain/entities";
import {
  createRuntimeSeedData,
  InMemoryRomeoRepository,
} from "../repositories/in-memory";
import { RunEventSequencer } from "./run-event-sequencer";
import { RunExecutionStateService } from "./run-execution-state-service";
import { runExecutionJobType } from "./run-recovery-service";
import { RunStreamingExecutionService } from "./run-streaming-execution-service";

describe("run streaming execution cleanup", () => {
  afterEach(() => vi.useRealTimers());

  it("cleans post-claim state when provider secret resolution rejects", async () => {
    vi.useFakeTimers();
    const repository = new InMemoryRomeoRepository(createRuntimeSeedData());
    const provider = await repository.getProvider("provider_openai_compatible");
    const model = await repository.getModel("model_openai_compatible_default");
    if (provider === undefined || model === undefined) {
      throw new Error("Expected seeded provider and model");
    }
    const run: RunRecord = {
      id: "run_secret_resolution_cleanup",
      orgId: seededSubject.orgId,
      workspaceId: "workspace_default",
      chatId: "chat_welcome",
      agentId: "agent_default",
      agentVersionId: "agent_version_default_v1",
      modelId: model.id,
      providerId: provider.id,
      status: "running",
      createdBy: seededSubject.id,
      createdAt: "2026-08-13T12:00:00.000Z",
    };
    const workerId = "run_worker_secret_cleanup";
    const renewLease = vi.spyOn(repository, "renewBackgroundJobLease");
    const service = new RunStreamingExecutionService(
      repository,
      new RunEventSequencer(),
      new RunExecutionStateService(
        repository,
        new RunEventSequencer(),
        new MemoryObjectStore(),
        workerId,
        1,
      ),
      new ProviderCircuitBreaker(),
      workerId,
      {
        runExecutionLeaseSeconds: 1,
        secretResolver: {
          check: vi.fn(async () => ({ available: true, scheme: "env" })),
          resolveValue: vi.fn(async () => {
            throw new Error("injected secret resolution failure");
          }),
        },
      },
      vi.fn(),
    );

    await expect(
      service.execute({
        run,
        messages: [],
        provider: { ...provider, credentialRef: "env://FAILING_KEY" },
        model,
        citations: [],
        routePlan: { primaryDisabled: false },
        providerTools: [],
        subject: seededSubject,
      }),
    ).rejects.toThrow("injected secret resolution failure");
    expect(service.has(run.id)).toBe(false);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(renewLease).not.toHaveBeenCalled();

    const reclaimed = await repository.claimBackgroundJob({
      orgId: run.orgId,
      type: runExecutionJobType(run.id),
      workerId: "replacement_worker",
      leaseSeconds: 60,
      now: "2099-01-01T00:00:00.000Z",
    });
    expect(reclaimed?.payload.workerLease).toMatchObject({
      workerId: "replacement_worker",
    });
  });
});
