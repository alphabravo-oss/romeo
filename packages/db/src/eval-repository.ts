import { and, asc, desc, eq } from "drizzle-orm";

import type { RomeoDatabase } from "./client";
import {
  evalCases,
  evalResultHumanRatings,
  evalRunResults,
  evalRuns,
  evalSuites,
} from "./schema";
import { optionalIsoString, toIsoString } from "./repository-mapping";

export interface EvalSuiteRecord {
  id: string;
  orgId: string;
  workspaceId: string;
  agentId: string;
  name: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface EvalRubricRecord {
  mustContain?: string[];
  mustNotContain?: string[];
  minLength?: number;
  maxLength?: number;
  expectedToolCalls?: Array<{
    name: string;
    arguments?: Record<string, string | number | boolean | null>;
  }>;
  requiredCitations?: string[];
  [key: string]: unknown;
}

export interface EvalCaseRecord {
  id: string;
  orgId: string;
  suiteId: string;
  input: string;
  expectedContains?: string;
  rubric?: EvalRubricRecord;
  requiresCitation: boolean;
  createdAt: string;
}

export interface EvalRunRecord {
  id: string;
  orgId: string;
  workspaceId: string;
  agentId: string;
  suiteId: string;
  modelId: string;
  status: "failed" | "passed";
  score: number;
  createdBy: string;
  createdAt: string;
  completedAt: string;
}

export interface EvalRunResultRecord {
  id: string;
  orgId: string;
  runId: string;
  caseId: string;
  status: "failed" | "passed";
  score: number;
  output: string;
  checks: Record<string, unknown>;
  createdAt: string;
}

export type EvalResultHumanRatingValueRecord = "fail" | "neutral" | "pass";

export interface EvalResultHumanRatingRecord {
  id: string;
  orgId: string;
  runId: string;
  resultId: string;
  reviewerId: string;
  rating: EvalResultHumanRatingValueRecord;
  comment?: string;
  createdAt: string;
  updatedAt: string;
}

export class PgEvalRepository {
  constructor(private readonly db: RomeoDatabase) {}

  async listEvalSuites(agentId: string): Promise<EvalSuiteRecord[]> {
    const rows = await this.db
      .select()
      .from(evalSuites)
      .where(eq(evalSuites.agentId, agentId))
      .orderBy(desc(evalSuites.createdAt));
    return rows.map(toEvalSuiteRecord);
  }

  async getEvalSuite(suiteId: string): Promise<EvalSuiteRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(evalSuites)
      .where(eq(evalSuites.id, suiteId))
      .limit(1);
    return row === undefined ? undefined : toEvalSuiteRecord(row);
  }

  async createEvalSuite(suite: EvalSuiteRecord): Promise<EvalSuiteRecord> {
    const [row] = await this.db
      .insert(evalSuites)
      .values(toEvalSuiteInsert(suite))
      .returning();
    return row === undefined ? suite : toEvalSuiteRecord(row);
  }

  async listEvalCases(suiteId: string): Promise<EvalCaseRecord[]> {
    const rows = await this.db
      .select()
      .from(evalCases)
      .where(eq(evalCases.suiteId, suiteId))
      .orderBy(asc(evalCases.createdAt), asc(evalCases.id));
    return rows.map(toEvalCaseRecord);
  }

  async createEvalCases(cases: EvalCaseRecord[]): Promise<EvalCaseRecord[]> {
    if (cases.length === 0) return [];
    const rows = await this.db
      .insert(evalCases)
      .values(cases.map(toEvalCaseInsert))
      .returning();
    return rows.map(toEvalCaseRecord);
  }

  async listEvalRuns(agentId: string): Promise<EvalRunRecord[]> {
    const rows = await this.db
      .select()
      .from(evalRuns)
      .where(eq(evalRuns.agentId, agentId))
      .orderBy(desc(evalRuns.createdAt));
    return rows.map(toEvalRunRecord);
  }

