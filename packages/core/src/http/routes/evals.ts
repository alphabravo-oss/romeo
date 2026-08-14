import {
  createEvalCaseFromFeedbackRoute,
  createEvalSuiteRoute,
  getEvalDashboardRoute,
  getEvalReleaseCandidateEvidenceRoute,
  getEvalReasoningComparisonRoute,
  listEvalRatingsRoute,
  listEvalResultsRoute,
  listEvalRunsRoute,
  listEvalSuitesRoute,
  rateEvalResultRoute,
  runEvalSuiteRoute,
} from "@romeo/contracts";

import type { RomeoApi } from "../context";

export function registerEvalRoutes(app: RomeoApi): void {
  app.openapi(listEvalSuitesRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .evals.listSuites(subject, context.req.valid("param").agentId);
    return context.json({ data });
  });

  app.openapi(createEvalSuiteRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context.get("services").evals.createSuite({
      subject,
      agentId: body.agentId,
      name: body.name,
      cases: body.cases.map((testCase) => ({
        input: testCase.input,
        ...(testCase.expectedContains !== undefined
          ? { expectedContains: testCase.expectedContains }
          : {}),
        ...(testCase.rubric !== undefined ? { rubric: testCase.rubric } : {}),
        ...(testCase.requiresCitation !== undefined
          ? { requiresCitation: testCase.requiresCitation }
          : {}),
      })),
    });
    return context.json({ data }, 201);
  });

  app.openapi(createEvalCaseFromFeedbackRoute, async (context) => {
    const body = context.req.valid("json");
    const data = await context
      .get("services")
      .evals.createCaseFromMessageFeedback({
        subject: context.get("subject"),
        agentId: body.agentId,
        chatId: body.chatId,
        messageId: body.messageId,
        ...(body.suiteId === undefined ? {} : { suiteId: body.suiteId }),
        ...(body.suiteName === undefined ? {} : { suiteName: body.suiteName }),
      });
    if (data.created) return context.json({ data }, 201);
    return context.json({ data }, 200);
  });

  app.openapi(listEvalRunsRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .evals.listRuns(subject, context.req.valid("param").agentId);
    return context.json({ data });
  });

  app.openapi(getEvalDashboardRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .evals.dashboard(subject, context.req.valid("param").agentId);
    return context.json({ data });
  });

  app.openapi(getEvalReleaseCandidateEvidenceRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .evals.releaseCandidateEvidence(
        subject,
        context.req.valid("param").agentId,
      );
    return context.json({ data });
  });

  app.openapi(runEvalSuiteRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json") ?? {};
    const data = await context.get("services").evals.runSuite({
      subject,
      suiteId: context.req.valid("param").suiteId,
      ...(body.modelId !== undefined ? { modelId: body.modelId } : {}),
      ...(body.reasoningPolicy === undefined
        ? {}
        : { reasoningPolicy: body.reasoningPolicy }),
    });
    return context.json({ data }, 202);
  });

  app.openapi(getEvalReasoningComparisonRoute, async (context) => {
    const data = await context
      .get("services")
      .evals.reasoningComparison(
        context.get("subject"),
        context.req.valid("param").suiteId,
      );
    return context.json({ data });
  });

  app.openapi(listEvalResultsRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .evals.results(subject, context.req.valid("param").runId);
    return context.json({ data });
  });

  app.openapi(listEvalRatingsRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .evals.ratings(subject, context.req.valid("param").runId);
    return context.json({ data });
  });

  app.openapi(rateEvalResultRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context.get("services").evals.rateResult({
      subject,
      resultId: context.req.valid("param").resultId,
      rating: body.rating,
      ...(body.comment === undefined ? {} : { comment: body.comment }),
    });
    return context.json({ data });
  });
}
