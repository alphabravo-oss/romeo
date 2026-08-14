import {
  AuthorizationError,
  assertScope,
  canAccessOrg,
  hasGrant,
  type AuthSubject,
} from "@romeo/auth";
import {
  translateProviderChatParameters,
  type ProviderReasoningPolicy,
} from "@romeo/providers";
import type {
  EvalCase,
  EvalReleaseCandidateEvidence,
  EvalReasoningComparison,
  EvalResultHumanRating,
  EvalResultHumanRatingValue,
  EvalRubric,
  EvalRun,
  EvalRunResult,
  EvalSuite,
  BaseModel,
  ProviderInstance,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { createId } from "../ids";
import { getAuthorizedAgent } from "./agent-access";
import {
  type AuditAction,
  type AuditMetadata,
  writeAuditLog,
} from "./audit-log";
import { assistantsEnabledForOrg } from "./chat-experience-service";
import { enforceContentPolicyStrings } from "./content-policy-service";
import { providerApiError } from "./provider-api-error";
import { normalizeEvalRubric } from "./eval-case-scoring";
import { buildEvalDashboard } from "./eval-dashboard";
import { executeReasoningAwareEval } from "./eval-reasoning-execution";
import { buildEvalReasoningComparison } from "./eval-reasoning-comparison";
import {
  createFeedbackEvalCase,
  type FeedbackEvalCaseResult,
} from "./eval-feedback-case";
import { buildEvalReleaseCandidateEvidence } from "./eval-reporting";
import { assertEvalRunAllowed } from "./eval-run-policy";
import type { QuotaCoordinator } from "./quota-coordination";
import type { SecretResolver } from "./secret-resolver";
import type { CapabilityPlatformPolicy } from "./capability-platform-policy";
import { reasoningPolicyLayersForStart } from "./run-reasoning-policy";
import { persistedSubjectActorId } from "./subject-persisted-actor";
import type { WebhookEmitter } from "./webhook-service";
export type { FeedbackEvalCaseResult } from "./eval-feedback-case";

export interface CreatedEvalSuite {
  suite: EvalSuite;
  cases: EvalCase[];
}

export class EvalService {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly options: {
      providerFetch?: typeof fetch;
      capabilityPlatformPolicy?: CapabilityPlatformPolicy;
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
    const governedInputs = await enforceContentPolicyStrings(
      this.repository,
      input.subject,
      input.cases.map((testCase) => testCase.input),
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
        input.cases.map((testCase, index) => ({
          id: createId("eval_case"),
          orgId: agent.orgId,
          suiteId: suite.id,
          input: governedInputs.contents[index]!,
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

  async createCaseFromMessageFeedback(input: {
    subject: AuthSubject;
    agentId: string;
    chatId: string;
    messageId: string;
    suiteId?: string;
    suiteName?: string;
  }): Promise<FeedbackEvalCaseResult> {
    return createFeedbackEvalCase(this.repository, input);
  }

  async listRuns(subject: AuthSubject, agentId: string): Promise<EvalRun[]> {
    await getAuthorizedAgent(this.repository, {
      agentId,
      subject,
      scope: "agents:read",
    });
    return this.repository.listEvalRuns(agentId);
  }

  async dashboard(subject: AuthSubject, agentId: string) {
    await getAuthorizedAgent(this.repository, {
      agentId,
      subject,
      scope: "agents:read",
    });
    const [suites, runs] = await Promise.all([
      this.repository.listEvalSuites(agentId),
      this.repository.listEvalRuns(agentId),
    ]);
    return buildEvalDashboard(agentId, suites, runs);
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
    reasoningPolicy?: ProviderReasoningPolicy;
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
    // Legacy cases and agent prompts may predate content-policy enforcement. Govern them before
    // quota consumption or any provider setup so a block has no billable/provider side effects.
    const assistantsEnabled = await assistantsEnabledForOrg(
      this.repository,
      input.subject.orgId,
    );
    const governedEvalContent = await enforceContentPolicyStrings(
      this.repository,
      input.subject,
      [
        assistantsEnabled ? agent.systemPrompt : "",
        ...cases.map((testCase) => testCase.input),
      ],
    );
    const governedSystemPrompt = governedEvalContent.contents[0]!;
    const governedCases = cases.map((testCase, index) => ({
      ...testCase,
      input: governedEvalContent.contents[index + 1]!,
    }));
    const reasoningPolicy = await reasoningPolicyLayersForStart(
      this.repository,
      {
        agentParameters: agent.parameters,
        orgId: agent.orgId,
        workspaceId: agent.workspaceId,
        ...(this.options.capabilityPlatformPolicy === undefined
          ? {}
          : { platformPolicy: this.options.capabilityPlatformPolicy }),
        ...(input.reasoningPolicy === undefined
          ? {}
          : { runRequest: input.reasoningPolicy }),
      },
    );
    // Resolve all policy and target constraints before quota consumption or credentials.
    try {
      translateProviderChatParameters({
        kind: provider.type,
        model,
        provider,
        ...(reasoningPolicy === undefined ? {} : { reasoningPolicy }),
      });
    } catch (error) {
      throw providerApiError(error, { kind: provider.type, operation: "chat" });
    }
    await assertEvalRunAllowed({
      repository: this.repository,
      subject: input.subject,
      agent,
      provider,
      cases: governedCases,
      ...(this.options.quotaCoordinator === undefined
        ? {}
        : { quotaCoordinator: this.options.quotaCoordinator }),
      ...(this.options.webhooks === undefined
        ? {}
        : { webhooks: this.options.webhooks }),
    });

    // Same suppression the run path applies, read off the same org row: an eval that measured a
    // system turn production never sends would score a request shape that does not exist.
    const execution = await executeReasoningAwareEval({
      repository: this.repository,
      subject: input.subject,
      provider,
      model,
      systemPrompt: governedSystemPrompt,
      cases: governedCases,
      ...(reasoningPolicy === undefined ? {} : { reasoningPolicy }),
      options: {
        ...(this.options.providerFetch === undefined
          ? {}
          : { providerFetch: this.options.providerFetch }),
        ...(this.options.secretResolver === undefined
          ? {}
          : { secretResolver: this.options.secretResolver }),
      },
    });
    const resultDrafts = execution.results;

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
        ...(execution.evidence === undefined
          ? {}
          : { reasoningPolicy: execution.evidence }),
        metrics: execution.metrics,
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

  async reasoningComparison(
    subject: AuthSubject,
    suiteId: string,
  ): Promise<EvalReasoningComparison> {
    const suite = await this.getAuthorizedSuite(subject, suiteId);
    return buildEvalReasoningComparison(
      suite.id,
      await this.repository.listEvalRuns(suite.agentId),
    );
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

  private async audit<A extends AuditAction>(
    repository: RomeoRepository,
    subject: AuthSubject,
    action: A,
    resourceId: string,
    metadata: AuditMetadata<A>,
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
