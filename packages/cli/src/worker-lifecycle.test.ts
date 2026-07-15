import { describe, expect, it } from "vitest";
import type { ToolOperationDispatchRequestClaimResult } from "@romeo/api-client";

import {
  runBillingEntitlementReconciliationWorker,
  runBillingLifecycleEnforcementWorker,
} from "./billing-worker";
import { runBrowserAutomationWorker } from "./browser-automation-worker";
import { runDataConnectorSyncWorker } from "./data-connector-worker";
import { runKnowledgeExtractionWorker } from "./knowledge-worker";
import { runNotificationRetryWorker } from "./notification-worker";
import { runRetentionEnforcementWorker } from "./retention-worker";
import { EnvironmentSecretValueResolver } from "./secret-resolver";
import {
  runToolDispatchWorker,
  type ToolDispatchWorkerClient,
} from "./tool-dispatch-worker";
import { runVoiceCatalogSyncWorker } from "./voice-worker";
import { runWebhookRetryWorker } from "./webhook-worker";
import { runWorkflowResumeWorker } from "./workflow-worker";
import type { CliIo } from "./io";

describe("worker lifecycle controls", () => {
  it("keeps tool-dispatch disabled when no payload source is configured", async () => {
    const { io, stdout } = createOutput();
    let claimed = false;

    const exitCode = await runToolDispatchWorker({
      client: {
        tool: {
          claimDispatchRequest: async () => {
            claimed = true;
            return {
              claimed: false,
              workerQueue: "external_tool_operations",
            };
          },
          completeDispatchRequest: async () => {
            throw new Error("disabled worker should not complete requests");
          },
          failDispatchRequest: async () => {
            throw new Error("disabled worker should not fail requests");
          },
        },
      },
      fetchImpl: fetch,
      intervalMs: 60_000,
      io,
      leaseSeconds: 300,
      maxBytes: 1_000_000,
      maxIterations: 1,
      timeoutMs: 10_000,
    });

    const parsed = JSON.parse(stdout());
    expect(exitCode).toBe(0);
    expect(claimed).toBe(false);
    expect(parsed).toMatchObject({
      iteration: 1,
      claimedCount: 0,
      disabledReason: "payload_store_not_configured",
    });
  });

  it("executes managed encrypted payload dispatches through the worker API payload read", async () => {
    const { io, stdout } = createOutput();
    const sentinel = "managed-worker-payload-secret";
    const claimInputs: unknown[] = [];
    const payloadReadInputs: unknown[] = [];
    const completedInputs: unknown[] = [];

    const exitCode = await runToolDispatchWorker({
      client: {
        tool: {
          claimDispatchRequest: async (input) => {
            claimInputs.push(input);
            return {
              claimed: true,
              job: {
                id: "job_dispatch_managed",
                type: "tool.operation.dispatch_request",
                status: "running",
              },
              connectorId: "tool_connector_1",
              operationId: "getIssue",
              method: "get",
              pathTemplate: "/issues/{issueId}",
              workerQueue: "external_tool_operations",
              request: {
                parameterKeys: ["issueId"],
                bodyKeys: [],
                host: "api.example.com",
                payloadStorage: "managed_encrypted_object_store",
              },
              lease: {
                workerId: "svc_worker",
                claimedAt: new Date(0).toISOString(),
                renewedAt: new Date(0).toISOString(),
                expiresAt: new Date(60_000).toISOString(),
                leaseSeconds: 300,
                attempt: 1,
              },
            };
          },
          readDispatchRequestPayload: async (input) => {
            payloadReadInputs.push(input);
            return {
              job: {
                id: "job_dispatch_managed",
                type: "tool.operation.dispatch_request",
                status: "running",
              },
              connectorId: "tool_connector_1",
              operationId: "getIssue",
              method: "get",
              pathTemplate: "/issues/{issueId}",
              workerQueue: "external_tool_operations",
              request: {
                parameterKeys: ["issueId"],
                bodyKeys: [],
                host: "api.example.com",
                payloadStorage: "managed_encrypted_object_store",
              },
              payload: { parameters: { issueId: sentinel } },
            };
          },
          completeDispatchRequest: async (input) => {
            completedInputs.push(input);
            return {
              job: {
                id: "job_dispatch_managed",
                type: "tool.operation.dispatch_request",
                status: "completed",
              },
              connectorId: "tool_connector_1",
              operationId: "getIssue",
              method: "get",
              pathTemplate: "/issues/{issueId}",
              workerQueue: "external_tool_operations",
              outcome: "completed",
            };
          },
          failDispatchRequest: async () => {
            throw new Error("managed payload worker should not fail request");
          },
        },
      },
      fetchImpl: async (input) => {
        expect(String(input)).toBe(
          `https://api.example.com/issues/${encodeURIComponent(sentinel)}`,
        );
        return new Response(null, { status: 204 });
      },
      intervalMs: 60_000,
      io,
      leaseSeconds: 300,
      maxBytes: 1_000_000,
      maxIterations: 1,
      timeoutMs: 10_000,
    });

    const output = stdout();
    expect(exitCode).toBe(0);
    expect(output).not.toContain(sentinel);
    expect(JSON.parse(output)).toMatchObject({
      claimedCount: 1,
      completedCount: 1,
      failedCount: 0,
    });
    expect(claimInputs).toEqual([
      {
        leaseSeconds: 300,
        payloadStorage: "managed_encrypted_object_store",
      },
    ]);
    expect(payloadReadInputs).toEqual([{ jobId: "job_dispatch_managed" }]);
    expect(completedInputs).toEqual([
      {
        jobId: "job_dispatch_managed",
        response: {
          ok: true,
          status: 204,
          bodyBytes: 0,
          truncated: false,
          schemaValidation: { status: "not_applicable" },
        },
      },
    ]);
  });

  it("executes claimed tool dispatch requests without printing raw payloads or response bodies", async () => {
    const { io, stdout } = createOutput();
    const sentinel = "tool-worker-raw-secret";
    const calls: unknown[] = [];
    const exitCode = await runToolDispatchWorker({
      client: {
        tool: {
          claimDispatchRequest: async () => ({
            claimed: true,
            job: {
              id: "job_dispatch_1",
              type: "tool.operation.dispatch_request",
              status: "running",
            },
            connectorId: "tool_connector_1",
            operationId: "getIssue",
            method: "get",
            pathTemplate: "/issues/{issueId}",
            workerQueue: "external_tool_operations",
            request: {
              parameterKeys: ["issueId"],
              bodyKeys: [],
              host: "api.example.com",
              payloadStorage: "external_worker_secret_store_required",
            },
            lease: {
              workerId: "svc_worker",
              claimedAt: new Date(0).toISOString(),
              renewedAt: new Date(0).toISOString(),
              expiresAt: new Date(60_000).toISOString(),
              leaseSeconds: 300,
              attempt: 1,
            },
          }),
          completeDispatchRequest: async (input: unknown) => {
            calls.push(input);
            return {
              job: {
                id: "job_dispatch_1",
                type: "tool.operation.dispatch_request",
                status: "completed",
              },
              connectorId: "tool_connector_1",
              operationId: "getIssue",
              method: "get",
              pathTemplate: "/issues/{issueId}",
              workerQueue: "external_tool_operations",
              outcome: "completed",
            };
          },
          failDispatchRequest: async () => {
            throw new Error("successful worker should not fail request");
          },
        },
      },
      fetchImpl: async (input) => {
        expect(String(input)).toBe(
          `https://api.example.com/issues/${encodeURIComponent(sentinel)}`,
        );
        return new Response(`response-${sentinel}`, {
          status: 202,
          headers: { "content-type": "application/json" },
        });
      },
      intervalMs: 60_000,
      io,
      leaseSeconds: 300,
      maxBytes: 1_000_000,
      maxIterations: 1,
      payloads: {
        job_dispatch_1: { parameters: { issueId: sentinel } },
      },
      timeoutMs: 10_000,
    });

    const output = stdout();
    const parsed = JSON.parse(output);
    expect(exitCode).toBe(0);
    expect(output).not.toContain(sentinel);
    expect(parsed).toMatchObject({
      iteration: 1,
      claimedCount: 1,
      completedCount: 1,
      failedCount: 0,
      jobs: [
        {
          jobId: "job_dispatch_1",
          outcome: "completed",
          responseStatus: 202,
          truncated: false,
        },
      ],
    });
    expect(calls).toEqual([
      {
        jobId: "job_dispatch_1",
        response: {
          ok: true,
          status: 202,
          contentType: "application/json",
          bodyBytes: 31,
          truncated: false,
          schemaValidation: { status: "not_applicable" },
        },
      },
    ]);
  });

  it("wraps MCP dispatch payloads as Streamable HTTP tools/call JSON-RPC requests", async () => {
    const { io, stdout } = createOutput();
    const sentinel = "mcp-worker-raw-query";
    const fetchCalls: Array<{
      input: RequestInfo | URL;
      init: RequestInit | undefined;
    }> = [];
    const completedInputs: unknown[] = [];

    const exitCode = await runToolDispatchWorker({
      client: createClaimedToolDispatchClient({
        host: "mcp.example.com",
        method: "post",
        onComplete: (input) => completedInputs.push(input),
        pathTemplate: "/mcp",
        transport: {
          protocol: "mcp_streamable_http",
          requestBody: "mcp_tools_call",
          mcpToolName: "search.docs",
          mcpProtocolVersion: "2025-06-18",
        },
      }),
      fetchImpl: async (input, init) => {
        fetchCalls.push({ input, init });
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: "job_dispatch_test",
            result: { content: [] },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
      intervalMs: 60_000,
      io,
      leaseSeconds: 300,
      maxBytes: 1_000_000,
      maxIterations: 1,
      payloads: {
        job_dispatch_test: { body: { query: sentinel } },
      },
      timeoutMs: 10_000,
    });

    const output = stdout();
    expect(exitCode).toBe(0);
    expect(output).not.toContain(sentinel);
    expect(fetchCalls).toHaveLength(1);
    expect(String(fetchCalls[0]?.input)).toBe("https://mcp.example.com/mcp");
    expect(fetchCalls[0]?.init?.method).toBe("POST");
    expect(fetchCalls[0]?.init?.headers).toMatchObject({
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "MCP-Protocol-Version": "2025-06-18",
      "Mcp-Method": "tools/call",
      "Mcp-Name": "search.docs",
    });
    expect(JSON.parse(String(fetchCalls[0]?.init?.body))).toMatchObject({
      jsonrpc: "2.0",
      id: "job_dispatch_test",
      method: "tools/call",
      params: {
        name: "search.docs",
        arguments: { query: sentinel },
      },
    });
    expect(completedInputs).toEqual([
      {
        jobId: "job_dispatch_test",
        response: {
          ok: true,
          status: 200,
          contentType: "application/json",
          bodyBytes: 66,
          truncated: false,
          schemaValidation: { status: "not_applicable" },
        },
      },
    ]);
  });

  it("validates claimed tool dispatch JSON responses against claim schema metadata", async () => {
    const { io, stdout } = createOutput();
    const calls: unknown[] = [];

    const exitCode = await runToolDispatchWorker({
      client: createClaimedToolDispatchClient({
        onComplete: (input) => calls.push(input),
        responseValidation: {
          jsonSchemas: {
            "200": {
              type: "object",
              required: ["id"],
              properties: { id: { type: "string" } },
            },
          },
        },
      }),
      fetchImpl: async () =>
        new Response(JSON.stringify({ id: "ISSUE-1" }), {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8" },
        }),
      intervalMs: 60_000,
      io,
      leaseSeconds: 300,
      maxBytes: 1_000_000,
      maxIterations: 1,
      payloads: {
        job_dispatch_test: { parameters: { issueId: "ISSUE-1" } },
      },
      timeoutMs: 10_000,
    });

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout())).toMatchObject({
      completedCount: 1,
      failedCount: 0,
    });
    expect(calls).toEqual([
      {
        jobId: "job_dispatch_test",
        response: expect.objectContaining({
          status: 200,
          schemaValidation: { status: "passed" },
        }),
      },
    ]);
  });

  it("reports claimed tool dispatch response schema failures without response bodies", async () => {
    const { io, stdout } = createOutput();
    const calls: unknown[] = [];
    const responseBody = "tool-worker-schema-secret";

    const exitCode = await runToolDispatchWorker({
      client: createClaimedToolDispatchClient({
        onComplete: (input) => calls.push(input),
        responseValidation: {
          jsonSchemas: {
            "200": {
              type: "object",
              required: ["id"],
              properties: { id: { type: "string" } },
            },
          },
        },
      }),
      fetchImpl: async () =>
        new Response(JSON.stringify({ secret: responseBody }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      intervalMs: 60_000,
      io,
      leaseSeconds: 300,
      maxBytes: 1_000_000,
      maxIterations: 1,
      payloads: {
        job_dispatch_test: { parameters: { issueId: "ISSUE-1" } },
      },
      timeoutMs: 10_000,
    });

    expect(exitCode).toBe(0);
    expect(stdout()).not.toContain(responseBody);
    expect(JSON.stringify(calls)).not.toContain(responseBody);
    expect(calls).toEqual([
      {
        jobId: "job_dispatch_test",
        response: expect.objectContaining({
          schemaValidation: {
            status: "failed",
            errorCode: "response_required_property_missing",
          },
        }),
      },
    ]);
  });

  it("reports invalid JSON when claimed tool dispatch response schema validation is configured", async () => {
    const { io, stdout } = createOutput();
    const calls: unknown[] = [];

    const exitCode = await runToolDispatchWorker({
      client: createClaimedToolDispatchClient({
        onComplete: (input) => calls.push(input),
        responseValidation: {
          jsonSchemas: { "200": { type: "object" } },
        },
      }),
      fetchImpl: async () =>
        new Response("{", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      intervalMs: 60_000,
      io,
      leaseSeconds: 300,
      maxBytes: 1_000_000,
      maxIterations: 1,
      payloads: {
        job_dispatch_test: { parameters: { issueId: "ISSUE-1" } },
      },
      timeoutMs: 10_000,
    });

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout())).toMatchObject({ completedCount: 1 });
    expect(calls).toEqual([
      {
        jobId: "job_dispatch_test",
        response: expect.objectContaining({
          schemaValidation: {
            status: "failed",
            errorCode: "response_json_invalid",
          },
        }),
      },
    ]);
  });

  it("fails claimed tool dispatch requests when payloads are missing", async () => {
    const { io, stdout } = createOutput();
    const calls: unknown[] = [];

    const exitCode = await runToolDispatchWorker({
      client: {
        tool: {
          claimDispatchRequest: async () => ({
            claimed: true,
            job: {
              id: "job_dispatch_missing",
              type: "tool.operation.dispatch_request",
              status: "running",
            },
            workerQueue: "external_tool_operations",
            request: {
              parameterKeys: ["issueId"],
              bodyKeys: [],
              host: "api.example.com",
              payloadStorage: "external_worker_secret_store_required",
            },
          }),
          completeDispatchRequest: async () => {
            throw new Error("missing payload should not complete request");
          },
          failDispatchRequest: async (input: unknown) => {
            calls.push(input);
            return {
              job: {
                id: "job_dispatch_missing",
                type: "tool.operation.dispatch_request",
                status: "failed",
              },
              connectorId: "tool_connector_1",
              operationId: "getIssue",
              method: "get",
              pathTemplate: "/issues/{issueId}",
              workerQueue: "external_tool_operations",
              outcome: "failed",
              errorCode: "worker_payload_unavailable",
            };
          },
        },
      },
      fetchImpl: fetch,
      intervalMs: 60_000,
      io,
      leaseSeconds: 300,
      maxBytes: 1_000_000,
      maxIterations: 1,
      payloads: {},
      timeoutMs: 10_000,
    });

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout())).toMatchObject({
      claimedCount: 1,
      completedCount: 0,
      failedCount: 1,
      jobs: [
        {
          jobId: "job_dispatch_missing",
          outcome: "failed",
          errorCode: "worker_payload_unavailable",
        },
      ],
    });
    expect(calls).toEqual([
      {
        jobId: "job_dispatch_missing",
        errorCode: "worker_payload_unavailable",
      },
    ]);
  });

  it("resolves tool dispatch bearer auth only inside the worker", async () => {
    const { io, stdout } = createOutput();
    const token = "tool-worker-bearer-token";
    const fetches: unknown[] = [];
    const calls: unknown[] = [];

    const exitCode = await runToolDispatchWorker({
      client: createClaimedToolDispatchClient({
        onComplete: (input) => calls.push(input),
      }),
      fetchImpl: async (input, init) => {
        fetches.push({
          url: String(input),
          headers: init?.headers,
        });
        return new Response("ok", { status: 200 });
      },
      intervalMs: 60_000,
      io,
      leaseSeconds: 300,
      maxBytes: 1_000_000,
      maxIterations: 1,
      payloads: {
        job_dispatch_test: {
          auth: { type: "bearer", secretRef: "env://TOOL_BEARER" },
          parameters: { issueId: "ISSUE-1" },
        },
      },
      secretResolver: new EnvironmentSecretValueResolver({
        TOOL_BEARER: token,
      }),
      timeoutMs: 10_000,
    });

    const output = stdout();
    expect(exitCode).toBe(0);
    expect(fetches).toEqual([
      {
        url: "https://api.example.com/issues/ISSUE-1",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${token}`,
        },
      },
    ]);
    expect(output).not.toContain(token);
    expect(JSON.stringify(calls)).not.toContain(token);
    expect(JSON.parse(output)).toMatchObject({
      completedCount: 1,
      failedCount: 0,
    });
  });

  it("injects API-key query auth without writing the secret to worker output", async () => {
    const { io, stdout } = createOutput();
    const token = "tool-worker-query-token";
    const fetches: unknown[] = [];

    const exitCode = await runToolDispatchWorker({
      client: createClaimedToolDispatchClient({}),
      fetchImpl: async (input) => {
        fetches.push(String(input));
        return new Response("ok", { status: 200 });
      },
      intervalMs: 60_000,
      io,
      leaseSeconds: 300,
      maxBytes: 1_000_000,
      maxIterations: 1,
      payloads: {
        job_dispatch_test: {
          auth: {
            type: "api_key",
            secretRef: "env://TOOL_API_KEY",
            apiKeyIn: "query",
            apiKeyName: "api_key",
          },
          parameters: { issueId: "ISSUE-1" },
        },
      },
      secretResolver: new EnvironmentSecretValueResolver({
        TOOL_API_KEY: token,
      }),
      timeoutMs: 10_000,
    });

    const output = stdout();
    expect(exitCode).toBe(0);
    expect(fetches).toEqual([
      `https://api.example.com/issues/ISSUE-1?api_key=${token}`,
    ]);
    expect(output).not.toContain(token);
    expect(JSON.parse(output)).toMatchObject({
      completedCount: 1,
      failedCount: 0,
    });
  });

  it("exchanges OAuth client credentials for tool dispatch auth without writing secrets to worker output", async () => {
    const { io, stdout } = createOutput();
    const clientId = "tool-worker-oauth-client-id";
    const clientSecret = "tool-worker-oauth-client-secret";
    const accessToken = "tool-worker-oauth-access-token";
    const fetches: unknown[] = [];
    const calls: unknown[] = [];

    const exitCode = await runToolDispatchWorker({
      client: createClaimedToolDispatchClient({
        authPolicy: {
          type: "oauth2_client_credentials",
          oauthTokenUrl: "https://auth.example.com/oauth/token",
          oauthScopes: ["issues:read"],
          oauthClientAuthMethod: "client_secret_basic",
        },
        onComplete: (input) => calls.push(input),
      }),
      fetchImpl: async (input, init) => {
        const url = String(input);
        const headers = new Headers(init?.headers);
        if (url === "https://auth.example.com/oauth/token") {
          fetches.push({
            kind: "token",
            url,
            method: init?.method,
            redirect: init?.redirect,
            auth: headers.get("authorization"),
            body: String(init?.body),
          });
          return new Response(
            JSON.stringify({
              access_token: accessToken,
              token_type: "Bearer",
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }
        fetches.push({
          kind: "api",
          url,
          auth: headers.get("authorization"),
        });
        return new Response("{}", { status: 200 });
      },
      intervalMs: 60_000,
      io,
      leaseSeconds: 300,
      maxBytes: 1_000_000,
      maxIterations: 1,
      payloads: {
        job_dispatch_test: {
          auth: {
            type: "oauth2_client_credentials",
            secretRef: "env://TOOL_OAUTH_CLIENT",
          },
          parameters: { issueId: "ISSUE-1" },
        },
      },
      secretResolver: new EnvironmentSecretValueResolver({
        TOOL_OAUTH_CLIENT: JSON.stringify({ clientId, clientSecret }),
      }),
      timeoutMs: 10_000,
    });

    const output = stdout();
    expect(exitCode).toBe(0);
    expect(fetches).toEqual([
      {
        kind: "token",
        url: "https://auth.example.com/oauth/token",
        method: "POST",
        redirect: "error",
        auth: `Basic ${Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64")}`,
        body: "grant_type=client_credentials&scope=issues%3Aread",
      },
      {
        kind: "api",
        url: "https://api.example.com/issues/ISSUE-1",
        auth: `Bearer ${accessToken}`,
      },
    ]);
    for (const serialized of [output, JSON.stringify(calls)]) {
      expect(serialized).not.toContain(clientId);
      expect(serialized).not.toContain(clientSecret);
      expect(serialized).not.toContain(accessToken);
    }
    expect(JSON.parse(output)).toMatchObject({
      completedCount: 1,
      failedCount: 0,
    });
  });

  it("fails OAuth tool dispatch auth when claim token policy is unsafe", async () => {
    const { io, stdout } = createOutput();
    const calls: unknown[] = [];
    let fetched = false;

    const exitCode = await runToolDispatchWorker({
      client: createClaimedToolDispatchClient({
        authPolicy: {
          type: "oauth2_client_credentials",
          oauthTokenUrl: "https://127.0.0.1/oauth/token",
          oauthScopes: ["issues:read"],
          oauthClientAuthMethod: "client_secret_basic",
        },
        onFail: (input) => calls.push(input),
      }),
      fetchImpl: async () => {
        fetched = true;
        return new Response(null, { status: 200 });
      },
      intervalMs: 60_000,
      io,
      leaseSeconds: 300,
      maxBytes: 1_000_000,
      maxIterations: 1,
      payloads: {
        job_dispatch_test: {
          auth: {
            type: "oauth2_client_credentials",
            secretRef: "env://TOOL_OAUTH_CLIENT",
          },
          parameters: { issueId: "ISSUE-1" },
        },
      },
      secretResolver: new EnvironmentSecretValueResolver({
        TOOL_OAUTH_CLIENT: JSON.stringify({
          clientId: "client-id",
          clientSecret: "client-secret",
        }),
      }),
      timeoutMs: 10_000,
    });

    expect(exitCode).toBe(0);
    expect(fetched).toBe(false);
    expect(JSON.parse(stdout())).toMatchObject({
      failedCount: 1,
      jobs: [{ errorCode: "worker_auth_invalid", outcome: "failed" }],
    });
    expect(calls).toEqual([
      { jobId: "job_dispatch_test", errorCode: "worker_auth_invalid" },
    ]);
  });

  it("fails tool dispatch auth before fetch when worker secret resolution is unavailable", async () => {
    const { io, stdout } = createOutput();
    const calls: unknown[] = [];
    let fetched = false;

    const exitCode = await runToolDispatchWorker({
      client: createClaimedToolDispatchClient({
        onFail: (input) => calls.push(input),
      }),
      fetchImpl: async () => {
        fetched = true;
        return new Response(null, { status: 200 });
      },
      intervalMs: 60_000,
      io,
      leaseSeconds: 300,
      maxBytes: 1_000_000,
      maxIterations: 1,
      payloads: {
        job_dispatch_test: {
          auth: { type: "bearer", secretRef: "env://MISSING_TOOL_TOKEN" },
          parameters: { issueId: "ISSUE-1" },
        },
      },
      secretResolver: new EnvironmentSecretValueResolver({}),
      timeoutMs: 10_000,
    });

    expect(exitCode).toBe(0);
    expect(fetched).toBe(false);
    expect(JSON.parse(stdout())).toMatchObject({
      failedCount: 1,
      jobs: [{ errorCode: "worker_secret_unavailable", outcome: "failed" }],
    });
    expect(calls).toEqual([
      { jobId: "job_dispatch_test", errorCode: "worker_secret_unavailable" },
    ]);
  });

  it("fails unsafe tool dispatch hosts before fetch", async () => {
    for (const host of [
      "127.0.0.1",
      "metadata.google.internal",
      "kubernetes.default.svc",
    ]) {
      const { io, stdout } = createOutput();
      const calls: unknown[] = [];
      let fetched = false;

      const exitCode = await runToolDispatchWorker({
        client: createClaimedToolDispatchClient({
          host,
          onFail: (input) => calls.push(input),
        }),
        fetchImpl: async () => {
          fetched = true;
          return new Response(null, { status: 200 });
        },
        intervalMs: 60_000,
        io,
        leaseSeconds: 300,
        maxBytes: 1_000_000,
        maxIterations: 1,
        payloads: {
          job_dispatch_test: { parameters: { issueId: "ISSUE-1" } },
        },
        timeoutMs: 10_000,
      });

      expect(exitCode).toBe(0);
      expect(fetched).toBe(false);
      expect(JSON.parse(stdout())).toMatchObject({
        claimedCount: 1,
        completedCount: 0,
        failedCount: 1,
        jobs: [{ errorCode: "worker_host_denied", outcome: "failed" }],
      });
      expect(calls).toEqual([
        { jobId: "job_dispatch_test", errorCode: "worker_host_denied" },
      ]);
    }
  });

  it("fails DNS-resolved private tool dispatch hosts before fetch", async () => {
    const { io, stdout } = createOutput();
    const calls: unknown[] = [];
    let fetched = false;

    const exitCode = await runToolDispatchWorker({
      client: createClaimedToolDispatchClient({
        host: "api.example.com",
        onFail: (input) => calls.push(input),
      }),
      dnsLookup: async (host) => {
        expect(host).toBe("api.example.com");
        return [{ address: "10.2.3.4", family: 4 }];
      },
      fetchImpl: async () => {
        fetched = true;
        return new Response(null, { status: 200 });
      },
      intervalMs: 60_000,
      io,
      leaseSeconds: 300,
      maxBytes: 1_000_000,
      maxIterations: 1,
      payloads: {
        job_dispatch_test: { parameters: { issueId: "ISSUE-1" } },
      },
      timeoutMs: 10_000,
    });

    expect(exitCode).toBe(0);
    expect(fetched).toBe(false);
    expect(JSON.parse(stdout())).toMatchObject({
      claimedCount: 1,
      completedCount: 0,
      failedCount: 1,
      jobs: [{ errorCode: "worker_host_denied", outcome: "failed" }],
    });
    expect(calls).toEqual([
      { jobId: "job_dispatch_test", errorCode: "worker_host_denied" },
    ]);
  });

  it("maps tool dispatch DNS lookup failures to a stable worker error", async () => {
    const { io, stdout } = createOutput();
    const calls: unknown[] = [];
    let fetched = false;

    const exitCode = await runToolDispatchWorker({
      client: createClaimedToolDispatchClient({
        host: "api.example.com",
        onFail: (input) => calls.push(input),
      }),
      dnsLookup: async () => {
        throw new Error("dns failure");
      },
      fetchImpl: async () => {
        fetched = true;
        return new Response(null, { status: 200 });
      },
      intervalMs: 60_000,
      io,
      leaseSeconds: 300,
      maxBytes: 1_000_000,
      maxIterations: 1,
      payloads: {
        job_dispatch_test: { parameters: { issueId: "ISSUE-1" } },
      },
      timeoutMs: 10_000,
    });

    expect(exitCode).toBe(0);
    expect(fetched).toBe(false);
    expect(JSON.parse(stdout())).toMatchObject({
      claimedCount: 1,
      completedCount: 0,
      failedCount: 1,
      jobs: [{ errorCode: "worker_dns_lookup_failed", outcome: "failed" }],
    });
    expect(calls).toEqual([
      { jobId: "job_dispatch_test", errorCode: "worker_dns_lookup_failed" },
    ]);
  });

  it("skips DNS private-address denial when explicitly allowed", async () => {
    const { io, stdout } = createOutput();
    let fetched = false;

    const exitCode = await runToolDispatchWorker({
      allowPrivateNetwork: true,
      client: createClaimedToolDispatchClient({
        host: "api.example.com",
      }),
      dnsLookup: async () => [{ address: "10.2.3.4", family: 4 }],
      fetchImpl: async () => {
        fetched = true;
        return new Response("ok", { status: 200 });
      },
      intervalMs: 60_000,
      io,
      leaseSeconds: 300,
      maxBytes: 1_000_000,
      maxIterations: 1,
      payloads: {
        job_dispatch_test: { parameters: { issueId: "ISSUE-1" } },
      },
      timeoutMs: 10_000,
    });

    expect(exitCode).toBe(0);
    expect(fetched).toBe(true);
    expect(JSON.parse(stdout())).toMatchObject({
      claimedCount: 1,
      completedCount: 1,
      failedCount: 0,
    });
  });

  it("maps tool dispatch fetch timeouts to a stable worker error", async () => {
    const { io, stdout } = createOutput();
    const calls: unknown[] = [];

    const exitCode = await runToolDispatchWorker({
      client: createClaimedToolDispatchClient({
        onFail: (input) => calls.push(input),
      }),
      fetchImpl: async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        }),
      intervalMs: 60_000,
      io,
      leaseSeconds: 300,
      maxBytes: 1_000_000,
      maxIterations: 1,
      payloads: {
        job_dispatch_test: { parameters: { issueId: "ISSUE-1" } },
      },
      timeoutMs: 1,
    });

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout())).toMatchObject({
      failedCount: 1,
      jobs: [{ errorCode: "worker_fetch_timeout", outcome: "failed" }],
    });
    expect(calls).toEqual([
      { jobId: "job_dispatch_test", errorCode: "worker_fetch_timeout" },
    ]);
  });

  it("reports truncated tool dispatch responses without response bodies", async () => {
    const { io, stdout } = createOutput();
    const calls: unknown[] = [];
    const responseBody = "tool-worker-response-body";

    const exitCode = await runToolDispatchWorker({
      client: createClaimedToolDispatchClient({
        onComplete: (input) => calls.push(input),
      }),
      fetchImpl: async () =>
        new Response(responseBody, {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      intervalMs: 60_000,
      io,
      leaseSeconds: 300,
      maxBytes: 4,
      maxIterations: 1,
      payloads: {
        job_dispatch_test: { parameters: { issueId: "ISSUE-1" } },
      },
      timeoutMs: 10_000,
    });

    expect(exitCode).toBe(0);
    expect(stdout()).not.toContain(responseBody);
    expect(JSON.parse(stdout())).toMatchObject({
      completedCount: 1,
      jobs: [
        {
          outcome: "completed",
          responseStatus: 200,
          truncated: true,
        },
      ],
    });
    expect(calls).toEqual([
      {
        jobId: "job_dispatch_test",
        response: {
          ok: true,
          status: 200,
          contentType: "application/json",
          bodyBytes: 4,
          truncated: true,
          schemaValidation: { status: "not_applicable" },
        },
      },
    ]);
  });

  it("skips claimed tool dispatch schema validation when the bounded response body is truncated", async () => {
    const { io, stdout } = createOutput();
    const calls: unknown[] = [];
    const responseBody = JSON.stringify({ id: "ISSUE-1", extra: "large" });

    const exitCode = await runToolDispatchWorker({
      client: createClaimedToolDispatchClient({
        onComplete: (input) => calls.push(input),
        responseValidation: {
          jsonSchemas: {
            "200": {
              type: "object",
              required: ["id"],
              properties: { id: { type: "string" } },
            },
          },
        },
      }),
      fetchImpl: async () =>
        new Response(responseBody, {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      intervalMs: 60_000,
      io,
      leaseSeconds: 300,
      maxBytes: 4,
      maxIterations: 1,
      payloads: {
        job_dispatch_test: { parameters: { issueId: "ISSUE-1" } },
      },
      timeoutMs: 10_000,
    });

    expect(exitCode).toBe(0);
    expect(stdout()).not.toContain(responseBody);
    expect(calls).toEqual([
      {
        jobId: "job_dispatch_test",
        response: expect.objectContaining({
          bodyBytes: 4,
          truncated: true,
          schemaValidation: {
            status: "skipped",
            errorCode: "response_body_truncated",
          },
        }),
      },
    ]);
  });

  it("fails tool dispatch redirect fetches with a stable worker error", async () => {
    const { io, stdout } = createOutput();
    const calls: unknown[] = [];
    const fetches: unknown[] = [];

    const exitCode = await runToolDispatchWorker({
      client: createClaimedToolDispatchClient({
        onFail: (input) => calls.push(input),
      }),
      fetchImpl: async (_input, init) => {
        fetches.push({ redirect: init?.redirect });
        throw new TypeError("redirect blocked");
      },
      intervalMs: 60_000,
      io,
      leaseSeconds: 300,
      maxBytes: 1_000_000,
      maxIterations: 1,
      payloads: {
        job_dispatch_test: { parameters: { issueId: "ISSUE-1" } },
      },
      timeoutMs: 10_000,
    });

    expect(exitCode).toBe(0);
    expect(fetches).toEqual([{ redirect: "error" }]);
    expect(JSON.parse(stdout())).toMatchObject({
      failedCount: 1,
      jobs: [{ errorCode: "worker_fetch_failed", outcome: "failed" }],
    });
    expect(calls).toEqual([
      { jobId: "job_dispatch_test", errorCode: "worker_fetch_failed" },
    ]);
  });

  it("exits the webhook retry loop after an abort without entering the next sleep", async () => {
    const { io, stdout } = createOutput();
    const controller = new AbortController();
    let calls = 0;
    let slept = false;

    const exitCode = await runWebhookRetryWorker({
      client: {
        webhooks: {
          retryDue: async () => {
            calls += 1;
            controller.abort();
            return {
              job: {
                id: "job_1",
                type: "webhook.retry_due",
                status: "completed",
              },
              deliveries: [],
            };
          },
        },
      } as never,
      intervalMs: 60_000,
      io,
      signal: controller.signal,
      sleep: async () => {
        slept = true;
      },
    });

    expect(exitCode).toBe(0);
    expect(calls).toBe(1);
    expect(slept).toBe(false);
    expect(stdout()).toContain('"iteration": 1');
  });

  it("exits the notification retry loop after an abort without entering the next sleep", async () => {
    const { io, stdout } = createOutput();
    const controller = new AbortController();
    let calls = 0;
    let slept = false;

    const exitCode = await runNotificationRetryWorker({
      client: {
        notifications: {
          retryDue: async () => {
            calls += 1;
            controller.abort();
            return {
              job: {
                id: "job_1",
                type: "notification.retry_due",
                status: "completed",
              },
              deliveries: [],
            };
          },
        },
      } as never,
      intervalMs: 60_000,
      io,
      signal: controller.signal,
      sleep: async () => {
        slept = true;
      },
    });

    expect(exitCode).toBe(0);
    expect(calls).toBe(1);
    expect(slept).toBe(false);
    expect(stdout()).toContain('"iteration": 1');
  });

  it("exits the workflow resume loop after an abort without entering the next sleep", async () => {
    const { io, stdout } = createOutput();
    const controller = new AbortController();
    let listCalls = 0;
    let slept = false;

    const exitCode = await runWorkflowResumeWorker({
      client: {
        workflows: {
          list: async () => {
            listCalls += 1;
            controller.abort();
            return [{ id: "workflow_1", enabled: true }];
          },
          resumeRun: async () => ({
            id: "workflow_run_1",
            status: "completed",
          }),
          runs: async () => [],
        },
      } as never,
      intervalMs: 60_000,
      io,
      signal: controller.signal,
      sleep: async () => {
        slept = true;
      },
    });

    expect(exitCode).toBe(0);
    expect(listCalls).toBe(1);
    expect(slept).toBe(false);
    expect(stdout()).toContain('"iteration": 1');
  });

  it("keeps raw workflow run input out of workflow-resume worker output", async () => {
    const { io, stdout } = createOutput();
    const sentinel = "worker-raw-prompt-sentinel";

    const exitCode = await runWorkflowResumeWorker({
      client: {
        workflows: {
          list: async () => [{ id: "workflow_1", enabled: true }],
          resumeRun: async () => ({
            id: "workflow_run_1",
            orgId: "org_default",
            workspaceId: "workspace_default",
            workflowId: "workflow_1",
            status: "waiting_approval",
            input: { prompt: sentinel },
            steps: [
              {
                stepId: "step_1",
                type: "agent_run",
                status: "completed",
                output: { runId: "run_1", raw: sentinel },
                completedAt: new Date(0).toISOString(),
              },
            ],
            currentStepId: "step_2",
            createdBy: "user_dev_admin",
            createdAt: new Date(0).toISOString(),
            updatedAt: new Date(0).toISOString(),
          }),
          runs: async () => [
            {
              id: "workflow_run_1",
              status: "waiting_run",
            },
          ],
        },
      } as never,
      intervalMs: 60_000,
      io,
      maxIterations: 1,
    });

    const output = stdout();
    const parsed = JSON.parse(output);
    expect(exitCode).toBe(0);
    expect(output).not.toContain(sentinel);
    expect(parsed.runs[0]).toMatchObject({
      id: "workflow_run_1",
      status: "waiting_approval",
      stepCount: 1,
      steps: [
        {
          stepId: "step_1",
          status: "completed",
          outputKeys: ["raw", "runId"],
        },
      ],
    });
    expect(parsed.runs[0].input).toBeUndefined();
    expect(parsed.runs[0].steps[0].output).toBeUndefined();
  });

  it("runs browser automation claims through an external runner without printing raw tasks", async () => {
    const { io, stdout } = createOutput();
    const sentinel = "browser-worker-raw-task-sentinel";
    const claimInputs: unknown[] = [];
    const completedInputs: unknown[] = [];
    const runnerRequests: Array<{ body: string; url: string }> = [];

    const exitCode = await runBrowserAutomationWorker({
      client: {
        workflows: {
          claimBrowserTask: async (input) => {
            claimInputs.push(input);
            return {
              claimed: true,
              workerQueue: "browser_automation",
              job: {
                id: "job_browser_1",
                type: "workflow.browser_task.dispatch_request",
                status: "running",
              },
              request: {
                targetHost: "example.com",
                targetOrigin: "https://example.com",
                targetUrl: "https://example.com/releases",
                task: `Inspect release metadata ${sentinel}.`,
                taskHash: "hash_1",
                taskLength: 64,
              },
              sandboxPolicy: {
                artifactCapture: "screenshots_and_traces",
                downloadPolicy: "metadata_only",
                executionDriver: "external_worker",
                network: "target_origin_only",
                uploadPolicy: "blocked",
              },
              workflow: {
                stepId: "step_1",
                workflowId: "workflow_1",
                workflowRunId: "workflow_run_1",
                workspaceId: "workspace_default",
              },
            };
          },
          completeBrowserTask: async (input) => {
            completedInputs.push(input);
            return {
              job: {
                id: input.jobId,
                status: "completed",
                type: "workflow.browser_task.dispatch_request",
              },
              outcome: "completed",
              workerQueue: "browser_automation",
              workflow: {
                stepId: "step_1",
                workflowId: "workflow_1",
                workflowRunId: "workflow_run_1",
                workspaceId: "workspace_default",
              },
            };
          },
          failBrowserTask: async () => {
            throw new Error("browser task should complete");
          },
        },
      },
      fetchImpl: async (input, init) => {
        runnerRequests.push({
          url: String(input),
          body: typeof init?.body === "string" ? init.body : "",
        });
        return new Response(
          JSON.stringify({
            artifactCount: 1,
            capturedBytes: 4096,
            durationMs: 1500,
            finalOrigin: "https://example.com/releases",
            navigationCount: 2,
            networkDeniedCount: 1,
            outputKeys: ["releaseStatus"],
            redactionApplied: true,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
      intervalMs: 60_000,
      io,
      leaseSeconds: 300,
      maxBytes: 20_000,
      maxIterations: 1,
      runnerUrl: "https://browser-runner.example/tasks",
      timeoutMs: 30_000,
    });

    const output = stdout();
    const parsed = JSON.parse(output);
    expect(exitCode).toBe(0);
    expect(claimInputs).toEqual([{ leaseSeconds: 300 }]);
    expect(runnerRequests).toHaveLength(1);
    expect(runnerRequests[0]?.url).toBe("https://browser-runner.example/tasks");
    expect(runnerRequests[0]?.body).toContain(sentinel);
    expect(completedInputs).toEqual([
      {
        jobId: "job_browser_1",
        result: {
          artifactCount: 1,
          capturedBytes: 4096,
          durationMs: 1500,
          finalOrigin: "https://example.com/releases",
          navigationCount: 2,
          networkDeniedCount: 1,
          outputKeys: ["releaseStatus"],
          redactionApplied: true,
        },
      },
    ]);
    expect(parsed).toMatchObject({
      iteration: 1,
      claimedCount: 1,
      completedCount: 1,
      failedCount: 0,
      jobs: [
        {
          jobId: "job_browser_1",
          outcome: "completed",
          targetHost: "example.com",
          workflowRunId: "workflow_run_1",
        },
      ],
    });
    expect(output).not.toContain(sentinel);
  });

  it("exits the data connector loop after an abort without entering the next sleep", async () => {
    const { io, stdout } = createOutput();
    const controller = new AbortController();
    let listCalls = 0;
    let slept = false;

    const exitCode = await runDataConnectorSyncWorker({
      client: {
        dataConnectors: {
          list: async () => {
            listCalls += 1;
            controller.abort();
            return [];
          },
          sync: async () => ({ id: "sync_1", status: "completed" }),
        },
      } as never,
      intervalMs: 60_000,
      io,
      signal: controller.signal,
      sleep: async () => {
        slept = true;
      },
    });

    expect(exitCode).toBe(0);
    expect(listCalls).toBe(1);
    expect(slept).toBe(false);
    expect(stdout()).toContain('"iteration": 1');
  });

  it("exits the knowledge extraction loop after an abort without entering the next sleep", async () => {
    const { io, stdout } = createOutput();
    const controller = new AbortController();
    let listCalls = 0;
    let slept = false;

    const exitCode = await runKnowledgeExtractionWorker({
      client: {
        knowledge: {
          extractUpload: async () => ({
            source: { id: "source_1", status: "indexed" },
            extractedTextBytes: 0,
          }),
          listSources: async () => {
            listCalls += 1;
            controller.abort();
            return [];
          },
        },
      } as never,
      intervalMs: 60_000,
      io,
      knowledgeBaseId: "kb_default",
      signal: controller.signal,
      sleep: async () => {
        slept = true;
      },
    });

    expect(exitCode).toBe(0);
    expect(listCalls).toBe(1);
    expect(slept).toBe(false);
    expect(stdout()).toContain('"iteration": 1');
  });

  it("exits the retention loop after an abort without entering the next sleep", async () => {
    const { io, stdout } = createOutput();
    const controller = new AbortController();
    let calls = 0;
    let slept = false;

    const exitCode = await runRetentionEnforcementWorker({
      client: {
        governance: {
          enforceRetention: async () => {
            calls += 1;
            controller.abort();
            return {
              deletedAuditLogCount: 0,
              cutoffAt: new Date(0).toISOString(),
            };
          },
        },
      } as never,
      intervalMs: 60_000,
      io,
      signal: controller.signal,
      sleep: async () => {
        slept = true;
      },
    });

    expect(exitCode).toBe(0);
    expect(calls).toBe(1);
    expect(slept).toBe(false);
    expect(stdout()).toContain('"iteration": 1');
  });

  it("exits the billing entitlement reconciliation loop after an abort without entering the next sleep", async () => {
    const { io, stdout } = createOutput();
    const controller = new AbortController();
    let calls = 0;
    let slept = false;

    const exitCode = await runBillingEntitlementReconciliationWorker({
      client: {
        admin: {
          reconcileBillingEntitlements: async () => {
            calls += 1;
            controller.abort();
            return {
              before: billingEntitlementReport("attention_required"),
              after: billingEntitlementReport("healthy"),
              actions: {
                createdQuotaIds: ["quota_created"],
                updatedQuotaIds: [],
                unchangedQuotaIds: ["quota_existing"],
              },
            };
          },
        },
      } as never,
      intervalMs: 60_000,
      io,
      signal: controller.signal,
      sleep: async () => {
        slept = true;
      },
    });

    expect(exitCode).toBe(0);
    expect(calls).toBe(1);
    expect(slept).toBe(false);
    expect(stdout()).toContain('"createdQuotaCount": 1');
  });

  it("exits the billing lifecycle enforcement loop after an abort without entering the next sleep", async () => {
    const { io, stdout } = createOutput();
    const controller = new AbortController();
    let calls = 0;
    let slept = false;

    const exitCode = await runBillingLifecycleEnforcementWorker({
      client: {
        admin: {
          enforceBillingLifecycle: async () => {
            calls += 1;
            controller.abort();
            return {
              before: billingLifecycleReport("attention_required"),
              after: billingLifecycleReport("healthy"),
              action: {
                type: "mark_past_due",
                statusChanged: true,
                previousStatus: "trialing",
                newStatus: "past_due",
              },
            };
          },
        },
      } as never,
      intervalMs: 60_000,
      io,
      signal: controller.signal,
      sleep: async () => {
        slept = true;
      },
    });

    expect(exitCode).toBe(0);
    expect(calls).toBe(1);
    expect(slept).toBe(false);
    expect(stdout()).toContain('"statusChangedCount": 1');
  });

  it("exits the voice catalog loop after an abort without entering the next sleep", async () => {
    const { io, stdout } = createOutput();
    const controller = new AbortController();
    let calls = 0;
    let slept = false;

    const exitCode = await runVoiceCatalogSyncWorker({
      client: {
        voice: {
          sync: async () => {
            calls += 1;
            controller.abort();
            return {
              imported: 0,
              existing: 0,
              providerVoiceCount: 0,
              profiles: [],
            };
          },
        },
      } as never,
      intervalMs: 60_000,
      io,
      signal: controller.signal,
      sleep: async () => {
        slept = true;
      },
    });

    expect(exitCode).toBe(0);
    expect(calls).toBe(1);
    expect(slept).toBe(false);
    expect(stdout()).toContain('"iteration": 1');
  });
});

function createOutput(): { io: CliIo; stdout: () => string } {
  let stdout = "";
  return {
    io: {
      stdout: {
        write: (chunk: string | Uint8Array) => (
          (stdout += String(chunk)),
          true
        ),
      },
      stderr: { write: () => true },
    },
    stdout: () => stdout,
  };
}

function billingEntitlementReport(status: "attention_required" | "healthy") {
  return {
    orgId: "org_default",
    generatedAt: "2026-07-02T00:00:00.000Z",
    status,
    billingPlanConfigured: true,
    quotaTemplateCount: 1,
    unmanagedOrgQuotaCount: 0,
    warnings: status === "healthy" ? [] : ["quota_missing"],
    billingPlan: {
      code: "team",
      name: "Team",
      source: "manual",
      status: "active",
      externalCustomerConfigured: false,
      externalSubscriptionConfigured: false,
      updatedAt: "2026-07-02T00:00:00.000Z",
    },
    quotas: [
      {
        metric: "run.started",
        expectedLimit: 1000,
        expectedResetInterval: "monthly",
        status: status === "healthy" ? "matched" : "missing",
      },
    ],
  };
}

function billingLifecycleReport(status: "attention_required" | "healthy") {
  return {
    orgId: "org_default",
    generatedAt: "2026-07-02T00:00:00.000Z",
    status,
    billingPlanConfigured: true,
    warnings: status === "healthy" ? [] : ["trial_expired"],
    recommendedAction: status === "healthy" ? "none" : "mark_past_due",
    lifecycle: {
      trialEndsAt: "2020-01-01T00:00:00.000Z",
    },
    billingPlan: {
      code: "trial",
      name: "Trial",
      source: "manual",
      status: status === "healthy" ? "past_due" : "trialing",
      externalCustomerConfigured: false,
      externalSubscriptionConfigured: false,
      updatedAt: "2026-07-02T00:00:00.000Z",
    },
  };
}

function createClaimedToolDispatchClient(input: {
  authPolicy?: {
    oauthClientAuthMethod?: "client_secret_basic" | "client_secret_post";
    oauthScopes?: string[];
    oauthTokenUrl?: string;
    type: "none" | "api_key" | "bearer" | "oauth2_client_credentials";
  };
  host?: string;
  method?: string;
  onComplete?: (input: unknown) => void;
  onFail?: (input: unknown) => void;
  pathTemplate?: string;
  responseValidation?: {
    jsonSchemas: Record<string, Record<string, unknown>>;
  };
  transport?: ToolOperationDispatchRequestClaimResult["transport"];
}): ToolDispatchWorkerClient {
  const method = input.method ?? "get";
  const pathTemplate = input.pathTemplate ?? "/issues/{issueId}";
  return {
    tool: {
      claimDispatchRequest: async () => ({
        claimed: true,
        job: {
          id: "job_dispatch_test",
          type: "tool.operation.dispatch_request",
          status: "running",
        },
        connectorId: "tool_connector_1",
        operationId: "getIssue",
        method,
        pathTemplate,
        workerQueue: "external_tool_operations",
        request: {
          parameterKeys: ["issueId"],
          bodyKeys: [],
          host: input.host ?? "api.example.com",
          payloadStorage: "external_worker_secret_store_required",
        },
        ...(input.authPolicy === undefined
          ? {}
          : { authPolicy: input.authPolicy }),
        ...(input.responseValidation === undefined
          ? {}
          : { responseValidation: input.responseValidation }),
        ...(input.transport === undefined
          ? {}
          : { transport: input.transport }),
      }),
      completeDispatchRequest: async (request) => {
        input.onComplete?.(request);
        return {
          job: {
            id: "job_dispatch_test",
            type: "tool.operation.dispatch_request",
            status: "completed",
          },
          connectorId: "tool_connector_1",
          operationId: "getIssue",
          method,
          pathTemplate,
          workerQueue: "external_tool_operations",
          outcome: "completed",
        };
      },
      failDispatchRequest: async (request) => {
        input.onFail?.(request);
        return {
          job: {
            id: "job_dispatch_test",
            type: "tool.operation.dispatch_request",
            status: "failed",
          },
          connectorId: "tool_connector_1",
          operationId: "getIssue",
          method,
          pathTemplate,
          workerQueue: "external_tool_operations",
          outcome: "failed",
          errorCode: request.errorCode,
        };
      },
    },
  };
}
