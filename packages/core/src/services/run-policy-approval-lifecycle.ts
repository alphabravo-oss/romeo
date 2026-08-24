import type { AuthSubject } from "@romeo/auth";
import type { RunEvent } from "@romeo/ai-runtime";

import type { BackgroundJob, RunRecord } from "../domain/entities";
import type {
  ContentPolicyDecisionRecord,
  PolicyApprovalRecord,
} from "../domain/content-policy";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { createId } from "../ids";
import { writeAuditLog } from "./audit-log";
import { publicPolicyApproval } from "./policy-approval";
import type { ProviderRoutingPolicy } from "./provider-routing";
import type { RunAccessService } from "./run-access-service";
import type { RunEventSequencer } from "./run-event-sequencer";
import type { RunExecutionStateService } from "./run-execution-state-service";
import {
  executionJobPayload,
  runWithStatus,
  type RunExecutionCheckpoint,
} from "./run-recovery-service";
import type { RunStreamingExecutionInput } from "./run-streaming-execution-service";
import { persistTerminalRunInRepository } from "./run-terminal-effects";
import { resumeContentPolicyApprovedRun } from "./run-policy-approval-resumption";
import { withApprovalCriticalSection } from "./tool-approval-integrity";

export interface PauseForPolicyApprovalInput {
  checkpoint: RunExecutionCheckpoint;
  detectors: ContentPolicyDecisionRecord["detectors"];
  executionJob: BackgroundJob;
  policyVersionId: string;
  approvalTtlSeconds: number;
  run: RunRecord;
}

