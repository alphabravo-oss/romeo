import type { AuthSubject } from "@romeo/auth";
import type { ToolApprovalPolicy, ToolRiskLevel } from "@romeo/tools";

import type { ToolConnector, ToolOperation } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { createId } from "../ids";
import { normalizeWebhookUrl } from "./webhook-url";
import { normalizeToolNetworkPolicy } from "./tool-network-policy";

export interface CreatedWebhookToolConnector {
  connector: ToolConnector;
  operations: ToolOperation[];
}

export async function createWebhookToolConnector(
  repository: RomeoRepository,
  subject: AuthSubject,
  input: {
    name: string;
    url: string;
    bodySchema?: Record<string, unknown>;
    description?: string;
    operationName?: string;
    riskLevel?: ToolRiskLevel;
    approvalPolicy?: ToolApprovalPolicy;
  },
): Promise<CreatedWebhookToolConnector> {
  const target = normalizeWebhookToolUrl(input.url);
  const now = new Date().toISOString();
  const riskLevel = input.riskLevel ?? "medium";
  const approvalPolicy = input.approvalPolicy ?? "external_side_effects";
  const connector: ToolConnector = {
    id: createId("tool_connector"),
    orgId: subject.orgId,
    type: "webhook",
    name: input.name,
    description: input.description ?? "",
    schema: {
      source: "webhook_tool",
      baseUrl: target.origin,
      targetHost: target.hostname,
      targetPath: target.path,
      operationCount: 1,
    },
    authConfig: { type: "none", configured: false },
    networkPolicy: normalizeToolNetworkPolicy({
      mode: "allow_hosts",
      allowedHosts: [target.hostname],
      allowPrivateNetwork: false,
    }),
    riskLevel,
    approvalPolicy,
    visibility: "org",
    enabled: false,
    createdAt: now,
    updatedAt: now,
  };

  const created = await repository.createToolConnector(connector);
  const operations = await repository.createToolOperations([
    {
      id: createId("tool_operation"),
      orgId: subject.orgId,
      connectorId: created.id,
      operationId: "invokeWebhook",
      method: "post",
      path: target.path,
      name: input.operationName ?? "Invoke webhook",
      description:
        input.description ??
        "Send a bounded JSON payload to the configured webhook target.",
      inputSchema: {
        parameters: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: normalizeWebhookBodySchema(input.bodySchema),
            },
          },
        },
      },
      outputSchema: {},
      riskLevel,
      approvalPolicy,
      enabled: false,
      createdAt: now,
    },
  ]);
  return { connector: created, operations };
}

function normalizeWebhookToolUrl(value: string): {
  hostname: string;
  origin: string;
  path: string;
} {
  const normalized = normalizeWebhookUrl(value);
  const url = new URL(normalized);
  if (url.search.length > 0) {
    throw new ApiError(
      "invalid_webhook_url",
      "Webhook tool URL must not include query parameters; use connector auth instead.",
      400,
    );
  }
  const path = url.pathname.length === 0 ? "/" : url.pathname;
  return {
    hostname: url.hostname.toLowerCase(),
    origin: url.origin,
    path,
  };
}

function normalizeWebhookBodySchema(
  schema: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (schema === undefined || Object.keys(schema).length === 0) {
    return { type: "object", additionalProperties: true };
  }
  return schema;
}
