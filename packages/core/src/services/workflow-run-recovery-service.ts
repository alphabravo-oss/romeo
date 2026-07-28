import { AuthorizationError, assertScope, type AuthSubject } from "@romeo/auth";

import type {
  RunRecord,
  WorkflowDefinition,
  WorkflowRun,
  WorkflowStep,
  WorkflowStepRun,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { assertAbuseControlsAllow } from "./abuse-control-service";
import { writeAuditLog } from "./audit-log";
import type { DeferredRunStart } from "./run-service";
import {
  appendWorkflowPreviousAttempt,
  workflowStepAttempt,
  workflowStepCanRetry,
  workflowStepOnFailure,
} from "./workflow-recovery";
import type { WorkflowStepExecutor } from "./workflow-step-executor";

export class WorkflowRunRecoveryService {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly stepExecutor: WorkflowStepExecutor,
  ) {}

  async resume(input: {
    subject: AuthSubject;
    workflowRunId: string;
  }): Promise<WorkflowRun> {
    assertScope(input.subject, "agents:run");
    const run = await this.repository.getWorkflowRun(input.workflowRunId);
    if (run === undefined || run.orgId !== input.subject.orgId) {
      throw notFound("Workflow run");
    }
    const workflow = await this.getAuthorizedWorkflow(
      input.subject,
      run.workflowId,
    );
    if (run.status !== "waiting_run" || run.currentStepId === undefined) {
      throw new ApiError(
        "workflow_run_not_waiting_run",
        "Workflow run is not waiting for an agent run.",
        409,
      );
    }

    const currentStep = run.steps.find(
      (step) => step.stepId === run.currentStepId,
    );
    const workflowStep = workflow.steps.find(
      (step) => step.id === run.currentStepId,
    );
    if (currentStep === undefined || workflowStep === undefined) {
      throw new ApiError(
        "workflow_run_invalid_state",
        "Waiting workflow run is missing the current workflow step.",
        409,
      );
    }
    const linkedRuns = await this.getLinkedRuns(run, currentStep, workflowStep);
    if (
      linkedRuns.some(
        (linkedRun) =>
          linkedRun.status === "queued" || linkedRun.status === "running",
      )
    ) {
      return run;
    }
    await assertAbuseControlsAllow(this.repository, input.subject, {
      action: "workflow.run",
      workspaceId: workflow.workspaceId,
      workerClass: "workflow.run",
    });

    const now = new Date().toISOString();
    const failedLinkedRun = linkedRuns.find(
      (linkedRun) => linkedRun.status !== "completed",
    );
    if (failedLinkedRun !== undefined) {
      if (
        workflowStep.type !== "agent_room" &&
        workflowStepCanRetry(workflowStep, currentStep)
      ) {
        return this.retry({
          subject: input.subject,
          run,
          workflow,
          workflowStep,
          currentStep,
          failedLinkedRun,
          linkedRuns,
          now,
        });
      }
      if (workflowStepOnFailure(workflowStep) === "continue") {
        return this.continueAfterFailure({
          subject: input.subject,
          run,
          workflow,
          linkedRuns,
          now,
        });
      }
      return this.failRun(input.subject, run, workflow, linkedRuns, now);
    }
    return this.completeCurrentStep(
      input.subject,
      run,
      workflow,
      linkedRuns,
      now,
    );
  }

  private async retry(input: {
    subject: AuthSubject;
    run: WorkflowRun;
    workflow: WorkflowDefinition;
    workflowStep: WorkflowStep;
    currentStep: WorkflowStepRun;
    failedLinkedRun: RunRecord;
    linkedRuns: RunRecord[];
    now: string;
  }): Promise<WorkflowRun> {
    const deferredStarts: DeferredRunStart[] = [];
    const retried = await this.repository.transaction(async (repository) => {
      const retryStep = await this.stepExecutor.startAgentStep({
        subject: input.subject,
        workflow: input.workflow,
        step: input.workflowStep,
        runInput: input.run.input,
        completedSteps: input.run.steps.filter(
          (step) => step.status === "completed",
        ),
        now: input.now,
        attempt: workflowStepAttempt(input.currentStep) + 1,
        previousAttempts: appendWorkflowPreviousAttempt(input.currentStep, {
          runId: input.failedLinkedRun.id,
          status: input.failedLinkedRun.status,
        }),
        repository,
        deferredStarts,
      });
      const retriedSteps = input.run.steps.map((step) =>
        step.stepId === input.run.currentStepId ? retryStep : step,
      );
      const { completedAt: _completedAt, ...runBase } = input.run;
      return updateWithAudit(repository, {
        subject: input.subject,
        action: "workflow.run.retry",
        runId: input.run.id,
        workflowId: input.workflow.id,
        nextRun: {
          ...runBase,
          status: "waiting_run",
          steps: retriedSteps,
          updatedAt: input.now,
        },
        metadata: {
          ...linkedRunAuditMetadata(input.linkedRuns),
          retryRunId: retryStep.output.runId,
          attempt: retryStep.output.attempt,
        },
      });
    });
    startDeferredRuns(deferredStarts);
    return retried;
  }

  private async continueAfterFailure(input: {
    subject: AuthSubject;
    run: WorkflowRun;
    workflow: WorkflowDefinition;
    linkedRuns: RunRecord[];
    now: string;
  }): Promise<WorkflowRun> {
    const recoveredSteps = completeActiveStep(
      input.run,
      input.linkedRuns,
      input.now,
      { recoveryAction: "continued_after_failure" },
    );
    const deferredStarts: DeferredRunStart[] = [];
    const recovered = await this.repository.transaction(async (repository) => {
      const evaluated = await this.stepExecutor.evaluate({
        subject: input.subject,
        workflow: input.workflow,
        existingSteps: recoveredSteps,
        now: input.now,
        runInput: input.run.input,
        repository,
        deferredStarts,
      });
      return updateEvaluatedRun(repository, {
        subject: input.subject,
        action: "workflow.run.recover",
        run: input.run,
        workflow: input.workflow,
        evaluated,
        now: input.now,
        metadata: {
          recoveryAction: "continue",
          ...linkedRunAuditMetadata(input.linkedRuns),
        },
      });
    });
    startDeferredRuns(deferredStarts);
    return recovered;
  }

  private async failRun(
    subject: AuthSubject,
    run: WorkflowRun,
    workflow: WorkflowDefinition,
    linkedRuns: RunRecord[],
    now: string,
  ): Promise<WorkflowRun> {
    const failedSteps = run.steps.map((step) =>
      step.stepId === run.currentStepId
        ? {
            ...step,
            status: "failed" as const,
            output: { ...step.output, ...linkedRunStatusOutput(linkedRuns) },
            completedAt: now,
          }
        : step,
    );
    const {
      currentStepId: _currentStepId,
      completedAt: _completedAt,
      ...runBase
    } = run;
    return this.repository.transaction((repository) =>
      updateWithAudit(repository, {
        subject,
        action: "workflow.run.resume",
        runId: run.id,
        workflowId: workflow.id,
        nextRun: {
          ...runBase,
          status: "failed",
          steps: failedSteps,
          updatedAt: now,
          completedAt: now,
        },
        metadata: linkedRunAuditMetadata(linkedRuns),
      }),
    );
  }

  private async completeCurrentStep(
    subject: AuthSubject,
    run: WorkflowRun,
    workflow: WorkflowDefinition,
    linkedRuns: RunRecord[],
    now: string,
  ): Promise<WorkflowRun> {
    const completedSteps = completeActiveStep(run, linkedRuns, now);
    const deferredStarts: DeferredRunStart[] = [];
    const updated = await this.repository.transaction(async (repository) => {
      const evaluated = await this.stepExecutor.evaluate({
        subject,
        workflow,
        existingSteps: completedSteps,
        now,
        runInput: run.input,
        repository,
        deferredStarts,
      });
      return updateEvaluatedRun(repository, {
        subject,
        action: "workflow.run.resume",
        run,
        workflow,
        evaluated,
        now,
        metadata: linkedRunAuditMetadata(linkedRuns),
      });
    });
    startDeferredRuns(deferredStarts);
    return updated;
  }

  private async getLinkedRuns(
    run: WorkflowRun,
    stepRun: WorkflowStepRun,
    workflowStep: WorkflowStep,
  ): Promise<RunRecord[]> {
    const runIds =
      workflowStep.type === "agent_room"
        ? stringArray(stepRun.output.runIds)
        : stringArray([stepRun.output.runId]);
    if (runIds.length === 0) {
      throw invalidRunState(
        "Waiting workflow run is missing linked model runs.",
      );
    }
    const runs = await Promise.all(
      runIds.map((runId) => this.repository.getRun(runId)),
    );
    const linkedRuns = runs.filter(
      (linkedRun): linkedRun is RunRecord => linkedRun !== undefined,
    );
    if (
      linkedRuns.length !== runIds.length ||
      linkedRuns.some(
        (linkedRun) =>
          linkedRun.orgId !== run.orgId ||
          linkedRun.workspaceId !== run.workspaceId,
      )
    ) {
      throw invalidRunState(
        "Waiting workflow run references an invalid model run.",
      );
    }
    return linkedRuns;
  }

  private async getAuthorizedWorkflow(
    subject: AuthSubject,
    workflowId: string,
  ): Promise<WorkflowDefinition> {
    const workflow = await this.repository.getWorkflowDefinition(workflowId);
    if (workflow === undefined || workflow.orgId !== subject.orgId) {
      throw notFound("Workflow");
    }
    assertWorkspaceAccess(subject, workflow.workspaceId);
    return workflow;
  }
}

