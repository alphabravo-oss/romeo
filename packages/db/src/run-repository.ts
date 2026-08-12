import type { RunEventType } from "@romeo/core";
import { and, asc, desc, eq, notInArray } from "drizzle-orm";

import type { RomeoDatabase } from "./client";
import { runEvents, runs, toolCalls } from "./schema";
import {
  asStringArray,
  optionalDate,
  optionalIsoString,
  toIsoString,
} from "./repository-mapping";

export type RunStatusRecord =
  | "cancelled"
  | "completed"
  | "failed"
  | "queued"
  | "running"
  | "waiting_tool_approval";

export interface RunRecord {
  id: string;
  orgId: string;
  workspaceId: string;
  chatId: string;
  agentId: string;
  agentVersionId: string;
  modelId: string;
  providerId: string;
  status: RunStatusRecord;
  createdBy: string;
  createdAt: string;
  completedAt?: string;
}

export type RunEventTypeRecord = RunEventType;

export interface RunEventRecord<TData = unknown> {
  id: string;
  runId: string;
  sequence: number;
  type: RunEventTypeRecord;
  data: TData;
  createdAt: string;
}

export type ToolCallStatusRecord =
  | "approval_required"
  | "blocked"
  | "failure"
  | "success";

export interface ToolCallRecord {
  id: string;
  orgId: string;
  workspaceId: string;
  agentId: string;
  actorId: string;
  toolId: string;
  status: ToolCallStatusRecord;
  riskLevel: string;
  approvalRequired: boolean;
  inputKeys: string[];
  outputKeys: string[];
  errorCode?: string;
  runId?: string;
  startedAt: string;
  completedAt: string;
}

export class PgRunRepository {
  constructor(private readonly db: RomeoDatabase) {}

  async createRun(run: RunRecord): Promise<RunRecord> {
    const [row] = await this.db
      .insert(runs)
      .values(toRunInsert(run))
      .returning();
    return row === undefined ? run : toRunRecord(row);
  }

  async getRun(runId: string): Promise<RunRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(runs)
      .where(eq(runs.id, runId))
      .limit(1);
    return row === undefined ? undefined : toRunRecord(row);
  }

  async listRuns(chatId: string): Promise<RunRecord[]> {
    const rows = await this.db
      .select()
      .from(runs)
      .where(eq(runs.chatId, chatId))
      .orderBy(desc(runs.createdAt), asc(runs.id));
    return rows.map(toRunRecord);
  }

  async updateRun(run: RunRecord): Promise<RunRecord> {
    const [row] = await this.db
      .update(runs)
      .set({
        completedAt: optionalDate(run.completedAt),
        status: run.status,
      })
      .where(eq(runs.id, run.id))
      .returning();
    return row === undefined ? run : toRunRecord(row);
  }

  async finalizeRun(input: {
    runId: string;
    status: "cancelled" | "completed" | "failed";
    completedAt: string;
  }): Promise<RunRecord | undefined> {
    const [row] = await this.db
      .update(runs)
      .set({
        completedAt: new Date(input.completedAt),
        status: input.status,
      })
      .where(
        and(
          eq(runs.id, input.runId),
          notInArray(runs.status, ["cancelled", "completed", "failed"]),
        ),
      )
      .returning();
    return row === undefined ? undefined : toRunRecord(row);
  }

  async appendRunEvents(events: RunEventRecord[]): Promise<void> {
    if (events.length === 0) return;
    await this.db
      .insert(runEvents)
      .values(events.map(toRunEventInsert))
      .onConflictDoNothing({
        target: [runEvents.runId, runEvents.sequence],
      });
  }

  async listRunEvents(runId: string): Promise<RunEventRecord[]> {
    const rows = await this.db
      .select()
      .from(runEvents)
      .where(eq(runEvents.runId, runId))
      .orderBy(asc(runEvents.sequence));
    return rows.map(toRunEventRecord);
  }

  async listToolCalls(orgId: string): Promise<ToolCallRecord[]> {
    const rows = await this.db
      .select()
      .from(toolCalls)
      .where(eq(toolCalls.orgId, orgId))
      .orderBy(desc(toolCalls.startedAt), asc(toolCalls.id));
    return rows.map(toToolCallRecord);
  }

  async createToolCall(call: ToolCallRecord): Promise<ToolCallRecord> {
    const [row] = await this.db
      .insert(toolCalls)
      .values(toToolCallInsert(call))
      .returning();
    return row === undefined ? call : toToolCallRecord(row);
  }
}

