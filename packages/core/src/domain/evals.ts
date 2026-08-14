export interface EvalSuite {
  id: string;
  orgId: string;
  workspaceId: string;
  agentId: string;
  name: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface EvalCase {
  id: string;
  orgId: string;
  suiteId: string;
  input: string;
  expectedContains?: string;
  rubric?: EvalRubric;
  requiresCitation: boolean;
  createdAt: string;
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
  reasoningPolicy?: EvalReasoningPolicyEvidence;
  metrics?: EvalRunMetrics;
}

export interface EvalReasoningPolicyEvidence {
  requested: ProviderReasoningPolicy;
  effective: ProviderReasoningPolicy;
}

export interface EvalRunMetrics {
  latencyMs: number;
  usage: {
    coverage: "complete" | "partial" | "none";
    inputTokens?: number;
    outputTokens?: number;
    reasoningTokens?: number;
    source?:
      | "anthropic"
      | "ollama"
      | "openai-compatible"
      | "openai-responses-compatible";
  };
  costBasis: "reported_tokens" | "unavailable";
  estimatedCostUsd?: number;
}

export interface EvalReasoningComparison {
  suiteId: string;
  generatedAt: string;
  variants: Array<{
    modelId: string;
    requested: ProviderReasoningPolicy;
    effective: ProviderReasoningPolicy;
    runCount: number;
    averageScore: number;
    averageLatencyMs: number;
    reportedInputTokens: number | null;
    reportedOutputTokens: number | null;
    reportedReasoningTokens: number | null;
    estimatedCostUsd: number | null;
    trend: Array<{
      runId: string;
      score: number;
      latencyMs: number;
      completedAt: string;
    }>;
  }>;
}

export interface EvalRunResult {
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

export type EvalResultHumanRatingValue = "fail" | "neutral" | "pass";

export interface EvalResultHumanRating {
  id: string;
  orgId: string;
  runId: string;
  resultId: string;
  reviewerId: string;
  rating: EvalResultHumanRatingValue;
  comment?: string | undefined;
  createdAt: string;
  updatedAt: string;
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
  reasoningPolicy?: EvalReasoningPolicyEvidence;
  metrics?: EvalRunMetrics;
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

export interface EvalReleaseCandidateSuiteEvidence {
  suiteId: string;
  name: string;
  latestRunId: string | null;
  status: "failed" | "missing" | "passed";
  score: number | null;
  completedAt: string | null;
  caseCount: number;
  resultCount: number;
  passedResultCount: number;
  failedResultCount: number;
  requirementCounts: {
    expectedContainsCases: number;
    citationRequiredCases: number;
    rubricCases: number;
    toolExpectationCases: number;
    expectedToolCallCases: number;
    expectedToolOutcomeCases: number;
  };
  toolEvaluation: {
    expectedToolCalls: {
      total: number;
      passed: number;
      failed: number;
    };
    expectedToolOutcomes: {
      total: number;
      passed: number;
      failed: number;
    };
    failedToolExpectationCaseCount: number;
  };
  humanRatingCounts: {
    pass: number;
    neutral: number;
    fail: number;
    total: number;
  };
}

export interface EvalReleaseCandidateEvidence {
  schema: "romeo.eval-release-candidate-evidence.v1";
  orgId: string;
  workspaceId: string;
  agentId: string;
  generatedAt: string;
  candidate: {
    baseModelId: string;
    draftUpdatedAt: string;
    publishedVersionId?: string;
  };
  gate: {
    status: "failed" | "missing" | "not_required" | "passed";
    publishBlocked: boolean;
    reasonCodes: string[];
    suiteCount: number;
    passedSuiteCount: number;
    failedSuiteCount: number;
    missingSuiteCount: number;
    averageScore: number | null;
    evaluatedAt: string | null;
  };
  suites: EvalReleaseCandidateSuiteEvidence[];
  redaction: {
    rawEvalInputsReturned: false;
    rawEvalOutputsReturned: false;
    rawHumanRatingCommentsReturned: false;
    rawRubricTermsReturned: false;
    rawToolArgumentsReturned: false;
    rawToolNamesReturned: false;
    rawToolOutputKeysReturned: false;
    rawToolResultBodiesReturned: false;
  };
}
import type { ProviderReasoningPolicy } from "@romeo/providers";
