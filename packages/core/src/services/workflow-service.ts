import { AuthorizationError, assertScope, type AuthSubject } from "@romeo/auth";

import type {
  BackgroundJob,
  WorkflowDefinition,
  WorkflowRun,
  WorkflowScheduleRunResult,
  WorkflowStep,
  WorkflowStepRun,
  WorkflowTemplate,
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
import type { DeferredRunStart, RunService } from "./run-service";
import { persistedSubjectActorId } from "./subject-persisted-actor";
import { assertWorkspaceActive } from "./workspace-guard";
import { type BrowserAutomationCompletionResult } from "./workflow-browser-tasks";
import { WorkflowBrowserTaskService } from "./workflow-browser-task-service";
import { WorkflowRunRecoveryService } from "./workflow-run-recovery-service";
import {
  buildWorkflowFromTemplate,
  listWorkflowTemplates,
} from "./workflow-templates";
import {
  advanceWorkflowSchedule,
  normalizeWorkflowSchedule,
  type WorkflowScheduleInput,
} from "./workflow-schedule";
import { WorkflowStepNormalizer } from "./workflow-step-normalizer";
import { WorkflowStepExecutor } from "./workflow-step-executor";

export class WorkflowService {
  private readonly browserTasks: WorkflowBrowserTaskService;
  private readonly runRecovery: WorkflowRunRecoveryService;
  private readonly stepExecutor: WorkflowStepExecutor;
  private readonly stepNormalizer: WorkflowStepNormalizer;

  constructor(
    private readonly repository: RomeoRepository,
    private readonly runs: RunService,
  ) {
    this.stepExecutor = new WorkflowStepExecutor(runs);
    this.browserTasks = new WorkflowBrowserTaskService(
      repository,
      this.stepExecutor,
    );
    this.runRecovery = new WorkflowRunRecoveryService(
      repository,
      this.stepExecutor,
    );
    this.stepNormalizer = new WorkflowStepNormalizer(repository);
  }

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
    const steps = await this.stepNormalizer.normalize(
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
        : { schedule: normalizeWorkflowSchedule(input.schedule, now) }),
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
      await advanceWorkflowSchedule(this.repository, workflow, checkedAt);
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
      return this.browserTasks.approve({
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
    return this.browserTasks.complete(input);
  }

  async failBrowserTaskFromWorker(input: {
    errorCode: string;
    job: BackgroundJob;
    subject: AuthSubject;
    repository?: RomeoRepository;
  }): Promise<WorkflowRun> {
    return this.browserTasks.fail(input);
  }

  async resume(input: {
    subject: AuthSubject;
    workflowRunId: string;
  }): Promise<WorkflowRun> {
    return this.runRecovery.resume(input);
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

  private async audit<A extends AuditAction>(
    subject: AuthSubject,
    action: A,
    resourceId: string,
    metadata: AuditMetadata<A>,
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
    return this.stepExecutor.evaluate({
      subject,
      workflow,
      existingSteps,
      now,
      runInput,
      repository,
      deferredStarts,
    });
  }
}
