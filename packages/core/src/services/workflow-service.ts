import { AuthorizationError, assertScope, type AuthSubject } from "@romeo/auth";

import type {
  BackgroundJob,
  Chat,
  RunRecord,
  WorkflowDefinition,
  WorkflowRun,
  WorkflowSchedule,
  WorkflowScheduleRunResult,
  WorkflowStep,
  WorkflowStepRun,
  WorkflowTemplate,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { createId } from "../ids";
import { assertAbuseControlsAllow } from "./abuse-control-service";
import { getAuthorizedAgent } from "./agent-access";
import { writeAuditLog } from "./audit-log";
import type { DeferredRunStart, RunService } from "./run-service";
import { persistedSubjectActorId } from "./subject-persisted-actor";
import { assertWorkspaceActive } from "./workspace-guard";
import {
  browserAutomationJobType,
  browserTaskApprovedOutput,
  browserTaskApprovalOutput,
  createBrowserAutomationJobPayload,
  normalizeBrowserAutomationCompletionResult,
  normalizeBrowserTaskStep,
  readBrowserAutomationJobPayload,
  type BrowserAutomationCompletionResult,
} from "./workflow-browser-tasks";
import { buildWorkflowHandoffPrompt } from "./workflow-handoffs";
import {
  appendWorkflowPreviousAttempt,
  workflowStepAttempt,
  workflowStepCanRetry,
  workflowStepMaxAttempts,
  workflowStepOnFailure,
  type WorkflowPreviousAttempt,
} from "./workflow-recovery";
import {
  buildWorkflowFromTemplate,
  listWorkflowTemplates,
} from "./workflow-templates";

interface WorkflowScheduleInput {
  enabled?: boolean | undefined;
  intervalMinutes?: number | undefined;
  nextRunAt?: string | undefined;
}

export class WorkflowService {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly runs: RunService,
  ) {}

  async list(
    subject: AuthSubject,
    workspaceId?: string,
  ): Promise<WorkflowDefinition[]> {
    assertScope(subject, "agents:read");
    const scopedWorkspaceId = workspaceId ?? subject.workspaceIds[0];
    if (scopedWorkspaceId === undefined) return [];
    this.assertWorkspaceAccess(subject, scopedWorkspaceId);
    return this.repository.listWorkflowDefinitions(
      subject.orgId,
      scopedWorkspaceId,
    );
  }

  listTemplates(subject: AuthSubject): WorkflowTemplate[] {
    assertScope(subject, "agents:read");
    return listWorkflowTemplates();
  }

  async create(input: {
    subject: AuthSubject;
    workspaceId: string;
    name: string;
    description?: string;
    steps: Array<Omit<WorkflowStep, "id">>;
    schedule?: WorkflowScheduleInput | undefined;
  }): Promise<WorkflowDefinition> {
    assertScope(input.subject, "agents:write");
    this.assertWorkspaceAccess(input.subject, input.workspaceId);
    await assertWorkspaceActive(this.repository, {
      orgId: input.subject.orgId,
      workspaceId: input.workspaceId,
    });
    if (input.steps.length === 0)
      throw new ApiError(
        "invalid_workflow",
        "Workflow requires at least one step.",
        400,
      );
    const steps = await this.normalizeSteps(
      input.subject,
      input.workspaceId,
      input.steps,
    );
    if (input.schedule !== undefined) {
      await assertAbuseControlsAllow(this.repository, input.subject, {
        action: "worker.enqueue",
        workspaceId: input.workspaceId,
        workerClass: "workflow.run",
      });
    }
    const now = new Date().toISOString();
    const createdBy = await persistedSubjectActorId(
      this.repository,
      input.subject,
      {
        kind: "service_account_workflow_owner",
        name: "Service Account Workflow Owner",
      },
    );
    const workflow = await this.repository.createWorkflowDefinition({
      id: createId("workflow"),
      orgId: input.subject.orgId,
      workspaceId: input.workspaceId,
      name: input.name,
      ...(input.description === undefined
        ? {}
        : { description: input.description }),
      steps,
      ...(input.schedule === undefined
        ? {}
        : { schedule: normalizeSchedule(input.schedule, now) }),
      enabled: true,
      createdBy,
      createdAt: now,
      updatedAt: now,
    });
    await this.audit(input.subject, "workflow.create", workflow.id, {
      workspaceId: workflow.workspaceId,
      stepCount: steps.length,
    });
    return workflow;
  }

  async createFromTemplate(input: {
    subject: AuthSubject;
    templateId: string;
    workspaceId: string;
    agentId?: string | undefined;
    name?: string | undefined;
    schedule?: WorkflowScheduleInput | undefined;
  }): Promise<WorkflowDefinition> {
    const workflow = buildWorkflowFromTemplate({
      templateId: input.templateId,
      workspaceId: input.workspaceId,
      ...(input.agentId === undefined ? {} : { agentId: input.agentId }),
      ...(input.name === undefined ? {} : { name: input.name }),
    });
    const definition = await this.create({
      subject: input.subject,
      workspaceId: input.workspaceId,
      name: workflow.name,
      description: workflow.description,
      steps: workflow.steps,
      ...(input.schedule === undefined ? {} : { schedule: input.schedule }),
    });
    await this.audit(input.subject, "workflow.template.create", definition.id, {
      workspaceId: definition.workspaceId,
      templateId: input.templateId,
    });
    return definition;
  }

  async listRuns(
    subject: AuthSubject,
    workflowId: string,
  ): Promise<WorkflowRun[]> {
    const workflow = await this.getAuthorizedWorkflow(
      subject,
      workflowId,
      "agents:read",
    );
    return this.repository.listWorkflowRuns(subject.orgId, workflow.id);
  }

  async runDueSchedules(
    subject: AuthSubject,
  ): Promise<WorkflowScheduleRunResult> {
    assertScope(subject, "agents:run");
    const checkedAt = new Date().toISOString();
    const workflows = (
      await this.repository.listWorkflowDefinitions(subject.orgId)
    ).filter((workflow) => this.isDueWorkflow(subject, workflow, checkedAt));
    const startedRuns: WorkflowRun[] = [];
    for (const workflow of workflows) {
      const run = await this.startRun({
        subject,
        workflowId: workflow.id,
        runInput: { scheduled: true, scheduledAt: checkedAt },
      });
      startedRuns.push(run);
      await this.advanceSchedule(workflow, checkedAt);
    }
    return { checkedAt, dueWorkflowCount: workflows.length, startedRuns };
  }

  async startRun(input: {
    subject: AuthSubject;
    workflowId: string;
    runInput?: Record<string, unknown>;
  }): Promise<WorkflowRun> {
    const workflow = await this.getAuthorizedWorkflow(
      input.subject,
      input.workflowId,
      "agents:run",
    );
    if (!workflow.enabled)
      throw new ApiError("workflow_disabled", "Workflow is disabled.", 409);
    await this.assertWorkflowRunAllowed(input.subject, workflow.workspaceId);
    const now = new Date().toISOString();
    const deferredStarts: DeferredRunStart[] = [];
    const run = await this.repository.transaction(async (repository) => {
      const evaluated = await this.evaluateSteps(
        input.subject,
        workflow,
        [],
        now,
        input.runInput ?? {},
        repository,
        deferredStarts,
      );
      const createdBy = await persistedSubjectActorId(
        repository,
        input.subject,
        {
          kind: "service_account_workflow_run",
          name: "Service Account Workflow Run Actor",
        },
      );
      const created = await repository.createWorkflowRun({
        id: createId("workflow_run"),
        orgId: workflow.orgId,
        workspaceId: workflow.workspaceId,
        workflowId: workflow.id,
        status: evaluated.status,
        input: input.runInput ?? {},
        steps: evaluated.steps,
        ...(evaluated.currentStepId === undefined
          ? {}
          : { currentStepId: evaluated.currentStepId }),
        createdBy,
        createdAt: now,
        updatedAt: now,
        ...(evaluated.status === "completed" ? { completedAt: now } : {}),
      });
      await this.audit(
        input.subject,
        "workflow.run.start",
        created.id,
        {
          workflowId: workflow.id,
          status: created.status,
          currentStepId: created.currentStepId ?? null,
        },
        repository,
      );
      return created;
    });
    this.startDeferredRuns(deferredStarts);
    return run;
  }

  async approve(input: {
    subject: AuthSubject;
    workflowRunId: string;
    comment?: string;
  }): Promise<WorkflowRun> {
    assertScope(input.subject, "agents:run");
    const run = await this.repository.getWorkflowRun(input.workflowRunId);
    if (!run || run.orgId !== input.subject.orgId)
      throw notFound("Workflow run");
    const workflow = await this.getAuthorizedWorkflow(
      input.subject,
      run.workflowId,
      "agents:run",
    );
    if (run.status !== "waiting_approval" || run.currentStepId === undefined) {
      throw new ApiError(
        "workflow_run_not_waiting_approval",
        "Workflow run is not waiting for approval.",
        409,
      );
    }
    const workflowStep = workflow.steps.find(
      (step) => step.id === run.currentStepId,
    );
    if (workflowStep === undefined) {
      throw new ApiError(
        "workflow_run_invalid_state",
        "Waiting workflow run is missing the current workflow step.",
        409,
      );
    }
    await this.assertWorkflowRunAllowed(input.subject, workflow.workspaceId);
    if (workflowStep.type === "browser_task") {
      return this.approveBrowserTaskRun({
        subject: input.subject,
        run,
        workflow,
        workflowStep,
      });
    }
    const now = new Date().toISOString();
    const completedApproval = run.steps.map((step) =>
      step.stepId === run.currentStepId
        ? {
            ...step,
            status: "completed" as const,
            output: {
              ...step.output,
              approvedBy: input.subject.id,
              ...(input.comment === undefined
                ? {}
                : { comment: input.comment }),
            },
            completedAt: now,
          }
        : step,
    );
    const deferredStarts: DeferredRunStart[] = [];
    const updated = await this.repository.transaction(async (repository) => {
      const evaluated = await this.evaluateSteps(
        input.subject,
        workflow,
        completedApproval,
        now,
        run.input,
        repository,
        deferredStarts,
      );
      const {
        currentStepId: _currentStepId,
        completedAt: _completedAt,
        ...runBase
      } = run;
      const updated = await repository.updateWorkflowRun({
        ...runBase,
        status: evaluated.status,
        steps: evaluated.steps,
        approvedBy: input.subject.id,
        updatedAt: now,
        ...(evaluated.currentStepId === undefined
          ? {}
          : { currentStepId: evaluated.currentStepId }),
        ...(evaluated.status === "completed" ? { completedAt: now } : {}),
      });
      await this.audit(
        input.subject,
        "workflow.run.approve",
        run.id,
        {
          workflowId: workflow.id,
          status: updated.status,
          currentStepId: updated.currentStepId ?? null,
        },
        repository,
      );
      return updated;
    });
    this.startDeferredRuns(deferredStarts);
    return updated;
  }

  async completeBrowserTaskFromWorker(input: {
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
      const { run, workflow, currentStep } = await this.getBrowserTaskRunState(
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
      const evaluated = await this.evaluateSteps(
        input.subject,
        workflow,
        completedSteps,
        now,
        run.input,
        repository,
        deferredStarts,
      );
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
      await this.audit(
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
        repository,
      );
      return updated;
    };
    if (input.repository !== undefined) return complete(input.repository);
    const updated = await this.repository.transaction(complete);
    this.startDeferredRuns(deferredStarts);
    return updated;
  }

  async failBrowserTaskFromWorker(input: {
    errorCode: string;
    job: BackgroundJob;
    subject: AuthSubject;
    repository?: RomeoRepository;
  }): Promise<WorkflowRun> {
    assertScope(input.subject, "tools:manage");
    const repository = input.repository ?? this.repository;
    const payload = readBrowserAutomationJobPayload(input.job);
    const { run, workflow, currentStep } = await this.getBrowserTaskRunState(
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
    await this.audit(
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
      repository,
    );
    return updated;
  }

  async resume(input: {
    subject: AuthSubject;
    workflowRunId: string;
  }): Promise<WorkflowRun> {
    assertScope(input.subject, "agents:run");
    const run = await this.repository.getWorkflowRun(input.workflowRunId);
    if (!run || run.orgId !== input.subject.orgId)
      throw notFound("Workflow run");
    const workflow = await this.getAuthorizedWorkflow(
      input.subject,
      run.workflowId,
      "agents:run",
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
    const linkedRuns = await this.getLinkedWorkflowRuns(
      run,
      currentStep,
      workflowStep,
    );
    if (
      linkedRuns.some(
        (linkedRun) =>
          linkedRun.status === "queued" || linkedRun.status === "running",
      )
    )
      return run;
    await this.assertWorkflowRunAllowed(input.subject, workflow.workspaceId);

    const now = new Date().toISOString();
    const failedLinkedRun = linkedRuns.find(
      (linkedRun) => linkedRun.status !== "completed",
    );
    if (failedLinkedRun !== undefined) {
      if (
        workflowStep.type !== "agent_room" &&
        workflowStepCanRetry(workflowStep, currentStep)
      ) {
        const deferredStarts: DeferredRunStart[] = [];
        const retried = await this.repository.transaction(
          async (repository) => {
            const retryStep = await this.startWorkflowAgentStepRun({
              subject: input.subject,
              workflow,
              step: workflowStep,
              runInput: run.input,
              completedSteps: run.steps.filter(
                (step) => step.status === "completed",
              ),
              now,
              attempt: workflowStepAttempt(currentStep) + 1,
              previousAttempts: appendWorkflowPreviousAttempt(currentStep, {
                runId: failedLinkedRun.id,
                status: failedLinkedRun.status,
              }),
              repository,
              deferredStarts,
            });
            const retriedSteps = run.steps.map((step) =>
              step.stepId === run.currentStepId ? retryStep : step,
            );
            const { completedAt: _completedAt, ...runBase } = run;
            return this.updateWorkflowRunWithAudit({
              subject: input.subject,
              action: "workflow.run.retry",
              runId: run.id,
              workflowId: workflow.id,
              nextRun: {
                ...runBase,
                status: "waiting_run",
                steps: retriedSteps,
                updatedAt: now,
              },
              metadata: {
                ...linkedRunAuditMetadata(linkedRuns),
                retryRunId: retryStep.output.runId,
                attempt: retryStep.output.attempt,
              },
              repository,
            });
          },
        );
        this.startDeferredRuns(deferredStarts);
        return retried;
      }
      if (workflowStepOnFailure(workflowStep) === "continue") {
        const recoveredSteps = run.steps.map((step) =>
          step.stepId === run.currentStepId
            ? {
                ...step,
                status: "completed" as const,
                output: {
                  ...step.output,
                  ...linkedRunStatusOutput(linkedRuns),
                  recoveryAction: "continued_after_failure",
                },
                completedAt: now,
              }
            : step,
        );
        const deferredStarts: DeferredRunStart[] = [];
        const recovered = await this.repository.transaction(
          async (repository) => {
            const evaluated = await this.evaluateSteps(
              input.subject,
              workflow,
              recoveredSteps,
              now,
              run.input,
              repository,
              deferredStarts,
            );
            const {
              currentStepId: _currentStepId,
              completedAt: _completedAt,
              ...runBase
            } = run;
            return this.updateWorkflowRunWithAudit({
              subject: input.subject,
              action: "workflow.run.recover",
              runId: run.id,
              workflowId: workflow.id,
              nextRun: {
                ...runBase,
                status: evaluated.status,
                steps: evaluated.steps,
                updatedAt: now,
                ...(evaluated.currentStepId === undefined
                  ? {}
                  : { currentStepId: evaluated.currentStepId }),
                ...(evaluated.status === "completed"
                  ? { completedAt: now }
                  : {}),
              },
              metadata: {
                recoveryAction: "continue",
                ...linkedRunAuditMetadata(linkedRuns),
              },
              repository,
            });
          },
        );
        this.startDeferredRuns(deferredStarts);
        return recovered;
      }
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
      const failed = await this.updateWorkflowRunWithAudit({
        subject: input.subject,
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
        metadata: {
          ...linkedRunAuditMetadata(linkedRuns),
        },
      });
      return failed;
    }

    const completedSteps = run.steps.map((step) =>
      step.stepId === run.currentStepId
        ? {
            ...step,
            status: "completed" as const,
            output: { ...step.output, ...linkedRunStatusOutput(linkedRuns) },
            completedAt: now,
          }
        : step,
    );
    const deferredStarts: DeferredRunStart[] = [];
    const updated = await this.repository.transaction(async (repository) => {
      const evaluated = await this.evaluateSteps(
        input.subject,
        workflow,
        completedSteps,
        now,
        run.input,
        repository,
        deferredStarts,
      );
      const {
        currentStepId: _currentStepId,
        completedAt: _completedAt,
        ...runBase
      } = run;
      return this.updateWorkflowRunWithAudit({
        subject: input.subject,
        action: "workflow.run.resume",
        runId: run.id,
        workflowId: workflow.id,
        nextRun: {
          ...runBase,
          status: evaluated.status,
          steps: evaluated.steps,
          updatedAt: now,
          ...(evaluated.currentStepId === undefined
            ? {}
            : { currentStepId: evaluated.currentStepId }),
          ...(evaluated.status === "completed" ? { completedAt: now } : {}),
        },
        metadata: linkedRunAuditMetadata(linkedRuns),
        repository,
      });
    });
    this.startDeferredRuns(deferredStarts);
    return updated;
  }

  private async getLinkedWorkflowRuns(
    run: WorkflowRun,
    stepRun: WorkflowStepRun,
    workflowStep: WorkflowStep,
  ): Promise<RunRecord[]> {
    const runIds =
      workflowStep.type === "agent_room"
        ? stringArray(stepRun.output.runIds)
        : stringArray([stepRun.output.runId]);
    if (runIds.length === 0)
      throw new ApiError(
        "workflow_run_invalid_state",
        "Waiting workflow run is missing linked model runs.",
        409,
      );
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
      throw new ApiError(
        "workflow_run_invalid_state",
        "Waiting workflow run references an invalid model run.",
        409,
      );
    }
    return linkedRuns;
  }

  private assertWorkflowRunAllowed(
    subject: AuthSubject,
    workspaceId: string,
  ): Promise<void> {
    return assertAbuseControlsAllow(this.repository, subject, {
      action: "workflow.run",
      workspaceId,
      workerClass: "workflow.run",
    });
  }

  private startDeferredRuns(starts: DeferredRunStart[]): void {
    for (const start of starts) start.startExecution();
  }

  private async approveBrowserTaskRun(input: {
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
        payload: {
          ...createBrowserAutomationJobPayload({
            approvedAt: now,
            subject: input.subject,
            step: input.workflowStep,
            workflowId: input.workflow.id,
            workflowRun: input.run,
          }),
        },
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
      await this.audit(
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
        repository,
      );
      return updated;
    });
  }

  private async getBrowserTaskRunState(
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
    if (run === undefined || run.orgId !== subject.orgId)
      throw notFound("Workflow run");
    if (run.status !== "waiting_run" || run.currentStepId !== payload.stepId) {
      throw new ApiError(
        "browser_automation_workflow_state_invalid",
        "Browser automation task is not linked to a waiting workflow run.",
        409,
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
    this.assertWorkspaceAccess(subject, workflow.workspaceId);
    const workflowStep = workflow.steps.find(
      (step) => step.id === payload.stepId,
    );
    if (workflowStep?.type !== "browser_task") {
      throw new ApiError(
        "browser_automation_workflow_state_invalid",
        "Browser automation task does not reference a browser workflow step.",
        409,
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
      throw new ApiError(
        "browser_automation_workflow_state_invalid",
        "Browser automation task is not the active workflow step.",
        409,
      );
    }
    return { currentStep, run, workflow };
  }

  private async getAuthorizedWorkflow(
    subject: AuthSubject,
    workflowId: string,
    scope: "agents:read" | "agents:run",
  ): Promise<WorkflowDefinition> {
    assertScope(subject, scope);
    const workflow = await this.repository.getWorkflowDefinition(workflowId);
    if (!workflow || workflow.orgId !== subject.orgId)
      throw notFound("Workflow");
    this.assertWorkspaceAccess(subject, workflow.workspaceId);
    return workflow;
  }

  private async normalizeSteps(
    subject: AuthSubject,
    workspaceId: string,
    steps: Array<Omit<WorkflowStep, "id">>,
  ): Promise<WorkflowStep[]> {
    const normalized: WorkflowStep[] = [];
    for (const [index, step] of steps.entries()) {
      if (step.type === "agent_run" || step.type === "agent_handoff") {
        if (step.agentId === undefined)
          throw new ApiError(
            "invalid_workflow_step",
            "Agent run steps require an agentId.",
            400,
          );
        const agent = await getAuthorizedAgent(this.repository, {
          agentId: step.agentId,
          subject,
          scope: "agents:read",
        });
        if (agent.workspaceId !== workspaceId)
          throw new ApiError(
            "invalid_workflow_step",
            "Agent run steps must reference an agent in the workflow workspace.",
            400,
          );
        if (step.type === "agent_run") {
          normalized.push({
            id: `step_${index + 1}`,
            type: step.type,
            name: step.name,
            agentId: agent.id,
            ...(step.retryPolicy === undefined
              ? {}
              : { retryPolicy: step.retryPolicy }),
            ...(step.recoveryPolicy === undefined
              ? {}
              : { recoveryPolicy: step.recoveryPolicy }),
          });
          continue;
        }
        const sourceStepId = this.resolveHandoffSourceStepId(normalized, step);
        normalized.push({
          id: `step_${index + 1}`,
          type: step.type,
          name: step.name,
          agentId: agent.id,
          handoffFromStepId: sourceStepId,
          ...(step.handoffPrompt === undefined
            ? {}
            : { handoffPrompt: step.handoffPrompt }),
          ...(step.retryPolicy === undefined
            ? {}
            : { retryPolicy: step.retryPolicy }),
          ...(step.recoveryPolicy === undefined
            ? {}
            : { recoveryPolicy: step.recoveryPolicy }),
        });
      } else if (step.type === "agent_room") {
        if (step.agentIds === undefined || step.agentIds.length < 2)
          throw new ApiError(
            "invalid_workflow_step",
            "Agent room steps require at least two agentIds.",
            400,
          );
        const uniqueAgentIds = [...new Set(step.agentIds)];
        if (uniqueAgentIds.length !== step.agentIds.length)
          throw new ApiError(
            "invalid_workflow_step",
            "Agent room steps require unique agentIds.",
            400,
          );
        for (const agentId of uniqueAgentIds) {
          const agent = await getAuthorizedAgent(this.repository, {
            agentId,
            subject,
            scope: "agents:read",
          });
          if (agent.workspaceId !== workspaceId)
            throw new ApiError(
              "invalid_workflow_step",
              "Agent room steps must reference agents in the workflow workspace.",
              400,
            );
        }
        normalized.push({
          id: `step_${index + 1}`,
          type: step.type,
          name: step.name,
          agentIds: uniqueAgentIds,
          ...(step.roomPrompt === undefined
            ? {}
            : { roomPrompt: step.roomPrompt }),
          ...(step.recoveryPolicy === undefined
            ? {}
            : { recoveryPolicy: step.recoveryPolicy }),
        });
      } else if (step.type === "approval") {
        normalized.push({
          id: `step_${index + 1}`,
          type: step.type,
          name: step.name,
          approvalPrompt: step.approvalPrompt ?? step.name,
        });
      } else if (step.type === "tool_approval") {
        normalized.push({
          id: `step_${index + 1}`,
          type: step.type,
          name: step.name,
          toolChainName: step.toolChainName ?? step.name,
          riskLevel: step.riskLevel ?? "medium",
          approvalPrompt: step.approvalPrompt ?? step.name,
          inputKeys: step.inputKeys ?? [],
        });
      } else if (step.type === "browser_task") {
        const browserTask = normalizeBrowserTaskStep(step);
        normalized.push({
          id: `step_${index + 1}`,
          type: step.type,
          name: step.name,
          targetUrl: browserTask.targetUrl,
          task: browserTask.task,
          approvalPrompt: step.approvalPrompt ?? step.name,
        });
      } else if (step.type === "notification") {
        normalized.push({
          id: `step_${index + 1}`,
          type: step.type,
          name: step.name,
          message: step.message ?? "",
          ...(step.condition === undefined
            ? {}
            : { condition: step.condition }),
        });
      } else {
        throw new ApiError(
          "invalid_workflow_step",
          "Unsupported workflow step type.",
          400,
        );
      }
    }
    return normalized;
  }

  private resolveHandoffSourceStepId(
    normalized: WorkflowStep[],
    step: Omit<WorkflowStep, "id">,
  ): string {
    const agentSteps = normalized.filter(
      (candidate) =>
        candidate.type === "agent_run" || candidate.type === "agent_handoff",
    );
    if (agentSteps.length === 0) {
      throw new ApiError(
        "invalid_workflow_step",
        "Agent handoff steps require an earlier agent step.",
        400,
      );
    }
    if (step.handoffFromStepId === undefined) {
      const source = agentSteps.at(-1);
      if (source === undefined)
        throw new ApiError(
          "invalid_workflow_step",
          "Agent handoff steps require an earlier agent step.",
          400,
        );
      return source.id;
    }
    const source = agentSteps.find(
      (candidate) => candidate.id === step.handoffFromStepId,
    );
    if (source === undefined)
      throw new ApiError(
        "invalid_workflow_step",
        "Agent handoff source must reference an earlier agent step.",
        400,
      );
    return source.id;
  }

  private assertWorkspaceAccess(
    subject: AuthSubject,
    workspaceId: string,
  ): void {
    if (
      subject.isAdmin !== true &&
      !subject.workspaceIds.includes(workspaceId)
    ) {
      throw new AuthorizationError(
        "The workflow workspace is outside the caller workspace access.",
      );
    }
  }

  private isDueWorkflow(
    subject: AuthSubject,
    workflow: WorkflowDefinition,
    checkedAt: string,
  ): boolean {
    if (!workflow.enabled || workflow.schedule?.enabled !== true) return false;
    if (workflow.schedule.nextRunAt > checkedAt) return false;
    try {
      this.assertWorkspaceAccess(subject, workflow.workspaceId);
      return true;
    } catch {
      return false;
    }
  }

  private async advanceSchedule(
    workflow: WorkflowDefinition,
    checkedAt: string,
  ): Promise<void> {
    if (workflow.schedule === undefined) return;
    await this.repository.updateWorkflowDefinition({
      ...workflow,
      schedule: {
        ...workflow.schedule,
        nextRunAt: addMinutes(checkedAt, workflow.schedule.intervalMinutes),
      },
      updatedAt: new Date().toISOString(),
    });
  }

  private async updateWorkflowRunWithAudit(input: {
    subject: AuthSubject;
    action: string;
    runId: string;
    workflowId: string;
    nextRun: WorkflowRun;
    metadata?: Record<string, unknown> | undefined;
    repository?: RomeoRepository | undefined;
  }): Promise<WorkflowRun> {
    const update = async (
      repository: RomeoRepository,
    ): Promise<WorkflowRun> => {
      const updated = await repository.updateWorkflowRun(input.nextRun);
      await this.audit(
        input.subject,
        input.action,
        input.runId,
        {
          workflowId: input.workflowId,
          status: updated.status,
          currentStepId: updated.currentStepId ?? null,
          ...(input.metadata ?? {}),
        },
        repository,
      );
      return updated;
    };
    if (input.repository !== undefined) return update(input.repository);
    return this.repository.transaction(update);
  }

  private async audit(
    subject: AuthSubject,
    action: string,
    resourceId: string,
    metadata: Record<string, unknown>,
    repository: RomeoRepository = this.repository,
  ): Promise<void> {
    await writeAuditLog(repository, {
      subject,
      action,
      resourceType: "workflow",
      resourceId,
      metadata,
    });
  }

  private async evaluateSteps(
    subject: AuthSubject,
    workflow: WorkflowDefinition,
    existingSteps: WorkflowStepRun[],
    now: string,
    runInput: Record<string, unknown>,
    repository: RomeoRepository = this.repository,
    deferredStarts: DeferredRunStart[] = [],
  ): Promise<{
    status: WorkflowRun["status"];
    steps: WorkflowStepRun[];
    currentStepId?: string;
  }> {
    const byStepId = new Map(existingSteps.map((step) => [step.stepId, step]));
    const results: WorkflowStepRun[] = [];
    for (const step of workflow.steps) {
      const existing = byStepId.get(step.id);
      if (existing?.status === "completed") {
        results.push(existing);
        continue;
      }
      if (
        step.type === "approval" ||
        step.type === "tool_approval" ||
        step.type === "browser_task"
      ) {
        results.push({
          stepId: step.id,
          type: step.type,
          status: "waiting_approval",
          output:
            step.type === "tool_approval"
              ? {
                  approvalKind: "tool_chain",
                  approvalPrompt: step.approvalPrompt ?? step.name,
                  toolChainName: step.toolChainName ?? step.name,
                  riskLevel: step.riskLevel ?? "medium",
                  inputKeys: step.inputKeys ?? [],
                }
              : step.type === "browser_task"
                ? browserTaskApprovalOutput(step)
                : { approvalPrompt: step.approvalPrompt ?? step.name },
        });
        return {
          status: "waiting_approval",
          steps: results,
          currentStepId: step.id,
        };
      }
      if (
        step.type === "agent_run" ||
        step.type === "agent_handoff" ||
        step.type === "agent_room"
      ) {
        const stepRun = await this.startWorkflowAgentStepRun({
          subject,
          workflow,
          step,
          completedSteps: results,
          runInput,
          now,
          attempt: 1,
          repository,
          deferredStarts,
        });
        results.push(stepRun);
        return {
          status: "waiting_run",
          steps: results,
          currentStepId: step.id,
        };
      }
      if (!workflowStepConditionMatches(step, runInput)) {
        results.push({
          stepId: step.id,
          type: step.type,
          status: "completed",
          output: {
            delivery: "skipped",
            reason: "condition_not_met",
            conditionKey: step.condition?.inputKey ?? null,
          },
          completedAt: now,
        });
        continue;
      }
      results.push({
        stepId: step.id,
        type: step.type,
        status: "completed",
        output: {
          delivery: "not_configured",
          messageKeys:
            step.message === undefined || step.message.length === 0
              ? []
              : ["message"],
        },
        completedAt: now,
      });
    }
    return { status: "completed", steps: results };
  }

  private async startWorkflowAgentStepRun(input: {
    subject: AuthSubject;
    workflow: WorkflowDefinition;
    step: WorkflowStep;
    completedSteps: WorkflowStepRun[];
    runInput: Record<string, unknown>;
    now: string;
    attempt: number;
    previousAttempts?: WorkflowPreviousAttempt[] | undefined;
    repository: RomeoRepository;
    deferredStarts: DeferredRunStart[];
  }): Promise<WorkflowStepRun> {
    const output: Record<string, unknown> = {
      agentId: input.step.agentId,
      attempt: input.attempt,
      maxAttempts: workflowStepMaxAttempts(input.step),
      ...(input.previousAttempts === undefined
        ? {}
        : { previousAttempts: input.previousAttempts }),
    };
    let content: string;
    if (input.step.type === "agent_run") {
      content = workflowStepPrompt(input.workflow, input.step, input.runInput);
      output.executionMode = "model_run_started";
    } else if (input.step.type === "agent_handoff") {
      const handoff = await buildWorkflowHandoffPrompt({
        repository: input.repository,
        workflow: input.workflow,
        step: input.step,
        completedSteps: input.completedSteps,
        runInput: input.runInput,
      });
      content = handoff.content;
      output.executionMode = "agent_handoff_started";
      output.handoffFromStepId = input.step.handoffFromStepId ?? null;
      output.sourceChatId = handoff.sourceChatId;
      output.sourceRunId = handoff.sourceRunId;
      output.handoffContextCharacters = handoff.contextCharacterCount;
    } else if (input.step.type === "agent_room") {
      const agentIds = input.step.agentIds ?? [];
      if (agentIds.length < 2)
        throw new ApiError(
          "workflow_run_invalid_state",
          "Agent room step is missing agent IDs.",
          409,
        );
      const roomRuns = [];
      content =
        input.step.roomPrompt ??
        workflowStepPrompt(input.workflow, input.step, input.runInput);
      for (const agentId of agentIds) {
        roomRuns.push(
          await this.startAgentStepRun(
            input.subject,
            input.workflow,
            input.step,
            agentId,
            content,
            input.now,
            input.repository,
            input.deferredStarts,
          ),
        );
      }
      return {
        stepId: input.step.id,
        type: input.step.type,
        status: "waiting_run",
        output: {
          ...output,
          agentIds,
          chatIds: roomRuns.map((run) => run.chat.id),
          runIds: roomRuns.map((run) => run.runId),
          executionMode: "agent_room_started",
          runStatuses: roomRuns.map((run) => ({
            runId: run.runId,
            status: run.status,
          })),
        },
      };
    } else {
      throw new ApiError(
        "workflow_run_invalid_state",
        "Waiting workflow run references a non-agent workflow step.",
        409,
      );
    }

    if (input.step.agentId === undefined)
      throw new ApiError(
        "workflow_run_invalid_state",
        "Agent workflow step is missing an agent ID.",
        409,
      );
    const run = await this.startAgentStepRun(
      input.subject,
      input.workflow,
      input.step,
      input.step.agentId,
      content,
      input.now,
      input.repository,
      input.deferredStarts,
    );
    return {
      stepId: input.step.id,
      type: input.step.type,
      status: "waiting_run",
      output: {
        ...output,
        chatId: run.chat.id,
        runId: run.runId,
        runStatus: run.status,
      },
    };
  }

  private async startAgentStepRun(
    subject: AuthSubject,
    workflow: WorkflowDefinition,
    step: WorkflowStep,
    agentId: string,
    content: string,
    now: string,
    repository: RomeoRepository,
    deferredStarts: DeferredRunStart[],
  ): Promise<{ chat: Chat; runId: string; status: string }> {
    const chat = await this.createWorkflowChat(
      subject,
      workflow,
      step,
      now,
      repository,
    );
    const started = await this.runs.startDeferred(repository, {
      subject,
      chatId: chat.id,
      agentId,
      content,
    });
    deferredStarts.push(started);
    return { chat, runId: started.run.id, status: started.run.status };
  }

  private async createWorkflowChat(
    subject: AuthSubject,
    workflow: WorkflowDefinition,
    step: WorkflowStep,
    now: string,
    repository: RomeoRepository = this.repository,
  ): Promise<Chat> {
    const chat = await repository.createChat({
      id: createId("chat"),
      orgId: workflow.orgId,
      workspaceId: workflow.workspaceId,
      title: workflowChatTitle(workflow, step),
      createdBy: subject.id,
      updatedAt: now,
    });
    await Promise.all(
      (["read", "write"] as const).map((permission) =>
        repository.createResourceGrant({
          id: createId("grant"),
          resourceType: "chat",
          resourceId: chat.id,
          principalType: subject.type,
          principalId: subject.id,
          permission,
        }),
      ),
    );
    return chat;
  }
}

function workflowStepPrompt(
  workflow: WorkflowDefinition,
  step: WorkflowStep,
  runInput: Record<string, unknown>,
): string {
  const prompt = stringInput(runInput.prompt) ?? stringInput(runInput.content);
  if (prompt !== undefined) return prompt;
  return `Run workflow "${workflow.name}" step "${step.name}".`;
}

function workflowStepConditionMatches(
  step: WorkflowStep,
  runInput: Record<string, unknown>,
): boolean {
  if (step.condition === undefined) return true;
  return runInput[step.condition.inputKey] === step.condition.equals;
}

function stringInput(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is string => typeof item === "string" && item.length > 0,
  );
}

function linkedRunStatusOutput(
  linkedRuns: RunRecord[],
): Record<string, unknown> {
  if (linkedRuns.length === 1 && linkedRuns[0] !== undefined)
    return { runStatus: linkedRuns[0].status };
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

function workflowChatTitle(
  workflow: WorkflowDefinition,
  step: WorkflowStep,
): string {
  return `Workflow: ${workflow.name} / ${step.name}`.slice(0, 120);
}

function normalizeSchedule(
  schedule: WorkflowScheduleInput,
  now: string,
): WorkflowSchedule {
  if (schedule.intervalMinutes === undefined)
    throw new ApiError(
      "invalid_workflow_schedule",
      "Workflow schedules require intervalMinutes.",
      400,
    );
  if (
    !Number.isInteger(schedule.intervalMinutes) ||
    schedule.intervalMinutes < 5 ||
    schedule.intervalMinutes > 43_200
  ) {
    throw new ApiError(
      "invalid_workflow_schedule",
      "Workflow schedule interval must be between 5 and 43200 minutes.",
      400,
    );
  }
  return {
    enabled: schedule.enabled ?? true,
    intervalMinutes: schedule.intervalMinutes,
    nextRunAt: schedule.nextRunAt ?? addMinutes(now, schedule.intervalMinutes),
  };
}

function addMinutes(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}
