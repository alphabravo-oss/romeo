import { ROMEO_PRODUCT_VERSION } from "@romeo/contracts";

import type {
  ToolOperationDispatchReadbackResponse,
  ToolOperationDispatchRequestClaimResult,
} from "./api-types";
import { applyPayloadAuth } from "./tool-dispatch-auth";
import {
  assertResolvedHostAllowed,
  buildDispatchUrl,
  fetchWithTimeout,
  readBoundedResponseBody,
} from "./tool-dispatch-network";
import type {
  RunToolDispatchWorkerInput,
  ToolDispatchPayload,
} from "./tool-dispatch-worker";
import { validateToolDispatchResponse } from "./tool-response-validation";

export async function executeToolDispatchHttpRequest(
  input: RunToolDispatchWorkerInput,
  claim: ToolOperationDispatchRequestClaimResult,
  payload: ToolDispatchPayload,
): Promise<ToolOperationDispatchReadbackResponse> {
  const url = buildDispatchUrl(
    claim,
    payload,
    input.allowPrivateNetwork === true,
  );
  const approvedAddresses = await assertResolvedHostAllowed(
    input,
    url.hostname,
  );
  const method = claim.method?.toUpperCase() ?? "GET";
  const headers: Record<string, string> = {
    accept: "application/json",
    ...payload.headers,
  };
  await applyPayloadAuth(input, claim, url, headers, payload.auth);
  const init: RequestInit = { method, headers, redirect: "error" };
  if (isMcpStreamableHttpTransport(claim)) {
    Object.assign(headers, mcpToolCallHeaders(claim));
    init.body = JSON.stringify(
      mcpToolCallBody(claim, payload.body ?? payload.parameters ?? {}),
    );
  } else if (
    !["GET", "DELETE"].includes(method) &&
    payload.body !== undefined
  ) {
    headers["content-type"] = headers["content-type"] ?? "application/json";
    init.body = JSON.stringify(payload.body);
  }

  const response = await fetchWithTimeout(
    input,
    url,
    init,
    input.timeoutMs,
    approvedAddresses,
  );
  const body = await readBoundedResponseBody(response, input.maxBytes);
  const contentType = response.headers.get("content-type");
  const schemaValidation = validateToolDispatchResponse({
    body: body.bytes,
    ...(contentType === null ? {} : { contentType }),
    responseValidation: claim.responseValidation,
    status: response.status,
    truncated: body.truncated,
  });
  return {
    ok: response.ok,
    status: response.status,
    ...(contentType === null ? {} : { contentType }),
    bodyBytes: body.bodyBytes,
    truncated: body.truncated,
    schemaValidation,
  };
}

function isMcpStreamableHttpTransport(
  claim: ToolOperationDispatchRequestClaimResult,
): boolean {
  return claim.transport?.protocol === "mcp_streamable_http";
}

function mcpToolCallHeaders(
  claim: ToolOperationDispatchRequestClaimResult,
): Record<string, string> {
  const transport = claim.transport;
  if (
    transport?.protocol !== "mcp_streamable_http" ||
    claim.method?.toUpperCase() !== "POST"
  ) {
    throw new Error("worker_transport_invalid");
  }
  return {
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    "MCP-Protocol-Version": transport.mcpProtocolVersion,
    "Mcp-Method": "tools/call",
    "Mcp-Name": transport.mcpToolName,
  };
}

function mcpToolCallBody(
  claim: ToolOperationDispatchRequestClaimResult,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const transport = claim.transport;
  if (transport?.protocol !== "mcp_streamable_http")
    throw new Error("worker_transport_invalid");
  return {
    jsonrpc: "2.0",
    id: claim.job?.id ?? "job_dispatch_unknown",
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
