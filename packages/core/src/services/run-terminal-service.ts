import type { AuthSubject } from "@romeo/auth";
import type { RunEvent } from "@romeo/ai-runtime";
import type { BaseModel } from "@romeo/providers";

import type {
  RunRecord,
  ToolOperationDispatchPayloadStoreReference,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { createId } from "../ids";
import { writeAuditLog } from "./audit-log";
import type { RunAccessService } from "./run-access-service";
import type { RunEventSequencer } from "./run-event-sequencer";
import type { RunKnowledgeCitation } from "./run-knowledge";
import { isTerminalRunStatus } from "./run-recovery-service";
import type { RunServiceOptions } from "./run-service-contracts";
import { appendRunCitations } from "./run-knowledge";
import { providerUsageFromEvent } from "./run-stream-service";
import {
  drainRunTerminalOutbox,
  persistTerminalRun,
  persistTerminalRunInRepository,
  type PersistTerminalRunInput,
} from "./run-terminal-effects";
import {
  deleteDispatchPayloadObjects,
  dispatchPayloadStoreReference,
  payloadString,
} from "./run-tool-service";
import type { WebhookEmitter } from "./webhook-service";
import { WorkerSupervisor } from "./worker-supervisor";

export class RunTerminalService {
  private readonly workerId = createId("terminal_worker");
  private readonly supervisor = new WorkerSupervisor("run_terminal_outbox");

  constructor(
    private readonly repository: RomeoRepository,
    private readonly sequencer: RunEventSequencer,
    private readonly access: RunAccessService,
    private readonly webhooks: WebhookEmitter | undefined,
    private readonly options: RunServiceOptions,
    private readonly abort: (runId: string) => void,
    private readonly drainQueue: (chatId: string) => void,
  ) {}

  startWorker(intervalMs = 1_000): void {
    const normalizedIntervalMs = Math.max(100, intervalMs);
    this.supervisor.start((signal) => this.runOnce(signal), {
      intervalMs: normalizedIntervalMs,
      maxBackoffMs: normalizedIntervalMs * 16,
      jitterRatio: 0.2,
    });
  }

  stopWorker(): void {
    this.supervisor.stop();
  }

  drainWorker(): Promise<void> {
    return this.supervisor.drain();
  }

  async runOnce(signal?: AbortSignal): Promise<number> {
    const organizations = await this.repository.listAllOrganizations();
    const counts = await Promise.all(
      organizations.map((organization) =>
        signal?.aborted === true
          ? Promise.resolve(0)
          : this.drain(organization.id, signal),
      ),
    );
    const processed = counts.reduce((total, count) => total + count, 0);
    this.supervisor.recordLease({
      claimed: processed > 0,
      count: Math.max(1, processed),
    });
    return processed;
  }

  async cancel(runId: string, subject: AuthSubject): Promise<RunRecord> {
    const run = await this.access.getAuthorizedRun(
      runId,
      subject,
      "runs:cancel",
    );
    if (isTerminalRunStatus(run.status)) return run;
    this.abort(runId);
    const model = await this.repository.getModel(run.modelId);
    const payloadReferences: ToolOperationDispatchPayloadStoreReference[] = [];
    const completedAt = new Date().toISOString();
    const persisted = await this.repository.transaction(async (repository) => {
      const result = await persistTerminalRunInRepository(
        repository,
        this.sequencer,
        {
          run,
          status: "cancelled",
          assistantContent: "",
          ...(model === undefined ? {} : { model }),
          terminalEvent: { type: "run.cancelled", data: {} },
        },
        completedAt,
      );
      if (result.run !== undefined && run.status === "queued")
        payloadReferences.push(
          ...(await this.cancelLinkedDispatchRequests(
            repository,
            run,
            subject,
          )),
        );
      return result;
    });
    await this.sequencer.notify(persisted.events);
    await deleteDispatchPayloadObjects(
      this.options.dispatchPayloadStore,
      payloadReferences,
    );
    void this.drain(run.orgId);
    this.drainQueue(run.chatId);
    return persisted.run ?? (await this.repository.getRun(runId)) ?? run;
  }

  async complete(
    run: RunRecord,
    event: RunEvent,
    assistantContent: string,
    model: BaseModel,
    citations: RunKnowledgeCitation[],
    subject: AuthSubject,
  ): Promise<void> {
    const terminalEventType = runTerminalEventType(event);
    const status =
      terminalEventType === "run.completed"
        ? "completed"
        : terminalEventType === "run.cancelled"
          ? "cancelled"
          : "failed";
    const providerUsage = providerUsageFromEvent(event);
    const error =
      status === "failed" || status === "cancelled"
        ? runErrorFromEvent(event, status)
        : undefined;
    await this.persist({
      run,
      subject,
      status,
      assistantContent: appendRunCitations(assistantContent, citations),
      model,
      ...(providerUsage === undefined ? {} : { providerUsage }),
      ...(citations.length === 0 ? {} : { citations }),
      ...(error === undefined ? {} : { error }),
      terminalEvent: {
        type: terminalEventType,
        data: event.data as Record<string, unknown>,
      },
    });
    void this.drain(run.orgId);
    this.drainQueue(run.chatId);
  }

  persist(input: PersistTerminalRunInput): Promise<RunRecord | undefined> {
    return persistTerminalRun(this.repository, this.sequencer, input);
  }

  drain(orgId: string, signal?: AbortSignal): Promise<number> {
    return drainRunTerminalOutbox({
      repository: this.repository,
      workerId: this.workerId,
      orgId,
      ...(this.webhooks === undefined ? {} : { webhooks: this.webhooks }),
      ...(signal === undefined ? {} : { signal }),
    });
  }

  private async cancelLinkedDispatchRequests(
    repository: RomeoRepository,
    run: RunRecord,
    subject: AuthSubject,
  ): Promise<ToolOperationDispatchPayloadStoreReference[]> {
    const now = new Date().toISOString();
    const jobs = (await repository.listBackgroundJobs(run.orgId)).filter(
      (job) =>
        job.type === "tool.operation.dispatch_request" &&
        job.payload.runContinuation === "model_tool_dispatch" &&
        job.payload.runId === run.id &&
        (job.status === "queued" || job.status === "running"),
    );
    for (const job of jobs) {
      await repository.updateBackgroundJob({
        ...job,
        status: "failed",
        payload: {
          ...job.payload,
          cancelledAt: now,
          cancelledBy: subject.id,
          cancelReasonCode: "run_cancelled",
          errorCode: "worker_cancelled",
        },
        updatedAt: now,
        completedAt: now,
      });
      await writeAuditLog(repository, {
        subject,
        action: "tool.operation.dispatch_request.cancel",
        resourceType: "tool_operation",
        resourceId: payloadString(job, "operationId"),
        metadata: {
          jobId: job.id,
          connectorId: payloadString(job, "connectorId"),
          operationId: payloadString(job, "operationId"),
          method: payloadString(job, "method"),
          path: payloadString(job, "path"),
          workerQueue: "external_tool_operations",
          errorCode: "worker_cancelled",
          reasonCode: "run_cancelled",
          runId: run.id,
        },
      });
    }
    return jobs
      .map((job) => dispatchPayloadStoreReference(job))
      .filter(
        (reference): reference is ToolOperationDispatchPayloadStoreReference =>
          reference !== undefined,
      );
  }
}

function runTerminalEventType(
  event: RunEvent,
): "run.cancelled" | "run.completed" | "run.failed" {
  if (
    event.type === "run.cancelled" ||
    event.type === "run.completed" ||
    event.type === "run.failed"
  )
    return event.type;
  throw new Error("Run terminal persistence requires a terminal event.");
}

function runErrorFromEvent(
  event: RunEvent,
  status: "cancelled" | "failed",
): { code: string; message?: string } {
  if (status === "cancelled") {
    return {
      code: "run_cancelled",
      message: "The response was stopped.",
    };
  }
  const data =
    typeof event.data === "object" && event.data !== null
      ? (event.data as Record<string, unknown>)
      : {};
  const code =
    typeof data.errorCode === "string" && data.errorCode.trim().length > 0
      ? data.errorCode.trim()
      : "provider_run_failed";
  const message =
    typeof data.message === "string" && data.message.trim().length > 0
      ? data.message.trim()
      : undefined;
  return {
    code,
    ...(message === undefined ? {} : { message }),
  };
}
