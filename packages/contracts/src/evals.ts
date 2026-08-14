import { createRoute, z } from "@hono/zod-openapi";

import {
  authenticationSecurity,
  dataEnvelope,
  jsonResponse,
  standardErrorResponses,
} from "./common";
import {
  EvalReasoningPolicyEvidenceSchema,
  EvalRunMetricsSchema,
  RunEvalSuiteSchema,
} from "./eval-reasoning";
import { getEvalReasoningComparisonRoute } from "./eval-reasoning-route";
export {
  EvalReasoningComparisonSchema,
  EvalReasoningPolicyEvidenceSchema,
  EvalRunMetricsSchema,
  RunEvalSuiteSchema,
} from "./eval-reasoning";
export { getEvalReasoningComparisonRoute } from "./eval-reasoning-route";

const id = z.string().trim().min(1).max(300);
const time = z.iso.datetime();
const count = z.number().int().min(0);
const score = z.number().min(0).max(1);
const runStatus = z.enum(["failed", "passed"]);
const evidenceStatus = z.enum(["failed", "missing", "passed"]);
const gateStatus = z.enum(["failed", "missing", "not_required", "passed"]);

const EvalToolArgumentSchema = z.union([
  z.string().max(1_000),
  z.number(),
  z.boolean(),
  z.null(),
]);

export const EvalToolCallExpectationSchema = z
  .strictObject({
    name: z.string().min(1).max(200),
    arguments: z
      .record(z.string().min(1).max(200), EvalToolArgumentSchema)
      .optional(),
  })
  .openapi("EvalToolCallExpectation");

export const EvalToolOutcomeExpectationSchema = z
  .strictObject({
    name: z.string().min(1).max(200),
    status: z.enum(["failure", "success"]).optional(),
    outputKeys: z.array(z.string().min(1).max(200)).max(25).optional(),
    errorCode: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[a-z0-9][a-z0-9_.:-]*$/iu)
      .optional(),
  })
  .openapi("EvalToolOutcomeExpectation");

export const EvalRubricSchema = z
  .strictObject({
    mustContain: z.array(z.string().min(1).max(500)).max(25).optional(),
    mustNotContain: z.array(z.string().min(1).max(500)).max(25).optional(),
    minLength: z.number().int().min(0).max(100_000).optional(),
    maxLength: z.number().int().min(1).max(100_000).optional(),
    expectedToolCalls: z
      .array(EvalToolCallExpectationSchema)
      .max(25)
      .optional(),
    expectedToolOutcomes: z
      .array(EvalToolOutcomeExpectationSchema)
      .max(25)
      .optional(),
    requiredCitations: z.array(z.string().min(1).max(500)).max(25).optional(),
  })
  .refine(
    (rubric) =>
      rubric.minLength === undefined ||
      rubric.maxLength === undefined ||
      rubric.minLength <= rubric.maxLength,
    { message: "minLength must be less than or equal to maxLength." },
  )
  .openapi("EvalRubric");

export const EvalSuiteSchema = z
  .strictObject({
    id,
    orgId: id,
    workspaceId: id,
    agentId: id,
    name: z.string().min(1),
    createdBy: id,
    createdAt: time,
    updatedAt: time,
  })
  .openapi("EvalSuite");

export const EvalCaseSchema = z
  .strictObject({
    id,
    orgId: id,
    suiteId: id,
    input: z.string(),
    expectedContains: z.string().optional(),
    rubric: EvalRubricSchema.optional(),
    requiresCitation: z.boolean(),
    createdAt: time,
  })
  .openapi("EvalCase");

export const EvalRunSchema = z
  .strictObject({
    id,
    orgId: id,
    workspaceId: id,
    agentId: id,
    suiteId: id,
    modelId: id,
    status: runStatus,
    score,
    createdBy: id,
    createdAt: time,
    completedAt: time,
    reasoningPolicy: EvalReasoningPolicyEvidenceSchema.optional(),
    metrics: EvalRunMetricsSchema.optional(),
  })
  .openapi("EvalRun");

