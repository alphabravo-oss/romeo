import type { RomeoApi } from "../context";
import { dispatchWaitFromToolOutput } from "../../services/run-service";
import {
  cancelToolOperationDispatchRequestSchema,
  claimToolOperationDispatchRequestSchema,
  createMcpToolSchema,
  completeToolOperationDispatchRequestSchema,
  createWebhookToolSchema,
  executeRunToolSchema,
  executeToolSchema,
  dispatchToolOperationSchema,
  enqueueToolOperationDispatchSchema,
  expireToolOperationDispatchRequestsSchema,
  failToolOperationDispatchRequestSchema,
  importOpenApiToolSchema,
  testToolOperationSchema,
  updateAgentToolBindingSchema,
  updateToolConnectorAuthSchema,
  updateToolConnectorNetworkPolicySchema,
  updateToolConnectorSchema,
  updateToolOperationSchema,
} from "../schemas";

export function registerToolRoutes(app: RomeoApi): void {
  app.get("/api/v1/tools", (context) => {
    const subject = context.get("subject");
    const data = context.get("services").tools.list(subject);
    return context.json({ data });
  });

  app.get("/api/v1/tool-calls", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .tools.listCalls(subject, context.req.query("agentId"));
    return context.json({ data });
  });

  app.get("/api/v1/tool-approvals", async (context) => {
    const subject = context.get("subject");
    const agentId = context.req.query("agentId");
    const runId = context.req.query("runId");
    const input: { agentId?: string; runId?: string } = {};
    if (agentId !== undefined) input.agentId = agentId;
    if (runId !== undefined) input.runId = runId;
    const data = await context
      .get("services")
      .tools.listPendingApprovals(subject, input);
    return context.json({ data });
  });

  app.post(
    "/api/v1/tool-approvals/:approvalRequestId/approve",
    async (context) => {
      const subject = context.get("subject");
      const data = await context
        .get("services")
        .tools.approveApproval(subject, context.req.param("approvalRequestId"));
      return context.json({ data });
    },
  );

  app.post(
    "/api/v1/tool-approvals/:approvalRequestId/cancel",
    async (context) => {
      const subject = context.get("subject");
      const data = await context
        .get("services")
        .tools.cancelApproval(subject, context.req.param("approvalRequestId"));
      return context.json({ data });
    },
  );

  app.post(
    "/api/v1/tool-approvals/:approvalRequestId/reject",
    async (context) => {
      const subject = context.get("subject");
      const data = await context
        .get("services")
        .tools.rejectApproval(subject, context.req.param("approvalRequestId"));
      return context.json({ data });
    },
  );

  app.get("/api/v1/tool-connectors", async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").toolConnectors.list(subject);
    return context.json({ data });
  });

  app.get("/api/v1/tool-connectors/catalog", async (context) => {
    const subject = context.get("subject");
    const data = context.get("services").toolConnectors.catalog(subject);
    return context.json({ data });
  });

  app.patch("/api/v1/tool-connectors/:connectorId", async (context) => {
    const subject = context.get("subject");
    const body = updateToolConnectorSchema.parse(await context.req.json());
    const data = await context.get("services").toolConnectors.updateConnector({
      subject,
      connectorId: context.req.param("connectorId"),
      enabled: body.enabled,
    });
    return context.json({ data });
  });

  app.post("/api/v1/tools/openapi", async (context) => {
    const subject = context.get("subject");
    const body = importOpenApiToolSchema.parse(await context.req.json());
    const input: {
      subject: typeof subject;
      name: string;
      description?: string;
      spec: Record<string, unknown>;
      riskLevel?: "low" | "medium" | "high" | "critical";
      approvalPolicy?:
        | "never"
        | "write_operations"
        | "external_side_effects"
        | "always"
        | "admin_only";
    } = { subject, name: body.name, spec: body.spec };
    if (body.description !== undefined) input.description = body.description;
    if (body.riskLevel !== undefined) input.riskLevel = body.riskLevel;
    if (body.approvalPolicy !== undefined)
      input.approvalPolicy = body.approvalPolicy;
    const data = await context
      .get("services")
      .toolConnectors.importOpenApi(input);
    return context.json({ data }, 201);
  });

  app.post("/api/v1/tools/webhook", async (context) => {
    const subject = context.get("subject");
    const body = createWebhookToolSchema.parse(await context.req.json());
    const input: {
      subject: typeof subject;
      name: string;
      url: string;
      bodySchema?: Record<string, unknown>;
      description?: string;
      operationName?: string;
      riskLevel?: "low" | "medium" | "high" | "critical";
      approvalPolicy?:
        | "never"
        | "write_operations"
        | "external_side_effects"
        | "always"
        | "admin_only";
    } = { subject, name: body.name, url: body.url };
    if (body.bodySchema !== undefined) input.bodySchema = body.bodySchema;
    if (body.description !== undefined) input.description = body.description;
    if (body.operationName !== undefined)
      input.operationName = body.operationName;
    if (body.riskLevel !== undefined) input.riskLevel = body.riskLevel;
    if (body.approvalPolicy !== undefined)
      input.approvalPolicy = body.approvalPolicy;
    const data = await context
      .get("services")
      .toolConnectors.createWebhook(input);
    return context.json({ data }, 201);
  });

  app.post("/api/v1/tools/mcp", async (context) => {
    const subject = context.get("subject");
    const body = createMcpToolSchema.parse(await context.req.json());
    const input: {
      subject: typeof subject;
      name: string;
      serverUrl: string;
      description?: string;
      protocolVersion?: string;
      tools: Array<{
        name: string;
        description?: string;
        inputSchema?: Record<string, unknown>;
        riskLevel?: "low" | "medium" | "high" | "critical";
        approvalPolicy?:
          | "never"
          | "write_operations"
          | "external_side_effects"
          | "always"
          | "admin_only";
      }>;
      riskLevel?: "low" | "medium" | "high" | "critical";
      approvalPolicy?:
        | "never"
        | "write_operations"
        | "external_side_effects"
        | "always"
        | "admin_only";
    } = { subject, name: body.name, serverUrl: body.serverUrl, tools: [] };
    if (body.description !== undefined) input.description = body.description;
    if (body.protocolVersion !== undefined)
      input.protocolVersion = body.protocolVersion;
    input.tools = body.tools.map((tool) => ({
      name: tool.name,
      ...(tool.description === undefined
        ? {}
        : { description: tool.description }),
      ...(tool.inputSchema === undefined
        ? {}
        : { inputSchema: tool.inputSchema }),
      ...(tool.riskLevel === undefined ? {} : { riskLevel: tool.riskLevel }),
      ...(tool.approvalPolicy === undefined
        ? {}
        : { approvalPolicy: tool.approvalPolicy }),
    }));
    if (body.riskLevel !== undefined) input.riskLevel = body.riskLevel;
    if (body.approvalPolicy !== undefined)
      input.approvalPolicy = body.approvalPolicy;
    const data = await context.get("services").toolConnectors.createMcp(input);
    return context.json({ data }, 201);
  });

  app.patch("/api/v1/tool-connectors/:connectorId/auth", async (context) => {
    const subject = context.get("subject");
    const body = updateToolConnectorAuthSchema.parse(await context.req.json());
    const input: {
      subject: typeof subject;
      connectorId: string;
      type: "none" | "api_key" | "bearer" | "oauth2_client_credentials";
      secretRef?: string;
      apiKeyIn?: "header" | "query";
      apiKeyName?: string;
      oauthClientAuthMethod?: "client_secret_basic" | "client_secret_post";
      oauthScopes?: string[];
      oauthTokenUrl?: string;
    } = {
      subject,
      connectorId: context.req.param("connectorId"),
      type: body.type,
    };
    if (body.secretRef !== undefined) input.secretRef = body.secretRef;
    if (body.apiKeyIn !== undefined) input.apiKeyIn = body.apiKeyIn;
    if (body.apiKeyName !== undefined) input.apiKeyName = body.apiKeyName;
    if (body.oauthClientAuthMethod !== undefined)
      input.oauthClientAuthMethod = body.oauthClientAuthMethod;
    if (body.oauthScopes !== undefined) input.oauthScopes = body.oauthScopes;
    if (body.oauthTokenUrl !== undefined)
      input.oauthTokenUrl = body.oauthTokenUrl;
    const data = await context.get("services").toolConnectors.updateAuth(input);
    return context.json({ data });
  });

  app.post(
    "/api/v1/tool-connectors/:connectorId/auth/check",
    async (context) => {
      const subject = context.get("subject");
      const data = await context
        .get("services")
        .toolConnectors.checkAuth(subject, context.req.param("connectorId"));
      return context.json({ data });
    },
  );

  app.patch(
    "/api/v1/tool-connectors/:connectorId/network-policy",
    async (context) => {
      const subject = context.get("subject");
      const body = updateToolConnectorNetworkPolicySchema.parse(
        await context.req.json(),
      );
      const data = await context
        .get("services")
        .toolConnectors.updateNetworkPolicy({
          subject,
          connectorId: context.req.param("connectorId"),
          policy: body,
        });
      return context.json({ data });
    },
  );

  app.get(
    "/api/v1/tool-connectors/:connectorId/operations",
    async (context) => {
      const subject = context.get("subject");
      const data = await context
        .get("services")
        .toolConnectors.listOperations(
          subject,
          context.req.param("connectorId"),
        );
      return context.json({ data });
    },
  );

  app.patch(
    "/api/v1/tool-connectors/:connectorId/operations/:operationId",
    async (context) => {
      const subject = context.get("subject");
      const body = updateToolOperationSchema.parse(await context.req.json());
      const data = await context
        .get("services")
        .toolConnectors.updateOperation({
          subject,
          connectorId: context.req.param("connectorId"),
          operationId: context.req.param("operationId"),
          enabled: body.enabled,
        });
      return context.json({ data });
    },
  );

  app.post(
    "/api/v1/tool-connectors/:connectorId/operations/:operationId/test",
    async (context) => {
      const subject = context.get("subject");
      const body = testToolOperationSchema.parse(await context.req.json());
      const input: {
        subject: typeof subject;
        connectorId: string;
        operationId: string;
        parameters?: Record<string, unknown>;
        body?: Record<string, unknown>;
      } = {
        subject,
        connectorId: context.req.param("connectorId"),
        operationId: context.req.param("operationId"),
      };
      if (body.parameters !== undefined) input.parameters = body.parameters;
      if (body.body !== undefined) input.body = body.body;
      const data = await context
        .get("services")
        .toolConnectors.testOperation(input);
      return context.json({ data });
    },
  );

  app.post(
    "/api/v1/tool-connectors/:connectorId/operations/:operationId/dispatch",
    async (context) => {
      const subject = context.get("subject");
      const body = enqueueToolOperationDispatchSchema.parse(
        await context.req.json(),
      );
      const input: {
        approvalRequestId?: string;
        approved?: boolean;
        idempotencyKey?: string;
        subject: typeof subject;
        connectorId: string;
        operationId: string;
        parameters?: Record<string, unknown>;
        body?: Record<string, unknown>;
      } = {
        subject,
        connectorId: context.req.param("connectorId"),
        operationId: context.req.param("operationId"),
      };
      if (body.approved !== undefined) input.approved = body.approved;
      if (body.approvalRequestId !== undefined)
        input.approvalRequestId = body.approvalRequestId;
      if (body.idempotencyKey !== undefined)
        input.idempotencyKey = body.idempotencyKey;
      if (body.parameters !== undefined) input.parameters = body.parameters;
      if (body.body !== undefined) input.body = body.body;
      const data = await context
        .get("services")
        .toolConnectors.dispatchOperation(input);
      return context.json({ data });
    },
  );

  app.post(
    "/api/v1/tool-connectors/:connectorId/operations/:operationId/dispatch-requests",
    async (context) => {
      const subject = context.get("subject");
      const body = enqueueToolOperationDispatchSchema.parse(
        await context.req.json(),
      );
      const input: {
        approvalRequestId?: string;
        approved?: boolean;
        idempotencyKey?: string;
        subject: typeof subject;
        connectorId: string;
        operationId: string;
        parameters?: Record<string, unknown>;
        body?: Record<string, unknown>;
      } = {
        subject,
        connectorId: context.req.param("connectorId"),
        operationId: context.req.param("operationId"),
      };
      if (body.approved !== undefined) input.approved = body.approved;
      if (body.approvalRequestId !== undefined)
        input.approvalRequestId = body.approvalRequestId;
      if (body.idempotencyKey !== undefined)
        input.idempotencyKey = body.idempotencyKey;
      if (body.parameters !== undefined) input.parameters = body.parameters;
      if (body.body !== undefined) input.body = body.body;
      const data = await context
        .get("services")
        .toolConnectors.enqueueDispatchOperation(input);
      return context.json({ data });
    },
  );

  app.post(
    "/api/v1/tool-operation-dispatch-requests/claim",
    async (context) => {
      const subject = context.get("subject");
      const body = claimToolOperationDispatchRequestSchema.parse(
        await context.req.json(),
      );
      const data = await context
        .get("services")
        .toolConnectors.claimDispatchRequest({
          subject,
          leaseSeconds: body.leaseSeconds,
          ...(body.payloadStorage === undefined
            ? {}
            : { payloadStorage: body.payloadStorage }),
        });
      return context.json({ data });
    },
  );

  app.post(
    "/api/v1/tool-operation-dispatch-requests/:jobId/payload",
    async (context) => {
      const subject = context.get("subject");
      const data = await context
        .get("services")
        .toolConnectors.readDispatchRequestPayload({
          subject,
          jobId: context.req.param("jobId"),
        });
      return context.json({ data });
    },
  );

  app.post(
    "/api/v1/tool-operation-dispatch-requests/expire",
    async (context) => {
      const subject = context.get("subject");
      const body = expireToolOperationDispatchRequestsSchema.parse(
        await context.req.json(),
      );
      const data = await context
        .get("services")
        .toolConnectors.expireDispatchRequests({
          subject,
          queuedTimeoutSeconds: body.queuedTimeoutSeconds,
          runningTimeoutSeconds: body.runningTimeoutSeconds,
          limit: body.limit,
        });
      return context.json({ data });
    },
  );

  app.post(
    "/api/v1/tool-operation-dispatch-requests/:jobId/renew-lease",
    async (context) => {
      const subject = context.get("subject");
      const body = claimToolOperationDispatchRequestSchema.parse(
        await context.req.json(),
      );
      const data = await context
        .get("services")
        .toolConnectors.renewDispatchRequestLease({
          subject,
          jobId: context.req.param("jobId"),
          leaseSeconds: body.leaseSeconds,
        });
      return context.json({ data });
    },
  );

  app.post(
    "/api/v1/tool-operation-dispatch-requests/:jobId/complete",
    async (context) => {
      const subject = context.get("subject");
      const body = completeToolOperationDispatchRequestSchema.parse(
        await context.req.json(),
      );
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
        .toolConnectors.completeDispatchRequest({
          subject,
          jobId: context.req.param("jobId"),
          response,
        });
      await context.get("services").runs.resumeAfterDispatchRequestReadback({
        subject,
        jobId: context.req.param("jobId"),
        response,
      });
      return context.json({ data });
    },
  );

  app.post(
    "/api/v1/tool-operation-dispatch-requests/:jobId/fail",
    async (context) => {
      const subject = context.get("subject");
      const body = failToolOperationDispatchRequestSchema.parse(
        await context.req.json(),
      );
      const data = await context
        .get("services")
        .toolConnectors.failDispatchRequest({
          subject,
          jobId: context.req.param("jobId"),
          errorCode: body.errorCode,
        });
      await context.get("services").runs.resumeAfterDispatchRequestReadback({
        subject,
        jobId: context.req.param("jobId"),
        errorCode: body.errorCode,
      });
      return context.json({ data });
    },
  );

  app.post(
    "/api/v1/tool-operation-dispatch-requests/:jobId/cancel",
    async (context) => {
      const subject = context.get("subject");
      const body = cancelToolOperationDispatchRequestSchema.parse(
        await context.req.json(),
      );
      const data = await context
        .get("services")
        .toolConnectors.cancelDispatchRequest({
          subject,
          jobId: context.req.param("jobId"),
          ...(body.reasonCode === undefined
            ? {}
            : { reasonCode: body.reasonCode }),
        });
      return context.json({ data });
    },
  );

  app.get("/api/v1/agents/:agentId/tools", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .tools.listForAgent(subject, context.req.param("agentId"));
    return context.json({ data });
  });

  app.patch("/api/v1/agents/:agentId/tools/:toolId", async (context) => {
    const subject = context.get("subject");
    const body = updateAgentToolBindingSchema.parse(await context.req.json());
    const input: {
      subject: typeof subject;
      agentId: string;
      toolId: string;
      enabled?: boolean;
      approvalRequired?: boolean;
    } = {
      subject,
      agentId: context.req.param("agentId"),
      toolId: context.req.param("toolId"),
    };
    if (body.enabled !== undefined) input.enabled = body.enabled;
    if (body.approvalRequired !== undefined)
      input.approvalRequired = body.approvalRequired;

    const data = await context.get("services").tools.updateBinding(input);
    return context.json({ data });
  });

  app.post("/api/v1/tools/:toolId/execute", async (context) => {
    const subject = context.get("subject");
    const body = executeToolSchema.parse(await context.req.json());
    const options: {
      agentId: string;
      approved?: boolean;
      approvalRequestId?: string;
      idempotencyKey?: string;
      runId?: string;
    } = { agentId: body.agentId };
    if (body.approved !== undefined) options.approved = body.approved;
    if (body.approvalRequestId !== undefined)
      options.approvalRequestId = body.approvalRequestId;
    if (body.idempotencyKey !== undefined)
      options.idempotencyKey = body.idempotencyKey;
    if (body.modelToolCallId !== undefined)
      options.idempotencyKey = body.modelToolCallId;
    if (body.runId !== undefined) options.runId = body.runId;
    const data = await context
      .get("services")
      .tools.execute(subject, context.req.param("toolId"), body.input, options);
    return context.json({ data });
  });

  app.post("/api/v1/runs/:runId/tools/:toolId/execute", async (context) => {
    const subject = context.get("subject");
    const body = executeRunToolSchema.parse(await context.req.json());
    const options: {
      approved?: boolean;
      approvalRequestId?: string;
      modelToolCallId?: string;
    } = {};
    if (body.approved !== undefined) options.approved = body.approved;
    if (body.approvalRequestId !== undefined)
      options.approvalRequestId = body.approvalRequestId;
    if (body.modelToolCallId !== undefined)
      options.modelToolCallId = body.modelToolCallId;
    if (
      options.modelToolCallId === undefined &&
      body.approved === true &&
      body.approvalRequestId !== undefined
    ) {
      options.modelToolCallId = body.approvalRequestId;
    }
    const services = context.get("services");
    const runId = context.req.param("runId");
    const toolId = context.req.param("toolId");
    const data = await services.tools.executeForRun(
      subject,
      runId,
      toolId,
      body.input,
      options,
    );
    if (body.approved === true && body.approvalRequestId !== undefined) {
      const dispatchWait = dispatchWaitFromToolOutput(data);
      if (dispatchWait === undefined) {
        void services.runs
          .resumeAfterApprovedTool({
            subject,
            runId,
            toolId,
            toolInput: body.input,
            toolResult: data,
            approvalRequestId: body.approvalRequestId,
          })
          .catch(() => undefined);
      } else {
        await services.runs.waitForDispatchRequest({
          subject,
          runId,
          toolId,
          dispatch: dispatchWait,
        });
      }
    }
    return context.json({ data });
  });
}