export function toRunRecord(row: typeof runs.$inferSelect): RunRecord {
  const run: RunRecord = {
    id: row.id,
    orgId: row.orgId,
    workspaceId: row.workspaceId,
    chatId: row.chatId,
    agentId: row.agentId,
    agentVersionId: row.agentVersionId,
    modelId: row.modelId,
    providerId: row.providerId,
    status: asRunStatus(row.status),
    createdBy: row.createdBy,
    createdAt: toIsoString(row.createdAt),
  };
  const completedAt = optionalIsoString(row.completedAt);
  if (completedAt !== undefined) run.completedAt = completedAt;
  return run;
}

export function toRunEventRecord(
  row: typeof runEvents.$inferSelect,
): RunEventRecord {
  return {
    id: row.id,
    runId: row.runId,
    sequence: row.sequence,
    type: asRunEventType(row.type),
    data: row.data,
    createdAt: toIsoString(row.createdAt),
  };
}

export function toToolCallRecord(
  row: typeof toolCalls.$inferSelect,
): ToolCallRecord {
  const call: ToolCallRecord = {
    id: row.id,
    orgId: row.orgId,
    workspaceId: row.workspaceId,
    agentId: row.agentId,
    actorId: row.actorId,
    toolId: row.toolId,
    status: asToolCallStatus(row.status),
    riskLevel: row.riskLevel,
    approvalRequired: row.approvalRequired,
    inputKeys: asStringArray(row.inputKeys),
    outputKeys: asStringArray(row.outputKeys),
    startedAt: toIsoString(row.startedAt),
    completedAt: toIsoString(row.completedAt),
  };
  const errorCode = optionalIsoString(row.errorCode);
  if (errorCode !== undefined) call.errorCode = errorCode;
  const runId = optionalIsoString(row.runId);
  if (runId !== undefined) call.runId = runId;
  return call;
}

function toRunInsert(record: RunRecord): typeof runs.$inferInsert {
  return {
    id: record.id,
    orgId: record.orgId,
    workspaceId: record.workspaceId,
    chatId: record.chatId,
    agentId: record.agentId,
    agentVersionId: record.agentVersionId,
    modelId: record.modelId,
    providerId: record.providerId,
    status: record.status,
    createdBy: record.createdBy,
    createdAt: new Date(record.createdAt),
    completedAt: optionalDate(record.completedAt),
  };
}

function toRunEventInsert(
  record: RunEventRecord,
): typeof runEvents.$inferInsert {
  return {
    id: record.id,
    runId: record.runId,
    sequence: record.sequence,
    type: record.type,
    data: record.data,
    createdAt: new Date(record.createdAt),
  };
}

function toToolCallInsert(
  record: ToolCallRecord,
): typeof toolCalls.$inferInsert {
  return {
    id: record.id,
    orgId: record.orgId,
    workspaceId: record.workspaceId,
    agentId: record.agentId,
    actorId: record.actorId,
    toolId: record.toolId,
    status: record.status,
    riskLevel: record.riskLevel,
    approvalRequired: record.approvalRequired,
    inputKeys: record.inputKeys,
    outputKeys: record.outputKeys,
    errorCode: record.errorCode ?? null,
    runId: record.runId ?? null,
    startedAt: new Date(record.startedAt),
    completedAt: new Date(record.completedAt),
  };
}

function asRunStatus(value: string): RunStatusRecord {
  if (
    value === "cancelled" ||
    value === "completed" ||
    value === "failed" ||
    value === "queued" ||
    value === "running" ||
    value === "waiting_tool_approval"
  ) {
    return value;
  }
  return "failed";
}

// Exhaustive by construction: a new RunEventType without a key here now fails `pnpm check` instead
// of reading back as "run.failed", which ends replay early and closes the SSE stream mid-run. That
// is not hypothetical — "run.continuing" was persisted but missing from the previous hand-written
// allowlist, so every resume-after-tool event replayed as a terminal failure on Postgres.
const runEventTypes: Record<RunEventTypeRecord, true> = {
  "message.completed": true,
  "message.delta": true,
  "message.reasoning": true,
  "message.started": true,
  "retrieval.completed": true,
  "run.cancelled": true,
  "run.completed": true,
  "run.continuing": true,
  "run.failed": true,
  "run.started": true,
  "run.waiting_tool_approval": true,
  "run.waiting_tool_dispatch": true,
  "tool.requested": true,
  "tool.approval_required": true,
  "tool.completed": true,
  "tool.failed": true,
  "tool.started": true,
};

function asRunEventType(value: string): RunEventTypeRecord {
  return Object.hasOwn(runEventTypes, value)
    ? (value as RunEventTypeRecord)
    : "run.failed";
}

function asToolCallStatus(value: string): ToolCallStatusRecord {
  if (
    value === "approval_required" ||
    value === "blocked" ||
    value === "failure" ||
    value === "success"
  ) {
    return value;
  }
  return "failure";
}