export const EvalRunResultSchema = z
  .strictObject({
    id,
    orgId: id,
    runId: id,
    caseId: id,
    status: runStatus,
    score,
    output: z.string(),
    checks: z.record(z.string(), z.unknown()),
    createdAt: time,
  })
  .openapi("EvalRunResult");

export const EvalResultHumanRatingSchema = z
  .strictObject({
    id,
    orgId: id,
    runId: id,
    resultId: id,
    reviewerId: id,
    rating: z.enum(["fail", "neutral", "pass"]),
    comment: z.string().optional(),
    createdAt: time,
    updatedAt: time,
  })
  .openapi("EvalResultHumanRating");

const EvalDashboardSuiteSummarySchema = z.strictObject({
  suiteId: id,
  name: z.string(),
  latestRunId: id.nullable(),
  status: evidenceStatus,
  score: score.nullable(),
  completedAt: time.nullable(),
  runCount: count,
});
const EvalDashboardRunPointSchema = z.strictObject({
  runId: id,
  suiteId: id,
  modelId: id,
  status: runStatus,
  score,
  completedAt: time,
  reasoningPolicy: EvalReasoningPolicyEvidenceSchema.optional(),
  metrics: EvalRunMetricsSchema.optional(),
});
export const EvalDashboardSchema = z
  .strictObject({
    agentId: id,
    generatedAt: time,
    status: gateStatus,
    suiteCount: count,
    runCount: count,
    averageLatestScore: score.nullable(),
    suites: z.array(EvalDashboardSuiteSummarySchema),
    trend: z.array(EvalDashboardRunPointSchema),
  })
  .openapi("EvalDashboard");

const CheckSummarySchema = z.strictObject({
  total: count,
  passed: count,
  failed: count,
});
const EvalReleaseCandidateSuiteEvidenceSchema = z.strictObject({
  suiteId: id,
  name: z.string(),
  latestRunId: id.nullable(),
  status: evidenceStatus,
  score: score.nullable(),
  completedAt: time.nullable(),
  caseCount: count,
  resultCount: count,
  passedResultCount: count,
  failedResultCount: count,
  requirementCounts: z.strictObject({
    expectedContainsCases: count,
    citationRequiredCases: count,
    rubricCases: count,
    toolExpectationCases: count,
    expectedToolCallCases: count,
    expectedToolOutcomeCases: count,
  }),
  toolEvaluation: z.strictObject({
    expectedToolCalls: CheckSummarySchema,
    expectedToolOutcomes: CheckSummarySchema,
    failedToolExpectationCaseCount: count,
  }),
  humanRatingCounts: z.strictObject({
    pass: count,
    neutral: count,
    fail: count,
    total: count,
  }),
});

export const EvalReleaseCandidateEvidenceSchema = z
  .strictObject({
    schema: z.literal("romeo.eval-release-candidate-evidence.v1"),
    orgId: id,
    workspaceId: id,
    agentId: id,
    generatedAt: time,
    candidate: z.strictObject({
      baseModelId: id,
      draftUpdatedAt: time,
      publishedVersionId: id.optional(),
    }),
    gate: z.strictObject({
      status: gateStatus,
      publishBlocked: z.boolean(),
      reasonCodes: z.array(z.string()),
      suiteCount: count,
      passedSuiteCount: count,
      failedSuiteCount: count,
      missingSuiteCount: count,
      averageScore: score.nullable(),
      evaluatedAt: time.nullable(),
    }),
    suites: z.array(EvalReleaseCandidateSuiteEvidenceSchema),
    redaction: z.strictObject({
      rawEvalInputsReturned: z.literal(false),
      rawEvalOutputsReturned: z.literal(false),
      rawHumanRatingCommentsReturned: z.literal(false),
      rawRubricTermsReturned: z.literal(false),
      rawToolArgumentsReturned: z.literal(false),
      rawToolNamesReturned: z.literal(false),
      rawToolOutputKeysReturned: z.literal(false),
      rawToolResultBodiesReturned: z.literal(false),
    }),
  })
  .openapi("EvalReleaseCandidateEvidence");

