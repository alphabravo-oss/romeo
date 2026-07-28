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
  EvalReleaseCandidateEvidence,
  EvalResultHumanRating,
  EvalResultHumanRatingValue,
  EvalRubric,
  EvalRun,
  EvalRunResult,
  EvalSuite,
  ProviderInstance,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { createId } from "../ids";
import { getAuthorizedAgent } from "./agent-access";
import { writeAuditLog } from "./audit-log";
import { normalizeEvalRubric, scoreEvalCase } from "./eval-case-scoring";
import { buildEvalReleaseCandidateEvidence } from "./eval-reporting";
import { assertEvalRunAllowed } from "./eval-run-policy";
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
            ? { rubric: normalizeEvalRubric(testCase.rubric) }
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
    await assertEvalRunAllowed({
      repository: this.repository,
      subject: input.subject,
      agent,
      provider,
      cases,
      ...(this.options.quotaCoordinator === undefined
        ? {}
        : { quotaCoordinator: this.options.quotaCoordinator }),
      ...(this.options.webhooks === undefined
        ? {}
        : { webhooks: this.options.webhooks }),
    });

    const resultDrafts: Array<Omit<EvalRunResult, "createdAt" | "runId">> = [];
    for (const testCase of cases) {
      const output = await this.generateOutput(
        provider,
        model,
        agent.systemPrompt,
        testCase.input,
      );
      resultDrafts.push(scoreEvalCase(testCase, output, input.subject.orgId));
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

  async releaseCandidateEvidence(
    subject: AuthSubject,
    agentId: string,
  ): Promise<EvalReleaseCandidateEvidence> {
    return buildEvalReleaseCandidateEvidence(this.repository, subject, agentId);
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
