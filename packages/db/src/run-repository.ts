import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  lte,
  notInArray,
  or,
  sql,
} from "drizzle-orm";

import type { RomeoDatabase } from "./client";
import { awaitCancellableQuery } from "./cancellable-query";
import {
  normalizeRunEvent,
  type RunEventTypeRecord,
} from "./run-event-record-mapping";
import { chats, runEvents, runs, toolCalls } from "./schema";
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

export type { RunEventTypeRecord } from "./run-event-record-mapping";

export interface RunEventRecord<TData = unknown> {
  id: string;
  runId: string;
  sequence: number;
  schemaVersion?: 1;
  type: RunEventTypeRecord;
  data: TData;
  createdAt: string;
}

interface RunEventPageRow {
  id: string;
  runId: string;
  sequence: string;
  type: string;
  data: unknown;
  createdAt: Date | string;
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
    const maxByRun = new Map<string, number>();
    for (const event of events) {
      maxByRun.set(
        event.runId,
        Math.max(maxByRun.get(event.runId) ?? 0, event.sequence),
      );
    }
    for (const [runId, sequence] of maxByRun) {
      await this.db
        .update(runs)
        .set({
          nextEventSequence: sql`greatest(${runs.nextEventSequence}, ${sequence})`,
        })
        .where(eq(runs.id, runId));
    }
  }

  async allocateRunEventSequence(runId: string): Promise<number | undefined> {
    const [row] = await this.db
      .update(runs)
      .set({ nextEventSequence: sql`${runs.nextEventSequence} + 1` })
      .where(eq(runs.id, runId))
      .returning({ sequence: runs.nextEventSequence });
    return row?.sequence;
  }

  async listRunEventsAfter(
    runId: string,
    afterSequence: number,
    limit: number,
    signal?: AbortSignal,
  ): Promise<RunEventRecord[]> {
    const rows = await awaitCancellableQuery(
      this.db.$client<RunEventPageRow[]>`
        select
          id,
          run_id as "runId",
          sequence::text as sequence,
          type,
          data,
          created_at as "createdAt"
        from run_events
        where run_id = ${runId}
          and sequence > ${afterSequence}
        order by sequence asc
        limit ${Math.max(1, limit)}
      `,
      signal,
    );
    return rows.map(toRunEventPageRecord);
  }

  async listRunEvents(runId: string): Promise<RunEventRecord[]> {
    const rows = await this.db
      .select()
      .from(runEvents)
      .where(eq(runEvents.runId, runId))
      .orderBy(asc(runEvents.sequence));
    return rows.map(toRunEventRecord);
  }

  async deleteCompactedRunEventsBefore(
    orgId: string,
    before: string,
    now: string,
    limit: number,
  ): Promise<number> {
    const candidates = await this.db
      .select({ id: runEvents.id })
      .from(runEvents)
      .innerJoin(runs, eq(runs.id, runEvents.runId))
      .innerJoin(chats, eq(chats.id, runs.chatId))
      .where(
        and(
          eq(runs.orgId, orgId),
          inArray(runs.status, ["cancelled", "completed", "failed"]),
          lt(runs.completedAt, new Date(before)),
          sql`${runEvents.sequence} < (
            SELECT MAX("latest_run_event"."sequence")
            FROM "run_events" AS "latest_run_event"
            WHERE "latest_run_event"."run_id" = ${runEvents.runId}
          )`,
          or(
            isNull(chats.legalHoldUntil),
            lte(chats.legalHoldUntil, new Date(now)),
          ),
        ),
      )
      .orderBy(asc(runEvents.createdAt), asc(runEvents.id))
      .limit(Math.max(1, limit));
    if (candidates.length === 0) return 0;
    const deleted = await this.db
      .delete(runEvents)
      .where(
        inArray(
          runEvents.id,
          candidates.map((candidate) => candidate.id),
        ),
      )
      .returning({ id: runEvents.id });
    return deleted.length;
  }

  async listToolCalls(orgId: string): Promise<ToolCallRecord[]> {
    const rows = await this.db
      .select()
      .from(toolCalls)
      .where(eq(toolCalls.orgId, orgId))
      .orderBy(desc(toolCalls.startedAt), asc(toolCalls.id));
    return rows.map(toToolCallRecord);
  }

  async listToolCallsForRun(
    orgId: string,
    workspaceId: string,
    runId: string,
    limit: number,
  ): Promise<ToolCallRecord[]> {
    const rows = await this.db
      .select()
      .from(toolCalls)
      .where(
        and(
          eq(toolCalls.orgId, orgId),
          eq(toolCalls.workspaceId, workspaceId),
          eq(toolCalls.runId, runId),
        ),
      )
      .orderBy(asc(toolCalls.startedAt), asc(toolCalls.id))
      .limit(Math.max(1, limit));
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
  const event = normalizeRunEvent(row.type, row.data);
  return {
    id: row.id,
    runId: row.runId,
    sequence: row.sequence,
    schemaVersion: 1,
    type: event.type,
    data: event.data,
    createdAt: toIsoString(row.createdAt),
  };
}

function toRunEventPageRecord(row: RunEventPageRow): RunEventRecord {
  const sequence = Number(row.sequence);
  if (!Number.isSafeInteger(sequence) || sequence < 1)
    throw new Error("Run event sequence is invalid.");
  const event = normalizeRunEvent(row.type, row.data);
  return {
    id: row.id,
    runId: row.runId,
    sequence,
    schemaVersion: 1,
    type: event.type,
    data: event.data,
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
    nextEventSequence: 0,
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
