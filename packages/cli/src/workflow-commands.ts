import {
  workflowsApproveRun,
  workflowsCreate,
  workflowsCreateFromTemplate,
  workflowsList,
  workflowsListTemplates,
  workflowsResumeRun,
  workflowsRunDueSchedules,
  workflowsStartRun,
  type CreateWorkflowRequest,
  type CreateWorkflowStep,
} from "@romeo/api-client/generated/sdk";
import type { GeneratedApiClient } from "@romeo/api-client/runtime/generated-client";

import { flagValue, type ParsedArgs } from "./args";
import { CliUsageError } from "./cli-errors";
import { csvFlag, optionalIntegerFlag, requiredFlag } from "./command-flags";
import type { CliIo } from "./io";
import { writeJson } from "./io";

interface WorkflowCommandContext {
  generatedClient?: GeneratedApiClient;
  io: CliIo;
  parsed: ParsedArgs;
}

export function executeWorkflowCommand(
  area: string,
  action: string | undefined,
  context: WorkflowCommandContext,
): Promise<number> | undefined {
  if (area !== "workflows") return undefined;
  const command = workflowCommand(action, context);
  return command === undefined ? undefined : result(context, command);
}

function workflowCommand(
  action: string | undefined,
  context: WorkflowCommandContext,
): Promise<unknown> | undefined {
  if (action === "list") return listWorkflows(context);
  if (action === "templates") return listTemplates(context);
  if (action === "create-template") return createFromTemplate(context);
  if (action === "create") return createWorkflow(context);
  if (action === "run-due-schedules") return runDueSchedules(context);
  if (action === "run") return startRun(context);
  if (action === "approve") return approveRun(context);
  if (action === "resume") return resumeRun(context);
  return undefined;
}

function listWorkflows(context: WorkflowCommandContext) {
  const workspaceId = flagValue(
    context.parsed.flags,
    "workspace",
    "workspace-id",
  );
  return workflowsList({
    client: generatedClient(context),
    ...(workspaceId === undefined ? {} : { query: { workspaceId } }),
    throwOnError: true,
  }).then(dataEnvelope);
}

function listTemplates(context: WorkflowCommandContext) {
  return workflowsListTemplates({
    client: generatedClient(context),
    throwOnError: true,
  }).then(dataEnvelope);
}

function createFromTemplate(context: WorkflowCommandContext) {
  const templateId = requiredFlag(context.parsed, "template", "template-id");
  const agentId = flagValue(context.parsed.flags, "agent", "agent-id");
  const name = flagValue(context.parsed.flags, "name");
  const schedule = workflowScheduleFromFlags(context.parsed);
  const body = {
    workspaceId: requiredFlag(context.parsed, "workspace", "workspace-id"),
    ...(agentId === undefined ? {} : { agentId }),
    ...(name === undefined ? {} : { name }),
    ...(schedule === undefined ? {} : { schedule }),
  };
  return workflowsCreateFromTemplate({
    body,
    client: generatedClient(context),
    path: { templateId },
    throwOnError: true,
  }).then(dataEnvelope);
}

function createWorkflow(context: WorkflowCommandContext) {
  const schedule = workflowScheduleFromFlags(context.parsed);
  const body: CreateWorkflowRequest = {
    workspaceId: requiredFlag(context.parsed, "workspace", "workspace-id"),
    name: requiredFlag(context.parsed, "name"),
    steps: workflowSteps(context.parsed),
    ...(schedule === undefined ? {} : { schedule }),
  };
  return workflowsCreate({
    body,
    client: generatedClient(context),
    throwOnError: true,
  }).then(dataEnvelope);
}

function runDueSchedules(context: WorkflowCommandContext) {
  return workflowsRunDueSchedules({
    client: generatedClient(context),
    throwOnError: true,
  }).then(dataEnvelope);
}

function startRun(context: WorkflowCommandContext) {
  const workflowId = requiredFlag(context.parsed, "workflow");
  return workflowsStartRun({
    client: generatedClient(context),
    path: { workflowId },
    throwOnError: true,
  }).then(dataEnvelope);
}

function approveRun(context: WorkflowCommandContext) {
  const workflowRunId = requiredFlag(context.parsed, "run", "workflow-run");
  const comment = flagValue(context.parsed.flags, "comment");
  const body = comment === undefined ? {} : { comment };
  return workflowsApproveRun({
    body,
    client: generatedClient(context),
    path: { workflowRunId },
    throwOnError: true,
  }).then(dataEnvelope);
}

function resumeRun(context: WorkflowCommandContext) {
  const workflowRunId = requiredFlag(context.parsed, "run", "workflow-run");
  return workflowsResumeRun({
    client: generatedClient(context),
    path: { workflowRunId },
    throwOnError: true,
  }).then(dataEnvelope);
}

function generatedClient(context: WorkflowCommandContext): GeneratedApiClient {
  if (context.generatedClient === undefined)
    throw new Error("The generated Romeo API client is required.");
  return context.generatedClient;
}

