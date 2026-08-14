import { AuthorizationError, assertScope, type AuthSubject } from "@romeo/auth";

import type {
  BackgroundJob,
  WorkflowDefinition,
  WorkflowRun,
  WorkflowStep,
  WorkflowStepRun,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { createId } from "../ids";
import { assertAbuseControlsAllow } from "./abuse-control-service";
import {
  type AuditAction,
  type AuditMetadata,
  writeAuditLog,
} from "./audit-log";
import type { DeferredRunStart } from "./run-service";
import { telemetryJobPayload } from "./telemetry-context";
import {
  browserAutomationJobType,
  browserTaskApprovedOutput,
  createBrowserAutomationJobPayload,
  normalizeBrowserAutomationCompletionResult,
  readBrowserAutomationJobPayload,
  type BrowserAutomationCompletionResult,
} from "./workflow-browser-tasks";
import type { WorkflowStepExecutor } from "./workflow-step-executor";

export class WorkflowBrowserTaskService {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly stepExecutor: WorkflowStepExecutor,
  ) {}

  async approve(input: {
    subject: AuthSubject;
    run: WorkflowRun;
    workflow: WorkflowDefinition;
    workflowStep: WorkflowStep;
  }): Promise<WorkflowRun> {
    const now = new Date().toISOString();
    await assertAbuseControlsAllow(this.repository, input.subject, {
      action: "worker.enqueue",
      workspaceId: input.run.workspaceId,
      workerClass: "browser_automation",
    });
    return this.repository.transaction(async (repository) => {
      const job = await repository.createBackgroundJob({
        id: createId("job"),
        orgId: input.run.orgId,
        workspaceId: input.run.workspaceId,
        type: browserAutomationJobType,
        status: "queued",
        payload: telemetryJobPayload({
          ...createBrowserAutomationJobPayload({
            approvedAt: now,
            subject: input.subject,
            step: input.workflowStep,
            workflowId: input.workflow.id,
            workflowRun: input.run,
          }),
        }),
        createdAt: now,
        updatedAt: now,
      });
      const { completedAt: _completedAt, ...runBase } = input.run;
      const steps = input.run.steps.map((step) =>
        step.stepId === input.workflowStep.id
          ? {
              ...step,
              status: "waiting_run" as const,
              output: browserTaskApprovedOutput({
                approvedAt: now,
                approvedBy: input.subject.id,
                job,
                step: input.workflowStep,
              }),
            }
          : step,
      );
      const updated = await repository.updateWorkflowRun({
        ...runBase,
        status: "waiting_run",
        steps,
        approvedBy: input.subject.id,
        updatedAt: now,
        currentStepId: input.workflowStep.id,
      });
      await audit(
        repository,
        input.subject,
        "workflow.browser_task.approve",
        input.run.id,
        {
          jobId: job.id,
          status: updated.status,
          stepId: input.workflowStep.id,
          targetHost: job.payload.targetHost,
          targetOrigin: job.payload.targetOrigin,
          workflowId: input.workflow.id,
          workerQueue: job.payload.workerQueue,
        },
      );
      return updated;
    });
  }

  async complete(input: {
    deferredStarts?: DeferredRunStart[] | undefined;
    job: BackgroundJob;
    result: BrowserAutomationCompletionResult;
    subject: AuthSubject;
    repository?: RomeoRepository;
  }): Promise<WorkflowRun> {
    assertScope(input.subject, "tools:manage");
    const deferredStarts = input.deferredStarts ?? [];
    const complete = async (
      repository: RomeoRepository,
    ): Promise<WorkflowRun> => {
      const payload = readBrowserAutomationJobPayload(input.job);
      const { run, workflow, currentStep } = await this.getRunState(
        repository,
        input.subject,
        input.job,
      );
      const now = new Date().toISOString();
      const result = normalizeBrowserAutomationCompletionResult(input.result);
      const completedSteps = run.steps.map((step) =>
        step.stepId === payload.stepId
          ? {
              ...step,
              status: "completed" as const,
              output: {
                ...step.output,
                completedBy: input.subject.id,
                jobId: input.job.id,
                result,
                workerCompletedAt: now,
              },
              completedAt: now,
            }
          : step,
      );
      const evaluated = await this.stepExecutor.evaluate({
        subject: input.subject,
        workflow,
        existingSteps: completedSteps,
        now,
        runInput: run.input,
        repository,
        deferredStarts,
      });
      const {
        currentStepId: _currentStepId,
        completedAt: _completedAt,
        ...runBase
      } = run;
      const updated = await repository.updateWorkflowRun({
        ...runBase,
        status: evaluated.status,
        steps: evaluated.steps,
        updatedAt: now,
        ...(evaluated.currentStepId === undefined
          ? {}
          : { currentStepId: evaluated.currentStepId }),
        ...(evaluated.status === "completed" ? { completedAt: now } : {}),
      });
      await audit(
        repository,
        input.subject,
        "workflow.browser_task.complete",
        run.id,
        {
          artifactCount: result.artifactCount ?? result.artifacts?.length ?? 0,
          currentStepId: updated.currentStepId ?? null,
          finalHost: result.finalHost ?? null,
          navigationCount: result.navigationCount ?? null,
          status: updated.status,
          stepId: currentStep.stepId,
          workflowId: workflow.id,
          workerQueue: payload.workerQueue,
        },
      );
      return updated;
    };
    if (input.repository !== undefined) return complete(input.repository);
    const updated = await this.repository.transaction(complete);
    startDeferredRuns(deferredStarts);
    return updated;
  }

  async fail(input: {
    errorCode: string;
    job: BackgroundJob;
    subject: AuthSubject;
    repository?: RomeoRepository;
  }): Promise<WorkflowRun> {
    assertScope(input.subject, "tools:manage");
    const repository = input.repository ?? this.repository;
    const payload = readBrowserAutomationJobPayload(input.job);
    const { run, workflow, currentStep } = await this.getRunState(
      repository,
      input.subject,
      input.job,
    );
    const now = new Date().toISOString();
    const failedSteps = run.steps.map((step) =>
      step.stepId === payload.stepId
        ? {
            ...step,
            status: "failed" as const,
            output: {
              ...step.output,
              errorCode: input.errorCode,
              failedBy: input.subject.id,
              jobId: input.job.id,
              workerFailedAt: now,
            },
            completedAt: now,
          }
        : step,
    );
    const {
      currentStepId: _currentStepId,
      completedAt: _completedAt,
      ...runBase
    } = run;
    const updated = await repository.updateWorkflowRun({
      ...runBase,
      status: "failed",
      steps: failedSteps,
      updatedAt: now,
      completedAt: now,
    });
    await audit(
      repository,
      input.subject,
      "workflow.browser_task.fail",
      run.id,
      {
        currentStepId: updated.currentStepId ?? null,
        errorCode: input.errorCode,
        status: updated.status,
        stepId: currentStep.stepId,
        workflowId: workflow.id,
        workerQueue: payload.workerQueue,
      },
    );
    return updated;
  }

  private async getRunState(
    repository: RomeoRepository,
    subject: AuthSubject,
    job: BackgroundJob,
  ): Promise<{
    currentStep: WorkflowStepRun;
    run: WorkflowRun;
    workflow: WorkflowDefinition;
  }> {
    const payload = readBrowserAutomationJobPayload(job);
    const run = await repository.getWorkflowRun(payload.workflowRunId);
    if (run === undefined || run.orgId !== subject.orgId) {
      throw notFound("Workflow run");
    }
    if (run.status !== "waiting_run" || run.currentStepId !== payload.stepId) {
      throw invalidState(
        "Browser automation task is not linked to a waiting workflow run.",
      );
    }
    const workflow = await repository.getWorkflowDefinition(payload.workflowId);
    if (
      workflow === undefined ||
      workflow.orgId !== subject.orgId ||
      workflow.id !== run.workflowId
    ) {
      throw notFound("Workflow");
    }
    assertWorkspaceAccess(subject, workflow.workspaceId);
    const workflowStep = workflow.steps.find(
      (step) => step.id === payload.stepId,
    );
    if (workflowStep?.type !== "browser_task") {
      throw invalidState(
        "Browser automation task does not reference a browser workflow step.",
      );
    }
    const currentStep = run.steps.find(
      (step) => step.stepId === payload.stepId,
    );
    if (
      currentStep === undefined ||
      currentStep.status !== "waiting_run" ||
      currentStep.output.jobId !== job.id
    ) {
      throw invalidState(
        "Browser automation task is not the active workflow step.",
      );
    }
    return { currentStep, run, workflow };
  }
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

function invalidState(message: string): ApiError {
  return new ApiError(
    "browser_automation_workflow_state_invalid",
    message,
    409,
  );
}

async function audit<A extends AuditAction>(
  repository: RomeoRepository,
  subject: AuthSubject,
  action: A,
  resourceId: string,
  metadata: AuditMetadata<A>,
): Promise<void> {
  await writeAuditLog(repository, {
    subject,
    action,
    resourceType: "workflow",
    resourceId,
    metadata,
  });
}
