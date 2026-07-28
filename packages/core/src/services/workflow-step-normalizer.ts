import type { AuthSubject } from "@romeo/auth";

import type { WorkflowStep } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { getAuthorizedAgent } from "./agent-access";
import { normalizeBrowserTaskStep } from "./workflow-browser-tasks";

export class WorkflowStepNormalizer {
  constructor(private readonly repository: RomeoRepository) {}

  async normalize(
    subject: AuthSubject,
    workspaceId: string,
    steps: Array<Omit<WorkflowStep, "id">>,
  ): Promise<WorkflowStep[]> {
    const normalized: WorkflowStep[] = [];
    for (const [index, step] of steps.entries()) {
      const id = `step_${index + 1}`;
      if (step.type === "agent_run" || step.type === "agent_handoff") {
        normalized.push(
          await this.normalizeAgentStep(
            subject,
            workspaceId,
            id,
            step,
            normalized,
          ),
        );
      } else if (step.type === "agent_room") {
        normalized.push(
          await this.normalizeAgentRoom(subject, workspaceId, id, step),
        );
      } else if (step.type === "approval") {
        normalized.push({
          id,
          type: step.type,
          name: step.name,
          approvalPrompt: step.approvalPrompt ?? step.name,
        });
      } else if (step.type === "tool_approval") {
        normalized.push({
          id,
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
          id,
          type: step.type,
          name: step.name,
          targetUrl: browserTask.targetUrl,
          task: browserTask.task,
          approvalPrompt: step.approvalPrompt ?? step.name,
        });
      } else if (step.type === "notification") {
        normalized.push({
          id,
          type: step.type,
          name: step.name,
          message: step.message ?? "",
          ...(step.condition === undefined
            ? {}
            : { condition: step.condition }),
        });
      } else {
        throw invalidStep("Unsupported workflow step type.");
      }
    }
    return normalized;
  }

  private async normalizeAgentStep(
    subject: AuthSubject,
    workspaceId: string,
    id: string,
    step: Omit<WorkflowStep, "id">,
    normalized: WorkflowStep[],
  ): Promise<WorkflowStep> {
    if (step.agentId === undefined) {
      throw invalidStep("Agent run steps require an agentId.");
    }
    const agent = await getAuthorizedAgent(this.repository, {
      agentId: step.agentId,
      subject,
      scope: "agents:read",
    });
    if (agent.workspaceId !== workspaceId) {
      throw invalidStep(
        "Agent run steps must reference an agent in the workflow workspace.",
      );
    }
    const policies = {
      ...(step.retryPolicy === undefined
        ? {}
        : { retryPolicy: step.retryPolicy }),
      ...(step.recoveryPolicy === undefined
        ? {}
        : { recoveryPolicy: step.recoveryPolicy }),
    };
    if (step.type === "agent_run") {
      return {
        id,
        type: step.type,
        name: step.name,
        agentId: agent.id,
        ...policies,
      };
    }
    return {
      id,
      type: step.type,
      name: step.name,
      agentId: agent.id,
      handoffFromStepId: resolveHandoffSourceStepId(normalized, step),
      ...(step.handoffPrompt === undefined
        ? {}
        : { handoffPrompt: step.handoffPrompt }),
      ...policies,
    };
  }

  private async normalizeAgentRoom(
    subject: AuthSubject,
    workspaceId: string,
    id: string,
    step: Omit<WorkflowStep, "id">,
  ): Promise<WorkflowStep> {
    if (step.agentIds === undefined || step.agentIds.length < 2) {
      throw invalidStep("Agent room steps require at least two agentIds.");
    }
    const uniqueAgentIds = [...new Set(step.agentIds)];
    if (uniqueAgentIds.length !== step.agentIds.length) {
      throw invalidStep("Agent room steps require unique agentIds.");
    }
    for (const agentId of uniqueAgentIds) {
      const agent = await getAuthorizedAgent(this.repository, {
        agentId,
        subject,
        scope: "agents:read",
      });
      if (agent.workspaceId !== workspaceId) {
        throw invalidStep(
          "Agent room steps must reference agents in the workflow workspace.",
        );
      }
    }
    return {
      id,
      type: step.type,
      name: step.name,
      agentIds: uniqueAgentIds,
      ...(step.roomPrompt === undefined ? {} : { roomPrompt: step.roomPrompt }),
      ...(step.recoveryPolicy === undefined
        ? {}
        : { recoveryPolicy: step.recoveryPolicy }),
    };
  }
}

function resolveHandoffSourceStepId(
  normalized: WorkflowStep[],
  step: Omit<WorkflowStep, "id">,
): string {
  const agentSteps = normalized.filter(
    (candidate) =>
      candidate.type === "agent_run" || candidate.type === "agent_handoff",
  );
  if (agentSteps.length === 0) {
    throw invalidStep("Agent handoff steps require an earlier agent step.");
  }
  if (step.handoffFromStepId === undefined) return agentSteps.at(-1)!.id;
  const source = agentSteps.find(
    (candidate) => candidate.id === step.handoffFromStepId,
  );
  if (source === undefined) {
    throw invalidStep(
      "Agent handoff source must reference an earlier agent step.",
    );
  }
  return source.id;
}

function invalidStep(message: string): ApiError {
  return new ApiError("invalid_workflow_step", message, 400);
}
