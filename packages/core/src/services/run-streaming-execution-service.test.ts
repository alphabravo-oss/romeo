import { seededSubject } from "@romeo/auth";
import { ProviderCircuitBreaker } from "@romeo/ai-runtime";
import { MemoryObjectStore } from "@romeo/storage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RunRecord } from "../domain/entities";
import {
  createRuntimeSeedData,
  InMemoryRomeoRepository,
} from "../repositories/in-memory";
import { RunEventSequencer } from "./run-event-sequencer";
import { RunExecutionStateService } from "./run-execution-state-service";
import { runExecutionJobType } from "./run-recovery-service";
import { RunStreamingExecutionService } from "./run-streaming-execution-service";

const providerErrorBody = "upstream said: sk-live-SECRET provider body";

async function harness(options: { secretFailure?: boolean } = {}) {
  const repository = new InMemoryRomeoRepository(createRuntimeSeedData());
  const provider = await repository.getProvider("provider_openai_compatible");
  const model = await repository.getModel("model_openai_compatible_default");
  if (provider === undefined || model === undefined) {
    throw new Error("Expected seeded provider and model");
  }
  const run: RunRecord = {
    id: "run_execution_failure",
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
  const workerId = "run_worker_failure";
  const executionState = new RunExecutionStateService(
    repository,
    new RunEventSequencer(),
    new MemoryObjectStore(),
    workerId,
    1,
  );
  const completeRun = vi.fn(async () => undefined);
  const service = new RunStreamingExecutionService(
    repository,
    new RunEventSequencer(),
    executionState,
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
    completeRun,
  );
  const input = {
    run,
    messages: [],
    provider: options.secretFailure
      ? { ...provider, credentialRef: "env://FAILING_KEY" }
      : provider,
    model,
    citations: [],
    routePlan: { primaryDisabled: false },
    providerTools: [],
    subject: seededSubject,
  };
  return { completeRun, executionState, input, repository, run, service };
}

function executionJobStatus(
  repository: InMemoryRomeoRepository,
  run: RunRecord,
) {
  return repository
    .listBackgroundJobs(run.orgId, {
      limit: 1,
      type: runExecutionJobType(run.id),
    })
    .then((jobs) => jobs[0]?.status);
}

describe("run streaming execution failures", () => {
  let unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  beforeEach(() => {
    unhandled = [];
    process.on("unhandledRejection", onUnhandled);
  });
  afterEach(() => {
    process.off("unhandledRejection", onUnhandled);
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("fails the run and releases the job when provider secret resolution rejects", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { completeRun, input, repository, run, service } = await harness({
      secretFailure: true,
    });
    const renewLease = vi.spyOn(repository, "renewBackgroundJobLease");

    await expect(service.execute(input)).resolves.toBeUndefined();
    expect(service.has(run.id)).toBe(false);
    expect(completeRun).toHaveBeenCalledOnce();
    expect(await executionJobStatus(repository, run)).toBe("failed");

    await vi.advanceTimersByTimeAsync(2_000);
    expect(renewLease).not.toHaveBeenCalled();
  });

  it("fails the run without an unhandled rejection when the claim throws", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { completeRun, executionState, input, run, service } =
      await harness();
    vi.spyOn(executionState, "claim").mockRejectedValue(
      Object.assign(new Error(providerErrorBody), { code: "ECONNRESET" }),
    );

    // Detached callers use `void service.execute(...)`; it must never reject.
    void service.execute(input);
    await vi.waitFor(() => expect(completeRun).toHaveBeenCalledOnce());
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(unhandled).toEqual([]);
    expect(completeRun).toHaveBeenCalledWith(
      run,
      expect.objectContaining({
        type: "run.failed",
        data: expect.objectContaining({ errorCode: "run_execution_failed" }),
      }),
      "",
      input.model,
      [],
      seededSubject,
      [],
    );
    expect(log).toHaveBeenCalledWith("background task failed", {
      task: "run.execute",
      orgId: run.orgId,
      runId: run.id,
      errorClass: "Error",
      errorCode: "ECONNRESET",
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("sk-live-SECRET");
  });

  it("fails the run and clears active state when the content policy lookup throws", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { completeRun, input, repository, run, service } = await harness();
    vi.spyOn(repository, "getSystemSetting").mockRejectedValue(
      new TypeError(providerErrorBody),
    );

    await service.execute(input);

    expect(unhandled).toEqual([]);
    expect(service.has(run.id)).toBe(false);
    expect(completeRun).toHaveBeenCalledWith(
      run,
      expect.objectContaining({ type: "run.failed" }),
      "",
      input.model,
      [],
      seededSubject,
      [],
    );
    expect(await executionJobStatus(repository, run)).toBe("failed");
    expect(log).toHaveBeenCalledWith(
      "background task failed",
      expect.objectContaining({ errorClass: "TypeError", runId: run.id }),
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain("sk-live-SECRET");
  });

  it("logs a failing recovery instead of rejecting", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { completeRun, executionState, input, service } = await harness();
    vi.spyOn(executionState, "claim").mockRejectedValue(new Error("claim"));
    completeRun.mockRejectedValue(new Error(providerErrorBody));

    await expect(service.execute(input)).resolves.toBeUndefined();

    expect(unhandled).toEqual([]);
    expect(log).toHaveBeenCalledWith(
      "background task failed",
      expect.objectContaining({ task: "run.execute.recovery" }),
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain("sk-live-SECRET");
  });
});
