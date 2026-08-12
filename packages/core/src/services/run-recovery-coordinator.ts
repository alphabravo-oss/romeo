import type { AuthSubject } from "@romeo/auth";
import type {
  BaseModel,
  ChatMessage,
  ProviderInstance,
  ProviderToolDefinition,
} from "@romeo/providers";

import type { BackgroundJob, RunRecord } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import {
  createProviderRoutePlan,
  type ProviderRoutePlan,
  type ProviderRoutingPolicy,
} from "./provider-routing";
import {
  executionJobPayload,
  runExecutionJobType,
  type RunExecutionCheckpoint,
  type RunExecutionJobPayload,
} from "./run-recovery-service";
import type { RunKnowledgeCitation } from "./run-knowledge";
import type { RunServiceOptions } from "./run-service-contracts";
import type { PersistTerminalRunInput } from "./run-terminal-effects";

export interface RecoverableRunExecutionInput {
  run: RunRecord;
  messages: ChatMessage[];
  provider: ProviderInstance;
  model: BaseModel;
  citations: RunKnowledgeCitation[];
  routePlan: ProviderRoutePlan;
  providerTools: ProviderToolDefinition[];
  subject: AuthSubject;
  assistantContentPrefix?: string;
  emitRunStarted?: boolean;
}

interface SubjectSnapshotInput {
  orgId: string;
  workspaceId: string;
  principalId: string;
  principalType: "user" | "service_account";
  scopeSnapshot: AuthSubject["scopes"];
}

export class RunRecoveryCoordinator {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly routingPolicy: ProviderRoutingPolicy,
    private readonly workerId: string,
    private readonly options: RunServiceOptions,
    private readonly ports: {
      active: (runId: string) => boolean;
      drainQueue: (chatId: string) => void;
      drainTerminalOutbox: (orgId: string) => void;
      execute: (input: RecoverableRunExecutionInput) => void;
      finishExecution: (
        job: BackgroundJob,
        outcome: NonNullable<RunExecutionJobPayload["outcome"]>,
      ) => Promise<unknown>;
      persistTerminal: (input: PersistTerminalRunInput) => Promise<unknown>;
      readCheckpoint: (
        job: BackgroundJob,
      ) => Promise<RunExecutionCheckpoint | undefined>;
      subjectFromSnapshot: (
        input: SubjectSnapshotInput,
      ) => Promise<AuthSubject>;
    },
  ) {}

  async recover(chatId: string): Promise<void> {
    const runs = await this.repository.listRuns(chatId);
    if (runs[0] !== undefined) this.ports.drainTerminalOutbox(runs[0].orgId);
    await this.reconcileSettledExecutions(runs);
    const running = runs.find((run) => run.status === "running");
    if (running === undefined || this.ports.active(running.id)) return;
    const events = await this.repository.listRunEvents(running.id);
    const lastActivityAt = events.at(-1)?.createdAt ?? running.createdAt;
    if (
      Date.now() - Date.parse(lastActivityAt) <
      (this.options.runRecoveryStaleMs ?? 120_000)
    )
      return;
    const executionJob = (
      await this.repository.listBackgroundJobs(running.orgId)
    )
      .filter(
        (job) =>
          job.type === runExecutionJobType(running.id) &&
          (job.status === "queued" || job.status === "running"),
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
    const metadata =
      executionJob === undefined
        ? undefined
        : executionJobPayload(executionJob);
    const checkpoint =
      executionJob === undefined
        ? undefined
        : await this.ports.readCheckpoint(executionJob);
    if (
      metadata !== undefined &&
      checkpoint !== undefined &&
      !metadata.assistantOutputStarted
    ) {
      const [model, provider] = await Promise.all([
        this.repository.getModel(running.modelId),
        this.repository.getProvider(running.providerId),
      ]);
      if (model !== undefined && provider !== undefined) {
        const subject = await this.ports.subjectFromSnapshot({
          orgId: running.orgId,
          workspaceId: running.workspaceId,
          principalId: checkpoint.principalId,
          principalType: checkpoint.principalType,
          scopeSnapshot: checkpoint.scopeSnapshot,
        });
        const routePlan = await createProviderRoutePlan(
          this.repository,
          this.routingPolicy,
          { model, provider },
        );
        this.ports.execute({
          run: running,
          messages: checkpoint.messages,
          provider,
          model,
          citations: checkpoint.citations,
          routePlan,
          providerTools: checkpoint.providerTools,
          subject,
          assistantContentPrefix: checkpoint.assistantContent,
          emitRunStarted: false,
        });
        return;
      }
    }
    const interrupted =
      executionJob === undefined
        ? undefined
        : await this.repository.claimBackgroundJob({
            orgId: running.orgId,
            type: runExecutionJobType(running.id),
            workerId: this.workerId,
            leaseSeconds: this.leaseSeconds(),
          });
    if (executionJob !== undefined && interrupted === undefined) return;
    const model = await this.repository.getModel(running.modelId);
    await this.ports.persistTerminal({
      run: running,
      status: "failed",
      assistantContent: "",
      ...(model === undefined ? {} : { model }),
      error: {
        code: "run_execution_interrupted",
        message:
          "The server stopped while this response was running. The run was recovered as failed; you can retry the message.",
      },
      terminalEvent: {
        type: "run.failed",
        data: {
          errorCode: "run_execution_interrupted",
          message:
            "The server stopped while this response was running. The run was recovered as failed; you can retry the message.",
          recoverable: true,
        },
      },
    });
    if (interrupted !== undefined)
      await this.ports.finishExecution(interrupted, "output_interrupted");
    this.ports.drainTerminalOutbox(running.orgId);
    this.ports.drainQueue(running.chatId);
  }

  private async reconcileSettledExecutions(runs: RunRecord[]): Promise<void> {
    const orgId = runs[0]?.orgId;
    if (orgId === undefined) return;
    const jobs = await this.repository.listBackgroundJobs(orgId);
    for (const run of runs) {
      const outcome = await this.settledExecutionOutcome(run);
      if (outcome === undefined) continue;
      const job = jobs.find(
        (candidate) =>
          candidate.type === runExecutionJobType(run.id) &&
          (candidate.status === "queued" || candidate.status === "running"),
      );
      if (job === undefined) continue;
      const claimed = await this.repository.claimBackgroundJob({
        orgId: run.orgId,
        type: runExecutionJobType(run.id),
        workerId: this.workerId,
        leaseSeconds: this.leaseSeconds(),
      });
      if (claimed?.id !== job.id) continue;
      await this.ports.finishExecution(claimed, outcome);
    }
  }

  private async settledExecutionOutcome(
    run: RunRecord,
  ): Promise<NonNullable<RunExecutionJobPayload["outcome"]> | undefined> {
    if (run.status === "completed") return "completed";
    if (run.status === "cancelled" || run.status === "failed") return "failed";
    if (run.status === "waiting_tool_approval") return "waiting_tool_approval";
    if (run.status !== "queued") return undefined;
    return (await this.repository.listRunEvents(run.id)).some(
      (event) => event.type === "run.waiting_tool_dispatch",
    )
      ? "waiting_tool_dispatch"
      : undefined;
  }

  private leaseSeconds(): number {
    return this.options.runExecutionLeaseSeconds ?? 60;
  }
}
