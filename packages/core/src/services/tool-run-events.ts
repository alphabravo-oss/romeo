import {
  AuthorizationError,
  canAccessOrg,
  type AuthSubject,
} from "@romeo/auth";
import type { RunEventType } from "@romeo/ai-runtime";
import type { ToolDefinition } from "@romeo/tools";

import type { Agent, RunRecord } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { canWriteChat } from "./chat-access";
import type { RunEventSequencer } from "./run-event-sequencer";
import { objectKeys } from "./tool-execution";

export async function getToolRun(
  repository: RomeoRepository,
  subject: AuthSubject,
  agent: Agent,
  runId: string | undefined,
): Promise<RunRecord | undefined> {
  if (runId === undefined) return undefined;
  const run = await repository.getRun(runId);
  if (!run) throw notFound("Run");
  if (!canAccessOrg(subject, run.orgId))
    throw new AuthorizationError("The run is outside the caller organization.");
  if (run.workspaceId !== agent.workspaceId)
    throw new ApiError(
      "run_agent_mismatch",
      "The run is outside the agent workspace.",
      400,
    );
  if (run.agentId !== agent.id)
    throw new ApiError(
      "run_agent_mismatch",
      "The run was not started with this agent.",
      400,
    );
  if (run.createdBy !== subject.id && subject.isAdmin !== true) {
    const chat = await repository.getChat(run.chatId);
    if (!chat) throw notFound("Chat");
    const grants = await repository.listResourceGrants(subject.orgId);
    if (!canWriteChat(subject, grants, chat))
      throw new AuthorizationError("The run is owned by another principal.");
  }
  return run;
}

export async function appendToolRunEvent(
  repository: RomeoRepository,
  sequencer: RunEventSequencer,
  run: RunRecord | undefined,
  input: {
    type: RunEventType;
    agent: Agent;
    tool: ToolDefinition;
    requestInput: unknown;
    output?: unknown;
    errorCode?: string;
    approvalRequestId?: string;
    approvalRequired: boolean;
  },
): Promise<void> {
  if (run === undefined) return;
  const event = await sequencer.create(repository, {
    runId: run.id,
    type: input.type,
    data: {
      agentId: input.agent.id,
      toolId: input.tool.id,
      riskLevel: input.tool.riskLevel,
      approvalRequired: input.approvalRequired,
      inputKeys: objectKeys(input.requestInput),
      outputKeys: objectKeys(input.output),
      errorCode: input.errorCode,
      ...(input.approvalRequestId === undefined
        ? {}
        : { approvalRequestId: input.approvalRequestId }),
    },
  });
  await repository.appendRunEvents([event]);
}