export const CreateEvalSuiteSchema = z
  .strictObject({
    agentId: id,
    name: z.string().min(1),
    cases: z
      .array(
        z.strictObject({
          input: z.string().min(1).max(10_000),
          expectedContains: z.string().min(1).optional(),
          rubric: EvalRubricSchema.optional(),
          requiresCitation: z.boolean().optional(),
        }),
      )
      .min(1)
      .max(100),
  })
  .openapi("CreateEvalSuiteRequest");
export const RateEvalResultSchema = z
  .strictObject({
    rating: z.enum(["pass", "neutral", "fail"]),
    comment: z.string().min(1).max(2_000).optional(),
  })
  .openapi("RateEvalResultRequest");

export const CreateEvalCaseFromFeedbackSchema = z
  .strictObject({
    agentId: id,
    chatId: id,
    messageId: id,
    suiteId: id.optional(),
    suiteName: z.string().trim().min(1).max(200).optional(),
  })
  .refine(
    (input) => input.suiteId === undefined || input.suiteName === undefined,
    {
      message: "suiteName cannot be used when appending to an existing suite.",
    },
  )
  .openapi("CreateEvalCaseFromFeedbackRequest");

export const FeedbackEvalCaseResultSchema = z
  .strictObject({
    suiteId: id,
    caseId: id,
    created: z.boolean(),
    redaction: z.strictObject({
      evalInputReturned: z.literal(false),
      assistantContentPersisted: z.literal(false),
      assistantContentReturned: z.literal(false),
      feedbackReasonPersisted: z.literal(false),
      feedbackReasonReturned: z.literal(false),
      reviewerIdentityPersisted: z.literal(false),
      reviewerIdentityReturned: z.literal(false),
    }),
  })
  .openapi("FeedbackEvalCaseResult");

const CreatedEvalSuiteSchema = z
  .strictObject({ suite: EvalSuiteSchema, cases: z.array(EvalCaseSchema) })
  .openapi("CreatedEvalSuite");
const EvalRunWithResultsSchema = z
  .strictObject({ run: EvalRunSchema, results: z.array(EvalRunResultSchema) })
  .openapi("EvalRunWithResults");
const agentPath = z.strictObject({ agentId: id });
const suitePath = z.strictObject({ suiteId: id });
const runPath = z.strictObject({ runId: id });
const resultPath = z.strictObject({ resultId: id });
const meta = { tags: ["Evals"], security: authenticationSecurity };
const errors = standardErrorResponses;
const body = <T extends z.ZodType>(schema: T, required = true) => ({
  required,
  content: { "application/json": { schema } },
});