  async getEvalRun(runId: string): Promise<EvalRunRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(evalRuns)
      .where(eq(evalRuns.id, runId))
      .limit(1);
    return row === undefined ? undefined : toEvalRunRecord(row);
  }

  async createEvalRun(run: EvalRunRecord): Promise<EvalRunRecord> {
    const [row] = await this.db
      .insert(evalRuns)
      .values(toEvalRunInsert(run))
      .returning();
    return row === undefined ? run : toEvalRunRecord(row);
  }

  async getEvalRunResult(
    resultId: string,
  ): Promise<EvalRunResultRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(evalRunResults)
      .where(eq(evalRunResults.id, resultId))
      .limit(1);
    return row === undefined ? undefined : toEvalRunResultRecord(row);
  }

  async listEvalRunResults(runId: string): Promise<EvalRunResultRecord[]> {
    const rows = await this.db
      .select()
      .from(evalRunResults)
      .where(eq(evalRunResults.runId, runId))
      .orderBy(asc(evalRunResults.createdAt), asc(evalRunResults.id));
    return rows.map(toEvalRunResultRecord);
  }

  async createEvalRunResults(
    results: EvalRunResultRecord[],
  ): Promise<EvalRunResultRecord[]> {
    if (results.length === 0) return [];
    const rows = await this.db
      .insert(evalRunResults)
      .values(results.map(toEvalRunResultInsert))
      .returning();
    return rows.map(toEvalRunResultRecord);
  }

  async listEvalResultHumanRatings(
    runId: string,
  ): Promise<EvalResultHumanRatingRecord[]> {
    const rows = await this.db
      .select()
      .from(evalResultHumanRatings)
      .where(eq(evalResultHumanRatings.runId, runId))
      .orderBy(desc(evalResultHumanRatings.updatedAt));
    return rows.map(toEvalResultHumanRatingRecord);
  }

  async getEvalResultHumanRating(
    resultId: string,
    reviewerId: string,
  ): Promise<EvalResultHumanRatingRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(evalResultHumanRatings)
      .where(
        and(
          eq(evalResultHumanRatings.resultId, resultId),
          eq(evalResultHumanRatings.reviewerId, reviewerId),
        ),
      )
      .limit(1);
    return row === undefined ? undefined : toEvalResultHumanRatingRecord(row);
  }

  async upsertEvalResultHumanRating(
    rating: EvalResultHumanRatingRecord,
  ): Promise<EvalResultHumanRatingRecord> {
    const [row] = await this.db
      .insert(evalResultHumanRatings)
      .values(toEvalResultHumanRatingInsert(rating))
      .onConflictDoUpdate({
        target: [
          evalResultHumanRatings.resultId,
          evalResultHumanRatings.reviewerId,
        ],
        set: {
          comment: rating.comment ?? null,
          id: rating.id,
          orgId: rating.orgId,
          rating: rating.rating,
          runId: rating.runId,
          updatedAt: new Date(rating.updatedAt),
        },
      })
      .returning();
    return row === undefined ? rating : toEvalResultHumanRatingRecord(row);
  }
}