export class RunPolicyApprovalLifecycle {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly sequencer: RunEventSequencer,
    private readonly executionState: RunExecutionStateService,
    private readonly access: RunAccessService,
    private readonly routingPolicy: ProviderRoutingPolicy,
    private readonly workerId: string,
    private readonly execute: (input: RunStreamingExecutionInput) => void,
  ) {}

  async pause(
    input: PauseForPolicyApprovalInput,
  ): Promise<PolicyApprovalRecord> {
    const now = new Date().toISOString();
    const decision: ContentPolicyDecisionRecord = {
      id: createId("policy_decision"),
      orgId: input.run.orgId,
      policyVersionId: input.policyVersionId,
      surface: "run_output",
      action: "block",
      detectors: input.detectors.map((detector) => ({ ...detector })),
      decidedAt: now,
      runId: input.run.id,
      executionJobId: input.executionJob.id,
    };
    const approval: PolicyApprovalRecord = {
      id: createId("policy_approval"),
      orgId: input.run.orgId,
      runId: input.run.id,
      decisionId: decision.id,
      policyVersionId: input.policyVersionId,
      executionJobId: input.executionJob.id,
      actorId: input.run.createdBy,
      state: "pending",
      expiresAt: new Date(
        Date.parse(now) + input.approvalTtlSeconds * 1_000,
      ).toISOString(),
      createdAt: now,
    };
    const event = await this.sequencer.assign(this.repository, {
      id: "",
      runId: input.run.id,
      sequence: 0,
      schemaVersion: 1,
      type: "run.waiting_tool_approval",
      data: {
        approvalId: approval.id,
        decisionId: decision.id,
        policyVersionId: decision.policyVersionId,
        code: "content_policy_approval_required",
        channel: "content_policy",
      },
      createdAt: now,
    });
    const checkpointed = await this.executionState.checkpoint(
      input.executionJob,
      event,
      input.checkpoint,
    );
    const persisted = await this.repository.transaction(async (repository) => {
      await repository.createContentPolicyDecision(decision);
      await repository.createContentPolicyApproval(approval);
      const run = await repository.getRun(input.run.id);
      if (run === undefined || run.status !== "running")
        throw new ApiError(
          "content_policy_approval_scope_mismatch",
          "The policy decision is no longer bound to a running run.",
          403,
        );
      await repository.updateRun(runWithStatus(run, "waiting_tool_approval"));
      const released = await repository.updateBackgroundJobWithLease({
        workerId: this.workerId,
        job: {
          ...checkpointed,
          status: "queued",
          payload: {
            ...checkpointed.payload,
            outcome: "waiting_tool_approval",
            contentPolicyApprovalId: approval.id,
            contentPolicyDecisionId: decision.id,
          },
          updatedAt: now,
        },
      });
      if (released === undefined)
        throw new ApiError(
          "run_execution_lease_lost",
          "Run execution ownership was lost while pausing for policy approval.",
          409,
        );
      await this.sequencer.persist(repository, [event]);
      await writeAuditLog(repository, {
        id: `audit_content_policy_approval_request_${approval.id}`,
        orgId: approval.orgId,
        actorId: approval.actorId,
        action: "admin.content_policy.approval.request",
        resourceType: "content_policy",
        resourceId: approval.id,
        outcome: "success",
        metadata: {
          runId: approval.runId,
          state: approval.state,
          policyVersionId: approval.policyVersionId,
          detectorCodes: decision.detectors.map((detector) => detector.code),
        },
        createdAt: now,
      });
      return approval;
    });
    await this.sequencer.notify([event]);
    return persisted;
  }

  async resolve(input: {
    subject: AuthSubject;
    approvalId: string;
    decision: "approve" | "deny";
    runId?: string;
  }): Promise<ReturnType<typeof publicPolicyApproval>> {
    return withApprovalCriticalSection(
      input.subject.orgId,
      input.approvalId,
      () => this.resolveLocked(input),
    );
  }

  private async resolveLocked(input: {
    subject: AuthSubject;
    approvalId: string;
    decision: "approve" | "deny";
    runId?: string;
  }): Promise<ReturnType<typeof publicPolicyApproval>> {
    const current = await this.requireApproval(
      input.subject.orgId,
      input.approvalId,
    );
    this.assertRunScope(current, input.runId ?? current.runId);
    const now = new Date().toISOString();
    if (current.state !== "pending")
      return this.resolveExisting(current, input.decision);
    if (Date.parse(current.expiresAt) <= Date.parse(now)) {
      const expired = await this.terminate({
        subject: input.subject,
        approval: current,
        state: "expired",
        now,
      });
      throw new ApiError(
        "content_policy_approval_expired",
        "The policy approval window has expired.",
        409,
        { approvalId: expired.id, runId: expired.runId },
      );
    }
    if (input.decision === "deny") {
      const denied = await this.terminate({
        subject: input.subject,
        approval: current,
        state: "denied",
        now,
      });
      return publicPolicyApproval(denied);
    }
    const approved = await this.approve(input.subject, current, now);
    await this.resumeApproved(approved);
    return publicPolicyApproval(approved);
  }

  async expireDue(subject: AuthSubject): Promise<void> {
    const now = new Date().toISOString();
    const due = await this.repository.listPendingContentPolicyApprovalsDue(
      subject.orgId,
      now,
      100,
    );
    for (const approval of due)
      await this.terminate({ subject, approval, state: "expired", now });
  }

  private async approve(
    subject: AuthSubject,
    approval: PolicyApprovalRecord,
    now: string,
  ): Promise<PolicyApprovalRecord> {
    const result = await this.repository.transaction(async (repository) => {
      await this.assertRuntimeBinding(repository, approval);
      const transitioned = await repository.transitionContentPolicyApproval({
        approvalId: approval.id,
        expectedState: "pending",
        nextState: "approved",
        orgId: approval.orgId,
        resolvedAt: now,
        resolvedBy: subject.id,
      });
      if (transitioned === undefined) return undefined;
      const run = await repository.getRun(approval.runId);
      if (run === undefined || run.status !== "waiting_tool_approval")
        throw new ApiError(
          "content_policy_approval_scope_mismatch",
          "The approval is no longer bound to a waiting run.",
          403,
        );
      const job = await this.requireExecutionJob(repository, approval);
      const { outcome: _outcome, ...payload } = job.payload;
      await repository.updateBackgroundJob({
        ...job,
        status: "queued",
        payload: {
          ...payload,
          contentPolicyApprovalId: approval.id,
          contentPolicyApprovedAt: now,
        },
        updatedAt: now,
      });
      await repository.updateRun(runWithStatus(run, "running"));
      const event = await this.sequencer.create(repository, {
        runId: run.id,
        type: "run.continuing",
        data: {
          reason: "content_policy_approval",
          approvalId: approval.id,
          decisionId: approval.decisionId,
          policyVersionId: approval.policyVersionId,
        },
      });
      await this.sequencer.persist(repository, [event]);
      await this.auditResolution(repository, subject, transitioned, now);
      return { approval: transitioned, event };
    });
    if (result === undefined) {
      const latest = await this.requireApproval(approval.orgId, approval.id);
      return this.resolveExisting(latest, "approve");
    }
    await this.sequencer.notify([result.event]);
    return result.approval;
  }

  private async terminate(input: {
    subject: AuthSubject;
    approval: PolicyApprovalRecord;
    state: "denied" | "expired";
    now: string;
  }): Promise<PolicyApprovalRecord> {
    const result = await this.repository.transaction(async (repository) => {
      await this.assertRuntimeBinding(repository, input.approval);
      const transitioned = await repository.transitionContentPolicyApproval({
        approvalId: input.approval.id,
        expectedState: "pending",
        nextState: input.state,
        orgId: input.approval.orgId,
        resolvedAt: input.now,
        ...(input.state === "expired" ? {} : { resolvedBy: input.subject.id }),
      });
      if (transitioned === undefined) return undefined;
      const run = await repository.getRun(input.approval.runId);
      if (run !== undefined && run.status === "waiting_tool_approval") {
        const model = await repository.getModel(run.modelId);
        const terminal = await persistTerminalRunInRepository(
          repository,
          this.sequencer,
          {
            run,
            status: "failed",
            assistantContent: "",
            ...(model === undefined ? {} : { model }),
            error: {
              code:
                input.state === "expired"
                  ? "content_policy_approval_expired"
                  : "content_policy_approval_required",
            },
            terminalEvent: {
              type: "run.failed",
              data: {
                channel: "content_policy",
                errorCode:
                  input.state === "expired"
                    ? "content_policy_approval_expired"
                    : "content_policy_approval_denied",
                approvalId: transitioned.id,
              },
            },
          },
          input.now,
        );
        await this.auditResolution(
          repository,
          input.subject,
          transitioned,
          input.now,
        );
        return { approval: transitioned, events: terminal.events };
      }
      await this.auditResolution(
        repository,
        input.subject,
        transitioned,
        input.now,
      );
      return { approval: transitioned, events: [] as RunEvent[] };
    });
    if (result === undefined) {
      const latest = await this.requireApproval(
        input.approval.orgId,
        input.approval.id,
      );
      if (latest.state === input.state) return latest;
      throw this.alreadyResolvedError(latest);
    }
    await this.sequencer.notify(result.events);
    return result.approval;
  }

  private async resumeApproved(approval: PolicyApprovalRecord): Promise<void> {
    const run = await this.repository.getRun(approval.runId);
    const job = await this.requireExecutionJob(this.repository, approval);
    if (run === undefined) return;
    await resumeContentPolicyApprovedRun({
      repository: this.repository,
      executionState: this.executionState,
      access: this.access,
      routingPolicy: this.routingPolicy,
      execute: this.execute,
      job,
      run,
    });
  }

  private async assertRuntimeBinding(
    repository: RomeoRepository,
    approval: PolicyApprovalRecord,
  ): Promise<void> {
    if (approval.executionJobId === undefined) throw this.scopeMismatchError();
    const decision = await repository.getContentPolicyDecision(
      approval.orgId,
      approval.decisionId,
    );
    if (
      decision === undefined ||
      decision.surface !== "run_output" ||
      decision.runId !== approval.runId ||
      decision.executionJobId !== approval.executionJobId ||
      decision.policyVersionId !== approval.policyVersionId
    )
      throw this.scopeMismatchError();
  }

  private async requireExecutionJob(
    repository: RomeoRepository,
    approval: PolicyApprovalRecord,
  ): Promise<BackgroundJob> {
    if (approval.executionJobId === undefined) throw this.scopeMismatchError();
    const job = await repository.getBackgroundJob(
      approval.orgId,
      approval.executionJobId,
    );
    if (
      job === undefined ||
      executionJobPayload(job)?.runId !== approval.runId ||
      job.payload.contentPolicyApprovalId !== approval.id
    )
      throw this.scopeMismatchError();
    return job;
  }

  private async requireApproval(
    orgId: string,
    approvalId: string,
  ): Promise<PolicyApprovalRecord> {
    const approval = await this.repository.getContentPolicyApproval(
      orgId,
      approvalId,
    );
    if (approval === undefined) throw notFound("Content policy approval");
    return approval;
  }

  private assertRunScope(approval: PolicyApprovalRecord, runId: string): void {
    if (approval.runId !== runId) throw this.scopeMismatchError();
  }

  private resolveExisting(
    approval: PolicyApprovalRecord,
    decision: "approve" | "deny",
  ): PolicyApprovalRecord {
    if (
      (approval.state === "approved" && decision === "approve") ||
      (approval.state === "denied" && decision === "deny")
    )
      return approval;
    throw this.alreadyResolvedError(approval);
  }

  private alreadyResolvedError(approval: PolicyApprovalRecord): ApiError {
    return new ApiError(
      "content_policy_approval_expired",
      "The policy approval is no longer pending.",
      409,
      { approvalId: approval.id, state: approval.state },
    );
  }

  private scopeMismatchError(): ApiError {
    return new ApiError(
      "content_policy_approval_scope_mismatch",
      "The approval does not match the durable run decision.",
      403,
    );
  }

  private auditResolution(
    repository: RomeoRepository,
    subject: AuthSubject,
    approval: PolicyApprovalRecord,
    now: string,
  ): Promise<unknown> {
    return writeAuditLog(repository, {
      id: `audit_content_policy_approval_resolve_${approval.id}`,
      orgId: approval.orgId,
      actorId: subject.id,
      action: "admin.content_policy.approval.resolve",
      resourceType: "content_policy",
      resourceId: approval.id,
      outcome: approval.state === "approved" ? "success" : "failure",
      metadata: {
        runId: approval.runId,
        state: approval.state,
        policyVersionId: approval.policyVersionId,
      },
      createdAt: now,
    });
  }
}
