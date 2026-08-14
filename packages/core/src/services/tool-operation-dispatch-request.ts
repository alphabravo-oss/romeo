import { ROMEO_PRODUCT_VERSION } from "@romeo/contracts";

import type {
  ToolConnector,
  ToolOperation,
  ToolOperationDispatchTransport,
} from "../domain/entities";
import { ApiError } from "../errors";
import {
  assertConnectorHostAllowed,
  type WebsiteConnectorHostAddress,
  type WebsiteConnectorHostLookup,
} from "./data-connector-network-policy";
import { resolveOAuthClientCredentialsAccessToken } from "./tool-oauth-client-credentials";
import type { DispatchToolOperationInput } from "./tool-operation-dispatch-types";
import {
  declaredParameters,
  escapeRegExp,
} from "./tool-operation-dispatch-execution";

export async function buildRequest(input: DispatchToolOperationInput): Promise<{
  approvedAddresses: WebsiteConnectorHostAddress[];
  authInjected: boolean;
  init: RequestInit;
  url: URL;
}> {
  const baseUrl =
    typeof input.connector.schema.baseUrl === "string"
      ? input.connector.schema.baseUrl
      : "";
  const url = buildOperationUrl(
    baseUrl,
    input.operation,
    input.parameters ?? {},
  );
  const approvedAddresses = await resolveDispatchAddresses(
    input.connector,
    url,
    input.hostLookup,
  );
  const auth = await authForConnector(input);
  for (const [name, value] of Object.entries(auth.query))
    url.searchParams.set(name, value);
  const headers: Record<string, string> = {
    accept: "application/json",
    ...auth.headers,
  };
  const method = input.operation.method.toUpperCase();
  const init: RequestInit = { method, headers };
  const transport = toolOperationDispatchTransport(
    input.connector,
    input.operation,
  );
  if (!["GET", "DELETE"].includes(method) && transport !== undefined) {
    Object.assign(headers, mcpToolCallHeaders(transport));
    init.body = JSON.stringify(
      mcpToolCallBody(
        transport,
        input.body ?? input.parameters ?? {},
        "direct",
      ),
    );
  } else if (!["GET", "DELETE"].includes(method) && input.body !== undefined) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(input.body);
  }
  return { approvedAddresses, authInjected: auth.injected, init, url };
}

export function toolOperationDispatchTransport(
  connector: ToolConnector,
  operation: ToolOperation,
):
  | Extract<ToolOperationDispatchTransport, { protocol: "mcp_streamable_http" }>
  | undefined {
  if (connector.type !== "mcp") return undefined;
  const mcpToolName =
    typeof operation.inputSchema.mcpToolName === "string"
      ? operation.inputSchema.mcpToolName
      : operation.operationId;
  const mcpProtocolVersion =
    typeof operation.inputSchema.mcpProtocolVersion === "string"
      ? operation.inputSchema.mcpProtocolVersion
      : typeof connector.schema.mcpProtocolVersion === "string"
        ? connector.schema.mcpProtocolVersion
        : "2025-06-18";
  return {
    protocol: "mcp_streamable_http",
    requestBody: "mcp_tools_call",
    mcpToolName,
    mcpProtocolVersion,
  };
}

function mcpToolCallHeaders(
  transport: Extract<
    ToolOperationDispatchTransport,
    { protocol: "mcp_streamable_http" }
  >,
): Record<string, string> {
  return {
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    "MCP-Protocol-Version": transport.mcpProtocolVersion,
    "Mcp-Method": "tools/call",
    "Mcp-Name": transport.mcpToolName,
  };
}

function mcpToolCallBody(
  transport: Extract<
    ToolOperationDispatchTransport,
    { protocol: "mcp_streamable_http" }
  >,
  args: Record<string, unknown>,
  id: string,
): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: {
      name: transport.mcpToolName,
      arguments: args,
      _meta: {
        "io.modelcontextprotocol/protocolVersion": transport.mcpProtocolVersion,
        "io.modelcontextprotocol/clientInfo": {
          name: "Romeo",
          version: ROMEO_PRODUCT_VERSION,
        },
        "io.modelcontextprotocol/clientCapabilities": {},
      },
    },
  };
}

function buildOperationUrl(
  baseUrl: string,
  operation: ToolOperation,
  parameters: Record<string, unknown>,
): URL {
  const base = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  const renderedPath = renderPath(operation, parameters).replace(/^\/+/u, "");
  const url = new URL(renderedPath, base);
  if (url.origin !== base.origin)
    throw new ApiError(
      "tool_operation_url_invalid",
      "Tool operation URL must stay on the connector origin.",
      409,
    );
  for (const name of declaredParameters(operation, "query")) {
    const value = parameters[name];
    if (value !== undefined && value !== null)
      url.searchParams.set(name, String(value));
  }
  return url;
}

