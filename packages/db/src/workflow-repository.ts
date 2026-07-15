import { and, asc, desc, eq } from "drizzle-orm";

import type { RomeoDatabase } from "./client";
import { workflowDefinitions, workflowRuns } from "./schema";
import {
  asStringArray,
  optionalDate,
  optionalIsoString,
  toIsoString,
} from "./repository-mapping";

export type WorkflowStepTypeRecord =
  | "agent_handoff"
  | "agent_room"
  | "agent_run"
  | "approval"
  | "browser_task"
  | "notification"
  | "tool_approval";
export type WorkflowRunStatusRecord =
  | "cancelled"
  | "completed"
  | "failed"
  | "waiting_approval"
  | "waiting_run";
export type WorkflowStepRunStatusRecord =
  | "completed"
  | "failed"
  | "pending"
  | "waiting_approval"
  | "waiting_run";

export interface WorkflowStepConditionRecord {
  inputKey: string;
  equals: boolean | number | string | null;
}

export interface WorkflowStepRetryPolicyRecord {
  maxAttempts: number;
}

export interface WorkflowStepRecoveryPolicyRecord {
  onFailure: "continue" | "fail";
}

export interface WorkflowStepRecord {
  id: string;
  type: WorkflowStepTypeRecord;
  name: string;
  agentId?: string;
  agentIds?: string[];
  handoffFromStepId?: string;
  handoffPrompt?: string;
  roomPrompt?: string;
  retryPolicy?: WorkflowStepRetryPolicyRecord;
  recoveryPolicy?: WorkflowStepRecoveryPolicyRecord;
  approvalPrompt?: string;
  toolChainName?: string;
  riskLevel?: "high" | "low" | "medium";
  inputKeys?: string[];
  targetUrl?: string;
  task?: string;
  message?: string;
  condition?: WorkflowStepConditionRecord;
}

export interface WorkflowScheduleRecord {
  enabled: boolean;
  intervalMinutes: number;
  nextRunAt: string;
}

export interface WorkflowDefinitionRecord {
  id: string;
  orgId: string;
  workspaceId: string;
  name: string;
  description?: string;
  steps: WorkflowStepRecord[];
  schedule?: WorkflowScheduleRecord;
  enabled: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowStepRunRecord {
  stepId: string;
  type: WorkflowStepTypeRecord;
  status: WorkflowStepRunStatusRecord;
  output: Record<string, unknown>;
  completedAt?: string;
}

export interface WorkflowRunRecord {
  id: string;
  orgId: string;
  workspaceId: string;
  workflowId: string;
  status: WorkflowRunStatusRecord;
  input: Record<string, unknown>;
  steps: WorkflowStepRunRecord[];
  currentStepId?: string;
  createdBy: string;
  approvedBy?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export class PgWorkflowRepository {
  constructor(private readonly db: RomeoDatabase) {}

  async listWorkflowDefinitions(
    orgId: string,
    workspaceId?: string,
  ): Promise<WorkflowDefinitionRecord[]> {
    const rows = await this.db
      .select()
      .from(workflowDefinitions)
      .where(
        workspaceId === undefined
          ? eq(workflowDefinitions.orgId, orgId)
          : and(
              eq(workflowDefinitions.orgId, orgId),
              eq(workflowDefinitions.workspaceId, workspaceId),
            ),
      )
      .orderBy(
        desc(workflowDefinitions.updatedAt),
        asc(workflowDefinitions.id),
      );
    return rows.map(toWorkflowDefinitionRecord);
  }

  async getWorkflowDefinition(
    workflowId: string,
  ): Promise<WorkflowDefinitionRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(workflowDefinitions)
      .where(eq(workflowDefinitions.id, workflowId))
      .limit(1);
    return row === undefined ? undefined : toWorkflowDefinitionRecord(row);
  }

