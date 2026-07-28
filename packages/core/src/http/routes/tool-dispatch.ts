import {
  cancelToolDispatchRequestRoute,
  claimToolDispatchRequestRoute,
  completeToolDispatchRequestRoute,
  enqueueToolDispatchRequestRoute,
  expireToolDispatchRequestsRoute,
  failToolDispatchRequestRoute,
  readToolDispatchRequestPayloadRoute,
  renewToolDispatchRequestLeaseRoute,
} from "@romeo/contracts";

import type { RomeoApi } from "../context";

export function registerToolDispatchRoutes(app: RomeoApi): void {
  app.openapi(enqueueToolDispatchRequestRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const { connectorId, operationId } = context.req.valid("param");
    const input: {
      approvalRequestId?: string;
      approved?: boolean;
      idempotencyKey?: string;
      subject: typeof subject;
      connectorId: string;
      operationId: string;
      parameters?: Record<string, unknown>;
      body?: Record<string, unknown>;
    } = { subject, connectorId, operationId };
    if (body.approved !== undefined) input.approved = body.approved;
    if (body.approvalRequestId !== undefined) {
      input.approvalRequestId = body.approvalRequestId;
    }
    if (body.idempotencyKey !== undefined) {
      input.idempotencyKey = body.idempotencyKey;
    }
    if (body.parameters !== undefined) input.parameters = body.parameters;
    if (body.body !== undefined) input.body = body.body;
    const data = await context
      .get("services")
      .toolConnectors.enqueueDispatchOperation(input);
    return context.json({ data }, 200);
  });

  app.openapi(claimToolDispatchRequestRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context
      .get("services")
      .toolConnectors.claimDispatchRequest({
        subject,
        leaseSeconds: body.leaseSeconds,
        ...(body.payloadStorage === undefined
          ? {}
          : { payloadStorage: body.payloadStorage }),
      });
    return context.json({ data }, 200);
  });

  app.openapi(readToolDispatchRequestPayloadRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .toolConnectors.readDispatchRequestPayload({
        subject,
        jobId: context.req.valid("param").jobId,
      });
    return context.json({ data }, 200);
  });

  app.openapi(expireToolDispatchRequestsRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context
      .get("services")
      .toolConnectors.expireDispatchRequests({
        subject,
        queuedTimeoutSeconds: body.queuedTimeoutSeconds,
        runningTimeoutSeconds: body.runningTimeoutSeconds,
        limit: body.limit,
      });
    return context.json({ data }, 200);
  });

  app.openapi(renewToolDispatchRequestLeaseRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context
      .get("services")
      .toolConnectors.renewDispatchRequestLease({
        subject,
        jobId: context.req.valid("param").jobId,
        leaseSeconds: body.leaseSeconds,
      });
    return context.json({ data }, 200);
  });

  app.openapi(completeToolDispatchRequestRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const { jobId } = context.req.valid("param");
    const response = {
      ok: body.response.ok,
      status: body.response.status,
      ...(body.response.contentType === undefined
        ? {}
        : { contentType: body.response.contentType }),
      bodyBytes: body.response.bodyBytes,
      truncated: body.response.truncated,
      schemaValidation: {
        status: body.response.schemaValidation.status,
        ...(body.response.schemaValidation.errorCode === undefined
          ? {}
          : { errorCode: body.response.schemaValidation.errorCode }),
      },
    };
    const data = await context
      .get("services")
      .toolConnectors.completeDispatchRequest({ subject, jobId, response });
    await context.get("services").runs.resumeAfterDispatchRequestReadback({
      subject,
      jobId,
      response,
    });
    return context.json({ data }, 200);
  });

  app.openapi(failToolDispatchRequestRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const { jobId } = context.req.valid("param");
    const data = await context
      .get("services")
      .toolConnectors.failDispatchRequest({
        subject,
        jobId,
        errorCode: body.errorCode,
      });
    await context.get("services").runs.resumeAfterDispatchRequestReadback({
      subject,
      jobId,
      errorCode: body.errorCode,
    });
    return context.json({ data }, 200);
  });

  app.openapi(cancelToolDispatchRequestRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context
      .get("services")
      .toolConnectors.cancelDispatchRequest({
        subject,
        jobId: context.req.valid("param").jobId,
        ...(body.reasonCode === undefined
          ? {}
          : { reasonCode: body.reasonCode }),
      });
    return context.json({ data }, 200);
  });
}