export const listEvalSuitesRoute = createRoute({
  ...meta,
  method: "get",
  path: "/api/v1/agents/{agentId}/eval-suites",
  operationId: "evals.listSuites",
  summary: "List suites",
  request: { params: agentPath },
  responses: {
    200: jsonResponse("Eval suites", dataEnvelope(z.array(EvalSuiteSchema))),
    ...errors,
  },
});
export const createEvalSuiteRoute = createRoute({
  ...meta,
  method: "post",
  path: "/api/v1/eval-suites",
  operationId: "evals.createSuite",
  summary: "Create suite",
  request: { body: body(CreateEvalSuiteSchema) },
  responses: {
    201: jsonResponse(
      "Created eval suite",
      dataEnvelope(CreatedEvalSuiteSchema),
    ),
    ...errors,
  },
});
export const createEvalCaseFromFeedbackRoute = createRoute({
  ...meta,
  method: "post",
  path: "/api/v1/eval-cases/from-message-feedback",
  operationId: "evals.createCaseFromMessageFeedback",
  summary: "Create an eval case from negative message feedback",
  request: { body: body(CreateEvalCaseFromFeedbackSchema) },
  responses: {
    200: jsonResponse(
      "Existing feedback-derived eval case",
      dataEnvelope(FeedbackEvalCaseResultSchema),
    ),
    201: jsonResponse(
      "Created feedback-derived eval case",
      dataEnvelope(FeedbackEvalCaseResultSchema),
    ),
    ...errors,
  },
});
export const listEvalRunsRoute = createRoute({
  ...meta,
  method: "get",
  path: "/api/v1/agents/{agentId}/eval-runs",
  operationId: "evals.listRuns",
  summary: "List runs",
  request: { params: agentPath },
  responses: {
    200: jsonResponse("Eval runs", dataEnvelope(z.array(EvalRunSchema))),
    ...errors,
  },
});
export const getEvalDashboardRoute = createRoute({
  ...meta,
  method: "get",
  path: "/api/v1/agents/{agentId}/eval-dashboard",
  operationId: "evals.getDashboard",
  summary: "Get dashboard",
  request: { params: agentPath },
  responses: {
    200: jsonResponse("Eval dashboard", dataEnvelope(EvalDashboardSchema)),
    ...errors,
  },
});
export const getEvalReleaseCandidateEvidenceRoute = createRoute({
  ...meta,
  method: "get",
  path: "/api/v1/agents/{agentId}/eval-release-candidate-evidence",
  operationId: "evals.getReleaseCandidateEvidence",
  summary: "Get release candidate evidence",
  request: { params: agentPath },
  responses: {
    200: jsonResponse(
      "Metadata-only release-candidate eval evidence",
      dataEnvelope(EvalReleaseCandidateEvidenceSchema),
    ),
    ...errors,
  },
});
export const runEvalSuiteRoute = createRoute({
  ...meta,
  method: "post",
  path: "/api/v1/eval-suites/{suiteId}/runs",
  operationId: "evals.runSuite",
  summary: "Run suite",
  request: { params: suitePath, body: body(RunEvalSuiteSchema, false) },
  responses: {
    202: jsonResponse(
      "Eval run with results",
      dataEnvelope(EvalRunWithResultsSchema),
    ),
    ...errors,
  },
});
export const listEvalResultsRoute = createRoute({
  ...meta,
  method: "get",
  path: "/api/v1/eval-runs/{runId}/results",
  operationId: "evals.listResults",
  summary: "List results",
  request: { params: runPath },
  responses: {
    200: jsonResponse(
      "Eval results",
      dataEnvelope(z.array(EvalRunResultSchema)),
    ),
    ...errors,
  },
});
export const listEvalRatingsRoute = createRoute({
  ...meta,
  method: "get",
  path: "/api/v1/eval-runs/{runId}/ratings",
  operationId: "evals.listRatings",
  summary: "List ratings",
  request: { params: runPath },
  responses: {
    200: jsonResponse(
      "Eval result human ratings",
      dataEnvelope(z.array(EvalResultHumanRatingSchema)),
    ),
    ...errors,
  },
});
export const rateEvalResultRoute = createRoute({
  ...meta,
  method: "post",
  path: "/api/v1/eval-run-results/{resultId}/rating",
  operationId: "evals.rateResult",
  summary: "Rate result",
  request: { params: resultPath, body: body(RateEvalResultSchema) },
  responses: {
    200: jsonResponse(
      "Eval result human rating",
      dataEnvelope(EvalResultHumanRatingSchema),
    ),
    ...errors,
  },
});

export const evalRoutes = [
  listEvalSuitesRoute,
  createEvalSuiteRoute,
  createEvalCaseFromFeedbackRoute,
  listEvalRunsRoute,
  getEvalDashboardRoute,
  getEvalReleaseCandidateEvidenceRoute,
  runEvalSuiteRoute,
  getEvalReasoningComparisonRoute,
  listEvalResultsRoute,
  listEvalRatingsRoute,
  rateEvalResultRoute,
] as const;