function renderPath(
  operation: ToolOperation,
  parameters: Record<string, unknown>,
): string {
  let path = operation.path;
  for (const name of declaredParameters(operation, "path")) {
    const value = parameters[name];
    if (value === undefined || value === null || String(value).length === 0) {
      throw new ApiError(
        "tool_operation_parameter_missing",
        "Tool operation path parameter is missing.",
        400,
        { parameter: name },
      );
    }
    path = path.replace(
      new RegExp(`\\{${escapeRegExp(name)}\\}`, "gu"),
      encodeURIComponent(String(value)),
    );
  }
  return path;
}

function assertHostAllowed(connector: ToolConnector, url: URL): void {
  if (
    connector.networkPolicy.mode !== "allow_hosts" ||
    !connector.networkPolicy.allowedHosts.includes(url.hostname.toLowerCase())
  ) {
    throw new ApiError(
      "tool_operation_host_not_allowed",
      "Tool operation host is not allowed by connector network policy.",
      409,
      { host: url.hostname },
    );
  }
}

/**
 * Resolves the dispatch host and returns the addresses the caller must pin to.
 *
 * The allowlist above only compares hostname strings, so an allowlisted name
 * whose DNS answers 169.254.169.254 or 127.0.0.1 used to be fetched with the
 * connector's injected auth headers. This applies the same private-network and
 * pinning checks the data-connector path already uses, closing both the
 * literal private host case and the rebind between check and connect.
 */
async function resolveDispatchAddresses(
  connector: ToolConnector,
  url: URL,
  hostLookup: WebsiteConnectorHostLookup | undefined,
): Promise<WebsiteConnectorHostAddress[]> {
  assertHostAllowed(connector, url);
  return await assertConnectorHostAllowed(url, {
    allowedHosts: connector.networkPolicy.allowedHosts,
    egressPolicy: "require_allowlist",
    ...(hostLookup === undefined ? {} : { hostLookup }),
  });
}

export function dispatchBaseHost(connector: ToolConnector): string {
  const baseUrl =
    typeof connector.schema.baseUrl === "string"
      ? connector.schema.baseUrl
      : "";
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new ApiError(
      "tool_operation_url_invalid",
      "Tool operation base URL is invalid.",
      409,
    );
  }
  assertHostAllowed(connector, url);
  return url.hostname;
}

async function authForConnector(input: DispatchToolOperationInput): Promise<{
  headers: Record<string, string>;
  injected: boolean;
  query: Record<string, string>;
}> {
  const type =
    typeof input.connector.authConfig.type === "string"
      ? input.connector.authConfig.type
      : "none";
  if (type === "none") return { headers: {}, injected: false, query: {} };
  if (type === "oauth2_client_credentials") {
    const accessToken = await resolveOAuthClientCredentialsAccessToken({
      connector: input.connector,
      fetchImpl: input.fetchImpl,
      maxBytes: input.maxBytes,
      secretResolver: input.secretResolver,
      timeoutMs: input.timeoutMs,
    });
    return {
      headers: { authorization: `Bearer ${accessToken}` },
      injected: true,
      query: {},
    };
  }
  const secretRef =
    typeof input.connector.authConfig.secretRef === "string"
      ? input.connector.authConfig.secretRef
      : undefined;
  if (secretRef === undefined)
    throw new ApiError(
      "tool_operation_auth_not_configured",
      "Tool operation auth is not configured.",
      409,
    );
  if (input.secretResolver.resolveValue === undefined) {
    throw new ApiError(
      "secret_value_resolution_unavailable",
      "Secret value resolution is unavailable for tool operation dispatch.",
      409,
    );
  }
  const resolution = await input.secretResolver.resolveValue(secretRef);
  if (!resolution.available || resolution.value === undefined) {
    throw new ApiError(
      "tool_operation_secret_unavailable",
      "Tool operation secret is unavailable.",
      409,
      {
        failureCode: resolution.failureCode,
        scheme: resolution.scheme,
      },
    );
  }
  if (type === "bearer")
    return {
      headers: { authorization: `Bearer ${resolution.value}` },
      injected: true,
      query: {},
    };
  if (type === "api_key") {
    const placement = apiKeyAuthPlacement(input.connector);
    if (placement.apiKeyIn === "query")
      return {
        headers: {},
        injected: true,
        query: { [placement.apiKeyName]: resolution.value },
      };
    return {
      headers: { [placement.apiKeyName]: resolution.value },
      injected: true,
      query: {},
    };
  }
  throw new ApiError(
    "tool_operation_auth_scheme_unsupported",
    "Tool operation auth scheme is not supported for dispatch.",
    409,
    { type },
  );
}

export function apiKeyAuthPlacement(connector: ToolConnector): {
  apiKeyIn: "header" | "query";
  apiKeyName: string;
} {
  const apiKeyIn = connector.authConfig.apiKeyIn;
  const apiKeyName = connector.authConfig.apiKeyName;
  if (
    (apiKeyIn === "header" || apiKeyIn === "query") &&
    typeof apiKeyName === "string" &&
    /^[A-Za-z0-9_.-]{1,80}$/u.test(apiKeyName)
  ) {
    return { apiKeyIn, apiKeyName };
  }
  return { apiKeyIn: "header", apiKeyName: "x-api-key" };
}