function completeActiveStep(
  run: WorkflowRun,
  linkedRuns: RunRecord[],
  now: string,
  extraOutput: Record<string, unknown> = {},
): WorkflowStepRun[] {
  return run.steps.map((step) =>
    step.stepId === run.currentStepId
      ? {
          ...step,
          status: "completed" as const,
          output: {
            ...step.output,
            ...linkedRunStatusOutput(linkedRuns),
            ...extraOutput,
          },
          completedAt: now,
        }
      : step,
  );
}

async function updateEvaluatedRun(
  repository: RomeoRepository,
  input: {
    subject: AuthSubject;
    action: string;
    run: WorkflowRun;
    workflow: WorkflowDefinition;
    evaluated: Awaited<ReturnType<WorkflowStepExecutor["evaluate"]>>;
    now: string;
    metadata: Record<string, unknown>;
  },
): Promise<WorkflowRun> {
  const {
    currentStepId: _currentStepId,
    completedAt: _completedAt,
    ...runBase
  } = input.run;
  return updateWithAudit(repository, {
    subject: input.subject,
    action: input.action,
    runId: input.run.id,
    workflowId: input.workflow.id,
    nextRun: {
      ...runBase,
      status: input.evaluated.status,
      steps: input.evaluated.steps,
      updatedAt: input.now,
      ...(input.evaluated.currentStepId === undefined
        ? {}
        : { currentStepId: input.evaluated.currentStepId }),
      ...(input.evaluated.status === "completed"
        ? { completedAt: input.now }
        : {}),
    },
    metadata: input.metadata,
  });
}

