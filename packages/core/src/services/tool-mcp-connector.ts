import { isIP } from "node:net";

import type { AuthSubject } from "@romeo/auth";
import type { ToolApprovalPolicy, ToolRiskLevel } from "@romeo/tools";

import type { ToolConnector, ToolOperation } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { createId } from "../ids";
import { normalizeToolNetworkPolicy } from "./tool-network-policy";

const blockedHostSuffixes = [".internal", ".local", ".localhost"];
const defaultMcpProtocolVersion = "2025-06-18";
const mcpToolNamePattern = /^[A-Za-z0-9_.:/-]{1,120}$/u;

export interface McpToolManifestEntry {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  riskLevel?: ToolRiskLevel;
  approvalPolicy?: ToolApprovalPolicy;
}

export interface CreatedMcpToolConnector {
  connector: ToolConnector;
  operations: ToolOperation[];
}

export async function createMcpToolConnector(
  repository: RomeoRepository,
  subject: AuthSubject,
  input: {
    name: string;
    serverUrl: string;
    description?: string;
    protocolVersion?: string;
    tools: McpToolManifestEntry[];
    riskLevel?: ToolRiskLevel;
    approvalPolicy?: ToolApprovalPolicy;
  },
): Promise<CreatedMcpToolConnector> {
  const target = normalizeMcpServerUrl(input.serverUrl);
  const protocolVersion = normalizeMcpProtocolVersion(input.protocolVersion);
  const tools = normalizeMcpTools(input.tools);
  const now = new Date().toISOString();
  const riskLevel = input.riskLevel ?? "medium";
  const approvalPolicy = input.approvalPolicy ?? "external_side_effects";
  const connector: ToolConnector = {
    id: createId("tool_connector"),
    orgId: subject.orgId,
    type: "mcp",
    name: input.name,
    description:
      input.description ??
      "Reviewed Streamable HTTP MCP connector with a static tool manifest.",
    schema: {
      source: "mcp_streamable_http",
      transport: "streamable_http",
      baseUrl: target.origin,
      serverHost: target.hostname,
      serverPath: target.path,
      mcpProtocolVersion: protocolVersion,
      operationCount: tools.length,
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
  const operations = await repository.createToolOperations(
    tools.map((tool) => ({
      id: createId("tool_operation"),
      orgId: subject.orgId,
      connectorId: created.id,
      operationId: tool.operationId,
      method: "post",
      path: target.path,
      name: tool.name,
      description:
        tool.description ??
        `Call the reviewed MCP tool "${tool.name}" over Streamable HTTP.`,
      inputSchema: {
        parameters: [],
        requestBody: {
          required: false,
          content: {
            "application/json": {
              schema: normalizeMcpInputSchema(tool.inputSchema),
            },
          },
        },
        mcpToolName: tool.name,
        mcpProtocolVersion: protocolVersion,
      },
      outputSchema: {
        type: "object",
        additionalProperties: true,
      },
      riskLevel: tool.riskLevel ?? riskLevel,
      approvalPolicy: tool.approvalPolicy ?? approvalPolicy,
      enabled: false,
      createdAt: now,
    })),
  );
  return { connector: created, operations };
}

function normalizeMcpServerUrl(value: string): {
  hostname: string;
  origin: string;
  path: string;
} {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApiError(
      "invalid_mcp_server_url",
      "MCP server URL must be a valid absolute HTTPS URL.",
      400,
    );
  }
  if (url.protocol !== "https:") {
    throw new ApiError(
      "invalid_mcp_server_url",
      "MCP server URL must use HTTPS.",
      400,
    );
  }
  if (url.username || url.password || url.hash || url.search.length > 0) {
    throw new ApiError(
      "invalid_mcp_server_url",
      "MCP server URL must not include credentials, fragments, or query parameters.",
      400,
    );
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[(.*)\]$/u, "$1");
  if (
    hostname === "localhost" ||
    blockedHostSuffixes.some((suffix) => hostname.endsWith(suffix)) ||
    isIP(hostname) !== 0
  ) {
    throw new ApiError(
      "invalid_mcp_server_url",
      "MCP server URL host is not allowed.",
      400,
    );
  }
  return {
    hostname,
    origin: url.origin,
    path: url.pathname.length === 0 ? "/" : url.pathname,
  };
}

function normalizeMcpProtocolVersion(value: string | undefined): string {
  if (value === undefined || value.length === 0)
    return defaultMcpProtocolVersion;
  if (/^\d{4}-\d{2}-\d{2}$/u.test(value)) return value;
  throw new ApiError(
    "invalid_mcp_protocol_version",
    "MCP protocol version must use YYYY-MM-DD format.",
    400,
  );
}

function normalizeMcpTools(
  tools: McpToolManifestEntry[],
): Array<McpToolManifestEntry & { operationId: string }> {
  const names = new Set<string>();
  const operationIds = new Set<string>();
  return tools.map((tool, index) => {
    if (!mcpToolNamePattern.test(tool.name)) {
      throw new ApiError(
        "invalid_mcp_tool_manifest",
        "MCP tool names must use letters, numbers, dot, underscore, colon, slash, or hyphen and be at most 120 characters.",
        400,
      );
    }
    if (names.has(tool.name)) {
      throw new ApiError(
        "invalid_mcp_tool_manifest",
        "MCP tool names must be unique.",
        400,
      );
    }
    names.add(tool.name);
    const baseOperationId = slugMcpToolName(tool.name) || `mcpTool${index + 1}`;
    const operationId = uniqueOperationId(baseOperationId, operationIds);
    operationIds.add(operationId);
    return { ...tool, operationId };
  });
}

function normalizeMcpInputSchema(
  schema: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (schema === undefined || Object.keys(schema).length === 0) {
    return { type: "object", additionalProperties: true };
  }
  return schema;
}

function slugMcpToolName(value: string): string {
  return value
    .replace(/[^A-Za-z0-9_.-]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 80);
}

function uniqueOperationId(base: string, used: Set<string>): string {
  if (!used.has(base)) return base;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base}_${index}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new ApiError(
    "invalid_mcp_tool_manifest",
    "MCP tool manifest contains too many colliding tool names.",
    400,
  );
}