  async createWorkflowDefinition(
    workflow: WorkflowDefinitionRecord,
  ): Promise<WorkflowDefinitionRecord> {
    const [row] = await this.db
      .insert(workflowDefinitions)
      .values(toWorkflowDefinitionInsert(workflow))
      .returning();
    return row === undefined ? workflow : toWorkflowDefinitionRecord(row);
  }

  async updateWorkflowDefinition(
    workflow: WorkflowDefinitionRecord,
  ): Promise<WorkflowDefinitionRecord> {
    const [row] = await this.db
      .update(workflowDefinitions)
      .set({
        description: workflow.description ?? null,
        enabled: workflow.enabled,
        name: workflow.name,
        nextScheduledRunAt: optionalDate(workflow.schedule?.nextRunAt),
        schedule: toWorkflowScheduleJson(workflow.schedule),
        steps: workflow.steps as unknown as Array<Record<string, unknown>>,
        updatedAt: new Date(workflow.updatedAt),
        workspaceId: workflow.workspaceId,
      })
      .where(eq(workflowDefinitions.id, workflow.id))
      .returning();
    return row === undefined ? workflow : toWorkflowDefinitionRecord(row);
  }

  async listWorkflowRuns(
    orgId: string,
    workflowId?: string,
  ): Promise<WorkflowRunRecord[]> {
    const rows = await this.db
      .select()
      .from(workflowRuns)
      .where(
        workflowId === undefined
          ? eq(workflowRuns.orgId, orgId)
          : and(
              eq(workflowRuns.orgId, orgId),
              eq(workflowRuns.workflowId, workflowId),
            ),
      )
      .orderBy(desc(workflowRuns.createdAt), asc(workflowRuns.id));
    return rows.map(toWorkflowRunRecord);
  }

  async getWorkflowRun(
    workflowRunId: string,
  ): Promise<WorkflowRunRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.id, workflowRunId))
      .limit(1);
    return row === undefined ? undefined : toWorkflowRunRecord(row);
  }

  async createWorkflowRun(run: WorkflowRunRecord): Promise<WorkflowRunRecord> {
    const [row] = await this.db
      .insert(workflowRuns)
      .values(toWorkflowRunInsert(run))
      .returning();
    return row === undefined ? run : toWorkflowRunRecord(row);
  }

  async updateWorkflowRun(run: WorkflowRunRecord): Promise<WorkflowRunRecord> {
    const [row] = await this.db
      .update(workflowRuns)
      .set({
        approvedBy: run.approvedBy ?? null,
        completedAt: optionalDate(run.completedAt),
        currentStepId: run.currentStepId ?? null,
        input: run.input,
        status: run.status,
        steps: run.steps as unknown as Array<Record<string, unknown>>,
        updatedAt: new Date(run.updatedAt),
      })
      .where(eq(workflowRuns.id, run.id))
      .returning();
    return row === undefined ? run : toWorkflowRunRecord(row);
  }
}