export function toEvalSuiteRecord(
  row: typeof evalSuites.$inferSelect,
): EvalSuiteRecord {
  return {
    id: row.id,
    orgId: row.orgId,
    workspaceId: row.workspaceId,
    agentId: row.agentId,
    name: row.name,
    createdBy: row.createdBy,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
}

export function toEvalCaseRecord(
  row: typeof evalCases.$inferSelect,
): EvalCaseRecord {
  const evalCase: EvalCaseRecord = {
    id: row.id,
    orgId: row.orgId,
    suiteId: row.suiteId,
    input: row.input,
    requiresCitation: row.requiresCitation,
    createdAt: toIsoString(row.createdAt),
  };
  const expectedContains = optionalIsoString(row.expectedContains);
  if (expectedContains !== undefined)
    evalCase.expectedContains = expectedContains;
  const rubric = asEvalRubric(row.rubric);
  if (rubric !== undefined) evalCase.rubric = rubric;
  return evalCase;
}

export function toEvalRunRecord(
  row: typeof evalRuns.$inferSelect,
): EvalRunRecord {
  return {
    id: row.id,
    orgId: row.orgId,
    workspaceId: row.workspaceId,
    agentId: row.agentId,
    suiteId: row.suiteId,
    modelId: row.modelId,
    status: row.status === "passed" ? "passed" : "failed",
    score: row.score,
    createdBy: row.createdBy,
    createdAt: toIsoString(row.createdAt),
    completedAt: toIsoString(row.completedAt),
  };
}

export function toEvalRunResultRecord(
  row: typeof evalRunResults.$inferSelect,
): EvalRunResultRecord {
  return {
    id: row.id,
    orgId: row.orgId,
    runId: row.runId,
    caseId: row.caseId,
    status: row.status === "passed" ? "passed" : "failed",
    score: row.score,
    output: row.output,
    checks: asJsonRecord(row.checks),
    createdAt: toIsoString(row.createdAt),
  };
}

export function toEvalResultHumanRatingRecord(
  row: typeof evalResultHumanRatings.$inferSelect,
): EvalResultHumanRatingRecord {
  const rating: EvalResultHumanRatingRecord = {
    id: row.id,
    orgId: row.orgId,
    runId: row.runId,
    resultId: row.resultId,
    reviewerId: row.reviewerId,
    rating: asHumanRating(row.rating),
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
  const comment = optionalIsoString(row.comment);
  if (comment !== undefined) rating.comment = comment;
  return rating;
}

function toEvalSuiteInsert(
  record: EvalSuiteRecord,
): typeof evalSuites.$inferInsert {
  return {
    id: record.id,
    orgId: record.orgId,
    workspaceId: record.workspaceId,
    agentId: record.agentId,
    name: record.name,
    createdBy: record.createdBy,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
  };
}

function toEvalCaseInsert(
  record: EvalCaseRecord,
): typeof evalCases.$inferInsert {
  return {
    id: record.id,
    orgId: record.orgId,
    suiteId: record.suiteId,
    input: record.input,
    expectedContains: record.expectedContains ?? null,
    rubric: record.rubric,
    requiresCitation: record.requiresCitation,
    createdAt: new Date(record.createdAt),
  };
}

function toEvalRunInsert(record: EvalRunRecord): typeof evalRuns.$inferInsert {
  return {
    id: record.id,
    orgId: record.orgId,
    workspaceId: record.workspaceId,
    agentId: record.agentId,
    suiteId: record.suiteId,
    modelId: record.modelId,
    status: record.status,
    score: record.score,
    createdBy: record.createdBy,
    createdAt: new Date(record.createdAt),
    completedAt: new Date(record.completedAt),
  };
}

function toEvalRunResultInsert(
  record: EvalRunResultRecord,
): typeof evalRunResults.$inferInsert {
  return {
    id: record.id,
    orgId: record.orgId,
    runId: record.runId,
    caseId: record.caseId,
    status: record.status,
    score: record.score,
    output: record.output,
    checks: record.checks,
    createdAt: new Date(record.createdAt),
  };
}

function toEvalResultHumanRatingInsert(
  record: EvalResultHumanRatingRecord,
): typeof evalResultHumanRatings.$inferInsert {
  return {
    id: record.id,
    orgId: record.orgId,
    runId: record.runId,
    resultId: record.resultId,
    reviewerId: record.reviewerId,
    rating: record.rating,
    comment: record.comment ?? null,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
  };
}

function asEvalRubric(value: unknown): EvalRubricRecord | undefined {
  const input = asJsonRecord(value);
  if (Object.keys(input).length === 0) return undefined;
  const rubric: EvalRubricRecord = {};
  const mustContain = asStringArray(input.mustContain);
  if (mustContain.length > 0) rubric.mustContain = mustContain;
  const mustNotContain = asStringArray(input.mustNotContain);
  if (mustNotContain.length > 0) rubric.mustNotContain = mustNotContain;
  if (typeof input.minLength === "number") rubric.minLength = input.minLength;
  if (typeof input.maxLength === "number") rubric.maxLength = input.maxLength;
  const expectedToolCalls = asExpectedToolCalls(input.expectedToolCalls);
  if (expectedToolCalls.length > 0)
    rubric.expectedToolCalls = expectedToolCalls;
  const requiredCitations = asStringArray(input.requiredCitations);
  if (requiredCitations.length > 0)
    rubric.requiredCitations = requiredCitations;
  return rubric;
}

function asExpectedToolCalls(value: unknown): Array<{
  name: string;
  arguments?: Record<string, string | number | boolean | null>;
}> {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const input = asJsonRecord(item);
      if (typeof input.name !== "string") return undefined;
      const call: {
        name: string;
        arguments?: Record<string, string | number | boolean | null>;
      } = { name: input.name };
      const args = asPrimitiveRecord(input.arguments);
      if (Object.keys(args).length > 0) call.arguments = args;
      return call;
    })
    .filter(
      (
        item,
      ): item is {
        name: string;
        arguments?: Record<string, string | number | boolean | null>;
      } => item !== undefined,
    );
}

function asHumanRating(value: string): EvalResultHumanRatingValueRecord {
  if (value === "fail" || value === "neutral" || value === "pass") return value;
  return "neutral";
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function asPrimitiveRecord(
  value: unknown,
): Record<string, string | number | boolean | null> {
  const input = asJsonRecord(value);
  return Object.fromEntries(
    Object.entries(input).filter(
      (entry): entry is [string, string | number | boolean | null] =>
        typeof entry[1] === "string" ||
        typeof entry[1] === "number" ||
        typeof entry[1] === "boolean" ||
        entry[1] === null,
    ),
  );
}

function asJsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return {};
  return value as Record<string, unknown>;
}
