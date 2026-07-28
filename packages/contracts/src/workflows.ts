import { createRoute, z } from "@hono/zod-openapi";

import {
  authenticationSecurity,
  dataEnvelope,
  jsonResponse,
  standardErrorResponses,
} from "./common";

const id = z.string().trim().min(1).max(300);
const time = z.iso.datetime();
const name = z.string().trim().min(1).max(120);
const prompt = z.string().trim().min(1).max(1_000);
const inputKey = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9_.-]+$/u);

export const WorkflowStepTypeSchema = z
  .enum([
    "agent_handoff",
    "agent_room",
    "agent_run",
    "approval",
    "browser_task",
    "notification",
    "tool_approval",
  ])
  .openapi("WorkflowStepType");
export const WorkflowRunStatusSchema = z
  .enum(["cancelled", "completed", "failed", "waiting_approval", "waiting_run"])
  .openapi("WorkflowRunStatus");
export const WorkflowStepRunStatusSchema = z
  .enum(["completed", "failed", "pending", "waiting_approval", "waiting_run"])
  .openapi("WorkflowStepRunStatus");

const WorkflowStepConditionSchema = z.strictObject({
  inputKey,
  equals: z.union([z.string().max(500), z.number(), z.boolean(), z.null()]),
});
const WorkflowStepRetryPolicySchema = z.strictObject({
  maxAttempts: z.number().int().min(1).max(3),
});
const WorkflowStepRecoveryPolicySchema = z.strictObject({
  onFailure: z.enum(["continue", "fail"]),
});
const agentRunStep = z.strictObject({
  type: z.literal("agent_run"),
  name,
  agentId: id,
  retryPolicy: WorkflowStepRetryPolicySchema.optional(),
  recoveryPolicy: WorkflowStepRecoveryPolicySchema.optional(),
});
const agentHandoffStep = z.strictObject({
  type: z.literal("agent_handoff"),
  name,
  agentId: id,
  handoffFromStepId: z
    .string()
    .min(1)
    .max(120)
    .regex(/^step_[1-9][0-9]*$/u)
    .optional(),
  handoffPrompt: prompt.optional(),
  retryPolicy: WorkflowStepRetryPolicySchema.optional(),
  recoveryPolicy: WorkflowStepRecoveryPolicySchema.optional(),
});
const agentRoomStep = z.strictObject({
  type: z.literal("agent_room"),
  name,
  agentIds: z
    .array(id)
    .min(2)
    .max(5)
    .refine((agentIds) => new Set(agentIds).size === agentIds.length, {
      message: "agentIds must be unique.",
    }),
  roomPrompt: prompt.optional(),
  recoveryPolicy: WorkflowStepRecoveryPolicySchema.optional(),
});
const approvalStep = z.strictObject({
  type: z.literal("approval"),
  name,
  approvalPrompt: prompt.optional(),
});
const toolApprovalStep = z.strictObject({
  type: z.literal("tool_approval"),
  name,
  toolChainName: name.optional(),
  riskLevel: z.enum(["high", "low", "medium"]).optional(),
  approvalPrompt: prompt.optional(),
  inputKeys: z.array(inputKey).max(25).optional(),
});
const browserTaskStep = z.strictObject({
  type: z.literal("browser_task"),
  name,
  targetUrl: z.url().max(2_000),
  task: prompt,
  approvalPrompt: prompt.optional(),
});
const notificationStep = z.strictObject({
  type: z.literal("notification"),
  name,
  message: z.string().max(1_000).optional(),
  condition: WorkflowStepConditionSchema.optional(),
});

export const CreateWorkflowStepSchema = z
  .discriminatedUnion("type", [
    agentRunStep,
    agentHandoffStep,
    agentRoomStep,
    approvalStep,
    toolApprovalStep,
    browserTaskStep,
    notificationStep,
  ])
  .openapi("CreateWorkflowStep");
export const WorkflowStepSchema = z
  .discriminatedUnion("type", [
    agentRunStep.extend({ id }),
    agentHandoffStep.extend({ id }),
    agentRoomStep.extend({ id }),
    approvalStep.extend({ id }),
    toolApprovalStep.extend({ id }),
    browserTaskStep.extend({ id }),
    notificationStep.extend({ id }),
  ])
  .openapi("WorkflowStep");

