import type { AuthSubject } from "@romeo/auth";
import type { ToolDefinition } from "@romeo/tools";

import type {
  Agent,
  AgentToolBinding,
  ToolCallRecord,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { createId } from "../ids";
import { persistedSubjectActorId } from "./subject-persisted-actor";
import { objectKeys } from "./tool-execution";

export async function recordToolCall(
  repository: RomeoRepository,
  input: {
    subject: AuthSubject;
    agent: Agent;
    tool: ToolDefinition;
    binding: AgentToolBinding | undefined;
    status: ToolCallRecord["status"];
    startedAt: string;
    requestInput: unknown;
    output?: unknown;
    errorCode?: string;
    runId?: string | undefined;
  },
): Promise<ToolCallRecord> {
  const record: ToolCallRecord = {
    id: createId("tool_call"),
    orgId: input.subject.orgId,
    workspaceId: input.agent.workspaceId,
    agentId: input.agent.id,
    actorId: await persistedSubjectActorId(repository, input.subject, {
      kind: "service_account_tool_call",
      name: "Service Account Tool Actor",
    }),
    toolId: input.tool.id,
    status: input.status,
    riskLevel: input.tool.riskLevel,
    approvalRequired: input.binding?.approvalRequired === true,
    inputKeys: objectKeys(input.requestInput),
    outputKeys: objectKeys(input.output),
    startedAt: input.startedAt,
    completedAt: new Date().toISOString(),
  };
  if (input.errorCode !== undefined) record.errorCode = input.errorCode;
  if (input.runId !== undefined) record.runId = input.runId;
  return repository.createToolCall(record);
}