async function updateWithAudit(
  repository: RomeoRepository,
  input: {
    subject: AuthSubject;
    action: string;
    runId: string;
    workflowId: string;
    nextRun: WorkflowRun;
    metadata: Record<string, unknown>;
  },
): Promise<WorkflowRun> {
  const updated = await repository.updateWorkflowRun(input.nextRun);
  await writeAuditLog(repository, {
    subject: input.subject,
    action: input.action,
    resourceType: "workflow",
    resourceId: input.runId,
    metadata: {
      workflowId: input.workflowId,
      status: updated.status,
      currentStepId: updated.currentStepId ?? null,
      ...input.metadata,
    },
  });
  return updated;
}

function linkedRunStatusOutput(
  linkedRuns: RunRecord[],
): Record<string, unknown> {
  if (linkedRuns.length === 1 && linkedRuns[0] !== undefined) {
    return { runStatus: linkedRuns[0].status };
  }
  return {
    runStatuses: linkedRuns.map((run) => ({
      runId: run.id,
      status: run.status,
    })),
  };
}

function linkedRunAuditMetadata(
  linkedRuns: RunRecord[],
): Record<string, unknown> {
  if (linkedRuns.length === 1 && linkedRuns[0] !== undefined) {
    return {
      linkedRunId: linkedRuns[0].id,
      linkedRunStatus: linkedRuns[0].status,
    };
  }
  return {
    linkedRunIds: linkedRuns.map((run) => run.id),
    linkedRunStatuses: linkedRuns.map((run) => run.status),
  };
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is string => typeof item === "string" && item.length > 0,
  );
}

function startDeferredRuns(starts: DeferredRunStart[]): void {
  for (const start of starts) start.startExecution();
}

function assertWorkspaceAccess(
  subject: AuthSubject,
  workspaceId: string,
): void {
  if (subject.isAdmin !== true && !subject.workspaceIds.includes(workspaceId)) {
    throw new AuthorizationError(
      "The workflow workspace is outside the caller workspace access.",
    );
  }
}

function invalidRunState(message: string): ApiError {
  return new ApiError("workflow_run_invalid_state", message, 409);
}