function workflowSteps(parsed: ParsedArgs): CreateWorkflowStep[] {
  const retryAttempts = optionalIntegerFlag(parsed, "retry-attempts");
  const retryPolicy =
    retryAttempts === undefined ? undefined : { maxAttempts: retryAttempts };
  const recoveryPolicy = workflowRecoveryPolicyFlag(parsed);
  const steps: CreateWorkflowStep[] = [
    {
      type: "agent_run",
      name: "Agent run",
      agentId: requiredFlag(parsed, "agent", "agent-id"),
      ...(retryPolicy === undefined ? {} : { retryPolicy }),
      ...(recoveryPolicy === undefined ? {} : { recoveryPolicy }),
    },
  ];
  addHandoffStep(steps, parsed, retryPolicy, recoveryPolicy);
  addRoomStep(steps, parsed, recoveryPolicy);
  addToolApprovalStep(steps, parsed);
  addBrowserStep(steps, parsed);
  const approval = flagValue(parsed.flags, "approval");
  if (approval !== undefined)
    steps.push({
      type: "approval",
      name: "Approval",
      approvalPrompt: approval,
    });
  return steps;
}

function addHandoffStep(
  steps: CreateWorkflowStep[],
  parsed: ParsedArgs,
  retryPolicy: { maxAttempts: number } | undefined,
  recoveryPolicy: { onFailure: "continue" | "fail" } | undefined,
) {
  const agentId = flagValue(parsed.flags, "handoff-agent", "handoff-agent-id");
  if (agentId === undefined) return;
  const handoffPrompt = flagValue(parsed.flags, "handoff-prompt");
  steps.push({
    type: "agent_handoff",
    name: "Agent handoff",
    agentId,
    ...(handoffPrompt === undefined ? {} : { handoffPrompt }),
    ...(retryPolicy === undefined ? {} : { retryPolicy }),
    ...(recoveryPolicy === undefined ? {} : { recoveryPolicy }),
  });
}

function addRoomStep(
  steps: CreateWorkflowStep[],
  parsed: ParsedArgs,
  recoveryPolicy: { onFailure: "continue" | "fail" } | undefined,
) {
  const agentIds = csvFlag(parsed, "room-agents");
  if (agentIds.length === 0) return;
  const roomPrompt = flagValue(parsed.flags, "room-prompt");
  steps.push({
    type: "agent_room",
    name: "Agent room",
    agentIds,
    ...(roomPrompt === undefined ? {} : { roomPrompt }),
    ...(recoveryPolicy === undefined ? {} : { recoveryPolicy }),
  });
}

function addToolApprovalStep(steps: CreateWorkflowStep[], parsed: ParsedArgs) {
  const toolChainName = flagValue(parsed.flags, "tool-approval", "tool-chain");
  if (toolChainName === undefined) return;
  const riskLevel = workflowRiskLevelFlag(parsed);
  const inputKeys = csvFlag(parsed, "tool-input-keys");
  steps.push({
    type: "tool_approval",
    name: "Tool approval",
    toolChainName,
    ...(riskLevel === undefined ? {} : { riskLevel }),
    ...(inputKeys.length === 0 ? {} : { inputKeys }),
  });
}

function addBrowserStep(steps: CreateWorkflowStep[], parsed: ParsedArgs) {
  const targetUrl = flagValue(parsed.flags, "browser-url");
  const task = flagValue(parsed.flags, "browser-task");
  if (targetUrl === undefined && task === undefined) return;
  if (targetUrl === undefined || task === undefined)
    throw new CliUsageError(
      "--browser-url and --browser-task must be provided together.",
    );
  steps.push({
    type: "browser_task",
    name: "Browser task",
    targetUrl,
    task,
  });
}

function workflowScheduleFromFlags(parsed: ParsedArgs) {
  const intervalMinutes = optionalIntegerFlag(
    parsed,
    "schedule-interval-minutes",
  );
  if (intervalMinutes === undefined) return undefined;
  const nextRunAt = flagValue(parsed.flags, "schedule-next-run-at");
  return {
    intervalMinutes,
    ...(nextRunAt === undefined ? {} : { nextRunAt }),
  };
}

function workflowRiskLevelFlag(
  parsed: ParsedArgs,
): "high" | "low" | "medium" | undefined {
  const risk = flagValue(parsed.flags, "tool-risk", "risk");
  if (risk === undefined) return undefined;
  if (risk === "high" || risk === "low" || risk === "medium") return risk;
  throw new CliUsageError("--tool-risk must be low, medium, or high.");
}

function workflowRecoveryPolicyFlag(
  parsed: ParsedArgs,
): { onFailure: "continue" | "fail" } | undefined {
  const action = flagValue(parsed.flags, "on-failure");
  if (action === undefined) return undefined;
  if (action === "continue" || action === "fail") return { onFailure: action };
  throw new CliUsageError("--on-failure must be fail or continue.");
}

function dataEnvelope<T>(response: { data: { data: T } }): T {
  return response.data.data;
}

async function result(
  context: WorkflowCommandContext,
  value: Promise<unknown>,
): Promise<number> {
  writeJson(context.io, await value);
  return 0;
}
