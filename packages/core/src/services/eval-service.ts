import {
  AuthorizationError,
  assertScope,
  canAccessOrg,
  hasGrant,
  type AuthSubject,
} from "@romeo/auth";
import { getProviderAdapter } from "@romeo/providers";

import type {
  BaseModel,
  EvalCase,
  EvalDashboard,
  EvalModelComparison,
  EvalReleaseCandidateEvidence,
  EvalReleaseCandidateSuiteEvidence,
  EvalResultHumanRating,
  EvalResultHumanRatingValue,
  EvalRubric,
  EvalRun,
  EvalRunResult,
  EvalSuite,
  EvalToolCallExpectation,
  EvalToolOutcomeExpectation,
  ProviderInstance,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { createId } from "../ids";
import { assertAbuseControlsAllow } from "./abuse-control-service";
import { getAuthorizedAgent } from "./agent-access";
import { writeAuditLog } from "./audit-log";
import { consumeQuota } from "./consume-quota";
import type { QuotaCoordinator } from "./quota-coordination";
import type { SecretResolver } from "./secret-resolver";
import { persistedSubjectActorId } from "./subject-persisted-actor";
import type { WebhookEmitter } from "./webhook-service";

export interface CreatedEvalSuite {
  suite: EvalSuite;
  cases: EvalCase[];
}

export class EvalService {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly options: {
      providerFetch?: typeof fetch;
      quotaCoordinator?: QuotaCoordinator;
      secretResolver?: SecretResolver;
      webhooks?: WebhookEmitter;
    } = {},
  ) {}

  async listSuites(
    subject: AuthSubject,
    agentId: string,
  ): Promise<EvalSuite[]> {
    await getAuthorizedAgent(this.repository, {
      agentId,
      subject,
      scope: "agents:read",
    });
    return this.repository.listEvalSuites(agentId);
  }

  async createSuite(input: {
    subject: AuthSubject;
    agentId: string;
    name: string;
    cases: Array<{
      input: string;
      expectedContains?: string;
      requiresCitation?: boolean;
      rubric?: EvalRubric;
    }>;
  }): Promise<CreatedEvalSuite> {
    const agent = await getAuthorizedAgent(this.repository, {
      agentId: input.agentId,
      subject: input.subject,
      scope: "agents:write",
    });
    if (input.cases.length === 0)
      throw new ApiError(
        "invalid_eval_suite",
        "Eval suite requires at least one case.",
        400,
      );
    const now = new Date().toISOString();
    return this.repository.transaction(async (repository) => {
      const createdBy = await persistedSubjectActorId(
        repository,
        input.subject,
        {
          kind: "service_account_eval_owner",
          name: "Service Account Eval Owner",
        },
      );
      const suite = await repository.createEvalSuite({
        id: createId("eval_suite"),
        orgId: agent.orgId,
        workspaceId: agent.workspaceId,
        agentId: agent.id,
        name: input.name,
        createdBy,
        createdAt: now,
        updatedAt: now,
      });
      const cases = await repository.createEvalCases(
        input.cases.map((testCase) => ({
          id: createId("eval_case"),
          orgId: agent.orgId,
          suiteId: suite.id,
          input: testCase.input,
          ...(testCase.expectedContains !== undefined
            ? { expectedContains: testCase.expectedContains }
            : {}),
          ...(testCase.rubric !== undefined
            ? { rubric: normalizeRubric(testCase.rubric) }
            : {}),
          requiresCitation: testCase.requiresCitation ?? false,
          createdAt: now,
        })),
      );
      await this.audit(
        repository,
        input.subject,
        "eval.suite.create",
        suite.id,
        {
          agentId: agent.id,
          caseCount: cases.length,
        },
      );
      return { suite, cases };
    });
  }

  async listRuns(subject: AuthSubject, agentId: string): Promise<EvalRun[]> {
    await getAuthorizedAgent(this.repository, {
      agentId,
      subject,
      scope: "agents:read",
    });
    return this.repository.listEvalRuns(agentId);
  }

  async dashboard(
    subject: AuthSubject,
    agentId: string,
  ): Promise<EvalDashboard> {
    await getAuthorizedAgent(this.repository, {
      agentId,
      subject,
      scope: "agents:read",
    });
    const [suites, runs] = await Promise.all([
      this.repository.listEvalSuites(agentId),
      this.repository.listEvalRuns(agentId),
    ]);
    const suiteSummaries: EvalDashboard["suites"] = suites.map((suite) => {
      const suiteRuns = runs
        .filter((run) => run.suiteId === suite.id)
        .sort((left, right) =>
          right.completedAt.localeCompare(left.completedAt),
        );
      const latestRun = suiteRuns[0];
      return {
        suiteId: suite.id,
        name: suite.name,
        latestRunId: latestRun?.id ?? null,
        status: latestRun?.status ?? "missing",
        score: latestRun?.score ?? null,
        completedAt: latestRun?.completedAt ?? null,
        runCount: suiteRuns.length,
      };
    });
    const completedSuites = suiteSummaries.filter(
      (suite) => suite.score !== null,
    );
    const failedCount = suiteSummaries.filter(
      (suite) => suite.status === "failed",
    ).length;
    const missingCount = suiteSummaries.filter(
      (suite) => suite.status === "missing",
    ).length;

    return {
      agentId,
      generatedAt: new Date().toISOString(),
      status:
        suites.length === 0
          ? "not_required"
          : missingCount > 0
            ? "missing"
            : failedCount > 0
              ? "failed"
              : "passed",
      suiteCount: suites.length,
      runCount: runs.length,
      averageLatestScore:
        completedSuites.length === 0
          ? null
          : completedSuites.reduce(
              (total, suite) => total + (suite.score ?? 0),
              0,
            ) / completedSuites.length,
      suites: suiteSummaries,
      trend: [...runs]
        .sort((left, right) =>
          right.completedAt.localeCompare(left.completedAt),
        )
        .slice(0, 20)
        .map((run) => ({
          runId: run.id,
          suiteId: run.suiteId,
          modelId: run.modelId,
          status: run.status,
          score: run.score,
          completedAt: run.completedAt,
        }))
        .reverse(),
    };
  }

  async results(subject: AuthSubject, runId: string): Promise<EvalRunResult[]> {
    const run = await this.repository.getEvalRun(runId);
    if (!run) throw notFound("Eval run");
    await getAuthorizedAgent(this.repository, {
      agentId: run.agentId,
      subject,
      scope: "agents:read",
    });
    const results = await this.repository.listEvalRunResults(runId);
    return results;
  }

  async ratings(
    subject: AuthSubject,
    runId: string,
  ): Promise<EvalResultHumanRating[]> {
    const run = await this.repository.getEvalRun(runId);
    if (!run) throw notFound("Eval run");
    await getAuthorizedAgent(this.repository, {
      agentId: run.agentId,
      subject,
      scope: "agents:read",
    });
    return this.repository.listEvalResultHumanRatings(runId);
  }

  async rateResult(input: {
    subject: AuthSubject;
    resultId: string;
    rating: EvalResultHumanRatingValue;
    comment?: string;
  }): Promise<EvalResultHumanRating> {
    const result = await this.repository.getEvalRunResult(input.resultId);
    if (!result) throw notFound("Eval result");
    const run = await this.repository.getEvalRun(result.runId);
    if (!run) throw notFound("Eval run");
    await getAuthorizedAgent(this.repository, {
      agentId: run.agentId,
      subject: input.subject,
      scope: "agents:write",
    });
    const now = new Date().toISOString();
    return this.repository.transaction(async (repository) => {
      const existing = await repository.getEvalResultHumanRating(
        result.id,
        input.subject.id,
      );
      const rating = await repository.upsertEvalResultHumanRating({
        id: existing?.id ?? createId("eval_rating"),
        orgId: run.orgId,
        runId: run.id,
        resultId: result.id,
        reviewerId: input.subject.id,
        rating: input.rating,
        ...(input.comment === undefined ? {} : { comment: input.comment }),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
      await this.audit(
        repository,
        input.subject,
        "eval.result.rate",
        result.id,
        {
          runId: run.id,
          agentId: run.agentId,
          rating: input.rating,
          hasComment: input.comment !== undefined,
        },
      );
      return rating;
    });
  }

  async runSuite(input: {
    subject: AuthSubject;
    suiteId: string;
    modelId?: string;
  }): Promise<{ run: EvalRun; results: EvalRunResult[] }> {
    assertScope(input.subject, "agents:run");
    const suite = await this.getAuthorizedSuite(input.subject, input.suiteId);
    const agent = await getAuthorizedAgent(this.repository, {
      agentId: suite.agentId,
      subject: input.subject,
      scope: "agents:read",
    });
    const { model, provider } = await this.resolveModel(
      input.subject,
      input.modelId ?? agent.baseModelId,
    );
    const cases = await this.repository.listEvalCases(suite.id);
    if (cases.length === 0)
      throw new ApiError("eval_suite_empty", "Eval suite has no cases.", 409);
    await this.assertEvalRunAllowed(input.subject, agent, provider, cases);

    const resultDrafts: Array<Omit<EvalRunResult, "createdAt" | "runId">> = [];
    for (const testCase of cases) {
      const output = await this.generateOutput(
        provider,
        model,
        agent.systemPrompt,
        testCase.input,
      );
      resultDrafts.push(scoreCase(testCase, output, input.subject.orgId));
    }

    const averageScore =
      resultDrafts.reduce((total, result) => total + result.score, 0) /
      resultDrafts.length;
    const status: EvalRun["status"] = resultDrafts.every(
      (result) => result.status === "passed",
    )
      ? "passed"
      : "failed";
    const now = new Date().toISOString();
    return this.repository.transaction(async (repository) => {
      const createdBy = await persistedSubjectActorId(
        repository,
        input.subject,
        {
          kind: "service_account_eval_run",
          name: "Service Account Eval Run Actor",
        },
      );
      const run = await repository.createEvalRun({
        id: createId("eval_run"),
        orgId: agent.orgId,
        workspaceId: agent.workspaceId,
        agentId: agent.id,
        suiteId: suite.id,
        modelId: model.id,
        status,
        score: averageScore,
        createdBy,
        createdAt: now,
        completedAt: now,
      });
      const storedResults = await repository.createEvalRunResults(
        resultDrafts.map((result) => ({
          ...result,
          runId: run.id,
          createdAt: now,
        })),
      );
      await this.audit(repository, input.subject, "eval.run.complete", run.id, {
        agentId: agent.id,
        suiteId: suite.id,
        status,
        score: averageScore,
      });
      return { run, results: storedResults };
    });
  }

  async compareModels(input: {
    subject: AuthSubject;
    suiteId: string;
    modelIds: string[];
  }): Promise<EvalModelComparison> {
    const modelIds = [...new Set(input.modelIds)];
    if (modelIds.length < 2 || modelIds.length > 5)
      throw new ApiError(
        "invalid_eval_model_comparison",
        "Compare between 2 and 5 unique models.",
        400,
      );
    const comparisons: EvalModelComparison["comparisons"] = [];
    for (const modelId of modelIds) {
      const result = await this.runSuite({
        subject: input.subject,
        suiteId: input.suiteId,
        modelId,
      });
      comparisons.push({
        modelId,
        runId: result.run.id,
        status: result.run.status,
        score: result.run.score,
        resultCount: result.results.length,
        passedResultCount: result.results.filter(
          (item) => item.status === "passed",
        ).length,
        failedResultCount: result.results.filter(
          (item) => item.status === "failed",
        ).length,
      });
    }
    await this.audit(
      this.repository,
      input.subject,
      "eval.model_compare.complete",
      input.suiteId,
      {
        suiteId: input.suiteId,
        modelCount: comparisons.length,
        modelIds,
      },
    );
    return {
      suiteId: input.suiteId,
      comparedAt: new Date().toISOString(),
      comparisons,
    };
  }

  async releaseCandidateEvidence(
    subject: AuthSubject,
    agentId: string,
  ): Promise<EvalReleaseCandidateEvidence> {
    const agent = await getAuthorizedAgent(this.repository, {
      agentId,
      subject,
      scope: "agents:read",
    });
    const [suites, runs] = await Promise.all([
      this.repository.listEvalSuites(agent.id),
      this.repository.listEvalRuns(agent.id),
    ]);
    const suiteEvidence = await Promise.all(
      suites.map(async (suite) => {
        const latestRun = latestRunForSuite(suite.id, runs);
        const [cases, results, ratings] = await Promise.all([
          this.repository.listEvalCases(suite.id),
          latestRun === undefined
            ? Promise.resolve([])
            : this.repository.listEvalRunResults(latestRun.id),
          latestRun === undefined
            ? Promise.resolve([])
            : this.repository.listEvalResultHumanRatings(latestRun.id),
        ]);
        return buildReleaseCandidateSuiteEvidence({
          suite,
          cases,
          latestRun,
          results,
          ratings,
        });
      }),
    );
    const gate = releaseCandidateGate(suiteEvidence);
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
      gate,
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

  private async getAuthorizedSuite(
    subject: AuthSubject,
    suiteId: string,
  ): Promise<EvalSuite> {
    const suite = await this.repository.getEvalSuite(suiteId);
    if (!suite) throw notFound("Eval suite");
    await getAuthorizedAgent(this.repository, {
      agentId: suite.agentId,
      subject,
      scope: "agents:read",
    });
    return suite;
  }

  private async resolveModel(
    subject: AuthSubject,
    modelId: string,
  ): Promise<{ model: BaseModel; provider: ProviderInstance }> {
    assertScope(subject, "models:use");
    const model = await this.repository.getModel(modelId);
    if (!model) throw notFound("Model");
    const provider = await this.repository.getProvider(model.providerId);
    if (!provider) throw notFound("Provider");
    if (!canAccessOrg(subject, provider.orgId))
      throw new AuthorizationError(
        "The model provider is outside the caller organization.",
      );
    const grants = await this.repository.listResourceGrants(subject.orgId);
    if (!hasGrant(subject, grants, "model", model.id, "use"))
      throw new AuthorizationError(
        `Missing use permission for model:${model.id}`,
      );
    if (!hasGrant(subject, grants, "provider", provider.id, "use"))
      throw new AuthorizationError(
        `Missing use permission for provider:${provider.id}`,
      );
    return { model, provider };
  }

  private async generateOutput(
    provider: ProviderInstance,
    model: BaseModel,
    systemPrompt: string,
    input: string,
  ): Promise<string> {
    const adapter = getProviderAdapter(provider.type);
    let output = "";
    const apiKey = await this.resolveProviderApiKey(provider);
    for await (const token of adapter.streamChat({
      provider,
      model,
      ...(apiKey === undefined ? {} : { apiKey }),
      ...(this.options.providerFetch === undefined
        ? {}
        : { fetchImpl: this.options.providerFetch }),
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: input },
      ],
    })) {
      if (typeof token === "string") output += token;
    }
    return output;
  }

  private async resolveProviderApiKey(
    provider: ProviderInstance,
  ): Promise<string | undefined> {
    if (provider.credentialRef === undefined) return undefined;
    const resolution = await this.options.secretResolver?.resolveValue?.(
      provider.credentialRef,
    );
    return resolution?.available === true ? resolution.value : undefined;
  }

  private async assertEvalRunAllowed(
    subject: AuthSubject,
    agent: { id: string; workspaceId: string },
    provider: ProviderInstance,
    cases: EvalCase[],
  ): Promise<void> {
    await assertAbuseControlsAllow(this.repository, subject, {
      action: "eval.run",
      agentId: agent.id,
      providerId: provider.id,
      workspaceId: agent.workspaceId,
    });
    await consumeQuota(
      this.repository,
      subject,
      {
        agentId: agent.id,
        metric: "run.started",
        providerId: provider.id,
        quantity: cases.length,
        workspaceId: agent.workspaceId,
      },
      {
        quotaCoordinator: this.options.quotaCoordinator,
        webhooks: this.options.webhooks,
      },
    );
  }

  private async audit(
    repository: RomeoRepository,
    subject: AuthSubject,
    action: string,
    resourceId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await writeAuditLog(repository, {
      subject,
      action,
      resourceType: "agent",
      resourceId,
      metadata,
    });
  }
}

function scoreCase(
  testCase: EvalCase,
  output: string,
  orgId: string,
): Omit<EvalRunResult, "createdAt" | "runId"> {
  const containsPassed =
    testCase.expectedContains === undefined ||
    output.includes(testCase.expectedContains);
  const observedCitations = extractCitationReferences(output);
  const citationPassed =
    !testCase.requiresCitation || observedCitations.length > 0;
  const rubricChecks = scoreRubric(testCase.rubric, output);
  const checkResults = [
    ...(testCase.expectedContains === undefined ? [] : [containsPassed]),
    ...(testCase.requiresCitation ? [citationPassed] : []),
    ...rubricChecks.scores,
  ];
  const score =
    checkResults.length === 0
      ? 1
      : checkResults.filter(Boolean).length / checkResults.length;
  const passed = checkResults.every(Boolean);
  return {
    id: createId("eval_result"),
    orgId,
    caseId: testCase.id,
    status: passed ? "passed" : "failed",
    score,
    output,
    checks: {
      expectedContains: testCase.expectedContains ?? null,
      containsPassed,
      requiresCitation: testCase.requiresCitation,
      citationPassed,
      observedCitations,
      rubric: rubricChecks.details,
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

function buildReleaseCandidateSuiteEvidence(input: {
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
  return (
    (testCase.rubric?.expectedToolCalls?.length ?? 0) > 0 ||
    (testCase.rubric?.expectedToolOutcomes?.length ?? 0) > 0
  );
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
  return {
    total: checks.length,
    passed,
    failed: checks.length - passed,
  };
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

function normalizeRubric(rubric: EvalRubric): EvalRubric {
  const normalized: EvalRubric = {};
  const mustContain = uniqueTerms(rubric.mustContain);
  const mustNotContain = uniqueTerms(rubric.mustNotContain);
  const requiredCitations = uniqueTerms(rubric.requiredCitations);
  const expectedToolCalls = normalizeToolCallExpectations(
    rubric.expectedToolCalls,
  );
  const expectedToolOutcomes = normalizeToolOutcomeExpectations(
    rubric.expectedToolOutcomes,
  );
  if (mustContain.length > 0) normalized.mustContain = mustContain;
  if (mustNotContain.length > 0) normalized.mustNotContain = mustNotContain;
  if (requiredCitations.length > 0)
    normalized.requiredCitations = requiredCitations;
  if (rubric.minLength !== undefined) normalized.minLength = rubric.minLength;
  if (rubric.maxLength !== undefined) normalized.maxLength = rubric.maxLength;
  if (expectedToolCalls.length > 0)
    normalized.expectedToolCalls = expectedToolCalls;
  if (expectedToolOutcomes.length > 0)
    normalized.expectedToolOutcomes = expectedToolOutcomes;
  return normalized;
}

function scoreRubric(
  rubric: EvalRubric | undefined,
  output: string,
): { details: Record<string, unknown>; scores: boolean[] } {
  if (rubric === undefined) return { details: {}, scores: [] };
  const mustContain = uniqueTerms(rubric.mustContain);
  const mustNotContain = uniqueTerms(rubric.mustNotContain);
  const requiredCitations = uniqueTerms(rubric.requiredCitations);
  const expectedToolCalls = normalizeToolCallExpectations(
    rubric.expectedToolCalls,
  );
  const expectedToolOutcomes = normalizeToolOutcomeExpectations(
    rubric.expectedToolOutcomes,
  );
  const mustContainPassed = mustContain.map((term) => ({
    term,
    passed: output.includes(term),
  }));
  const mustNotContainPassed = mustNotContain.map((term) => ({
    term,
    passed: !output.includes(term),
  }));
  const citationChecks = scoreRequiredCitations(requiredCitations, output);
  const toolCallChecks = scoreExpectedToolCalls(expectedToolCalls, output);
  const toolOutcomeChecks = scoreExpectedToolOutcomes(
    expectedToolOutcomes,
    output,
  );
  const length = output.length;
  const minLengthPassed =
    rubric.minLength === undefined ? undefined : length >= rubric.minLength;
  const maxLengthPassed =
    rubric.maxLength === undefined ? undefined : length <= rubric.maxLength;
  return {
    details: {
      mustContain: mustContainPassed,
      mustNotContain: mustNotContainPassed,
      length,
      minLength: rubric.minLength ?? null,
      maxLength: rubric.maxLength ?? null,
      minLengthPassed: minLengthPassed ?? null,
      maxLengthPassed: maxLengthPassed ?? null,
      requiredCitations: citationChecks.details,
      observedCitations: citationChecks.observed,
      expectedToolCalls: toolCallChecks.details,
      expectedToolOutcomes: toolOutcomeChecks.details,
    },
    scores: [
      ...mustContainPassed.map((check) => check.passed),
      ...mustNotContainPassed.map((check) => check.passed),
      ...citationChecks.scores,
      ...toolCallChecks.scores,
      ...toolOutcomeChecks.scores,
      ...(minLengthPassed === undefined ? [] : [minLengthPassed]),
      ...(maxLengthPassed === undefined ? [] : [maxLengthPassed]),
    ],
  };
}

function uniqueTerms(terms: string[] | undefined): string[] {
  return [
    ...new Set(
      (terms ?? [])
        .map((term) => term.trim())
        .filter((term) => term.length > 0),
    ),
  ];
}

function scoreRequiredCitations(
  requiredCitations: string[],
  output: string,
): {
  details: Array<{ citation: string; passed: boolean }>;
  observed: string[];
  scores: boolean[];
} {
  const observed = extractCitationReferences(output);
  const observedSet = new Set(observed.map(normalizedCitationReference));
  const details = requiredCitations.map((citation) => ({
    citation,
    passed: observedSet.has(normalizedCitationReference(citation)),
  }));
  return { details, observed, scores: details.map((check) => check.passed) };
}

function extractCitationReferences(output: string): string[] {
  const references: string[] = [];
  const inlinePattern = /\[(?:source|citation)\s*[:#-]?\s*([^\]\n]+)\]/giu;
  for (const match of output.matchAll(inlinePattern)) {
    const reference = cleanCitationReference(match[1]);
    if (reference !== undefined) references.push(reference);
  }

  const romeoListPattern = /-\s*\[\d+\]\s+[^\n]*?\(([^()\n]+)\)/gu;
  for (const match of output.matchAll(romeoListPattern)) {
    const reference = cleanCitationReference(match[1]);
    if (reference !== undefined) references.push(reference);
  }

  return uniqueTerms(references).slice(0, 50);
}

function cleanCitationReference(value: string | undefined): string | undefined {
  const reference = value?.trim().replace(/^[\s"'`]+|[\s"'`.,;:]+$/gu, "");
  return reference === undefined || reference.length === 0
    ? undefined
    : reference;
}

function normalizedCitationReference(value: string): string {
  return cleanCitationReference(value)?.toLowerCase() ?? "";
}

function normalizeToolCallExpectations(
  calls: EvalToolCallExpectation[] | undefined,
): EvalToolCallExpectation[] {
  const normalized = new Map<string, EvalToolCallExpectation>();
  for (const call of calls ?? []) {
    const name = call.name.trim();
    if (name.length === 0) continue;
    const args = normalizeToolArguments(call.arguments);
    const item: EvalToolCallExpectation = {
      name,
      ...(args === undefined ? {} : { arguments: args }),
    };
    normalized.set(JSON.stringify(item), item);
  }
  return [...normalized.values()];
}

function normalizeToolOutcomeExpectations(
  outcomes: EvalToolOutcomeExpectation[] | undefined,
): EvalToolOutcomeExpectation[] {
  const normalized = new Map<string, EvalToolOutcomeExpectation>();
  for (const outcome of outcomes ?? []) {
    const name = outcome.name.trim();
    if (name.length === 0) continue;
    const outputKeys = uniqueTerms(outcome.outputKeys).slice(0, 25);
    const errorCode = cleanStableCode(outcome.errorCode);
    const item: EvalToolOutcomeExpectation = {
      name,
      ...(outcome.status === undefined ? {} : { status: outcome.status }),
      ...(outputKeys.length === 0 ? {} : { outputKeys }),
      ...(errorCode === undefined ? {} : { errorCode }),
    };
    normalized.set(JSON.stringify(item), item);
  }
  return [...normalized.values()];
}

function scoreExpectedToolCalls(
  expectedCalls: EvalToolCallExpectation[],
  output: string,
): {
  details: Array<EvalToolCallExpectation & { passed: boolean }>;
  scores: boolean[];
} {
  if (expectedCalls.length === 0) return { details: [], scores: [] };
  const observedCalls = extractToolCalls(output);
  const details = expectedCalls.map((expected) => ({
    ...expected,
    passed: observedCalls.some((observed) =>
      toolCallMatches(expected, observed),
    ),
  }));
  return { details, scores: details.map((check) => check.passed) };
}

function scoreExpectedToolOutcomes(
  expectedOutcomes: EvalToolOutcomeExpectation[],
  output: string,
): {
  details: Array<EvalToolOutcomeExpectation & { passed: boolean }>;
  scores: boolean[];
} {
  if (expectedOutcomes.length === 0) return { details: [], scores: [] };
  const observedOutcomes = extractToolOutcomes(output);
  const details = expectedOutcomes.map((expected) => ({
    ...expected,
    passed: observedOutcomes.some((observed) =>
      toolOutcomeMatches(expected, observed),
    ),
  }));
  return { details, scores: details.map((check) => check.passed) };
}

function extractToolCalls(output: string): EvalToolCallExpectation[] {
  const calls: EvalToolCallExpectation[] = [];
  const fencePattern =
    /```(?:romeo-tool-call|tool-call|json)\s*([\s\S]*?)```/giu;
  for (const match of output.matchAll(fencePattern)) {
    const json = match[1]?.trim();
    if (json === undefined || json.length === 0) continue;
    calls.push(...toolCallsFromJson(json));
  }
  return calls;
}

function extractToolOutcomes(output: string): EvalToolOutcomeExpectation[] {
  const outcomes: EvalToolOutcomeExpectation[] = [];
  const fencePattern =
    /```(?:romeo-tool-outcome|tool-outcome|tool-result|json)\s*([\s\S]*?)```/giu;
  for (const match of output.matchAll(fencePattern)) {
    const json = match[1]?.trim();
    if (json === undefined || json.length === 0) continue;
    outcomes.push(...toolOutcomesFromJson(json));
  }
  return outcomes;
}

function toolCallsFromJson(json: string): EvalToolCallExpectation[] {
  try {
    const parsed = JSON.parse(json);
    const values = Array.isArray(parsed) ? parsed : [parsed];
    return values.flatMap((value) => {
      if (typeof value !== "object" || value === null) return [];
      const record = value as Record<string, unknown>;
      const name =
        typeof record.name === "string"
          ? record.name
          : typeof record.tool === "string"
            ? record.tool
            : undefined;
      if (name === undefined) return [];
      if (isToolOutcomeOnlyRecord(record)) return [];
      const args = normalizeToolArguments(record.arguments);
      return [{ name, ...(args === undefined ? {} : { arguments: args }) }];
    });
  } catch {
    return [];
  }
}

function toolOutcomesFromJson(json: string): EvalToolOutcomeExpectation[] {
  try {
    const parsed = JSON.parse(json);
    const values = Array.isArray(parsed) ? parsed : [parsed];
    return values.flatMap((value) => {
      if (typeof value !== "object" || value === null) return [];
      const record = value as Record<string, unknown>;
      const name =
        typeof record.name === "string"
          ? record.name
          : typeof record.tool === "string"
            ? record.tool
            : undefined;
      if (name === undefined) return [];
      const status = normalizeToolOutcomeStatus(record.status);
      const outputKeys = normalizeStringList(record.outputKeys);
      const errorCode = cleanStableCode(record.errorCode);
      if (
        status === undefined &&
        outputKeys.length === 0 &&
        errorCode === undefined
      )
        return [];
      const outcome: EvalToolOutcomeExpectation = {
        name,
        ...(status === undefined ? {} : { status }),
        ...(outputKeys.length === 0 ? {} : { outputKeys }),
        ...(errorCode === undefined ? {} : { errorCode }),
      };
      return [outcome];
    });
  } catch {
    return [];
  }
}

function toolCallMatches(
  expected: EvalToolCallExpectation,
  observed: EvalToolCallExpectation,
): boolean {
  if (expected.name !== observed.name) return false;
  if (expected.arguments === undefined) return true;
  if (observed.arguments === undefined) return false;
  return Object.entries(expected.arguments).every(
    ([key, value]) => observed.arguments?.[key] === value,
  );
}

function toolOutcomeMatches(
  expected: EvalToolOutcomeExpectation,
  observed: EvalToolOutcomeExpectation,
): boolean {
  if (expected.name !== observed.name) return false;
  if (expected.status !== undefined && expected.status !== observed.status)
    return false;
  if (
    expected.errorCode !== undefined &&
    expected.errorCode !== observed.errorCode
  )
    return false;
  if (expected.outputKeys !== undefined) {
    const observedKeys = new Set<string>(observed.outputKeys ?? []);
    if (expected.outputKeys.some((key) => !observedKeys.has(key))) return false;
  }
  return true;
}

function isToolOutcomeOnlyRecord(record: Record<string, unknown>): boolean {
  return (
    record.arguments === undefined &&
    (record.status !== undefined ||
      record.outputKeys !== undefined ||
      record.errorCode !== undefined)
  );
}

function normalizeToolArguments(
  value: unknown,
): Record<string, string | number | boolean | null> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined;
  const normalized: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of Object.entries(value)) {
    if (
      typeof item === "string" ||
      typeof item === "number" ||
      typeof item === "boolean" ||
      item === null
    )
      normalized[key] = item;
  }
  return Object.keys(normalized).length === 0 ? undefined : normalized;
}

function normalizeStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? uniqueTerms(
        value.filter((item): item is string => typeof item === "string"),
      )
    : [];
}

function normalizeToolOutcomeStatus(
  value: unknown,
): EvalToolOutcomeExpectation["status"] | undefined {
  if (value === "success" || value === "failure") return value;
  return undefined;
}

function cleanStableCode(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const code = value.trim();
  return /^[a-z0-9][a-z0-9_.:-]{0,119}$/iu.test(code) ? code : undefined;
}
