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