const WorkflowScheduleInputSchema = z.strictObject({
  enabled: z.boolean().optional(),
  intervalMinutes: z.number().int().min(5).max(43_200),
  nextRunAt: time.optional(),
});
export const WorkflowScheduleSchema = z
  .strictObject({
    enabled: z.boolean(),
    intervalMinutes: z.number().int().min(5).max(43_200),
    nextRunAt: time,
  })
  .openapi("WorkflowSchedule");
export const WorkflowSchema = z
  .strictObject({
    id,
    orgId: id,
    workspaceId: id,
    name,
    description: z.string().min(1).max(1_000).optional(),
    steps: z.array(WorkflowStepSchema).min(1).max(25),
    schedule: WorkflowScheduleSchema.optional(),
    enabled: z.boolean(),
    createdBy: id,
    createdAt: time,
    updatedAt: time,
  })
  .openapi("Workflow");

const templateAgentRunStep = agentRunStep.omit({ agentId: true }).extend({
  requiresAgentId: z.boolean().optional(),
});
const templateAgentHandoffStep = agentHandoffStep
  .omit({ agentId: true })
  .extend({ requiresAgentId: z.boolean().optional() });
export const WorkflowTemplateStepSchema = z
  .discriminatedUnion("type", [
    templateAgentRunStep,
    templateAgentHandoffStep,
    agentRoomStep,
    approvalStep,
    toolApprovalStep,
    browserTaskStep,
    notificationStep,
  ])
  .openapi("WorkflowTemplateStep");
export const WorkflowTemplateSchema = z
  .strictObject({
    id,
    name,
    description: z.string().min(1).max(1_000),
    requiredInputs: z.array(z.literal("agentId")),
    steps: z.array(WorkflowTemplateStepSchema).min(1).max(25),
  })
  .openapi("WorkflowTemplate");

export const WorkflowStepRunSchema = z
  .strictObject({
    stepId: id,
    type: WorkflowStepTypeSchema,
    status: WorkflowStepRunStatusSchema,
    output: z.record(z.string(), z.unknown()),
    completedAt: time.optional(),
  })
  .openapi("WorkflowStepRun");
export const WorkflowRunSchema = z
  .strictObject({
    id,
    orgId: id,
    workspaceId: id,
    workflowId: id,
    status: WorkflowRunStatusSchema,
    input: z.record(z.string(), z.unknown()),
    steps: z.array(WorkflowStepRunSchema).max(25),
    currentStepId: id.optional(),
    createdBy: id,
    approvedBy: id.optional(),
    createdAt: time,
    updatedAt: time,
    completedAt: time.optional(),
  })
  .openapi("WorkflowRun");
export const WorkflowScheduleRunResultSchema = z
  .strictObject({
    checkedAt: time,
    dueWorkflowCount: z.number().int().min(0),
    startedRuns: z.array(WorkflowRunSchema),
  })
  .openapi("WorkflowScheduleRunResult");

export const CreateWorkflowSchema = z
  .strictObject({
    workspaceId: id,
    name,
    description: z.string().trim().min(1).max(1_000).optional(),
    steps: z.array(CreateWorkflowStepSchema).min(1).max(25),
    schedule: WorkflowScheduleInputSchema.optional(),
  })
  .openapi("CreateWorkflowRequest");
export const CreateWorkflowFromTemplateSchema = z
  .strictObject({
    workspaceId: id,
    agentId: id.optional(),
    name: name.optional(),
    schedule: WorkflowScheduleInputSchema.optional(),
  })
  .openapi("CreateWorkflowFromTemplateRequest");
export const StartWorkflowRunSchema = z
  .strictObject({ input: z.record(z.string(), z.unknown()).optional() })
  .openapi("StartWorkflowRunRequest");
export const ApproveWorkflowRunSchema = z
  .strictObject({ comment: prompt.optional() })
  .openapi("ApproveWorkflowRunRequest");

const templatePath = z.strictObject({ templateId: id });
const workflowPath = z.strictObject({ workflowId: id });
const runPath = z.strictObject({ workflowRunId: id });
const workspaceQuery = z.strictObject({ workspaceId: id.optional() });
const meta = { tags: ["Workflows"], security: authenticationSecurity };
const errors = standardErrorResponses;
const body = <T extends z.ZodType>(schema: T, required = true) => ({
  required,
  content: { "application/json": { schema } },
});

