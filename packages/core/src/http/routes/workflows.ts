import {
  approveWorkflowRunRoute,
  WorkflowRunSchema,
  WorkflowScheduleRunResultSchema,
  WorkflowSchema,
  WorkflowTemplateSchema,
  createWorkflowFromTemplateRoute,
  createWorkflowRoute,
  listWorkflowRunsRoute,
  listWorkflowTemplatesRoute,
  listWorkflowsRoute,
  resumeWorkflowRunRoute,
  runDueWorkflowSchedulesRoute,
  startWorkflowRunRoute,
} from "@romeo/contracts";

import type { RomeoApi } from "../context";

export function registerWorkflowRoutes(app: RomeoApi): void {
  app.openapi(listWorkflowTemplatesRoute, async (context) => {
    const subject = context.get("subject");
    const data = WorkflowTemplateSchema.array().parse(
      context.get("services").workflows.listTemplates(subject),
    );
    return context.json({ data });
  });

  app.openapi(createWorkflowFromTemplateRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = WorkflowSchema.parse(
      await context.get("services").workflows.createFromTemplate({
        subject,
        templateId: context.req.valid("param").templateId,
        workspaceId: body.workspaceId,
        ...(body.agentId === undefined ? {} : { agentId: body.agentId }),
        ...(body.name === undefined ? {} : { name: body.name }),
        ...(body.schedule === undefined ? {} : { schedule: body.schedule }),
      }),
    );
    return context.json({ data }, 201);
  });

  app.openapi(listWorkflowsRoute, async (context) => {
    const subject = context.get("subject");
    const data = WorkflowSchema.array().parse(
      await context
        .get("services")
        .workflows.list(subject, context.req.valid("query").workspaceId),
    );
    return context.json({ data });
  });

  app.openapi(createWorkflowRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = WorkflowSchema.parse(
      await context.get("services").workflows.create({
        subject,
        workspaceId: body.workspaceId,
        name: body.name,
        ...(body.description === undefined
          ? {}
          : { description: body.description }),
        steps: body.steps,
        ...(body.schedule === undefined ? {} : { schedule: body.schedule }),
      }),
    );
    return context.json({ data }, 201);
  });

  app.openapi(runDueWorkflowSchedulesRoute, async (context) => {
    const subject = context.get("subject");
    const data = WorkflowScheduleRunResultSchema.parse(
      await context.get("services").workflows.runDueSchedules(subject),
    );
    return context.json({ data });
  });

  app.openapi(listWorkflowRunsRoute, async (context) => {
    const subject = context.get("subject");
    const data = WorkflowRunSchema.array().parse(
      await context
        .get("services")
        .workflows.listRuns(subject, context.req.valid("param").workflowId),
    );
    return context.json({ data });
  });

  app.openapi(startWorkflowRunRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json") ?? {};
    const data = WorkflowRunSchema.parse(
      await context.get("services").workflows.startRun({
        subject,
        workflowId: context.req.valid("param").workflowId,
        ...(body.input === undefined ? {} : { runInput: body.input }),
      }),
    );
    return context.json({ data }, 201);
  });

  app.openapi(approveWorkflowRunRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json") ?? {};
    const data = WorkflowRunSchema.parse(
      await context.get("services").workflows.approve({
        subject,
        workflowRunId: context.req.valid("param").workflowRunId,
        ...(body.comment === undefined ? {} : { comment: body.comment }),
      }),
    );
    return context.json({ data });
  });

  app.openapi(resumeWorkflowRunRoute, async (context) => {
    const subject = context.get("subject");
    const data = WorkflowRunSchema.parse(
      await context.get("services").workflows.resume({
        subject,
        workflowRunId: context.req.valid("param").workflowRunId,
      }),
    );
    return context.json({ data });
  });
}
