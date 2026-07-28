import type { AuthSubject } from "@romeo/auth";

import type {
  Chat,
  WorkflowDefinition,
  WorkflowRun,
  WorkflowStep,
  WorkflowStepRun,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { createId } from "../ids";
import type { DeferredRunStart, RunService } from "./run-service";
import { browserTaskApprovalOutput } from "./workflow-browser-tasks";
import { buildWorkflowHandoffPrompt } from "./workflow-handoffs";
import {
  workflowStepMaxAttempts,
  type WorkflowPreviousAttempt,
} from "./workflow-recovery";

export interface WorkflowStepEvaluation {
  status: WorkflowRun["status"];
  steps: WorkflowStepRun[];
  currentStepId?: string;
}

export interface StartWorkflowAgentStepInput {
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
}

export class WorkflowStepExecutor {
  constructor(private readonly runs: RunService) {}

  async evaluate(input: {
    subject: AuthSubject;
    workflow: WorkflowDefinition;
    existingSteps: WorkflowStepRun[];
    now: string;
    runInput: Record<string, unknown>;
    repository: RomeoRepository;
    deferredStarts: DeferredRunStart[];
  }): Promise<WorkflowStepEvaluation> {
    const byStepId = new Map(
      input.existingSteps.map((step) => [step.stepId, step]),
    );
    const results: WorkflowStepRun[] = [];
    for (const step of input.workflow.steps) {
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
        results.push(waitingApprovalStep(step));
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
        results.push(
          await this.startAgentStep({
            subject: input.subject,
            workflow: input.workflow,
            step,
            completedSteps: results,
            runInput: input.runInput,
            now: input.now,
            attempt: 1,
            repository: input.repository,
            deferredStarts: input.deferredStarts,
          }),
        );
        return {
          status: "waiting_run",
          steps: results,
          currentStepId: step.id,
        };
      }
      results.push(notificationStepRun(step, input.runInput, input.now));
    }
    return { status: "completed", steps: results };
  }

  async startAgentStep(
    input: StartWorkflowAgentStepInput,
  ): Promise<WorkflowStepRun> {
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
      return this.startAgentRoom(input, output);
    } else {
      throw invalidAgentStep();
    }

    if (input.step.agentId === undefined) {
      throw new ApiError(
        "workflow_run_invalid_state",
        "Agent workflow step is missing an agent ID.",
        409,
      );
    }
    const run = await this.startModelRun(input, input.step.agentId, content);
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

  private async startAgentRoom(
    input: StartWorkflowAgentStepInput,
    output: Record<string, unknown>,
  ): Promise<WorkflowStepRun> {
    const agentIds = input.step.agentIds ?? [];
    if (agentIds.length < 2) {
      throw new ApiError(
        "workflow_run_invalid_state",
        "Agent room step is missing agent IDs.",
        409,
      );
    }
    const content =
      input.step.roomPrompt ??
      workflowStepPrompt(input.workflow, input.step, input.runInput);
    const roomRuns = [];
    for (const agentId of agentIds) {
      roomRuns.push(await this.startModelRun(input, agentId, content));
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
  }

  private async startModelRun(
    input: StartWorkflowAgentStepInput,
    agentId: string,
    content: string,
  ): Promise<{ chat: Chat; runId: string; status: string }> {
    const chat = await createWorkflowChat(input, input.repository);
    const started = await this.runs.startDeferred(input.repository, {
      subject: input.subject,
      chatId: chat.id,
      agentId,
      content,
    });
    input.deferredStarts.push(started);
    return { chat, runId: started.run.id, status: started.run.status };
  }
}

function waitingApprovalStep(step: WorkflowStep): WorkflowStepRun {
  return {
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
  };
}

function notificationStepRun(
  step: WorkflowStep,
  runInput: Record<string, unknown>,
  now: string,
): WorkflowStepRun {
  if (!workflowStepConditionMatches(step, runInput)) {
    return {
      stepId: step.id,
      type: step.type,
      status: "completed",
      output: {
        delivery: "skipped",
        reason: "condition_not_met",
        conditionKey: step.condition?.inputKey ?? null,
      },
      completedAt: now,
    };
  }
  return {
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
  };
}

async function createWorkflowChat(
  input: StartWorkflowAgentStepInput,
  repository: RomeoRepository,
): Promise<Chat> {
  const chat = await repository.createChat({
    id: createId("chat"),
    orgId: input.workflow.orgId,
    workspaceId: input.workflow.workspaceId,
    title: workflowChatTitle(input.workflow, input.step),
    createdBy: input.subject.id,
    updatedAt: input.now,
  });
  await Promise.all(
    (["read", "write"] as const).map((permission) =>
      repository.createResourceGrant({
        id: createId("grant"),
        resourceType: "chat",
        resourceId: chat.id,
        principalType: input.subject.type,
        principalId: input.subject.id,
        permission,
      }),
    ),
  );
  return chat;
}

function workflowStepPrompt(
  workflow: WorkflowDefinition,
  step: WorkflowStep,
  runInput: Record<string, unknown>,
): string {
  const prompt = stringInput(runInput.prompt) ?? stringInput(runInput.content);
  return prompt ?? `Run workflow "${workflow.name}" step "${step.name}".`;
}

function workflowStepConditionMatches(
  step: WorkflowStep,
  runInput: Record<string, unknown>,
): boolean {
  return (
    step.condition === undefined ||
    runInput[step.condition.inputKey] === step.condition.equals
  );
}

function stringInput(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function workflowChatTitle(
  workflow: WorkflowDefinition,
  step: WorkflowStep,
): string {
  return `Workflow: ${workflow.name} / ${step.name}`.slice(0, 120);
}

function invalidAgentStep(): ApiError {
  return new ApiError(
    "workflow_run_invalid_state",
    "Waiting workflow run references a non-agent workflow step.",
    409,
  );
}
