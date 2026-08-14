import type { AuthSubject } from "@romeo/auth";
import type {
  ChatMessage,
  ProviderReasoningParameters,
  ProviderReasoningPolicyLayers,
  ProviderSampling,
  ProviderStructuredOutput,
  ProviderToolDefinition,
} from "@romeo/providers";
import type { ObjectStore } from "@romeo/storage";
import type { RunEvent } from "@romeo/ai-runtime";

import type { BackgroundJob, RunRecord } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { createId } from "../ids";
import { currentTelemetryMetadata } from "./telemetry-context";
import type { RunEventSequencer } from "./run-event-sequencer";
import type { RunKnowledgeCitation } from "./run-knowledge";
import {
  executionJobPayload,
  runExecutionCheckpoint,
  runExecutionCheckpointKey,
  runExecutionJobType,
  runWithStatus,
  type RunExecutionCheckpoint,
  type RunExecutionJobPayload,
} from "./run-recovery-service";

export class RunExecutionStateService {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly sequencer: RunEventSequencer,
    private readonly checkpointStore: ObjectStore,
    private readonly workerId: string,
    private readonly leaseSeconds: number,
  ) {}

  async claim(input: {
    run: RunRecord;
    messages: ChatMessage[];
    citations: RunKnowledgeCitation[];
    providerTools: ProviderToolDefinition[];
    subject: AuthSubject;
    assistantContentPrefix?: string;
    emitRunStarted?: boolean;
    reasoning?: ProviderReasoningParameters;
    reasoningPolicy?: ProviderReasoningPolicyLayers;
    sampling?: ProviderSampling;
    structuredOutput?: ProviderStructuredOutput;
  }): Promise<
    { job: BackgroundJob; checkpoint: RunExecutionCheckpoint } | undefined
  > {
    const type = runExecutionJobType(input.run.id);
    const jobs = await this.repository.listBackgroundJobs(input.run.orgId);
    let job = jobs.find(
      (candidate) =>
        candidate.type === type &&
        (candidate.status === "queued" || candidate.status === "running"),
    );
    if (job === undefined) {
      const now = new Date().toISOString();
      const checkpointKey = runExecutionCheckpointKey(input.run);
      const checkpoint: RunExecutionCheckpoint = {
        messages: input.messages,
        citations: input.citations,
        providerTools: input.providerTools,
        principalId: input.subject.id,
        principalType: input.subject.type,
        scopeSnapshot: input.subject.scopes,
        assistantContent: input.assistantContentPrefix ?? "",
        emitRunStarted: input.emitRunStarted !== false,
        ...(input.sampling === undefined ? {} : { sampling: input.sampling }),
        ...(input.reasoning === undefined
          ? {}
          : { reasoning: input.reasoning }),
        ...(input.reasoningPolicy === undefined
          ? {}
          : { reasoningPolicy: input.reasoningPolicy }),
        ...(input.structuredOutput === undefined
          ? {}
          : { structuredOutput: input.structuredOutput }),
      };
      await this.writeCheckpoint(checkpointKey, checkpoint);
      job = await this.repository.createBackgroundJob({
        id: createId("run_execution"),
        orgId: input.run.orgId,
        workspaceId: input.run.workspaceId,
        type,
        status: "queued",
        payload: {
          runId: input.run.id,
          checkpointKey,
          assistantOutputStarted:
            (input.assistantContentPrefix?.length ?? 0) > 0,
          lastEventSequence: 0,
          ...currentTelemetryMetadata(),
        } satisfies RunExecutionJobPayload,
        createdAt: now,
        updatedAt: now,
      });
    }
    const claimed = await this.repository.claimBackgroundJob({
      orgId: input.run.orgId,
      type,
      workerId: this.workerId,
      leaseSeconds: this.leaseSeconds,
    });
    if (claimed?.id !== job.id) return undefined;
    const checkpoint = await this.readCheckpoint(claimed);
    return checkpoint === undefined ? undefined : { job: claimed, checkpoint };
  }

  async checkpoint(
    job: BackgroundJob,
    event: RunEvent,
    checkpoint: RunExecutionCheckpoint,
  ): Promise<BackgroundJob> {
    const payload = executionJobPayload(job);
    if (payload === undefined) return job;
    const checkpointKey = `${payload.checkpointKey.replace(/\.\d+\.json$/u, "")}.${event.sequence}.json`;
    await this.writeCheckpoint(checkpointKey, checkpoint);
    const updated = await this.repository.updateBackgroundJobWithLease({
      workerId: this.workerId,
      job: {
        ...job,
        payload: {
          ...job.payload,
          checkpointKey,
          assistantOutputStarted:
            payload.assistantOutputStarted ||
            event.type === "message.delta" ||
            event.type === "tool.requested" ||
            event.type === "run.waiting_tool_approval" ||
            event.type === "run.waiting_tool_dispatch",
          lastEventSequence: event.sequence,
        },
        updatedAt: new Date().toISOString(),
      },
    });
    if (updated === undefined) {
      await this.checkpointStore
        .deleteObject(checkpointKey)
        .catch(() => undefined);
      throw new ApiError(
        "run_execution_lease_lost",
        "Run execution ownership was lost before the checkpoint could be committed.",
        409,
      );
    }
    if (payload.checkpointKey !== checkpointKey)
      await this.checkpointStore
        .deleteObject(payload.checkpointKey)
        .catch(() => undefined);
    return updated;
  }

  async finish(
    job: BackgroundJob,
    outcome: NonNullable<RunExecutionJobPayload["outcome"]>,
  ): Promise<BackgroundJob> {
    const payload = executionJobPayload(job);
    const completedAt = new Date().toISOString();
    const completed = await this.repository.updateBackgroundJobWithLease({
      workerId: this.workerId,
      job: {
        ...job,
        status:
          outcome === "failed" || outcome === "output_interrupted"
            ? "failed"
            : "completed",
        payload: { ...job.payload, outcome },
        updatedAt: completedAt,
        completedAt,
      },
    });
    if (completed !== undefined && payload !== undefined)
      await this.checkpointStore
        .deleteObject(payload.checkpointKey)
        .catch(() => undefined);
    return completed ?? job;
  }

  async readCheckpoint(
    job: BackgroundJob,
  ): Promise<RunExecutionCheckpoint | undefined> {
    const payload = executionJobPayload(job);
    if (payload === undefined) return undefined;
    const bytes = await this.checkpointStore
      .getObject(payload.checkpointKey)
      .catch(() => undefined);
    if (bytes === undefined) return undefined;
    try {
      return runExecutionCheckpoint(
        JSON.parse(Buffer.from(bytes).toString("utf8")),
      );
    } catch {
      return undefined;
    }
  }

  markWaiting(run: RunRecord): Promise<RunRecord> {
    return this.repository.updateRun(
      runWithStatus(run, "waiting_tool_approval"),
    );
  }

  markQueued(run: RunRecord): Promise<RunRecord> {
    return this.repository.updateRun(runWithStatus(run, "queued"));
  }

  async markContinuing(
    run: RunRecord,
    data: {
      reason: "tool_approval" | "tool_dispatch";
      toolId: string;
      approvalRequestId?: string;
      errorCode?: string;
      jobId?: string;
      outcome?: "completed" | "failed";
    },
  ): Promise<RunRecord> {
    const result = await this.repository.transaction(async (repository) => {
      const runningRun = await repository.updateRun(
        runWithStatus(run, "running"),
      );
      const event = await this.sequencer.create(repository, {
        runId: run.id,
        type: "run.continuing",
        data,
      });
      await this.sequencer.persist(repository, [event]);
      return { event, runningRun };
    });
    await this.sequencer.notify([result.event]);
    return result.runningRun;
  }

  private async writeCheckpoint(
    key: string,
    checkpoint: RunExecutionCheckpoint,
  ): Promise<void> {
    await this.checkpointStore.putObject({
      key,
      body: Buffer.from(JSON.stringify(checkpoint), "utf8"),
      contentType: "application/vnd.romeo.run-execution-checkpoint+json",
    });
  }
}
