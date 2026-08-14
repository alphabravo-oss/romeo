import {
  createContentPolicyVersionRoute,
  dryRunContentPolicyVersionRoute,
  getContentPolicyRoute,
  listContentPolicyApprovalsRoute,
  listContentPolicyDecisionsRoute,
  listContentPolicyVersionsRoute,
  publishContentPolicyVersionRoute,
  requestContentPolicyApprovalRoute,
  resolveContentPolicyApprovalRoute,
  rollbackContentPolicyRoute,
  simulateContentPolicyRoute,
  updateContentPolicyRoute,
} from "@romeo/contracts";

import type { RomeoApi } from "../context";

export function registerContentPolicyRoutes(app: RomeoApi): void {
  app.openapi(getContentPolicyRoute, async (context) => {
    const data = await context
      .get("services")
      .contentPolicy.report(context.get("subject"));
    return context.json({ data });
  });

  app.openapi(updateContentPolicyRoute, async (context) => {
    const body = context.req.valid("json");
    const detectors = Object.fromEntries(
      Object.entries(body.detectors).filter(
        ([, action]) => action !== undefined,
      ),
    );
    const data = await context.get("services").contentPolicy.update({
      subject: context.get("subject"),
      detectors,
    });
    return context.json({ data });
  });

  app.openapi(simulateContentPolicyRoute, async (context) => {
    const body = context.req.valid("json");
    const data = await context.get("services").contentPolicy.simulate({
      subject: context.get("subject"),
      content: body.content,
    });
    return context.json({ data });
  });

  app.openapi(listContentPolicyVersionsRoute, async (context) => {
    const versions = await context
      .get("services")
      .contentPolicyVersions.list(context.get("subject"));
    return context.json({
      data: versions.map((version) =>
        context.get("services").contentPolicyVersions.publicVersion(version),
      ),
    });
  });

  app.openapi(createContentPolicyVersionRoute, async (context) => {
    const body = context.req.valid("json");
    const version = await context.get("services").contentPolicyVersions.createDraft({
      subject: context.get("subject"),
      detectors: body.detectors,
      ...(body.approvalRequired === undefined
        ? {}
        : { approvalRequired: body.approvalRequired }),
      ...(body.approvalTtlSeconds === undefined
        ? {}
        : { approvalTtlSeconds: body.approvalTtlSeconds }),
    });
    return context.json({
      data: context.get("services").contentPolicyVersions.publicVersion(version),
    });
  });

  app.openapi(dryRunContentPolicyVersionRoute, async (context) => {
    const { versionId } = context.req.valid("param");
    const body = context.req.valid("json");
    const data = await context.get("services").contentPolicyVersions.dryRun({
      subject: context.get("subject"),
      versionId,
      content: body.content,
    });
    return context.json({ data });
  });

  app.openapi(publishContentPolicyVersionRoute, async (context) => {
    const { versionId } = context.req.valid("param");
    const version = await context.get("services").contentPolicyVersions.publish({
      subject: context.get("subject"),
      versionId,
    });
    return context.json({
      data: context.get("services").contentPolicyVersions.publicVersion(version),
    });
  });

  app.openapi(rollbackContentPolicyRoute, async (context) => {
    const body = context.req.valid("json");
    const version = await context.get("services").contentPolicyVersions.rollback({
      subject: context.get("subject"),
      ...(body.versionId === undefined ? {} : { versionId: body.versionId }),
    });
    return context.json({
      data: context.get("services").contentPolicyVersions.publicVersion(version),
    });
  });

  app.openapi(listContentPolicyDecisionsRoute, async (context) => {
    const data = await context
      .get("services")
      .contentPolicyVersions.listDecisions(context.get("subject"));
    return context.json({ data });
  });

  app.openapi(listContentPolicyApprovalsRoute, async (context) => {
    const data = await context
      .get("services")
      .contentPolicyApprovals.list(context.get("subject"));
    return context.json({ data });
  });

  app.openapi(requestContentPolicyApprovalRoute, async (context) => {
    const body = context.req.valid("json");
    const data = await context.get("services").contentPolicyApprovals.request({
      subject: context.get("subject"),
      runId: body.runId,
      decisionId: body.decisionId,
      expiresAt: body.expiresAt,
    });
    return context.json({ data });
  });

  app.openapi(resolveContentPolicyApprovalRoute, async (context) => {
    const { approvalId } = context.req.valid("param");
    const body = context.req.valid("json");
    const data = await context.get("services").contentPolicyApprovals.resolve({
      subject: context.get("subject"),
      approvalId,
      decision: body.decision,
      ...(body.runId === undefined ? {} : { runId: body.runId }),
    });
    return context.json({ data });
  });
}