export function toWorkflowDefinitionRecord(
  row: typeof workflowDefinitions.$inferSelect,
): WorkflowDefinitionRecord {
  const workflow: WorkflowDefinitionRecord = {
    id: row.id,
    orgId: row.orgId,
    workspaceId: row.workspaceId,
    name: row.name,
    steps: asWorkflowSteps(row.steps),
    enabled: row.enabled,
    createdBy: row.createdBy,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
  const description = optionalIsoString(row.description);
  if (description !== undefined) workflow.description = description;
  const schedule = asWorkflowSchedule(row.schedule);
  if (schedule !== undefined) workflow.schedule = schedule;
  return workflow;
}

export function toWorkflowRunRecord(
  row: typeof workflowRuns.$inferSelect,
): WorkflowRunRecord {
  const run: WorkflowRunRecord = {
    id: row.id,
    orgId: row.orgId,
    workspaceId: row.workspaceId,
    workflowId: row.workflowId,
    status: asWorkflowRunStatus(row.status),
    input: asJsonRecord(row.input),
    steps: asWorkflowStepRuns(row.steps),
    createdBy: row.createdBy,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
  const currentStepId = optionalIsoString(row.currentStepId);
  if (currentStepId !== undefined) run.currentStepId = currentStepId;
  const approvedBy = optionalIsoString(row.approvedBy);
  if (approvedBy !== undefined) run.approvedBy = approvedBy;
  const completedAt = optionalIsoString(row.completedAt);
  if (completedAt !== undefined) run.completedAt = completedAt;
  return run;
}

function toWorkflowDefinitionInsert(
  record: WorkflowDefinitionRecord,
): typeof workflowDefinitions.$inferInsert {
  return {
    id: record.id,
    orgId: record.orgId,
    workspaceId: record.workspaceId,
    name: record.name,
    description: record.description ?? null,
    steps: record.steps as unknown as Array<Record<string, unknown>>,
    schedule: toWorkflowScheduleJson(record.schedule),
    nextScheduledRunAt: optionalDate(record.schedule?.nextRunAt),
    enabled: record.enabled,
    createdBy: record.createdBy,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
  };
}

function toWorkflowRunInsert(
  record: WorkflowRunRecord,
): typeof workflowRuns.$inferInsert {
  return {
    id: record.id,
    orgId: record.orgId,
    workspaceId: record.workspaceId,
    workflowId: record.workflowId,
    status: record.status,
    input: record.input,
    steps: record.steps as unknown as Array<Record<string, unknown>>,
    currentStepId: record.currentStepId ?? null,
    createdBy: record.createdBy,
    approvedBy: record.approvedBy ?? null,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
    completedAt: optionalDate(record.completedAt),
  };
}

function asWorkflowSteps(value: unknown): WorkflowStepRecord[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(asWorkflowStep)
    .filter((step): step is WorkflowStepRecord => step !== undefined);
}

function asWorkflowStep(value: unknown): WorkflowStepRecord | undefined {
  const record = asJsonRecord(value);
  if (
    typeof record.id !== "string" ||
    typeof record.name !== "string" ||
    typeof record.type !== "string"
  ) {
    return undefined;
  }
  const type = asWorkflowStepType(record.type);
  if (type === undefined) return undefined;
  const step: WorkflowStepRecord = { id: record.id, type, name: record.name };
  assignOptionalString(step, "agentId", record.agentId);
  const agentIds = asStringArray(record.agentIds);
  if (agentIds.length > 0) step.agentIds = agentIds;
  assignOptionalString(step, "handoffFromStepId", record.handoffFromStepId);
  assignOptionalString(step, "handoffPrompt", record.handoffPrompt);
  assignOptionalString(step, "roomPrompt", record.roomPrompt);
  assignOptionalString(step, "approvalPrompt", record.approvalPrompt);
  assignOptionalString(step, "toolChainName", record.toolChainName);
  assignOptionalRiskLevel(step, record.riskLevel);
  const inputKeys = asStringArray(record.inputKeys);
  if (inputKeys.length > 0) step.inputKeys = inputKeys;
  assignOptionalString(step, "targetUrl", record.targetUrl);
  assignOptionalString(step, "task", record.task);
  assignOptionalString(step, "message", record.message);
  const retryPolicy = asWorkflowRetryPolicy(record.retryPolicy);
  if (retryPolicy !== undefined) step.retryPolicy = retryPolicy;
  const recoveryPolicy = asWorkflowRecoveryPolicy(record.recoveryPolicy);
  if (recoveryPolicy !== undefined) step.recoveryPolicy = recoveryPolicy;
  const condition = asWorkflowStepCondition(record.condition);
  if (condition !== undefined) step.condition = condition;
  return step;
}

function asWorkflowStepRuns(value: unknown): WorkflowStepRunRecord[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(asWorkflowStepRun)
    .filter((step): step is WorkflowStepRunRecord => step !== undefined);
}

function asWorkflowStepRun(value: unknown): WorkflowStepRunRecord | undefined {
  const record = asJsonRecord(value);
  if (typeof record.stepId !== "string" || typeof record.type !== "string")
    return undefined;
  const type = asWorkflowStepType(record.type);
  if (type === undefined) return undefined;
  const step: WorkflowStepRunRecord = {
    stepId: record.stepId,
    type,
    status: asWorkflowStepRunStatus(record.status),
    output: asJsonRecord(record.output),
  };
  if (typeof record.completedAt === "string")
    step.completedAt = record.completedAt;
  return step;
}

function asWorkflowSchedule(
  value: unknown,
): WorkflowScheduleRecord | undefined {
  const record = asJsonRecord(value);
  if (
    typeof record.enabled !== "boolean" ||
    typeof record.intervalMinutes !== "number" ||
    typeof record.nextRunAt !== "string"
  ) {
    return undefined;
  }
  return {
    enabled: record.enabled,
    intervalMinutes: Math.trunc(record.intervalMinutes),
    nextRunAt: record.nextRunAt,
  };
}

function asWorkflowStepType(value: string): WorkflowStepTypeRecord | undefined {
  if (
    value === "agent_handoff" ||
    value === "agent_room" ||
    value === "agent_run" ||
    value === "approval" ||
    value === "browser_task" ||
    value === "notification" ||
    value === "tool_approval"
  ) {
    return value;
  }
  return undefined;
}

function asWorkflowRunStatus(value: string): WorkflowRunStatusRecord {
  if (
    value === "cancelled" ||
    value === "completed" ||
    value === "failed" ||
    value === "waiting_approval" ||
    value === "waiting_run"
  ) {
    return value;
  }
  return "failed";
}

function asWorkflowStepRunStatus(value: unknown): WorkflowStepRunStatusRecord {
  if (
    value === "completed" ||
    value === "failed" ||
    value === "pending" ||
    value === "waiting_approval" ||
    value === "waiting_run"
  ) {
    return value;
  }
  return "failed";
}

function asWorkflowRetryPolicy(
  value: unknown,
): WorkflowStepRetryPolicyRecord | undefined {
  const record = asJsonRecord(value);
  if (typeof record.maxAttempts !== "number") return undefined;
  return { maxAttempts: Math.max(1, Math.trunc(record.maxAttempts)) };
}

function asWorkflowRecoveryPolicy(
  value: unknown,
): WorkflowStepRecoveryPolicyRecord | undefined {
  const record = asJsonRecord(value);
  if (record.onFailure === "continue" || record.onFailure === "fail") {
    return { onFailure: record.onFailure };
  }
  return undefined;
}

function asWorkflowStepCondition(
  value: unknown,
): WorkflowStepConditionRecord | undefined {
  const record = asJsonRecord(value);
  if (typeof record.inputKey !== "string") return undefined;
  if (
    record.equals === null ||
    typeof record.equals === "boolean" ||
    typeof record.equals === "number" ||
    typeof record.equals === "string"
  ) {
    return { inputKey: record.inputKey, equals: record.equals };
  }
  return undefined;
}

type WorkflowStepStringKey =
  | "agentId"
  | "handoffFromStepId"
  | "handoffPrompt"
  | "roomPrompt"
  | "approvalPrompt"
  | "toolChainName"
  | "targetUrl"
  | "task"
  | "message";

function assignOptionalString(
  target: WorkflowStepRecord,
  key: WorkflowStepStringKey,
  value: unknown,
): void {
  if (typeof value === "string") target[key] = value;
}

function toWorkflowScheduleJson(
  schedule: WorkflowScheduleRecord | undefined,
): Record<string, unknown> | null {
  return schedule === undefined
    ? null
    : (schedule as unknown as Record<string, unknown>);
}

function assignOptionalRiskLevel(
  target: WorkflowStepRecord,
  value: unknown,
): void {
  if (value === "high" || value === "low" || value === "medium") {
    target.riskLevel = value;
  }
}

function asJsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return {};
  return value as Record<string, unknown>;
}
