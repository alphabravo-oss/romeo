import type { AuthSubject } from "@romeo/auth";

import type {
  EvalCase,
  EvalReleaseCandidateEvidence,
  EvalReleaseCandidateSuiteEvidence,
  EvalResultHumanRating,
  EvalRun,
  EvalRunResult,
  EvalSuite,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { getAuthorizedAgent } from "./agent-access";

export async function buildEvalReleaseCandidateEvidence(
  repository: RomeoRepository,
  subject: AuthSubject,
  agentId: string,
): Promise<EvalReleaseCandidateEvidence> {
  const agent = await getAuthorizedAgent(repository, {
    agentId,
    subject,
    scope: "agents:read",
  });
  const [suites, runs] = await Promise.all([
    repository.listEvalSuites(agent.id),
    repository.listEvalRuns(agent.id),
  ]);
  const suiteEvidence = await Promise.all(
    suites.map(async (suite) => {
      const latestRun = latestRunForSuite(suite.id, runs);
      const [cases, results, ratings] = await Promise.all([
        repository.listEvalCases(suite.id),
        latestRun === undefined
          ? Promise.resolve([])
          : repository.listEvalRunResults(latestRun.id),
        latestRun === undefined
          ? Promise.resolve([])
          : repository.listEvalResultHumanRatings(latestRun.id),
      ]);
      return buildSuiteEvidence({ suite, cases, latestRun, results, ratings });
    }),
  );
  return {
    schema: "romeo.eval-release-candidate-evidence.v1",
    orgId: agent.orgId,
    workspaceId: agent.workspaceId,
    agentId: agent.id,
    generatedAt: new Date().toISOString(),
    candidate: {
      baseModelId: agent.baseModelId,
      draftUpdatedAt: agent.updatedAt,
      ...(agent.publishedVersionId === undefined
        ? {}
        : { publishedVersionId: agent.publishedVersionId }),
    },
    gate: releaseCandidateGate(suiteEvidence),
    suites: suiteEvidence,
    redaction: {
      rawEvalInputsReturned: false,
      rawEvalOutputsReturned: false,
      rawHumanRatingCommentsReturned: false,
      rawRubricTermsReturned: false,
      rawToolArgumentsReturned: false,
      rawToolNamesReturned: false,
      rawToolOutputKeysReturned: false,
      rawToolResultBodiesReturned: false,
    },
  };
}

function latestRunForSuite(
  suiteId: string,
  runs: EvalRun[],
): EvalRun | undefined {
  return runs
    .filter((run) => run.suiteId === suiteId)
    .sort((left, right) =>
      right.completedAt.localeCompare(left.completedAt),
    )[0];
}

function buildSuiteEvidence(input: {
  suite: EvalSuite;
  cases: EvalCase[];
  latestRun: EvalRun | undefined;
  results: EvalRunResult[];
  ratings: EvalResultHumanRating[];
}): EvalReleaseCandidateSuiteEvidence {
  const passedResultCount = input.results.filter(
    (result) => result.status === "passed",
  ).length;
  const failedResultCount = input.results.filter(
    (result) => result.status === "failed",
  ).length;
  return {
    suiteId: input.suite.id,
    name: input.suite.name,
    latestRunId: input.latestRun?.id ?? null,
    status: input.latestRun?.status ?? "missing",
    score: input.latestRun?.score ?? null,
    completedAt: input.latestRun?.completedAt ?? null,
    caseCount: input.cases.length,
    resultCount: input.results.length,
    passedResultCount,
    failedResultCount,
    requirementCounts: {
      expectedContainsCases: input.cases.filter(
        (testCase) => testCase.expectedContains !== undefined,
      ).length,
      citationRequiredCases: input.cases.filter(
        (testCase) => testCase.requiresCitation,
      ).length,
      rubricCases: input.cases.filter(
        (testCase) => testCase.rubric !== undefined,
      ).length,
      toolExpectationCases: input.cases.filter(hasToolExpectation).length,
      expectedToolCallCases: input.cases.filter(hasExpectedToolCalls).length,
      expectedToolOutcomeCases: input.cases.filter(hasExpectedToolOutcomes)
        .length,
    },
    toolEvaluation: toolEvaluationSummary(input.results),
    humanRatingCounts: humanRatingCounts(input.ratings),
  };
}

function releaseCandidateGate(
  suites: EvalReleaseCandidateSuiteEvidence[],
): EvalReleaseCandidateEvidence["gate"] {
  if (suites.length === 0) {
    return {
      status: "not_required",
      publishBlocked: false,
      reasonCodes: [],
      suiteCount: 0,
      passedSuiteCount: 0,
      failedSuiteCount: 0,
      missingSuiteCount: 0,
      averageScore: null,
      evaluatedAt: null,
    };
  }
  const passedSuiteCount = suites.filter(
    (suite) => suite.status === "passed",
  ).length;
  const failedSuiteCount = suites.filter(
    (suite) => suite.status === "failed",
  ).length;
  const missingSuiteCount = suites.filter(
    (suite) => suite.status === "missing",
  ).length;
  const completed = suites.filter((suite) => suite.score !== null);
  const evaluatedAt = suites
    .map((suite) => suite.completedAt)
    .filter((completedAt): completedAt is string => completedAt !== null)
    .sort()
    .at(-1);
  const status =
    missingSuiteCount > 0
      ? "missing"
      : failedSuiteCount > 0
        ? "failed"
        : "passed";
  return {
    status,
    publishBlocked: status !== "passed",
    reasonCodes: [
      ...(missingSuiteCount > 0 ? ["eval_suite_missing_run"] : []),
      ...(failedSuiteCount > 0 ? ["eval_suite_failed"] : []),
    ],
    suiteCount: suites.length,
    passedSuiteCount,
    failedSuiteCount,
    missingSuiteCount,
    averageScore:
      completed.length === 0
        ? null
        : completed.reduce((total, suite) => total + (suite.score ?? 0), 0) /
          completed.length,
    evaluatedAt: evaluatedAt ?? null,
  };
}

function humanRatingCounts(
  ratings: EvalResultHumanRating[],
): EvalReleaseCandidateSuiteEvidence["humanRatingCounts"] {
  return {
    pass: ratings.filter((rating) => rating.rating === "pass").length,
    neutral: ratings.filter((rating) => rating.rating === "neutral").length,
    fail: ratings.filter((rating) => rating.rating === "fail").length,
    total: ratings.length,
  };
}

function hasToolExpectation(testCase: EvalCase): boolean {
  return hasExpectedToolCalls(testCase) || hasExpectedToolOutcomes(testCase);
}

function hasExpectedToolCalls(testCase: EvalCase): boolean {
  return (testCase.rubric?.expectedToolCalls?.length ?? 0) > 0;
}

function hasExpectedToolOutcomes(testCase: EvalCase): boolean {
  return (testCase.rubric?.expectedToolOutcomes?.length ?? 0) > 0;
}

function toolEvaluationSummary(
  results: EvalRunResult[],
): EvalReleaseCandidateSuiteEvidence["toolEvaluation"] {
  const expectedToolCalls = summarizeToolChecks(results, "expectedToolCalls");
  const expectedToolOutcomes = summarizeToolChecks(
    results,
    "expectedToolOutcomes",
  );
  return {
    expectedToolCalls,
    expectedToolOutcomes,
    failedToolExpectationCaseCount: results.filter(hasFailedToolExpectation)
      .length,
  };
}

function summarizeToolChecks(
  results: EvalRunResult[],
  field: "expectedToolCalls" | "expectedToolOutcomes",
): EvalReleaseCandidateSuiteEvidence["toolEvaluation"]["expectedToolCalls"] {
  const checks = results.flatMap((result) => rubricCheckItems(result, field));
  const passed = checks.filter((check) => check.passed).length;
  return { total: checks.length, passed, failed: checks.length - passed };
}

function hasFailedToolExpectation(result: EvalRunResult): boolean {
  return (
    rubricCheckItems(result, "expectedToolCalls").some(
      (check) => !check.passed,
    ) ||
    rubricCheckItems(result, "expectedToolOutcomes").some(
      (check) => !check.passed,
    )
  );
}

function rubricCheckItems(
  result: EvalRunResult,
  field: "expectedToolCalls" | "expectedToolOutcomes",
): Array<{ passed: boolean }> {
  const rubric =
    typeof result.checks.rubric === "object" && result.checks.rubric !== null
      ? (result.checks.rubric as Record<string, unknown>)
      : {};
  const checks = rubric[field];
  if (!Array.isArray(checks)) return [];
  return checks.flatMap((check) => {
    if (typeof check !== "object" || check === null) return [];
    const passed = (check as Record<string, unknown>).passed;
    return typeof passed === "boolean" ? [{ passed }] : [];
  });
}