export const listWorkflowTemplatesRoute = createRoute({
  ...meta,
  method: "get",
  path: "/api/v1/workflow-templates",
  operationId: "workflows.listTemplates",
  summary: "List templates",
  responses: {
    200: jsonResponse(
      "Safe workflow templates",
      dataEnvelope(z.array(WorkflowTemplateSchema)),
    ),
    ...errors,
  },
});
export const createWorkflowFromTemplateRoute = createRoute({
  ...meta,
  method: "post",
  path: "/api/v1/workflow-templates/{templateId}/create",
  operationId: "workflows.createFromTemplate",
  summary: "Create from template",
  request: {
    params: templatePath,
    body: body(CreateWorkflowFromTemplateSchema),
  },
  responses: {
    201: jsonResponse("Workflow definition", dataEnvelope(WorkflowSchema)),
    ...errors,
  },
});
export const listWorkflowsRoute = createRoute({
  ...meta,
  method: "get",
  path: "/api/v1/workflows",
  operationId: "workflows.list",
  summary: "List",
  request: { query: workspaceQuery },
  responses: {
    200: jsonResponse(
      "Workflow definitions",
      dataEnvelope(z.array(WorkflowSchema)),
    ),
    ...errors,
  },
});
export const createWorkflowRoute = createRoute({
  ...meta,
  method: "post",
  path: "/api/v1/workflows",
  operationId: "workflows.create",
  summary: "Create",
  request: { body: body(CreateWorkflowSchema) },
  responses: {
    201: jsonResponse("Workflow definition", dataEnvelope(WorkflowSchema)),
    ...errors,
  },
});
export const runDueWorkflowSchedulesRoute = createRoute({
  ...meta,
  method: "post",
  path: "/api/v1/workflows/schedules/run-due",
  operationId: "workflows.runDueSchedules",
  summary: "Run due schedules",
  responses: {
    200: jsonResponse(
      "Workflow schedule run result",
      dataEnvelope(WorkflowScheduleRunResultSchema),
    ),
    ...errors,
  },
});
export const listWorkflowRunsRoute = createRoute({
  ...meta,
  method: "get",
  path: "/api/v1/workflows/{workflowId}/runs",
  operationId: "workflows.listRuns",
  summary: "List runs",
  request: { params: workflowPath },
  responses: {
    200: jsonResponse(
      "Workflow runs",
      dataEnvelope(z.array(WorkflowRunSchema)),
    ),
    ...errors,
  },
});
export const startWorkflowRunRoute = createRoute({
  ...meta,
  method: "post",
  path: "/api/v1/workflows/{workflowId}/runs",
  operationId: "workflows.startRun",
  summary: "Start run",
  request: {
    params: workflowPath,
    body: body(StartWorkflowRunSchema, false),
  },
  responses: {
    201: jsonResponse("Workflow run", dataEnvelope(WorkflowRunSchema)),
    ...errors,
  },
});
export const approveWorkflowRunRoute = createRoute({
  ...meta,
  method: "post",
  path: "/api/v1/workflow-runs/{workflowRunId}/approve",
  operationId: "workflows.approveRun",
  summary: "Approve run",
  request: { params: runPath, body: body(ApproveWorkflowRunSchema, false) },
  responses: {
    200: jsonResponse("Workflow run", dataEnvelope(WorkflowRunSchema)),
    ...errors,
  },
});
export const resumeWorkflowRunRoute = createRoute({
  ...meta,
  method: "post",
  path: "/api/v1/workflow-runs/{workflowRunId}/resume",
  operationId: "workflows.resumeRun",
  summary: "Resume run",
  request: { params: runPath },
  responses: {
    200: jsonResponse("Workflow run", dataEnvelope(WorkflowRunSchema)),
    ...errors,
  },
});

export const workflowRoutes = [
  listWorkflowTemplatesRoute,
  createWorkflowFromTemplateRoute,
  listWorkflowsRoute,
  createWorkflowRoute,
  runDueWorkflowSchedulesRoute,
  listWorkflowRunsRoute,
  startWorkflowRunRoute,
  approveWorkflowRunRoute,
  resumeWorkflowRunRoute,
] as const;
