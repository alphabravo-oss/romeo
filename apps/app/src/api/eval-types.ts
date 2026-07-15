export interface EvalSuite {
  id: string;
  agentId: string;
  name: string;
  createdAt: string;
}

export interface EvalCase {
  id: string;
  suiteId: string;
  input: string;
  expectedContains?: string;
  rubric?: EvalRubric;
  requiresCitation: boolean;
}

export interface EvalRubric {
  mustContain?: string[] | undefined;
  mustNotContain?: string[] | undefined;
  minLength?: number | undefined;
  maxLength?: number | undefined;
  expectedToolCalls?: EvalToolCallExpectation[] | undefined;
  expectedToolOutcomes?: EvalToolOutcomeExpectation[] | undefined;
  requiredCitations?: string[] | undefined;
}

export interface EvalToolCallExpectation {
  name: string;
  arguments?: Record<string, string | number | boolean | null> | undefined;
}

export interface EvalToolOutcomeExpectation {
  name: string;
  status?: "failure" | "success" | undefined;
  outputKeys?: string[] | undefined;
  errorCode?: string | undefined;
}

export interface EvalRun {
  id: string;
  agentId: string;
  suiteId: string;
  modelId: string;
  status: "failed" | "passed";
  score: number;
  completedAt: string;
}

export interface EvalRunResult {
  id: string;
  runId: string;
  caseId: string;
  status: "failed" | "passed";
  score: number;
  output: string;
  checks: Record<string, unknown>;
}

export type EvalResultHumanRatingValue = "fail" | "neutral" | "pass";

export interface EvalResultHumanRating {
  id: string;
  runId: string;
  resultId: string;
  reviewerId: string;
  rating: EvalResultHumanRatingValue;
  comment?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EvalModelComparisonItem {
  modelId: string;
  runId: string;
  status: EvalRun["status"];
  score: number;
  resultCount: number;
  passedResultCount: number;
  failedResultCount: number;
}

export interface EvalModelComparison {
  suiteId: string;
  comparedAt: string;
  comparisons: EvalModelComparisonItem[];
}

export interface EvalDashboardSuiteSummary {
  suiteId: string;
  name: string;
  latestRunId: string | null;
  status: "failed" | "missing" | "passed";
  score: number | null;
  completedAt: string | null;
  runCount: number;
}

export interface EvalDashboardRunPoint {
  runId: string;
  suiteId: string;
  modelId: string;
  status: EvalRun["status"];
  score: number;
  completedAt: string;
}

export interface EvalDashboard {
  agentId: string;
  generatedAt: string;
  status: "failed" | "missing" | "not_required" | "passed";
  suiteCount: number;
  runCount: number;
  averageLatestScore: number | null;
  suites: EvalDashboardSuiteSummary[];
  trend: EvalDashboardRunPoint[];
}

export interface CreatedEvalSuite {
  suite: EvalSuite;
  cases: EvalCase[];
}

export interface EvalRunWithResults {
  run: EvalRun;
  results: EvalRunResult[];
}
