import type { RomeoApi } from "../context";
import {
  approveToolApprovalRoute,
  cancelToolApprovalRoute,
  checkToolConnectorAuthRoute,
  createMcpToolRoute,
  createWebhookToolRoute,
  dispatchToolOperationRoute,
  executeRunToolRoute,
  executeToolRoute,
  getToolConnectorCatalogRoute,
  importOpenApiToolRoute,
  listAgentToolsRoute,
  listToolApprovalsRoute,
  listToolCallsRoute,
  listToolConnectorsRoute,
  listToolOperationsRoute,
  listToolsRoute,
  rejectToolApprovalRoute,
  testToolOperationRoute,
  updateAgentToolBindingRoute,
  updateToolConnectorAuthRoute,
  updateToolConnectorNetworkPolicyRoute,
  updateToolConnectorRoute,
  updateToolOperationRoute,
} from "@romeo/contracts";
import { dispatchWaitFromToolOutput } from "../../services/run-tool-service";
import { registerToolDispatchRoutes } from "./tool-dispatch";

export function registerToolRoutes(app: RomeoApi): void {
  registerToolDispatchRoutes(app);
  app.openapi(listToolsRoute, (context) => {
    const subject = context.get("subject");
    const data = context.get("services").tools.list(subject);
    return context.json({ data }, 200);
  });

  app.openapi(listToolCallsRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .tools.listCalls(subject, context.req.valid("query").agentId);
    return context.json({ data }, 200);
  });

  app.openapi(listToolApprovalsRoute, async (context) => {
    const subject = context.get("subject");
    const { agentId, runId } = context.req.valid("query");
    const input: { agentId?: string; runId?: string } = {};
    if (agentId !== undefined) input.agentId = agentId;
    if (runId !== undefined) input.runId = runId;
    const data = await context
      .get("services")
      .tools.listPendingApprovals(subject, input);
    return context.json({ data }, 200);
  });

  app.openapi(approveToolApprovalRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .tools.approveApproval(
        subject,
        context.req.valid("param").approvalRequestId,
      );
    return context.json({ data }, 200);
  });

  app.openapi(cancelToolApprovalRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .tools.cancelApproval(
        subject,
        context.req.valid("param").approvalRequestId,
      );
    return context.json({ data }, 200);
  });

  app.openapi(rejectToolApprovalRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .tools.rejectApproval(
        subject,
        context.req.valid("param").approvalRequestId,
      );
    return context.json({ data }, 200);
  });

  app.openapi(listToolConnectorsRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").toolConnectors.list(subject);
    return context.json({ data }, 200);
  });

  app.openapi(getToolConnectorCatalogRoute, async (context) => {
    const subject = context.get("subject");
    const data = context.get("services").toolConnectors.catalog(subject);
    return context.json({ data }, 200);
  });

  app.openapi(updateToolConnectorRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context.get("services").toolConnectors.updateConnector({
      subject,
      connectorId: context.req.valid("param").connectorId,
      enabled: body.enabled,
    });
    return context.json({ data }, 200);
  });

  app.openapi(importOpenApiToolRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
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

  app.openapi(createWebhookToolRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
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

  app.openapi(createMcpToolRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
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

  app.openapi(updateToolConnectorAuthRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
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
      connectorId: context.req.valid("param").connectorId,
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
    return context.json({ data }, 200);
  });

  app.openapi(checkToolConnectorAuthRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .toolConnectors.checkAuth(
        subject,
        context.req.valid("param").connectorId,
      );
    return context.json({ data }, 200);
  });

  app.openapi(updateToolConnectorNetworkPolicyRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context
      .get("services")
      .toolConnectors.updateNetworkPolicy({
        subject,
        connectorId: context.req.valid("param").connectorId,
        policy: body,
      });
    return context.json({ data }, 200);
  });

  app.openapi(listToolOperationsRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .toolConnectors.listOperations(
        subject,
        context.req.valid("param").connectorId,
      );
    return context.json({ data }, 200);
  });

  app.openapi(updateToolOperationRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const { connectorId, operationId } = context.req.valid("param");
    const data = await context.get("services").toolConnectors.updateOperation({
      subject,
      connectorId,
      operationId,
      enabled: body.enabled,
    });
    return context.json({ data }, 200);
  });

  app.openapi(testToolOperationRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const { connectorId, operationId } = context.req.valid("param");
    const input: {
      subject: typeof subject;
      connectorId: string;
      operationId: string;
      parameters?: Record<string, unknown>;
      body?: Record<string, unknown>;
    } = {
      subject,
      connectorId,
      operationId,
    };
    if (body.parameters !== undefined) input.parameters = body.parameters;
    if (body.body !== undefined) input.body = body.body;
    const data = await context
      .get("services")
      .toolConnectors.testOperation(input);
    return context.json({ data }, 200);
  });

  app.openapi(dispatchToolOperationRoute, async (context) => {
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
    } = {
      subject,
      connectorId,
      operationId,
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
    return context.json({ data }, 200);
  });

  app.openapi(listAgentToolsRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .tools.listForAgent(subject, context.req.valid("param").agentId);
    return context.json({ data }, 200);
  });

  app.openapi(updateAgentToolBindingRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const { agentId, toolId } = context.req.valid("param");
    const input: {
      subject: typeof subject;
      agentId: string;
      toolId: string;
      enabled?: boolean;
      approvalRequired?: boolean;
    } = {
      subject,
      agentId,
      toolId,
    };
    if (body.enabled !== undefined) input.enabled = body.enabled;
    if (body.approvalRequired !== undefined)
      input.approvalRequired = body.approvalRequired;

    const data = await context.get("services").tools.updateBinding(input);
    return context.json({ data }, 200);
  });

  app.openapi(executeToolRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
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
      .tools.execute(
        subject,
        context.req.valid("param").toolId,
        body.input,
        options,
      );
    return context.json({ data }, 200);
  });

  app.openapi(executeRunToolRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
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
    const { runId, toolId } = context.req.valid("param");
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
    return context.json({ data }, 200);
  });
}
