import { describe, expect, it } from "vitest";

import { parseArgs } from "./args";
import { executeCommand } from "./commands";
import type { CliIo } from "./io";

describe("executeCommand", () => {
  it("lists agents as JSON", async () => {
    const output = createOutput();
    const exitCode = await executeCommand({
      client: {
        agent: {
          list: async (workspaceId?: string) => [
            { id: "agent_1", workspaceId, name: "Romeo" },
          ],
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs(["agents", "list", "--workspace", "ws_1"]),
      readFile: async () => new Uint8Array(),
    });

    expect(exitCode).toBe(0);
    expect(output.stdout()).toContain('"agent_1"');
    expect(output.stdout()).toContain('"ws_1"');
  });

  it("streams chat deltas by default", async () => {
    const output = createOutput();
    const exitCode = await executeCommand({
      client: {
        chatApi: {
          create: async () => ({ id: "chat_1" }),
          startRun: async () => ({ id: "run_1" }),
          events: async function* () {
            yield {
              id: "evt_1",
              runId: "run_1",
              sequence: 1,
              type: "message.delta",
              data: { text: "Hello" },
              createdAt: "",
            };
            yield {
              id: "evt_2",
              runId: "run_1",
              sequence: 2,
              type: "run.completed",
              data: {},
              createdAt: "",
            };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "chat",
        "run",
        "--workspace",
        "ws_1",
        "--agent",
        "agent_1",
        "--prompt",
        "Hi",
      ]),
      readFile: async () => new Uint8Array(),
    });

    expect(exitCode).toBe(0);
    expect(output.stdout()).toBe("Hello\n");
  });

  it("uploads knowledge files through the presigned flow", async () => {
    const output = createOutput();
    const uploads: Array<{ url: string; init?: RequestInit }> = [];
    const exitCode = await executeCommand({
      client: {
        knowledge: {
          createUpload: async () => ({
            source: { id: "src_1" },
            upload: {
              url: "https://upload.example/src_1",
              method: "PUT",
              headers: { "content-type": "text/plain" },
            },
          }),
          completeUpload: async () => ({ id: "src_1", status: "indexed" }),
        },
      } as never,
      fetchImpl: async (input, init) => {
        const upload: { url: string; init?: RequestInit } = {
          url: String(input),
        };
        if (init !== undefined) upload.init = init;
        uploads.push(upload);
        return new Response(null, { status: 200 });
      },
      io: output.io,
      parsed: parseArgs([
        "knowledge",
        "upload",
        "--kb",
        "kb_1",
        "--file",
        "notes.md",
        "--mime",
        "text/markdown",
      ]),
      readFile: async () => new TextEncoder().encode("Romeo notes"),
    });

    expect(exitCode).toBe(0);
    expect(uploads[0]?.url).toBe("https://upload.example/src_1");
    expect(uploads[0]?.init?.method).toBe("PUT");
    expect(output.stdout()).toContain('"indexed"');
  });

  it("extracts a knowledge source from CLI flags", async () => {
    const output = createOutput();
    const calls: unknown[] = [];
    const exitCode = await executeCommand({
      client: {
        knowledge: {
          extractUpload: async (knowledgeBaseId: string, sourceId: string) => {
            calls.push({ knowledgeBaseId, sourceId });
            return {
              job: { id: "job_1", status: "completed" },
              source: { id: sourceId, status: "indexed" },
            };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "knowledge",
        "extract",
        "--kb",
        "kb_1",
        "--source",
        "src_1",
      ]),
      readFile: async () => new Uint8Array(),
    });

    expect(exitCode).toBe(0);
    expect(calls).toEqual([{ knowledgeBaseId: "kb_1", sourceId: "src_1" }]);
    expect(output.stdout()).toContain('"job_1"');
  });

  it("indexes knowledge embeddings from CLI flags", async () => {
    const output = createOutput();
    const calls: unknown[] = [];
    const exitCode = await executeCommand({
      client: {
        knowledge: {
          indexEmbeddings: async (input: {
            batchSize?: number;
            knowledgeBaseId: string;
            model: string;
            providerId: string;
          }) => {
            calls.push(input);
            return {
              job: { id: "job_embeddings", status: "completed" },
              embeddingCount: 2,
              dimensions: 1536,
              providerId: input.providerId,
              model: input.model,
            };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "knowledge",
        "index-embeddings",
        "--kb",
        "kb_1",
        "--provider",
        "provider_ollama",
        "--model",
        "nomic-embed-text",
        "--batch-size",
        "8",
      ]),
      readFile: async () => new Uint8Array(),
    });

    expect(exitCode).toBe(0);
    expect(calls).toEqual([
      {
        knowledgeBaseId: "kb_1",
        providerId: "provider_ollama",
        model: "nomic-embed-text",
        batchSize: 8,
      },
    ]);
    expect(output.stdout()).toContain('"job_embeddings"');
  });

  it("syncs provider models from CLI flags", async () => {
    const output = createOutput();
    const calls: string[] = [];
    const exitCode = await executeCommand({
      client: {
        provider: {
          syncModels: async (providerId: string) => {
            calls.push(providerId);
            return [{ id: "model_provider_ollama_llama3_2_latest" }];
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs(["models", "sync", "--provider", "provider_ollama"]),
      readFile: async () => new Uint8Array(),
    });

    expect(exitCode).toBe(0);
    expect(calls).toEqual(["provider_ollama"]);
    expect(output.stdout()).toContain("model_provider_ollama_llama3_2_latest");
  });

  it("prints provider operational summary from the admin resource", async () => {
    const output = createOutput();
    const exitCode = await executeCommand({
      client: {
        admin: {
          providerOperationalSummary: async () => ({
            alerts: [
              {
                code: "provider_kill_switch",
                id: "provider_provider_kill_switch_provider_openai",
                providerId: "provider_openai",
                severity: "warning",
              },
            ],
            fallback: {
              available: true,
              configured: true,
              modelId: "model_fallback",
              providerId: "provider_fallback",
            },
            generatedAt: "2026-06-30T00:00:00.000Z",
            policy: {
              circuitCooldownMs: 60000,
              circuitFailureThreshold: 5,
              disabledProviderIds: ["provider_openai"],
              fallbackModelId: "model_fallback",
              retryAttempts: 1,
              retryBackoffMs: 250,
              streamTimeoutMs: 60000,
            },
            providers: [
              {
                circuit: { consecutiveFailures: 0, state: "closed" },
                enabled: true,
                enabledModelCount: 1,
                killSwitchActive: true,
                modelCount: 1,
                providerId: "provider_openai",
                reasons: ["provider_kill_switch"],
                status: "unavailable",
                type: "openai-compatible",
              },
            ],
            status: "degraded",
          }),
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs(["providers", "summary"]),
      readFile: async () => new Uint8Array(),
    });

    expect(exitCode).toBe(0);
    expect(output.stdout()).toContain('"status": "degraded"');
    expect(output.stdout()).toContain('"provider_kill_switch"');
    expect(output.stdout()).toContain('"provider_fallback"');
  });

  it("runs the knowledge extraction worker for bounded iterations", async () => {
    const output = createOutput();
    let listCalls = 0;
    const extracted: string[] = [];
    const exitCode = await executeCommand({
      client: {
        knowledge: {
          listSources: async () => {
            listCalls += 1;
            return listCalls === 1
              ? [
                  {
                    id: "src_pending",
                    status: "pending",
                    objectKey: "knowledge/kb_1/src_pending/policy.pdf",
                  },
                  {
                    id: "src_indexed",
                    status: "indexed",
                    objectKey: "knowledge/kb_1/src_indexed/notes.md",
                  },
                ]
              : [];
          },
          extractUpload: async (_knowledgeBaseId: string, sourceId: string) => {
            extracted.push(sourceId);
            return {
              job: { id: "job_1", status: "completed" },
              source: { id: sourceId, status: "indexed" },
            };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "workers",
        "knowledge-extraction",
        "--kb",
        "kb_1",
        "--max-iterations",
        "2",
        "--interval-ms",
        "0",
      ]),
      readFile: async () => new Uint8Array(),
    });

    expect(exitCode).toBe(0);
    expect(listCalls).toBe(2);
    expect(extracted).toEqual(["src_pending"]);
    expect(output.stdout()).toContain('"iteration": 2');
    expect(output.stdout()).toContain('"extractedCount": 1');
  });

  it("checks tool connector auth availability from CLI flags", async () => {
    const output = createOutput();
    const calls: string[] = [];
    const exitCode = await executeCommand({
      client: {
        tool: {
          checkConnectorAuth: async (connectorId: string) => {
            calls.push(connectorId);
            return {
              connectorId,
              configured: true,
              available: false,
              failureCode: "secret_resolver_disabled",
              checkedAt: "",
            };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "tools",
        "auth-check",
        "--connector",
        "tool_connector_1",
      ]),
      readFile: async () => new Uint8Array(),
    });

    expect(exitCode).toBe(0);
    expect(calls).toEqual(["tool_connector_1"]);
    expect(output.stdout()).toContain("secret_resolver_disabled");
  });

  it("updates tool connector and operation activation from CLI flags", async () => {
    const output = createOutput();
    const calls: unknown[] = [];
    const connectorExitCode = await executeCommand({
      client: {
        tool: {
          updateConnector: async (input: unknown) => {
            calls.push(input);
            return { id: "tool_connector_1", enabled: true };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "tools",
        "connector-enable",
        "--connector",
        "tool_connector_1",
      ]),
      readFile: async () => new Uint8Array(),
    });
    const operationExitCode = await executeCommand({
      client: {
        tool: {
          updateOperation: async (input: unknown) => {
            calls.push(input);
            return {
              id: "tool_operation_1",
              operationId: "listIssues",
              enabled: true,
            };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "tools",
        "operation-enable",
        "--connector",
        "tool_connector_1",
        "--operation",
        "listIssues",
      ]),
      readFile: async () => new Uint8Array(),
    });

    expect(connectorExitCode).toBe(0);
    expect(operationExitCode).toBe(0);
    expect(calls).toEqual([
      { connectorId: "tool_connector_1", enabled: true },
      {
        connectorId: "tool_connector_1",
        operationId: "listIssues",
        enabled: true,
      },
    ]);
    expect(output.stdout()).toContain("tool_connector_1");
    expect(output.stdout()).toContain("tool_operation_1");
  });

  it("dispatches a tool operation from CLI flags", async () => {
    const output = createOutput();
    const calls: unknown[] = [];
    const exitCode = await executeCommand({
      client: {
        tool: {
          dispatchOperation: async (input: unknown) => {
            calls.push(input);
            return {
              job: {
                id: "job_1",
                type: "tool.operation.dispatch",
                status: "completed",
              },
              connectorId: "tool_connector_1",
              operationId: "getIssue",
              method: "get",
              pathTemplate: "/issues/{issueId}",
              request: {
                parameterKeys: ["expand", "issueId"],
                bodyKeys: [],
                host: "api.example.com",
                authInjected: true,
              },
              response: {
                ok: true,
                status: 200,
                bodyBytes: 12,
                truncated: false,
                schemaValidation: { status: "not_applicable" },
              },
            };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "tools",
        "operation-dispatch",
        "--connector",
        "tool_connector_1",
        "--operation",
        "getIssue",
        "--approved",
        "--approval-request",
        "job_approval",
        "--param",
        "issueId=ISSUE-1,expand=comments",
      ]),
      readFile: async () => new Uint8Array(),
    });

    expect(exitCode).toBe(0);
    expect(calls).toEqual([
      {
        connectorId: "tool_connector_1",
        operationId: "getIssue",
        approved: true,
        approvalRequestId: "job_approval",
        parameters: { issueId: "ISSUE-1", expand: "comments" },
      },
    ]);
    expect(output.stdout()).toContain('"tool.operation.dispatch"');
    expect(output.stdout()).toContain('"bodyBytes": 12');
  });

  it("queues a tool operation dispatch request from CLI flags", async () => {
    const output = createOutput();
    const calls: unknown[] = [];
    const exitCode = await executeCommand({
      client: {
        tool: {
          enqueueDispatchOperation: async (input: unknown) => {
            calls.push(input);
            return {
              job: {
                id: "job_2",
                type: "tool.operation.dispatch_request",
                status: "queued",
              },
              connectorId: "tool_connector_1",
              operationId: "getIssue",
              method: "get",
              pathTemplate: "/issues/{issueId}",
              workerQueue: "external_tool_operations",
              request: {
                parameterKeys: ["expand", "issueId"],
                bodyKeys: [],
                host: "api.example.com",
                payloadStorage: "external_worker_secret_store_required",
              },
              approval: {
                required: true,
                approvalPolicy: "external_side_effects",
                riskLevel: "medium",
                approvalRequestId: "job_approval",
              },
            };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "tools",
        "operation-enqueue",
        "--connector",
        "tool_connector_1",
        "--operation",
        "getIssue",
        "--approved",
        "--approval-request",
        "job_approval",
        "--idempotency-key",
        "dispatch-key-1",
        "--param",
        "issueId=ISSUE-1,expand=comments",
      ]),
      readFile: async () => new Uint8Array(),
    });

    expect(exitCode).toBe(0);
    expect(calls).toEqual([
      {
        connectorId: "tool_connector_1",
        operationId: "getIssue",
        approved: true,
        approvalRequestId: "job_approval",
        idempotencyKey: "dispatch-key-1",
        parameters: { issueId: "ISSUE-1", expand: "comments" },
      },
    ]);
    expect(output.stdout()).toContain('"tool.operation.dispatch_request"');
    expect(output.stdout()).toContain(
      '"external_worker_secret_store_required"',
    );
  });

  it("claims and renews tool dispatch request leases from CLI flags", async () => {
    const output = createOutput();
    const calls: unknown[] = [];
    const claimExitCode = await executeCommand({
      client: {
        tool: {
          claimDispatchRequest: async (input: unknown) => {
            calls.push(input);
            return {
              claimed: true,
              job: {
                id: "job_2",
                type: "tool.operation.dispatch_request",
                status: "running",
              },
              workerQueue: "external_tool_operations",
              lease: {
                workerId: "svc_worker",
                claimedAt: "2026-06-30T00:00:00.000Z",
                renewedAt: "2026-06-30T00:00:00.000Z",
                expiresAt: "2026-06-30T00:05:00.000Z",
                leaseSeconds: 300,
                attempt: 1,
              },
            };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "tools",
        "dispatch-request-claim",
        "--lease-seconds",
        "300",
      ]),
      readFile: async () => new Uint8Array(),
    });
    const renewExitCode = await executeCommand({
      client: {
        tool: {
          renewDispatchRequestLease: async (input: unknown) => {
            calls.push(input);
            return {
              claimed: true,
              job: {
                id: "job_2",
                type: "tool.operation.dispatch_request",
                status: "running",
              },
              workerQueue: "external_tool_operations",
              lease: {
                workerId: "svc_worker",
                claimedAt: "2026-06-30T00:00:00.000Z",
                renewedAt: "2026-06-30T00:02:00.000Z",
                expiresAt: "2026-06-30T00:12:00.000Z",
                leaseSeconds: 600,
                attempt: 1,
              },
            };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "tools",
        "dispatch-request-renew",
        "--job",
        "job_2",
        "--lease-seconds",
        "600",
      ]),
      readFile: async () => new Uint8Array(),
    });

    expect(claimExitCode).toBe(0);
    expect(renewExitCode).toBe(0);
    expect(calls).toEqual([
      { leaseSeconds: 300 },
      { jobId: "job_2", leaseSeconds: 600 },
    ]);
    expect(output.stdout()).toContain('"claimed": true');
    expect(output.stdout()).toContain('"leaseSeconds": 600');
  });

  it("expires stale tool dispatch requests from CLI flags", async () => {
    const output = createOutput();
    const calls: unknown[] = [];
    const exitCode = await executeCommand({
      client: {
        tool: {
          expireDispatchRequests: async (input: unknown) => {
            calls.push(input);
            return {
              expired: 1,
              workerQueue: "external_tool_operations",
              jobs: [
                {
                  job: {
                    id: "job_5",
                    type: "tool.operation.dispatch_request",
                    status: "failed",
                  },
                  connectorId: "tool_connector_1",
                  operationId: "getIssue",
                  method: "get",
                  pathTemplate: "/issues/{issueId}",
                  reasonCode: "queued_timeout",
                },
              ],
            };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "tools",
        "dispatch-requests-expire",
        "--queued-timeout-seconds",
        "86400",
        "--running-timeout-seconds",
        "3600",
        "--limit",
        "25",
      ]),
      readFile: async () => new Uint8Array(),
    });

    expect(exitCode).toBe(0);
    expect(calls).toEqual([
      {
        queuedTimeoutSeconds: 86400,
        runningTimeoutSeconds: 3600,
        limit: 25,
      },
    ]);
    expect(output.stdout()).toContain('"expired": 1');
    expect(output.stdout()).toContain('"queued_timeout"');
  });

  it("reports tool dispatch request readback from CLI flags", async () => {
    const output = createOutput();
    const calls: unknown[] = [];
    const completeExitCode = await executeCommand({
      client: {
        tool: {
          completeDispatchRequest: async (input: unknown) => {
            calls.push(input);
            return {
              job: {
                id: "job_2",
                type: "tool.operation.dispatch_request",
                status: "completed",
              },
              connectorId: "tool_connector_1",
              operationId: "getIssue",
              method: "get",
              pathTemplate: "/issues/{issueId}",
              workerQueue: "external_tool_operations",
              outcome: "completed",
              response: {
                ok: true,
                status: 202,
                bodyBytes: 12,
                truncated: true,
                schemaValidation: { status: "passed" },
              },
            };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "tools",
        "dispatch-request-complete",
        "--job",
        "job_2",
        "--status",
        "202",
        "--content-type",
        "application/json",
        "--body-bytes",
        "12",
        "--truncated",
        "--schema-validation",
        "passed",
      ]),
      readFile: async () => new Uint8Array(),
    });
    const failExitCode = await executeCommand({
      client: {
        tool: {
          failDispatchRequest: async (input: unknown) => {
            calls.push(input);
            return {
              job: {
                id: "job_3",
                type: "tool.operation.dispatch_request",
                status: "failed",
              },
              connectorId: "tool_connector_1",
              operationId: "getIssue",
              method: "get",
              pathTemplate: "/issues/{issueId}",
              workerQueue: "external_tool_operations",
              outcome: "failed",
              errorCode: "worker_failed",
            };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "tools",
        "dispatch-request-fail",
        "--job",
        "job_3",
        "--error-code",
        "worker_failed",
      ]),
      readFile: async () => new Uint8Array(),
    });
    const cancelExitCode = await executeCommand({
      client: {
        tool: {
          cancelDispatchRequest: async (input: unknown) => {
            calls.push(input);
            return {
              job: {
                id: "job_4",
                type: "tool.operation.dispatch_request",
                status: "failed",
              },
              connectorId: "tool_connector_1",
              operationId: "getIssue",
              method: "get",
              pathTemplate: "/issues/{issueId}",
              workerQueue: "external_tool_operations",
              outcome: "cancelled",
              errorCode: "worker_cancelled",
            };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "tools",
        "dispatch-request-cancel",
        "--job",
        "job_4",
        "--reason-code",
        "operator_cancelled",
      ]),
      readFile: async () => new Uint8Array(),
    });

    expect(completeExitCode).toBe(0);
    expect(failExitCode).toBe(0);
    expect(cancelExitCode).toBe(0);
    expect(calls).toEqual([
      {
        jobId: "job_2",
        response: {
          ok: true,
          status: 202,
          contentType: "application/json",
          bodyBytes: 12,
          truncated: true,
          schemaValidation: { status: "passed" },
        },
      },
      { jobId: "job_3", errorCode: "worker_failed" },
      { jobId: "job_4", reasonCode: "operator_cancelled" },
    ]);
    expect(output.stdout()).toContain('"outcome": "completed"');
    expect(output.stdout()).toContain('"worker_failed"');
    expect(output.stdout()).toContain('"outcome": "cancelled"');
  });

  it("runs the tool dispatch worker with an external payload file", async () => {
    const output = createOutput();
    const rawSentinel = "tool-worker-command-raw-secret";
    const calls: unknown[] = [];
    const fetches: unknown[] = [];
    const exitCode = await executeCommand({
      client: {
        tool: {
          claimDispatchRequest: async (input: unknown) => {
            calls.push(input);
            return {
              claimed: true,
              job: {
                id: "job_2",
                type: "tool.operation.dispatch_request",
                status: "running",
              },
              connectorId: "tool_connector_1",
              operationId: "createIssue",
              method: "post",
              pathTemplate: "/issues/{issueId}",
              workerQueue: "external_tool_operations",
              request: {
                parameterKeys: ["issueId"],
                bodyKeys: ["secret"],
                host: "api.example.com",
                payloadStorage: "external_worker_secret_store_required",
              },
              lease: {
                workerId: "svc_worker",
                claimedAt: "2026-06-30T00:00:00.000Z",
                renewedAt: "2026-06-30T00:00:00.000Z",
                expiresAt: "2026-06-30T00:05:00.000Z",
                leaseSeconds: 300,
                attempt: 1,
              },
            };
          },
          completeDispatchRequest: async (input: unknown) => {
            calls.push(input);
            return {
              job: {
                id: "job_2",
                type: "tool.operation.dispatch_request",
                status: "completed",
              },
              connectorId: "tool_connector_1",
              operationId: "createIssue",
              method: "post",
              pathTemplate: "/issues/{issueId}",
              workerQueue: "external_tool_operations",
              outcome: "completed",
            };
          },
          failDispatchRequest: async (input: unknown) => {
            calls.push(input);
            throw new Error(
              "tool dispatch worker should not fail this request",
            );
          },
        },
      } as never,
      fetchImpl: async (input, init) => {
        fetches.push({
          url: String(input),
          method: init?.method,
          redirect: init?.redirect,
          headers: init?.headers,
          body: init?.body,
        });
        return new Response("ok", {
          status: 202,
          headers: { "content-type": "application/json" },
        });
      },
      io: output.io,
      parsed: parseArgs([
        "workers",
        "tool-dispatch",
        "--once",
        "--payload-file",
        "payloads.json",
        "--timeout-ms",
        "500",
        "--max-bytes",
        "64",
      ]),
      readFile: async (path) => {
        expect(path).toBe("payloads.json");
        return new TextEncoder().encode(
          JSON.stringify({
            job_2: {
              parameters: { issueId: "ISSUE-1" },
              headers: { "x-worker-secret": rawSentinel },
              body: { secret: rawSentinel },
            },
          }),
        );
      },
    });

    expect(exitCode).toBe(0);
    expect(calls).toEqual([
      { leaseSeconds: 300 },
      {
        jobId: "job_2",
        response: {
          ok: true,
          status: 202,
          contentType: "application/json",
          bodyBytes: 2,
          truncated: false,
          schemaValidation: { status: "not_applicable" },
        },
      },
    ]);
    expect(fetches).toEqual([
      {
        url: "https://api.example.com/issues/ISSUE-1",
        method: "POST",
        redirect: "error",
        headers: {
          accept: "application/json",
          "x-worker-secret": rawSentinel,
          "content-type": "application/json",
        },
        body: JSON.stringify({ secret: rawSentinel }),
      },
    ]);
    expect(output.stdout()).toContain('"completedCount": 1');
    expect(output.stdout()).not.toContain(rawSentinel);
  });

  it("runs the tool dispatch worker with worker-local env secret resolution", async () => {
    const output = createOutput();
    const token = "tool-worker-command-env-secret";
    const previous = process.env.TOOL_WORKER_AUTH_TOKEN;
    const fetches: unknown[] = [];
    process.env.TOOL_WORKER_AUTH_TOKEN = token;
    try {
      const exitCode = await executeCommand({
        client: {
          tool: {
            claimDispatchRequest: async () => ({
              claimed: true,
              job: {
                id: "job_env_auth",
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
            }),
            completeDispatchRequest: async () => ({
              job: {
                id: "job_env_auth",
                type: "tool.operation.dispatch_request",
                status: "completed",
              },
              connectorId: "tool_connector_1",
              operationId: "getIssue",
              method: "get",
              pathTemplate: "/issues/{issueId}",
              workerQueue: "external_tool_operations",
              outcome: "completed",
            }),
            failDispatchRequest: async () => {
              throw new Error("env auth worker should complete request");
            },
          },
        } as never,
        fetchImpl: async (input, init) => {
          fetches.push({
            url: String(input),
            headers: init?.headers,
          });
          return new Response("ok", { status: 200 });
        },
        io: output.io,
        parsed: parseArgs([
          "workers",
          "tool-dispatch",
          "--once",
          "--payload-file",
          "payloads.json",
          "--secret-resolver",
          "env",
        ]),
        readFile: async () =>
          new TextEncoder().encode(
            JSON.stringify({
              job_env_auth: {
                parameters: { issueId: "ISSUE-2" },
                auth: {
                  type: "bearer",
                  secretRef: "env://TOOL_WORKER_AUTH_TOKEN",
                },
              },
            }),
          ),
      });

      expect(exitCode).toBe(0);
      expect(fetches).toEqual([
        {
          url: "https://api.example.com/issues/ISSUE-2",
          headers: {
            accept: "application/json",
            authorization: `Bearer ${token}`,
          },
        },
      ]);
      expect(output.stdout()).toContain('"completedCount": 1');
      expect(output.stdout()).not.toContain(token);
    } finally {
      if (previous === undefined) {
        delete process.env.TOOL_WORKER_AUTH_TOKEN;
      } else {
        process.env.TOOL_WORKER_AUTH_TOKEN = previous;
      }
    }
  });

  it("runs the tool dispatch worker with worker-local Vault secret resolution", async () => {
    const output = createOutput();
    const token = "tool-worker-command-vault-secret";
    const previous = {
      VAULT_ADDR: process.env.VAULT_ADDR,
      VAULT_TOKEN: process.env.VAULT_TOKEN,
      VAULT_NAMESPACE: process.env.VAULT_NAMESPACE,
      VAULT_KV_MOUNT: process.env.VAULT_KV_MOUNT,
    };
    const fetches: unknown[] = [];
    process.env.VAULT_ADDR = "https://vault.example.com";
    process.env.VAULT_TOKEN = "vault-command-token";
    process.env.VAULT_NAMESPACE = "platform";
    process.env.VAULT_KV_MOUNT = "secret";
    try {
      const exitCode = await executeCommand({
        client: {
          tool: {
            claimDispatchRequest: async () => ({
              claimed: true,
              job: {
                id: "job_vault_auth",
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
            }),
            completeDispatchRequest: async () => ({
              job: {
                id: "job_vault_auth",
                type: "tool.operation.dispatch_request",
                status: "completed",
              },
              connectorId: "tool_connector_1",
              operationId: "getIssue",
              method: "get",
              pathTemplate: "/issues/{issueId}",
              workerQueue: "external_tool_operations",
              outcome: "completed",
            }),
            failDispatchRequest: async () => {
              throw new Error("Vault auth worker should complete request");
            },
          },
        } as never,
        fetchImpl: async (input, init) => {
          const url = String(input);
          const headers = new Headers(init?.headers);
          if (
            url === "https://vault.example.com/v1/secret/data/tools/api-key"
          ) {
            fetches.push({
              kind: "vault",
              url,
              token: headers.get("x-vault-token"),
              namespace: headers.get("x-vault-namespace"),
            });
            return new Response(
              JSON.stringify({ data: { data: { value: token } } }),
              { status: 200, headers: { "content-type": "application/json" } },
            );
          }
          fetches.push({
            kind: "api",
            url,
            auth: headers.get("authorization"),
          });
          return new Response("ok", { status: 200 });
        },
        io: output.io,
        parsed: parseArgs([
          "workers",
          "tool-dispatch",
          "--once",
          "--payload-file",
          "payloads.json",
          "--secret-resolver",
          "vault",
        ]),
        readFile: async () =>
          new TextEncoder().encode(
            JSON.stringify({
              job_vault_auth: {
                parameters: { issueId: "ISSUE-4" },
                auth: {
                  type: "bearer",
                  secretRef: "vault://tools/api-key",
                },
              },
            }),
          ),
      });

      expect(exitCode).toBe(0);
      expect(fetches).toEqual([
        {
          kind: "vault",
          url: "https://vault.example.com/v1/secret/data/tools/api-key",
          token: "vault-command-token",
          namespace: "platform",
        },
        {
          kind: "api",
          url: "https://api.example.com/issues/ISSUE-4",
          auth: `Bearer ${token}`,
        },
      ]);
      expect(output.stdout()).toContain('"completedCount": 1');
      expect(output.stdout()).not.toContain(token);
      expect(output.stdout()).not.toContain("vault-command-token");
    } finally {
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = value;
        }
      }
    }
  });

  it("runs the tool dispatch worker with worker-local OAuth client credentials", async () => {
    const output = createOutput();
    const clientId = "tool-worker-command-oauth-client";
    const clientSecret = "tool-worker-command-oauth-secret";
    const accessToken = "tool-worker-command-oauth-token";
    const previous = process.env.TOOL_WORKER_OAUTH_CLIENT;
    const fetches: unknown[] = [];
    process.env.TOOL_WORKER_OAUTH_CLIENT = JSON.stringify({
      clientId,
      clientSecret,
    });
    try {
      const exitCode = await executeCommand({
        client: {
          tool: {
            claimDispatchRequest: async () => ({
              claimed: true,
              job: {
                id: "job_oauth_auth",
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
              authPolicy: {
                type: "oauth2_client_credentials",
                oauthTokenUrl: "https://auth.example.com/oauth/token",
                oauthScopes: ["issues:read"],
                oauthClientAuthMethod: "client_secret_post",
              },
            }),
            completeDispatchRequest: async () => ({
              job: {
                id: "job_oauth_auth",
                type: "tool.operation.dispatch_request",
                status: "completed",
              },
              connectorId: "tool_connector_1",
              operationId: "getIssue",
              method: "get",
              pathTemplate: "/issues/{issueId}",
              workerQueue: "external_tool_operations",
              outcome: "completed",
            }),
            failDispatchRequest: async () => {
              throw new Error("OAuth auth worker should complete request");
            },
          },
        } as never,
        fetchImpl: async (input, init) => {
          const url = String(input);
          const headers = new Headers(init?.headers);
          if (url === "https://auth.example.com/oauth/token") {
            fetches.push({
              kind: "token",
              body: String(init?.body),
              auth: headers.get("authorization"),
            });
            return new Response(JSON.stringify({ access_token: accessToken }), {
              status: 200,
              headers: { "content-type": "application/json" },
            });
          }
          fetches.push({
            kind: "api",
            url,
            auth: headers.get("authorization"),
          });
          return new Response("ok", { status: 200 });
        },
        io: output.io,
        parsed: parseArgs([
          "workers",
          "tool-dispatch",
          "--once",
          "--payload-file",
          "payloads.json",
          "--secret-resolver",
          "env",
        ]),
        readFile: async () =>
          new TextEncoder().encode(
            JSON.stringify({
              job_oauth_auth: {
                parameters: { issueId: "ISSUE-3" },
                auth: {
                  type: "oauth2_client_credentials",
                  secretRef: "env://TOOL_WORKER_OAUTH_CLIENT",
                },
              },
            }),
          ),
      });

      expect(exitCode).toBe(0);
      expect(fetches).toEqual([
        {
          kind: "token",
          body: `grant_type=client_credentials&scope=issues%3Aread&client_id=${clientId}&client_secret=${clientSecret}`,
          auth: null,
        },
        {
          kind: "api",
          url: "https://api.example.com/issues/ISSUE-3",
          auth: `Bearer ${accessToken}`,
        },
      ]);
      expect(output.stdout()).toContain('"completedCount": 1');
      expect(output.stdout()).not.toContain(clientId);
      expect(output.stdout()).not.toContain(clientSecret);
      expect(output.stdout()).not.toContain(accessToken);
    } finally {
      if (previous === undefined) {
        delete process.env.TOOL_WORKER_OAUTH_CLIENT;
      } else {
        process.env.TOOL_WORKER_OAUTH_CLIENT = previous;
      }
    }
  });

  it("creates local sessions from CLI flags", async () => {
    const output = createOutput();
    let received: unknown;
    const exitCode = await executeCommand({
      client: {
        sessions: {
          create: async (input: unknown) => {
            received = input;
            return { session: { id: "session_1" }, token: "rms_test" };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "sessions",
        "create",
        "--name",
        "Browser",
        "--ttl-hours",
        "12",
      ]),
      readFile: async () => new Uint8Array(),
    });

    expect(exitCode).toBe(0);
    expect(received).toEqual({ name: "Browser", ttlHours: 12 });
    expect(output.stdout()).toContain("rms_test");
  });

  it("creates support impersonation sessions from CLI flags", async () => {
    const output = createOutput();
    let received: unknown;
    const exitCode = await executeCommand({
      client: {
        sessions: {
          createSupportSession: async (input: unknown) => {
            received = input;
            return { session: { id: "session_support" }, token: "rms_support" };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "sessions",
        "impersonate",
        "--target-user",
        "user_target",
        "--confirm-target-user",
        "user_target",
        "--reason",
        "Support ticket investigation",
        "--ticket",
        "TICKET-123",
        "--ttl-minutes",
        "15",
      ]),
      readFile: async () => new Uint8Array(),
    });

    expect(exitCode).toBe(0);
    expect(received).toEqual({
      targetUserId: "user_target",
      confirmTargetUserId: "user_target",
      reason: "Support ticket investigation",
      ticketRef: "TICKET-123",
      ttlMinutes: 15,
    });
    expect(output.stdout()).toContain("rms_support");
  });

  it("lists support impersonation session reports from the CLI", async () => {
    const output = createOutput();
    const exitCode = await executeCommand({
      client: {
        sessions: {
          supportSessionReports: async () => [
            {
              adminUserId: "user_admin",
              targetUserId: "user_target",
              status: "active",
              session: { id: "session_support" },
              createdAuditLogId: "audit_support",
            },
          ],
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs(["sessions", "impersonation-report"]),
      readFile: async () => new Uint8Array(),
    });

    expect(exitCode).toBe(0);
    expect(output.stdout()).toContain("session_support");
    expect(output.stdout()).toContain("user_target");
  });

  it("creates support impersonation approval requests from CLI flags", async () => {
    const output = createOutput();
    let received: unknown;
    const exitCode = await executeCommand({
      client: {
        sessions: {
          requestSupportSession: async (input: unknown) => {
            received = input;
            return {
              id: "support_request_1",
              status: "pending",
              targetUserId: "user_target",
            };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "sessions",
        "request-impersonation",
        "--target-user",
        "user_target",
        "--confirm-target-user",
        "user_target",
        "--reason",
        "Support ticket investigation",
        "--ticket",
        "TICKET-123",
        "--ttl-minutes",
        "15",
      ]),
      readFile: async () => new Uint8Array(),
    });

    expect(exitCode).toBe(0);
    expect(received).toEqual({
      targetUserId: "user_target",
      confirmTargetUserId: "user_target",
      reason: "Support ticket investigation",
      ticketRef: "TICKET-123",
      ttlMinutes: 15,
    });
    expect(output.stdout()).toContain("support_request_1");
  });

  it("approves and rejects support impersonation approval requests from CLI flags", async () => {
    const output = createOutput();
    const calls: string[] = [];
    const exitCodeApprove = await executeCommand({
      client: {
        sessions: {
          approveSupportSessionRequest: async (requestId: string) => {
            calls.push(`approve:${requestId}`);
            return { session: { id: "session_support" }, token: "rms_support" };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "sessions",
        "approve-impersonation",
        "--request",
        "support_request_1",
      ]),
      readFile: async () => new Uint8Array(),
    });
    const exitCodeReject = await executeCommand({
      client: {
        sessions: {
          rejectSupportSessionRequest: async (requestId: string) => {
            calls.push(`reject:${requestId}`);
            return { id: requestId, status: "rejected" };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "sessions",
        "reject-impersonation",
        "--request-id",
        "support_request_2",
      ]),
      readFile: async () => new Uint8Array(),
    });

    expect(exitCodeApprove).toBe(0);
    expect(exitCodeReject).toBe(0);
    expect(calls).toEqual([
      "approve:support_request_1",
      "reject:support_request_2",
    ]);
    expect(output.stdout()).toContain("rms_support");
    expect(output.stdout()).toContain("rejected");
  });

  it("lists support impersonation approval requests from the CLI", async () => {
    const output = createOutput();
    const exitCode = await executeCommand({
      client: {
        sessions: {
          supportSessionRequests: async () => [
            {
              id: "support_request_1",
              status: "pending",
              requestedByUserId: "user_support",
              targetUserId: "user_target",
              ttlMinutes: 15,
              createdAt: "",
            },
          ],
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs(["sessions", "impersonation-requests"]),
      readFile: async () => new Uint8Array(),
    });

    expect(exitCode).toBe(0);
    expect(output.stdout()).toContain("support_request_1");
    expect(output.stdout()).toContain("pending");
  });

  it("creates webhooks from comma-separated events", async () => {
    const output = createOutput();
    let received: unknown;
    const exitCode = await executeCommand({
      client: {
        webhooks: {
          create: async (input: unknown) => {
            received = input;
            return {
              subscription: { id: "webhook_1" },
              signingSecret: "whsec_test",
            };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "webhooks",
        "create",
        "--url",
        "https://hooks.example/romeo",
        "--events",
        "run.completed,run.failed",
      ]),
      readFile: async () => new Uint8Array(),
    });

    expect(exitCode).toBe(0);
    expect(received).toEqual({
      url: "https://hooks.example/romeo",
      eventTypes: ["run.completed", "run.failed"],
    });
    expect(output.stdout()).toContain("whsec_test");
  });

  it("retries due webhooks from CLI flags", async () => {
    const output = createOutput();
    const exitCode = await executeCommand({
      client: {
        webhooks: {
          retryDue: async () => ({
            job: { id: "job_1", status: "completed" },
            deliveries: [],
          }),
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs(["webhooks", "retry-due"]),
      readFile: async () => new Uint8Array(),
    });

    expect(exitCode).toBe(0);
    expect(output.stdout()).toContain("completed");
  });

  it("runs the webhook retry worker for bounded iterations", async () => {
    const output = createOutput();
    let calls = 0;
    const exitCode = await executeCommand({
      client: {
        webhooks: {
          retryDue: async () => {
            calls += 1;
            return {
              job: {
                id: `job_${calls}`,
                type: "webhook.retry_due",
                status: "completed",
              },
              deliveries: calls === 1 ? [{ id: "webhook_delivery_1" }] : [],
            };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "workers",
        "webhook-retry",
        "--max-iterations",
        "2",
        "--interval-ms",
        "0",
      ]),
      readFile: async () => new Uint8Array(),
    });

    expect(exitCode).toBe(0);
    expect(calls).toBe(2);
    expect(output.stdout()).toContain('"iteration": 2');
    expect(output.stdout()).toContain('"retriedDeliveryCount": 1');
  });

  it("updates governance retention from the CLI", async () => {
    const output = createOutput();
    let received: unknown;
    const exitCode = await executeCommand({
      client: {
        governance: {
          updateRetentionPolicy: async (input: unknown) => {
            received = input;
            return { auditLogRetentionDays: 180 };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs(["governance", "retention", "--days", "180"]),
      readFile: async () => new Uint8Array(),
    });

    expect(exitCode).toBe(0);
    expect(received).toEqual({ auditLogRetentionDays: 180 });
    expect(output.stdout()).toContain('"auditLogRetentionDays": 180');
  });

  it("applies billing plan quota templates from the CLI", async () => {
    const output = createOutput();
    let received: unknown;
    const exitCode = await executeCommand({
      client: {
        admin: {
          applyBillingPlan: async (input: unknown) => {
            received = input;
            return { plan: { id: "billing_plan_1", code: "team" }, quotas: [] };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "billing",
        "apply-plan",
        "--code",
        "team",
        "--name",
        "Team",
        "--quota",
        "run.started:1000:monthly,tool.call:5000:daily",
      ]),
      readFile: async () => new Uint8Array(),
    });

    expect(exitCode).toBe(0);
    expect(received).toEqual({
      code: "team",
      name: "Team",
      quotaTemplates: [
        { metric: "run.started", limit: 1000, resetInterval: "monthly" },
        { metric: "tool.call", limit: 5000, resetInterval: "daily" },
      ],
    });
    expect(output.stdout()).toContain('"billing_plan_1"');
  });

  it("syncs external billing lifecycle events from the CLI", async () => {
    const output = createOutput();
    let received: unknown;
    const exitCode = await executeCommand({
      client: {
        admin: {
          syncExternalBillingEvent: async (input: unknown) => {
            received = input;
            return { plan: { id: "billing_plan_1", code: "team" }, quotas: [] };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "billing",
        "sync-external",
        "--provider",
        "stripe",
        "--event",
        "invoice.paid",
        "--external-customer",
        "cus_123",
        "--external-subscription",
        "sub_123",
        "--external-invoice",
        "in_123",
        "--plan-code",
        "team",
        "--plan-name",
        "Team",
        "--quota",
        "run.started:1000:monthly",
        "--amount-cents",
        "2500",
        "--currency",
        "USD",
      ]),
      readFile: async () => new Uint8Array(),
    });

    expect(exitCode).toBe(0);
    expect(received).toEqual({
      provider: "stripe",
      eventType: "invoice.paid",
      externalCustomerId: "cus_123",
      externalSubscriptionId: "sub_123",
      externalInvoiceId: "in_123",
      planCode: "team",
      planName: "Team",
      quotaTemplates: [
        { metric: "run.started", limit: 1000, resetInterval: "monthly" },
      ],
      amountCents: 2500,
      currency: "USD",
    });
    expect(output.stdout()).toContain('"billing_plan_1"');
  });

  it("reads and reconciles billing entitlements from the CLI", async () => {
    const output = createOutput();
    const calls: string[] = [];
    const report = billingEntitlementReport("healthy");
    const result = {
      before: billingEntitlementReport("attention_required"),
      after: report,
      actions: {
        createdQuotaIds: ["quota_new"],
        updatedQuotaIds: [],
        unchangedQuotaIds: ["quota_existing"],
      },
    };
    const client = {
      admin: {
        billingEntitlements: async () => {
          calls.push("report");
          return report;
        },
        reconcileBillingEntitlements: async () => {
          calls.push("reconcile");
          return result;
        },
      },
    } as never;

    const reportExit = await executeCommand({
      client,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs(["billing", "entitlements"]),
      readFile: async () => new Uint8Array(),
    });
    const reconcileExit = await executeCommand({
      client,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs(["billing", "reconcile-entitlements"]),
      readFile: async () => new Uint8Array(),
    });

    expect(reportExit).toBe(0);
    expect(reconcileExit).toBe(0);
    expect(calls).toEqual(["report", "reconcile"]);
    expect(output.stdout()).toContain('"status": "healthy"');
    expect(output.stdout()).toContain('"createdQuotaIds"');
  });

  it("runs billing entitlement reconciliation worker once from CLI flags", async () => {
    const output = createOutput();
    const calls: string[] = [];
    const exitCode = await executeCommand({
      client: {
        admin: {
          reconcileBillingEntitlements: async () => {
            calls.push("reconcile");
            return {
              before: billingEntitlementReport("attention_required"),
              after: billingEntitlementReport("healthy"),
              actions: {
                createdQuotaIds: ["quota_new"],
                updatedQuotaIds: ["quota_updated"],
                unchangedQuotaIds: [],
              },
            };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs(["workers", "billing-entitlement-reconcile", "--once"]),
      readFile: async () => new Uint8Array(),
    });

    expect(exitCode).toBe(0);
    expect(calls).toEqual(["reconcile"]);
    expect(output.stdout()).toContain('"createdQuotaCount": 1');
    expect(output.stdout()).toContain('"updatedQuotaCount": 1');
  });

  it("reads and enforces billing lifecycle from the CLI", async () => {
    const output = createOutput();
    const calls: string[] = [];
    const client = {
      admin: {
        billingLifecycle: async () => {
          calls.push("report");
          return billingLifecycleReport("attention_required");
        },
        enforceBillingLifecycle: async () => {
          calls.push("enforce");
          return billingLifecycleEnforcementResult(true);
        },
      },
    } as never;

    const reportExit = await executeCommand({
      client,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs(["billing", "lifecycle"]),
      readFile: async () => new Uint8Array(),
    });
    const enforceExit = await executeCommand({
      client,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs(["billing", "enforce-lifecycle"]),
      readFile: async () => new Uint8Array(),
    });

    expect(reportExit).toBe(0);
    expect(enforceExit).toBe(0);
    expect(calls).toEqual(["report", "enforce"]);
    expect(output.stdout()).toContain('"recommendedAction": "mark_past_due"');
    expect(output.stdout()).toContain('"statusChanged": true');
  });

  it("runs billing lifecycle enforcement worker once from CLI flags", async () => {
    const output = createOutput();
    const calls: string[] = [];
    const exitCode = await executeCommand({
      client: {
        admin: {
          enforceBillingLifecycle: async () => {
            calls.push("enforce");
            return billingLifecycleEnforcementResult(true);
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs(["workers", "billing-lifecycle-enforce", "--once"]),
      readFile: async () => new Uint8Array(),
    });

    expect(exitCode).toBe(0);
    expect(calls).toEqual(["enforce"]);
    expect(output.stdout()).toContain('"statusChangedCount": 1');
    expect(output.stdout()).toContain('"action": "mark_past_due"');
  });

  it("manages groups from CLI flags", async () => {
    const output = createOutput();
    const calls: unknown[] = [];
    const client = {
      admin: {
        groups: async () => {
          calls.push({ action: "list" });
          return [{ id: "group_admins" }];
        },
        createGroup: async (input: unknown) => {
          calls.push({ action: "create", input });
          return { id: "group_reviewers" };
        },
        groupMembers: async (groupId: string) => {
          calls.push({ action: "members", groupId });
          return [{ groupId, userId: "user_1" }];
        },
        addGroupMember: async (groupId: string, input: unknown) => {
          calls.push({ action: "add", groupId, input });
          return { groupId, userId: "user_1" };
        },
        removeGroupMember: async (groupId: string, userId: string) => {
          calls.push({ action: "remove", groupId, userId });
          return { groupId, userId };
        },
      },
    } as never;

    await executeCommand({
      client,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs(["groups", "list"]),
      readFile: async () => new Uint8Array(),
    });
    await executeCommand({
      client,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "groups",
        "create",
        "--name",
        "Reviewers",
        "--slug",
        "reviewers",
      ]),
      readFile: async () => new Uint8Array(),
    });
    await executeCommand({
      client,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs(["groups", "members", "--group", "group_reviewers"]),
      readFile: async () => new Uint8Array(),
    });
    await executeCommand({
      client,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "groups",
        "add-member",
        "--group",
        "group_reviewers",
        "--user",
        "user_1",
      ]),
      readFile: async () => new Uint8Array(),
    });
    await executeCommand({
      client,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "groups",
        "remove-member",
        "--group",
        "group_reviewers",
        "--user",
        "user_1",
      ]),
      readFile: async () => new Uint8Array(),
    });

    expect(calls).toEqual([
      { action: "list" },
      { action: "create", input: { name: "Reviewers", slug: "reviewers" } },
      { action: "members", groupId: "group_reviewers" },
      {
        action: "add",
        groupId: "group_reviewers",
        input: { userId: "user_1" },
      },
      { action: "remove", groupId: "group_reviewers", userId: "user_1" },
    ]);
    expect(output.stdout()).toContain("group_reviewers");
  });

  it("manages users from CLI flags", async () => {
    const output = createOutput();
    const calls: unknown[] = [];
    const client = {
      admin: {
        users: async () => {
          calls.push({ action: "list" });
          return [{ id: "user_1", email: "user@example.com" }];
        },
        disableUser: async (userId: string) => {
          calls.push({ action: "disable", userId });
          return { id: userId, disabledAt: "2026-06-27T00:00:00.000Z" };
        },
      },
    } as never;

    const listExit = await executeCommand({
      client,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs(["users", "list"]),
      readFile: async () => new Uint8Array(),
    });
    const disableExit = await executeCommand({
      client,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs(["users", "disable", "--user", "user_1"]),
      readFile: async () => new Uint8Array(),
    });

    expect(listExit).toBe(0);
    expect(disableExit).toBe(0);
    expect(calls).toEqual([
      { action: "list" },
      { action: "disable", userId: "user_1" },
    ]);
    expect(output.stdout()).toContain("user_1");
    expect(output.stdout()).toContain("disabledAt");
  });

  it("enforces governance retention from the CLI", async () => {
    const output = createOutput();
    const exitCode = await executeCommand({
      client: {
        governance: {
          enforceRetention: async () => ({
            deletedAuditLogCount: 2,
            cutoffAt: "2026-01-01T00:00:00.000Z",
          }),
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs(["governance", "retention-enforce"]),
      readFile: async () => new Uint8Array(),
    });

    expect(exitCode).toBe(0);
    expect(output.stdout()).toContain('"deletedAuditLogCount": 2');
  });

  it("previews and executes governed data deletion from the CLI", async () => {
    const output = createOutput();
    const calls: unknown[] = [];
    const previewExit = await executeCommand({
      client: {
        governance: {
          previewDataDeletion: async (input: unknown) => {
            calls.push({ action: "preview", input });
            return {
              schema: "romeo.data-deletion-preview.v1",
              counts: { chats: 1 },
            };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "governance",
        "data-delete-preview",
        "--chat",
        "chat_1",
      ]),
      readFile: async () => new Uint8Array(),
    });
    const executeExit = await executeCommand({
      client: {
        governance: {
          executeDataDeletion: async (input: unknown) => {
            calls.push({ action: "execute", input });
            return {
              schema: "romeo.data-deletion-result.v1",
              counts: { chats: 1 },
            };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "governance",
        "data-delete",
        "--chat",
        "chat_1",
        "--confirm",
        "chat_1",
      ]),
      readFile: async () => new Uint8Array(),
    });

    expect(previewExit).toBe(0);
    expect(executeExit).toBe(0);
    expect(calls).toEqual([
      {
        action: "preview",
        input: { resourceType: "chat", resourceId: "chat_1" },
      },
      {
        action: "execute",
        input: {
          resourceType: "chat",
          resourceId: "chat_1",
          confirmResourceId: "chat_1",
        },
      },
    ]);
    expect(output.stdout()).toContain("romeo.data-deletion-preview.v1");
    expect(output.stdout()).toContain("romeo.data-deletion-result.v1");
  });

  it("archives chats and updates legal holds from the CLI", async () => {
    const output = createOutput();
    const calls: unknown[] = [];
    const client = {
      chatApi: {
        archive: async (chatId: string) => {
          calls.push({ action: "archive", chatId });
          return { id: chatId, archivedAt: "2026-06-27T00:00:00.000Z" };
        },
        updateLegalHold: async (chatId: string, input: unknown) => {
          calls.push({ action: "legalHold", chatId, input });
          return { id: chatId, ...(input as object) };
        },
      },
    } as never;

    const archiveExit = await executeCommand({
      client,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs(["chat", "archive", "--chat", "chat_1"]),
      readFile: async () => new Uint8Array(),
    });
    const holdExit = await executeCommand({
      client,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "chat",
        "legal-hold",
        "--chat",
        "chat_1",
        "--until",
        "2026-07-27T00:00:00.000Z",
        "--reason",
        "Matter 42",
      ]),
      readFile: async () => new Uint8Array(),
    });
    const clearExit = await executeCommand({
      client,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs(["chat", "legal-hold-clear", "--chat", "chat_1"]),
      readFile: async () => new Uint8Array(),
    });

    expect(archiveExit).toBe(0);
    expect(holdExit).toBe(0);
    expect(clearExit).toBe(0);
    expect(calls).toEqual([
      { action: "archive", chatId: "chat_1" },
      {
        action: "legalHold",
        chatId: "chat_1",
        input: {
          legalHoldUntil: "2026-07-27T00:00:00.000Z",
          legalHoldReason: "Matter 42",
        },
      },
      {
        action: "legalHold",
        chatId: "chat_1",
        input: { legalHoldUntil: null },
      },
    ]);
    expect(output.stdout()).toContain("archivedAt");
  });

  it("archives and exports workspaces from the CLI", async () => {
    const output = createOutput();
    const calls: unknown[] = [];
    const client = {
      system: {
        archiveWorkspace: async (workspaceId: string) => {
          calls.push({ action: "archive", workspaceId });
          return { id: workspaceId, archivedAt: "2026-06-27T00:00:00.000Z" };
        },
        exportWorkspace: async (workspaceId: string) => {
          calls.push({ action: "export", workspaceId });
          return {
            schema: "romeo.workspace-export.v1",
            workspace: { id: workspaceId },
            counts: { chats: 1 },
          };
        },
      },
    } as never;

    const archiveExit = await executeCommand({
      client,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "workspaces",
        "archive",
        "--workspace",
        "workspace_1",
      ]),
      readFile: async () => new Uint8Array(),
    });
    const exportExit = await executeCommand({
      client,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs(["workspaces", "export", "--workspace", "workspace_1"]),
      readFile: async () => new Uint8Array(),
    });

    expect(archiveExit).toBe(0);
    expect(exportExit).toBe(0);
    expect(calls).toEqual([
      { action: "archive", workspaceId: "workspace_1" },
      { action: "export", workspaceId: "workspace_1" },
    ]);
    expect(output.stdout()).toContain("romeo.workspace-export.v1");
  });

  it("exports governance compliance reports from the CLI", async () => {
    const output = createOutput();
    const jsonExit = await executeCommand({
      client: {
        governance: {
          complianceReport: async () => ({
            schema: "romeo.compliance-report.v1",
            controls: [{ id: "retention_policy" }],
          }),
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs(["governance", "compliance-report"]),
      readFile: async () => new Uint8Array(),
    });
    const csvExit = await executeCommand({
      client: {
        governance: {
          complianceReportCsv: async () =>
            "control_id,status\nretention_policy,pass\n",
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs(["governance", "compliance-report-export"]),
      readFile: async () => new Uint8Array(),
    });

    expect(jsonExit).toBe(0);
    expect(csvExit).toBe(0);
    expect(output.stdout()).toContain('"romeo.compliance-report.v1"');
    expect(output.stdout()).toContain("control_id,status");
  });

  it("exports access review CSV from the CLI", async () => {
    const output = createOutput();
    const exitCode = await executeCommand({
      client: {
        governance: {
          accessReviewCsv: async () =>
            "resource_type,resource_id\nagent,agent_default\n",
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs(["access-review", "export"]),
      readFile: async () => new Uint8Array(),
    });

    expect(exitCode).toBe(0);
    expect(output.stdout()).toBe(
      "resource_type,resource_id\nagent,agent_default\n",
    );
  });

  it("creates eval suites from CLI flags", async () => {
    const output = createOutput();
    let received: unknown;
    const exitCode = await executeCommand({
      client: {
        evals: {
          createSuite: async (input: unknown) => {
            received = input;
            return { suite: { id: "eval_suite_1" }, cases: [] };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "evals",
        "create",
        "--agent",
        "agent_1",
        "--prompt",
        "Hello",
        "--expected",
        "Romeo",
      ]),
      readFile: async () => new Uint8Array(),
    });

    expect(exitCode).toBe(0);
    expect(received).toEqual({
      agentId: "agent_1",
      name: "Golden prompt",
      cases: [{ input: "Hello", expectedContains: "Romeo" }],
    });
    expect(output.stdout()).toContain("eval_suite_1");
  });

  it("creates eval suites with rubric flags", async () => {
    const output = createOutput();
    let received: unknown;
    const exitCode = await executeCommand({
      client: {
        evals: {
          createSuite: async (input: unknown) => {
            received = input;
            return { suite: { id: "eval_suite_1" }, cases: [] };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "evals",
        "create",
        "--agent",
        "agent_1",
        "--prompt",
        "Hello",
        "--expected",
        "Romeo",
        "--must-contain",
        "safe,grounded",
        "--must-not-contain",
        "forbidden",
        "--expected-tool",
        "search,calculator",
        "--required-citation",
        "chunk_access,chunk_policy",
        "--min-length",
        "0",
        "--max-length",
        "500",
      ]),
      readFile: async () => new Uint8Array(),
    });

    expect(exitCode).toBe(0);
    expect(received).toEqual({
      agentId: "agent_1",
      name: "Golden prompt",
      cases: [
        {
          input: "Hello",
          expectedContains: "Romeo",
          rubric: {
            mustContain: ["safe", "grounded"],
            mustNotContain: ["forbidden"],
            expectedToolCalls: [{ name: "search" }, { name: "calculator" }],
            requiredCitations: ["chunk_access", "chunk_policy"],
            minLength: 0,
            maxLength: 500,
          },
        },
      ],
    });
    expect(output.stdout()).toContain("eval_suite_1");
  });

  it("rejects inverted eval rubric length flags", async () => {
    const output = createOutput();
    await expect(
      executeCommand({
        client: {
          evals: {
            createSuite: async () => ({
              suite: { id: "eval_suite_1" },
              cases: [],
            }),
          },
        } as never,
        fetchImpl: fetch,
        io: output.io,
        parsed: parseArgs([
          "evals",
          "create",
          "--agent",
          "agent_1",
          "--prompt",
          "Hello",
          "--expected",
          "Romeo",
          "--min-length",
          "50",
          "--max-length",
          "10",
        ]),
        readFile: async () => new Uint8Array(),
      }),
    ).rejects.toThrow(
      "--min-length must be less than or equal to --max-length.",
    );
  });

  it("compares eval suites across models from CLI flags", async () => {
    const output = createOutput();
    const calls: unknown[] = [];
    const exitCode = await executeCommand({
      client: {
        evals: {
          compareModels: async (suiteId: string, input: unknown) => {
            calls.push({ suiteId, input });
            return {
              suiteId,
              comparedAt: "2026-01-01T00:00:00.000Z",
              comparisons: [],
            };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "evals",
        "compare-models",
        "--suite",
        "eval_suite_1",
        "--models",
        "model_1,model_2",
      ]),
      readFile: async () => new Uint8Array(),
    });

    expect(exitCode).toBe(0);
    expect(calls).toEqual([
      { suiteId: "eval_suite_1", input: { modelIds: ["model_1", "model_2"] } },
    ]);
    expect(output.stdout()).toContain("eval_suite_1");
  });

  it("reads eval dashboards from CLI flags", async () => {
    const output = createOutput();
    const calls: unknown[] = [];
    const exitCode = await executeCommand({
      client: {
        evals: {
          dashboard: async (agentId: string) => {
            calls.push(agentId);
            return {
              agentId,
              generatedAt: "2026-01-01T00:00:00.000Z",
              status: "passed",
              suiteCount: 1,
              runCount: 1,
              averageLatestScore: 1,
              suites: [],
              trend: [],
            };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs(["evals", "dashboard", "--agent", "agent_1"]),
      readFile: async () => new Uint8Array(),
    });

    expect(exitCode).toBe(0);
    expect(calls).toEqual(["agent_1"]);
    expect(output.stdout()).toContain("agent_1");
  });

  it("lists and writes eval human ratings from CLI flags", async () => {
    const output = createOutput();
    const calls: unknown[] = [];
    const listExit = await executeCommand({
      client: {
        evals: {
          ratings: async (runId: string) => {
            calls.push({ ratings: runId });
            return [{ id: "eval_rating_1", rating: "pass" }];
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs(["evals", "ratings", "--run", "eval_run_1"]),
      readFile: async () => new Uint8Array(),
    });
    const rateExit = await executeCommand({
      client: {
        evals: {
          rateResult: async (resultId: string, input: unknown) => {
            calls.push({ rateResult: resultId, input });
            return { id: "eval_rating_1", rating: "pass" };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "evals",
        "rate",
        "--result",
        "eval_result_1",
        "--rating",
        "pass",
        "--comment",
        "Approved",
      ]),
      readFile: async () => new Uint8Array(),
    });

    expect(listExit).toBe(0);
    expect(rateExit).toBe(0);
    expect(calls).toEqual([
      { ratings: "eval_run_1" },
      {
        rateResult: "eval_result_1",
        input: { rating: "pass", comment: "Approved" },
      },
    ]);
  });

  it("creates device authorizations from CLI flags", async () => {
    const output = createOutput();
    let received: unknown;
    const exitCode = await executeCommand({
      client: {
        deviceAuthorizations: {
          create: async (input: unknown) => {
            received = input;
            return {
              authorization: { id: "device_auth_1" },
              accessToken: "rmk_test",
              refreshToken: "rmr_test",
            };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "devices",
        "create",
        "--name",
        "MacBook",
        "--scopes",
        "me:read,chats:read",
        "--ttl-days",
        "30",
      ]),
      readFile: async () => new Uint8Array(),
    });

    expect(exitCode).toBe(0);
    expect(received).toEqual({
      name: "MacBook",
      scopes: ["me:read", "chats:read"],
      ttlDays: 30,
    });
    expect(output.stdout()).toContain("device_auth_1");
  });

  it("refreshes and revokes device authorizations from CLI flags", async () => {
    const output = createOutput();
    const calls: unknown[] = [];
    const exitCodeRefresh = await executeCommand({
      client: {
        deviceAuthorizations: {
          refresh: async (refreshToken: string) => {
            calls.push({ refreshToken });
            return {
              authorization: { id: "device_auth_1" },
              accessToken: "rmk_next",
              refreshToken: "rmr_next",
            };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs(["devices", "refresh", "--refresh-token", "rmr_old"]),
      readFile: async () => new Uint8Array(),
    });
    const exitCodeRevoke = await executeCommand({
      client: {
        deviceAuthorizations: {
          revoke: async (deviceAuthorizationId: string) => {
            calls.push({ deviceAuthorizationId });
            return {
              id: deviceAuthorizationId,
              revokedAt: "2026-06-27T00:00:00.000Z",
            };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs(["devices", "revoke", "--device", "device_auth_1"]),
      readFile: async () => new Uint8Array(),
    });

    expect(exitCodeRefresh).toBe(0);
    expect(exitCodeRevoke).toBe(0);
    expect(calls).toEqual([
      { refreshToken: "rmr_old" },
      { deviceAuthorizationId: "device_auth_1" },
    ]);
  });

  it("runs retention enforcement worker once from CLI flags", async () => {
    const output = createOutput();
    const calls: unknown[] = [];
    const exitCode = await executeCommand({
      client: {
        governance: {
          enforceRetention: async () => {
            calls.push({ enforceRetention: true });
            return {
              orgId: "org_default",
              auditLogRetentionDays: 365,
              cutoffAt: "2025-06-27T00:00:00.000Z",
              deletedAuditLogCount: 2,
              enforcedAt: "2026-06-27T00:00:00.000Z",
            };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs(["workers", "retention-enforce", "--once"]),
      readFile: async () => new Uint8Array(),
    });

    expect(exitCode).toBe(0);
    expect(calls).toEqual([{ enforceRetention: true }]);
    expect(output.stdout()).toContain('"deletedAuditLogCount": 2');
  });

  it("creates, templates, runs, and approves workflows from CLI flags", async () => {
    const output = createOutput();
    const calls: unknown[] = [];
    const templatesExit = await executeCommand({
      client: {
        workflows: {
          templates: async () => [{ id: "agent_review_approval" }],
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs(["workflows", "templates"]),
      readFile: async () => new Uint8Array(),
    });
    const createTemplateExit = await executeCommand({
      client: {
        workflows: {
          createFromTemplate: async (templateId: string, input: unknown) => {
            calls.push({ createFromTemplate: templateId, input });
            return { id: "workflow_template_1" };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "workflows",
        "create-template",
        "--template",
        "agent_review_approval",
        "--workspace",
        "workspace_1",
        "--agent",
        "agent_1",
        "--schedule-interval-minutes",
        "15",
        "--name",
        "Templated review flow",
      ]),
      readFile: async () => new Uint8Array(),
    });
    const createExit = await executeCommand({
      client: {
        workflows: {
          create: async (input: unknown) => {
            calls.push({ create: input });
            return { id: "workflow_1" };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "workflows",
        "create",
        "--workspace",
        "workspace_1",
        "--name",
        "Review flow",
        "--agent",
        "agent_1",
        "--handoff-agent",
        "agent_2",
        "--handoff-prompt",
        "Review the draft.",
        "--retry-attempts",
        "2",
        "--on-failure",
        "continue",
        "--room-agents",
        "agent_1,agent_2",
        "--room-prompt",
        "Discuss the draft.",
        "--tool-approval",
        "ticket_update",
        "--tool-risk",
        "high",
        "--tool-input-keys",
        "ticketId,status",
        "--browser-url",
        "https://example.com/releases",
        "--browser-task",
        "Inspect the page.",
        "--approval",
        "Approve it",
      ]),
      readFile: async () => new Uint8Array(),
    });
    const runDueExit = await executeCommand({
      client: {
        workflows: {
          runDueSchedules: async () => {
            calls.push({ runDueSchedules: true });
            return { dueWorkflowCount: 1, startedRuns: [] };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs(["workflows", "run-due-schedules"]),
      readFile: async () => new Uint8Array(),
    });
    const runExit = await executeCommand({
      client: {
        workflows: {
          startRun: async (workflowId: string) => {
            calls.push({ startRun: workflowId });
            return { id: "workflow_run_1", status: "waiting_approval" };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs(["workflows", "run", "--workflow", "workflow_1"]),
      readFile: async () => new Uint8Array(),
    });
    const resumeExit = await executeCommand({
      client: {
        workflows: {
          resumeRun: async (workflowRunId: string) => {
            calls.push({ resumeRun: workflowRunId });
            return { id: "workflow_run_1", status: "waiting_approval" };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs(["workflows", "resume", "--run", "workflow_run_1"]),
      readFile: async () => new Uint8Array(),
    });
    const approveExit = await executeCommand({
      client: {
        workflows: {
          approveRun: async (workflowRunId: string, input: unknown) => {
            calls.push({ approveRun: workflowRunId, input });
            return { id: "workflow_run_1", status: "completed" };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "workflows",
        "approve",
        "--run",
        "workflow_run_1",
        "--comment",
        "Approved",
      ]),
      readFile: async () => new Uint8Array(),
    });

    expect(templatesExit).toBe(0);
    expect(createTemplateExit).toBe(0);
    expect(createExit).toBe(0);
    expect(runDueExit).toBe(0);
    expect(runExit).toBe(0);
    expect(approveExit).toBe(0);
    expect(resumeExit).toBe(0);
    expect(calls).toEqual([
      {
        createFromTemplate: "agent_review_approval",
        input: {
          workspaceId: "workspace_1",
          agentId: "agent_1",
          name: "Templated review flow",
          schedule: { intervalMinutes: 15 },
        },
      },
      {
        create: {
          workspaceId: "workspace_1",
          name: "Review flow",
          steps: [
            {
              type: "agent_run",
              name: "Agent run",
              agentId: "agent_1",
              retryPolicy: { maxAttempts: 2 },
              recoveryPolicy: { onFailure: "continue" },
            },
            {
              type: "agent_handoff",
              name: "Agent handoff",
              agentId: "agent_2",
              handoffPrompt: "Review the draft.",
              retryPolicy: { maxAttempts: 2 },
              recoveryPolicy: { onFailure: "continue" },
            },
            {
              type: "agent_room",
              name: "Agent room",
              agentIds: ["agent_1", "agent_2"],
              roomPrompt: "Discuss the draft.",
              recoveryPolicy: { onFailure: "continue" },
            },
            {
              type: "tool_approval",
              name: "Tool approval",
              toolChainName: "ticket_update",
              riskLevel: "high",
              inputKeys: ["ticketId", "status"],
            },
            {
              type: "browser_task",
              name: "Browser task",
              targetUrl: "https://example.com/releases",
              task: "Inspect the page.",
            },
            {
              type: "approval",
              name: "Approval",
              approvalPrompt: "Approve it",
            },
          ],
        },
      },
      { runDueSchedules: true },
      { startRun: "workflow_1" },
      { resumeRun: "workflow_run_1" },
      { approveRun: "workflow_run_1", input: { comment: "Approved" } },
    ]);
  });

  it("manages browser automation tasks from CLI flags", async () => {
    const output = createOutput();
    const calls: unknown[] = [];
    const uploads: Array<{ url: string; init?: RequestInit }> = [];
    const claimExit = await executeCommand({
      client: {
        workflows: {
          claimBrowserTask: async (input: unknown) => {
            calls.push({ claimBrowserTask: input });
            return { claimed: false, workerQueue: "browser_automation" };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "workflows",
        "browser-task-claim",
        "--lease-seconds",
        "120",
      ]),
      readFile: async () => new Uint8Array(),
    });
    const renewExit = await executeCommand({
      client: {
        workflows: {
          renewBrowserTaskLease: async (input: unknown) => {
            calls.push({ renewBrowserTaskLease: input });
            return { claimed: true, workerQueue: "browser_automation" };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "workflows",
        "browser-task-renew",
        "--job",
        "job_browser",
        "--lease-seconds",
        "180",
      ]),
      readFile: async () => new Uint8Array(),
    });
    const uploadExit = await executeCommand({
      client: {
        workflows: {
          createBrowserTaskArtifactUpload: async (input: unknown) => {
            calls.push({ createBrowserTaskArtifactUpload: input });
            return {
              artifact: {
                artifactId: "browser_artifact_1",
                artifactUrl:
                  "/api/v1/browser-automation-artifacts/browser_artifact_1",
                type: "screenshot",
                contentType: "image/png",
                sizeBytes: 4,
              },
              upload: {
                key: "browser-automation/org/job/browser_artifact_1.png",
                url: "https://upload.example/browser_artifact_1",
                method: "PUT",
                expiresAt: "2026-01-01T00:15:00.000Z",
                headers: { "content-type": "image/png" },
              },
            };
          },
        },
      } as never,
      fetchImpl: async (input, init) => {
        const upload: { url: string; init?: RequestInit } = {
          url: String(input),
        };
        if (init !== undefined) upload.init = init;
        uploads.push(upload);
        return new Response(null, { status: 200 });
      },
      io: output.io,
      parsed: parseArgs([
        "workflows",
        "browser-artifact-upload",
        "--job",
        "job_browser",
        "--file",
        "screenshot.png",
        "--type",
        "screenshot",
        "--content-type",
        "image/png",
      ]),
      readFile: async () => new Uint8Array([1, 2, 3, 4]),
    });
    const expireExit = await executeCommand({
      client: {
        workflows: {
          expireBrowserTasks: async (input: unknown) => {
            calls.push({ expireBrowserTasks: input });
            return { expired: 0, jobs: [], workerQueue: "browser_automation" };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "workflows",
        "browser-tasks-expire",
        "--queued-timeout-seconds",
        "86400",
        "--running-timeout-seconds",
        "3600",
        "--limit",
        "10",
      ]),
      readFile: async () => new Uint8Array(),
    });
    const completeExit = await executeCommand({
      client: {
        workflows: {
          completeBrowserTask: async (input: unknown) => {
            calls.push({ completeBrowserTask: input });
            return { outcome: "completed", workerQueue: "browser_automation" };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "workflows",
        "browser-task-complete",
        "--job",
        "job_browser",
        "--final-url",
        "https://example.com/releases",
        "--artifact-count",
        "1",
        "--duration-ms",
        "1500",
        "--navigation-count",
        "2",
        "--network-denied-count",
        "1",
        "--captured-bytes",
        "4096",
        "--output-keys",
        "releaseStatus",
        "--redaction-applied",
        "true",
      ]),
      readFile: async () => new Uint8Array(),
    });
    const failExit = await executeCommand({
      client: {
        workflows: {
          failBrowserTask: async (input: unknown) => {
            calls.push({ failBrowserTask: input });
            return { outcome: "failed", workerQueue: "browser_automation" };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "workflows",
        "browser-task-fail",
        "--job",
        "job_browser",
        "--error-code",
        "browser_failed",
      ]),
      readFile: async () => new Uint8Array(),
    });

    expect(claimExit).toBe(0);
    expect(renewExit).toBe(0);
    expect(uploadExit).toBe(0);
    expect(expireExit).toBe(0);
    expect(completeExit).toBe(0);
    expect(failExit).toBe(0);
    expect(uploads[0]?.url).toBe("https://upload.example/browser_artifact_1");
    expect(uploads[0]?.init?.method).toBe("PUT");
    expect(uploads[0]?.init?.headers).toEqual({ "content-type": "image/png" });
    expect(output.stdout()).toContain("browser_artifact_1");
    expect(output.stdout()).not.toContain("browser-automation/org/job");
    expect(calls).toEqual([
      { claimBrowserTask: { leaseSeconds: 120 } },
      {
        renewBrowserTaskLease: {
          jobId: "job_browser",
          leaseSeconds: 180,
        },
      },
      {
        createBrowserTaskArtifactUpload: {
          jobId: "job_browser",
          type: "screenshot",
          contentType: "image/png",
          sizeBytes: 4,
        },
      },
      {
        expireBrowserTasks: {
          queuedTimeoutSeconds: 86400,
          runningTimeoutSeconds: 3600,
          limit: 10,
        },
      },
      {
        completeBrowserTask: {
          jobId: "job_browser",
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
      },
      {
        failBrowserTask: {
          jobId: "job_browser",
          errorCode: "browser_failed",
        },
      },
    ]);
  });

  it("shares agents from CLI flags", async () => {
    const output = createOutput();
    let received: unknown;
    const exitCode = await executeCommand({
      client: {
        collaboration: {
          shareAgent: async (agentId: string, input: unknown) => {
            received = { agentId, input };
            return [{ id: "grant_1", permission: "run" }];
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "share",
        "agent",
        "--agent",
        "agent_1",
        "--group",
        "group_reviewers",
      ]),
      readFile: async () => new Uint8Array(),
    });

    expect(exitCode).toBe(0);
    expect(received).toEqual({
      agentId: "agent_1",
      input: {
        principalType: "group",
        principalId: "group_reviewers",
        permissions: ["read", "run"],
      },
    });
    expect(output.stdout()).toContain("grant_1");
  });

  it("searches share targets from CLI flags", async () => {
    const output = createOutput();
    let received: unknown;
    const exitCode = await executeCommand({
      client: {
        collaboration: {
          shareTargets: async (
            query: string | undefined,
            limit: number | undefined,
          ) => {
            received = { query, limit };
            return [
              {
                principalType: "user",
                principalId: "user_alice",
                label: "Alice Reviewer",
              },
            ];
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "share",
        "targets",
        "--query",
        "alice",
        "--limit",
        "5",
      ]),
      readFile: async () => new Uint8Array(),
    });

    expect(exitCode).toBe(0);
    expect(received).toEqual({ query: "alice", limit: 5 });
    expect(output.stdout()).toContain("user_alice");
  });

  it("manages prompt templates from CLI flags", async () => {
    const output = createOutput();
    const calls: unknown[] = [];
    const client = {
      collaboration: {
        promptTemplates: async (workspaceId: string, query?: string) => {
          calls.push({ action: "list", workspaceId, query });
          return [{ id: "prompt_1" }];
        },
        promptMarketplace: async (workspaceId: string, query?: string) => {
          calls.push({ action: "marketplace", workspaceId, query });
          return [{ id: "prompt_2" }];
        },
        createPromptTemplate: async (input: unknown) => {
          calls.push({ action: "create", input });
          return { id: "prompt_3" };
        },
        updatePromptTemplate: async (id: string, input: unknown) => {
          calls.push({ action: "update", id, input });
          return { id };
        },
        sharePromptTemplate: async (id: string, input: unknown) => {
          calls.push({ action: "share", id, input });
          return [{ id: "grant_1" }];
        },
      },
    } as never;

    await executeCommand({
      client,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "prompts",
        "list",
        "--workspace",
        "workspace_1",
        "--query",
        "ops",
      ]),
      readFile: async () => new Uint8Array(),
    });
    await executeCommand({
      client,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "prompts",
        "marketplace",
        "--workspace",
        "workspace_1",
      ]),
      readFile: async () => new Uint8Array(),
    });
    await executeCommand({
      client,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "prompts",
        "create",
        "--workspace",
        "workspace_1",
        "--name",
        "Responder",
        "--body",
        "Summarize.",
        "--tags",
        "ops,incident",
        "--visibility",
        "marketplace",
      ]),
      readFile: async () => new Uint8Array(),
    });
    await executeCommand({
      client,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "prompts",
        "update",
        "--prompt",
        "prompt_3",
        "--visibility",
        "workspace",
      ]),
      readFile: async () => new Uint8Array(),
    });
    await executeCommand({
      client,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "share",
        "prompt",
        "--prompt",
        "prompt_3",
        "--group",
        "group_reviewers",
      ]),
      readFile: async () => new Uint8Array(),
    });

    expect(calls).toEqual([
      { action: "list", workspaceId: "workspace_1", query: "ops" },
      { action: "marketplace", workspaceId: "workspace_1", query: undefined },
      {
        action: "create",
        input: {
          workspaceId: "workspace_1",
          name: "Responder",
          body: "Summarize.",
          tags: ["ops", "incident"],
          visibility: "marketplace",
        },
      },
      { action: "update", id: "prompt_3", input: { visibility: "workspace" } },
      {
        action: "share",
        id: "prompt_3",
        input: {
          principalType: "group",
          principalId: "group_reviewers",
          permissions: ["read", "use"],
        },
      },
    ]);
    expect(output.stdout()).toContain("prompt_3");
  });

  it("shares chats from CLI flags", async () => {
    const output = createOutput();
    let received: unknown;
    const exitCode = await executeCommand({
      client: {
        collaboration: {
          shareChat: async (chatId: string, input: unknown) => {
            received = { chatId, input };
            return [{ id: "grant_1", permission: "write" }];
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "share",
        "chat",
        "--chat",
        "chat_1",
        "--group",
        "group_reviewers",
      ]),
      readFile: async () => new Uint8Array(),
    });

    expect(exitCode).toBe(0);
    expect(received).toEqual({
      chatId: "chat_1",
      input: {
        principalType: "group",
        principalId: "group_reviewers",
        permissions: ["read", "write"],
      },
    });
    expect(output.stdout()).toContain("grant_1");
  });

  it("creates folders and adds folder items from CLI flags", async () => {
    const output = createOutput();
    const calls: unknown[] = [];
    const client = {
      collaboration: {
        createFolder: async (input: unknown) => {
          calls.push({ createFolder: input });
          return { id: "folder_1" };
        },
        addFolderItem: async (folderId: string, input: unknown) => {
          calls.push({ addFolderItem: folderId, input });
          return { id: "folder_item_1" };
        },
      },
    } as never;

    const createExit = await executeCommand({
      client,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "folders",
        "create",
        "--workspace",
        "workspace_1",
        "--name",
        "Review pack",
      ]),
      readFile: async () => new Uint8Array(),
    });
    const addExit = await executeCommand({
      client,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "folders",
        "add-item",
        "--folder",
        "folder_1",
        "--type",
        "chat",
        "--resource",
        "chat_1",
      ]),
      readFile: async () => new Uint8Array(),
    });

    expect(createExit).toBe(0);
    expect(addExit).toBe(0);
    expect(calls).toEqual([
      { createFolder: { workspaceId: "workspace_1", name: "Review pack" } },
      {
        addFolderItem: "folder_1",
        input: { resourceType: "chat", resourceId: "chat_1" },
      },
    ]);
    expect(output.stdout()).toContain("folder_item_1");
  });

  it("creates chat comments from CLI flags", async () => {
    const output = createOutput();
    let received: unknown;
    const exitCode = await executeCommand({
      client: {
        chatApi: {
          comment: async (chatId: string, input: unknown) => {
            received = { chatId, input };
            return { id: "chat_comment_1", body: "Review @user_dev_admin" };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "comments",
        "create",
        "--chat",
        "chat_1",
        "--body",
        "Review @user_dev_admin",
      ]),
      readFile: async () => new Uint8Array(),
    });

    expect(exitCode).toBe(0);
    expect(received).toEqual({
      chatId: "chat_1",
      input: { body: "Review @user_dev_admin" },
    });
    expect(output.stdout()).toContain("chat_comment_1");
  });

  it("marks notifications read from CLI flags", async () => {
    const output = createOutput();
    let received: unknown;
    const exitCode = await executeCommand({
      client: {
        notifications: {
          markRead: async (notificationId: string) => {
            received = notificationId;
            return { id: notificationId, readAt: "2026-06-27T00:00:00.000Z" };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "notifications",
        "read",
        "--notification",
        "notification_1",
      ]),
      readFile: async () => new Uint8Array(),
    });

    expect(exitCode).toBe(0);
    expect(received).toBe("notification_1");
    expect(output.stdout()).toContain("readAt");
  });

  it("lists and syncs voices from CLI flags", async () => {
    const output = createOutput();
    const calls: string[] = [];
    const client = {
      voice: {
        list: async () => {
          calls.push("list");
          return [{ id: "voice_default" }];
        },
        sync: async () => {
          calls.push("sync");
          return {
            imported: 1,
            existing: 0,
            providerVoiceCount: 1,
            profiles: [{ id: "voice_synced" }],
          };
        },
      },
    } as never;

    await executeCommand({
      client,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs(["voices", "list"]),
      readFile: async () => new Uint8Array(),
    });
    await executeCommand({
      client,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs(["voices", "sync"]),
      readFile: async () => new Uint8Array(),
    });

    expect(calls).toEqual(["list", "sync"]);
    expect(output.stdout()).toContain("voice_synced");
  });

  it("runs the voice catalog sync worker once from CLI flags", async () => {
    const output = createOutput();
    const calls: string[] = [];
    const exitCode = await executeCommand({
      client: {
        voice: {
          sync: async () => {
            calls.push("sync");
            return {
              imported: 1,
              existing: 2,
              providerVoiceCount: 3,
              profiles: [{ id: "voice_synced" }],
            };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs(["workers", "voice-catalog-sync", "--once"]),
      readFile: async () => new Uint8Array(),
    });

    expect(exitCode).toBe(0);
    expect(calls).toEqual(["sync"]);
    expect(output.stdout()).toContain('"providerVoiceCount": 3');
    expect(output.stdout()).toContain("voice_synced");
  });

  it("creates notification channels and lists delivery records from CLI flags", async () => {
    const output = createOutput();
    const calls: unknown[] = [];
    const createExit = await executeCommand({
      client: {
        notifications: {
          createChannel: async (input: unknown) => {
            calls.push({ createChannel: input });
            return { id: "notification_channel_1", type: "webhook" };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "notifications",
        "channel-create",
        "--url",
        "https://hooks.example.com/romeo",
        "--name",
        "Mentions",
        "--enabled-notification-types",
        "chat_mention",
      ]),
      readFile: async () => new Uint8Array(),
    });
    const createEmailExit = await executeCommand({
      client: {
        notifications: {
          createChannel: async (input: unknown) => {
            calls.push({ createChannel: input });
            return { id: "notification_channel_2", type: "email" };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "notifications",
        "channel-create",
        "--type",
        "email",
        "--to",
        "target@example.com",
        "--name",
        "Email",
      ]),
      readFile: async () => new Uint8Array(),
    });
    const createSlackExit = await executeCommand({
      client: {
        notifications: {
          createChannel: async (input: unknown) => {
            calls.push({ createChannel: input });
            return { id: "notification_channel_3", type: "slack" };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "notifications",
        "channel-create",
        "--type",
        "slack",
        "--url",
        "https://hooks.slack.com/services/T/B/C",
        "--name",
        "Slack",
      ]),
      readFile: async () => new Uint8Array(),
    });
    const createMobilePushExit = await executeCommand({
      client: {
        notifications: {
          createChannel: async (input: unknown) => {
            calls.push({ createChannel: input });
            return { id: "notification_channel_4", type: "mobile_push" };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "notifications",
        "channel-create",
        "--type",
        "mobile_push",
        "--token-ref",
        "romeo-secret://secret_device_token",
        "--platform",
        "android",
        "--collapse-key",
        "mention",
        "--name",
        "Mobile",
      ]),
      readFile: async () => new Uint8Array(),
    });
    const createTeamsExit = await executeCommand({
      client: {
        notifications: {
          createChannel: async (input: unknown) => {
            calls.push({ createChannel: input });
            return { id: "notification_channel_5", type: "teams" };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "notifications",
        "channel-create",
        "--type",
        "teams",
        "--url",
        "https://teams.example.com/webhook",
        "--name",
        "Teams",
      ]),
      readFile: async () => new Uint8Array(),
    });
    const createPagerDutyExit = await executeCommand({
      client: {
        notifications: {
          createChannel: async (input: unknown) => {
            calls.push({ createChannel: input });
            return { id: "notification_channel_6", type: "pagerduty" };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "notifications",
        "channel-create",
        "--type",
        "pagerduty",
        "--routing-key-ref",
        "vault://romeo/pagerduty-routing-key",
        "--severity",
        "warning",
        "--name",
        "PagerDuty",
      ]),
      readFile: async () => new Uint8Array(),
    });
    const deliveriesExit = await executeCommand({
      client: {
        notifications: {
          deliveries: async () => {
            calls.push({ deliveries: true });
            return [{ id: "notification_delivery_1", status: "disabled" }];
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs(["notifications", "deliveries"]),
      readFile: async () => new Uint8Array(),
    });
    const retryExit = await executeCommand({
      client: {
        notifications: {
          retryDue: async () => {
            calls.push({ retryDue: true });
            return {
              job: { id: "job_notification_retry", status: "completed" },
              deliveries: [
                { id: "notification_delivery_retry", status: "sent" },
              ],
            };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs(["notifications", "retry-due"]),
      readFile: async () => new Uint8Array(),
    });
    const policyExit = await executeCommand({
      client: {
        notifications: {
          policy: async () => {
            calls.push({ policy: true });
            return {
              orgId: "org_default",
              policy: { deliveryEnabled: true },
              posture: { deliveryEnabled: true },
            };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs(["notifications", "policy"]),
      readFile: async () => new Uint8Array(),
    });
    const policyUpdateExit = await executeCommand({
      client: {
        notifications: {
          updatePolicy: async (input: unknown) => {
            calls.push({ updatePolicy: input });
            return {
              orgId: "org_default",
              policy: input,
              posture: { deliveryEnabled: true },
            };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "notifications",
        "policy-update",
        "--delivery-enabled",
        "false",
        "--allowed-channel-types",
        "webhook,email,mobile_push,teams,pagerduty",
        "--allowed-webhook-hosts",
        "hooks.example.com,*.example.net",
        "--allowed-teams-hosts",
        "teams.example.com",
        "--allowed-email-domains",
        "example.com",
        "--suppressed-notification-types",
        "chat_mention",
      ]),
      readFile: async () => new Uint8Array(),
    });

    expect(createExit).toBe(0);
    expect(createEmailExit).toBe(0);
    expect(createSlackExit).toBe(0);
    expect(createMobilePushExit).toBe(0);
    expect(createTeamsExit).toBe(0);
    expect(createPagerDutyExit).toBe(0);
    expect(deliveriesExit).toBe(0);
    expect(retryExit).toBe(0);
    expect(policyExit).toBe(0);
    expect(policyUpdateExit).toBe(0);
    expect(calls).toEqual([
      {
        createChannel: {
          type: "webhook",
          name: "Mentions",
          config: {
            url: "https://hooks.example.com/romeo",
            enabledNotificationTypes: ["chat_mention"],
          },
        },
      },
      {
        createChannel: {
          type: "email",
          name: "Email",
          config: { to: "target@example.com" },
        },
      },
      {
        createChannel: {
          type: "slack",
          name: "Slack",
          config: { url: "https://hooks.slack.com/services/T/B/C" },
        },
      },
      {
        createChannel: {
          type: "mobile_push",
          name: "Mobile",
          config: {
            tokenRef: "romeo-secret://secret_device_token",
            platform: "android",
            collapseKey: "mention",
          },
        },
      },
      {
        createChannel: {
          type: "teams",
          name: "Teams",
          config: { url: "https://teams.example.com/webhook" },
        },
      },
      {
        createChannel: {
          type: "pagerduty",
          name: "PagerDuty",
          config: {
            routingKeyRef: "vault://romeo/pagerduty-routing-key",
            severity: "warning",
          },
        },
      },
      { deliveries: true },
      { retryDue: true },
      { policy: true },
      {
        updatePolicy: {
          deliveryEnabled: false,
          allowedChannelTypes: [
            "webhook",
            "email",
            "mobile_push",
            "teams",
            "pagerduty",
          ],
          allowedWebhookHosts: ["hooks.example.com", "*.example.net"],
          allowedTeamsHosts: ["teams.example.com"],
          allowedEmailDomains: ["example.com"],
          suppressedNotificationTypes: ["chat_mention"],
        },
      },
    ]);
    expect(output.stdout()).toContain("notification_delivery_1");
    expect(output.stdout()).toContain("notification_delivery_retry");
  });

  it("runs the notification retry worker for bounded iterations", async () => {
    const output = createOutput();
    let calls = 0;
    const exitCode = await executeCommand({
      client: {
        notifications: {
          retryDue: async () => {
            calls += 1;
            return {
              job: {
                id: `job_notification_${calls}`,
                type: "notification.retry_due",
                status: "completed",
              },
              deliveries:
                calls === 1 ? [{ id: "notification_delivery_retry" }] : [],
            };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "workers",
        "notification-retry",
        "--max-iterations",
        "2",
        "--interval-ms",
        "0",
      ]),
      readFile: async () => new Uint8Array(),
    });

    expect(exitCode).toBe(0);
    expect(calls).toBe(2);
    expect(output.stdout()).toContain('"retriedDeliveryCount": 1');
  });

  it("creates and syncs website connectors from CLI flags", async () => {
    const output = createOutput();
    const calls: unknown[] = [];
    const createExit = await executeCommand({
      client: {
        dataConnectors: {
          create: async (input: unknown) => {
            calls.push({ create: input });
            return { id: "data_connector_1", type: "website" };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "connectors",
        "create-website",
        "--workspace",
        "ws_1",
        "--kb",
        "kb_1",
        "--url",
        "https://docs.example.com/guide",
        "--name",
        "Docs",
        "--sync-interval-minutes",
        "60",
        "--source-access-mode",
        "connector_owner",
      ]),
      readFile: async () => new Uint8Array(),
    });
    const syncExit = await executeCommand({
      client: {
        dataConnectors: {
          sync: async (input: unknown) => {
            calls.push({ sync: input });
            return { id: "connector_sync_1", status: "completed" };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "connectors",
        "sync",
        "--connector",
        "data_connector_1",
      ]),
      readFile: async () => new Uint8Array(),
    });

    expect(createExit).toBe(0);
    expect(syncExit).toBe(0);
    expect(calls).toEqual([
      {
        create: {
          workspaceId: "ws_1",
          knowledgeBaseId: "kb_1",
          type: "website",
          name: "Docs",
          syncIntervalMinutes: 60,
          config: {
            url: "https://docs.example.com/guide",
            sourceAccessMode: "connector_owner",
          },
        },
      },
      { sync: { connectorId: "data_connector_1" } },
    ]);
    expect(output.stdout()).toContain("connector_sync_1");
  });

  it("creates RSS connectors from CLI flags", async () => {
    const output = createOutput();
    let received: unknown;
    const exitCode = await executeCommand({
      client: {
        dataConnectors: {
          create: async (input: unknown) => {
            received = input;
            return { id: "data_connector_1", type: "rss" };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "connectors",
        "create-rss",
        "--workspace",
        "ws_1",
        "--kb",
        "kb_1",
        "--url",
        "https://docs.example.com/feed.xml",
        "--name",
        "Feed",
        "--max-items",
        "5",
        "--sync-interval-minutes",
        "120",
        "--source-access-mode",
        "knowledge_base",
      ]),
      readFile: async () => new Uint8Array(),
    });

    expect(exitCode).toBe(0);
    expect(received).toEqual({
      workspaceId: "ws_1",
      knowledgeBaseId: "kb_1",
      type: "rss",
      name: "Feed",
      syncIntervalMinutes: 120,
      config: {
        url: "https://docs.example.com/feed.xml",
        maxItems: 5,
        sourceAccessMode: "knowledge_base",
      },
    });
    expect(output.stdout()).toContain("data_connector_1");
  });

  it("creates S3 connectors from CLI flags", async () => {
    const output = createOutput();
    let received: unknown;
    const exitCode = await executeCommand({
      client: {
        dataConnectors: {
          create: async (input: unknown) => {
            received = input;
            return { id: "data_connector_s3", type: "s3" };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "connectors",
        "create-s3",
        "--workspace",
        "ws_1",
        "--kb",
        "kb_1",
        "--bucket",
        "romeo-docs",
        "--prefix",
        "handbook/",
        "--region",
        "us-east-1",
        "--secret-ref",
        "env://S3_CONNECTOR_TOKEN",
        "--max-items",
        "10",
        "--sync-interval-minutes",
        "240",
        "--source-access-mode",
        "connector_owner",
      ]),
      readFile: async () => new Uint8Array(),
    });

    expect(exitCode).toBe(0);
    expect(received).toEqual({
      workspaceId: "ws_1",
      knowledgeBaseId: "kb_1",
      type: "s3",
      name: "S3 bucket",
      syncIntervalMinutes: 240,
      config: {
        bucket: "romeo-docs",
        prefix: "handbook/",
        region: "us-east-1",
        secretRef: "env://S3_CONNECTOR_TOKEN",
        maxItems: 10,
        sourceAccessMode: "connector_owner",
      },
    });
    expect(output.stdout()).toContain("data_connector_s3");
  });

  it("runs the data connector sync worker for bounded iterations", async () => {
    const output = createOutput();
    let listCalls = 0;
    const synced: string[] = [];
    const exitCode = await executeCommand({
      client: {
        dataConnectors: {
          list: async (workspaceId?: string) => {
            listCalls += 1;
            return listCalls === 1
              ? [
                  {
                    id: "connector_web",
                    type: "website",
                    status: "active",
                    workspaceId,
                  },
                  {
                    id: "connector_future",
                    type: "rss",
                    status: "active",
                    workspaceId,
                    nextSyncAt: "9999-01-01T00:00:00.000Z",
                  },
                  {
                    id: "connector_local",
                    type: "local_import",
                    status: "active",
                    workspaceId,
                  },
                ]
              : [];
          },
          sync: async (input: { connectorId: string }) => {
            synced.push(input.connectorId);
            return {
              id: "connector_sync_1",
              connectorId: input.connectorId,
              status: "completed",
            };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "workers",
        "data-connector-sync",
        "--workspace",
        "ws_1",
        "--max-iterations",
        "2",
        "--interval-ms",
        "0",
      ]),
      readFile: async () => new Uint8Array(),
    });

    expect(exitCode).toBe(0);
    expect(listCalls).toBe(2);
    expect(synced).toEqual(["connector_web"]);
    expect(output.stdout()).toContain('"iteration": 2');
    expect(output.stdout()).toContain('"syncedCount": 1');
  });

  it("runs the workflow resume worker for bounded iterations", async () => {
    const output = createOutput();
    let listCalls = 0;
    const resumed: string[] = [];
    const exitCode = await executeCommand({
      client: {
        workflows: {
          list: async (workspaceId?: string) => {
            expect(workspaceId).toBe("ws_1");
            return [
              { id: "workflow_1", enabled: true },
              { id: "workflow_disabled", enabled: false },
            ];
          },
          runs: async (workflowId: string) => {
            listCalls += 1;
            return workflowId === "workflow_1" && listCalls === 1
              ? [
                  { id: "workflow_run_waiting", status: "waiting_run" },
                  { id: "workflow_run_done", status: "completed" },
                ]
              : [];
          },
          resumeRun: async (workflowRunId: string) => {
            resumed.push(workflowRunId);
            return { id: workflowRunId, status: "waiting_approval" };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "workers",
        "workflow-resume",
        "--workspace",
        "ws_1",
        "--max-iterations",
        "2",
        "--interval-ms",
        "0",
      ]),
      readFile: async () => new Uint8Array(),
    });

    expect(exitCode).toBe(0);
    expect(listCalls).toBe(2);
    expect(resumed).toEqual(["workflow_run_waiting"]);
    expect(output.stdout()).toContain('"iteration": 2');
    expect(output.stdout()).toContain('"resumedCount": 1');
  });

  it("runs the browser automation worker for bounded iterations", async () => {
    const output = createOutput();
    const completed: unknown[] = [];
    const runnerCalls: string[] = [];
    const exitCode = await executeCommand({
      client: {
        workflows: {
          claimBrowserTask: async () => ({
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
              task: "Inspect release metadata.",
              taskHash: "hash_1",
              taskLength: 25,
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
          }),
          completeBrowserTask: async (input: unknown) => {
            completed.push(input);
            return { outcome: "completed", workerQueue: "browser_automation" };
          },
          failBrowserTask: async () => {
            throw new Error("browser task should complete");
          },
        },
      } as never,
      fetchImpl: async (input) => {
        runnerCalls.push(String(input));
        return new Response(
          JSON.stringify({
            artifactCount: 1,
            finalOrigin: "https://example.com/releases",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
      io: output.io,
      parsed: parseArgs([
        "workers",
        "browser-automation",
        "--runner-url",
        "https://browser-runner.example/tasks",
        "--once",
        "--max-jobs",
        "1",
      ]),
      readFile: async () => new Uint8Array(),
    });

    expect(exitCode).toBe(0);
    expect(runnerCalls).toEqual(["https://browser-runner.example/tasks"]);
    expect(completed).toEqual([
      {
        jobId: "job_browser_1",
        result: {
          artifactCount: 1,
          finalOrigin: "https://example.com/releases",
        },
      },
    ]);
    expect(output.stdout()).toContain('"completedCount": 1');
  });

  it("syncs a local connector file from CLI flags", async () => {
    const output = createOutput();
    let received: unknown;
    const exitCode = await executeCommand({
      client: {
        dataConnectors: {
          sync: async (input: unknown) => {
            received = input;
            return { id: "connector_sync_1", status: "completed" };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "connectors",
        "sync-local",
        "--connector",
        "connector_1",
        "--file",
        "notes.md",
        "--mime-type",
        "text/markdown",
      ]),
      readFile: async () => new TextEncoder().encode("Romeo connector notes"),
    });

    expect(exitCode).toBe(0);
    expect(received).toEqual({
      connectorId: "connector_1",
      items: [
        {
          fileName: "notes.md",
          mimeType: "text/markdown",
          content: "Romeo connector notes",
          sizeBytes: 21,
        },
      ],
    });
    expect(output.stdout()).toContain("connector_sync_1");
  });

  it("prints readiness from the CLI", async () => {
    const output = createOutput();
    const exitCode = await executeCommand({
      client: {
        admin: {
          readiness: async () => ({
            status: "attention_required",
            generatedAt: "",
            checks: [],
          }),
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs(["readiness"]),
      readFile: async () => new Uint8Array(),
    });

    expect(exitCode).toBe(0);
    expect(output.stdout()).toContain("attention_required");
  });

  it("prints background job operational summaries from the CLI", async () => {
    const output = createOutput();
    const exitCode = await executeCommand({
      client: {
        admin: {
          jobOperationalSummary: async () => ({
            generatedAt: "2026-06-30T00:00:00.000Z",
            status: "degraded",
            thresholds: {
              deadLetterCriticalCount: 5,
              deadLetterWarningCount: 1,
              queuedWarningSeconds: 300,
              queuedCriticalSeconds: 900,
              runningWarningSeconds: 900,
              runningCriticalSeconds: 3600,
              failedLookbackSeconds: 3600,
              failedWarningCount: 1,
              failedCriticalCount: 5,
            },
            totals: {
              total: 1,
              queued: 1,
              running: 0,
              completed: 0,
              failed: 0,
              deadLettered: 1,
              recentFailed: 0,
            },
            byType: [],
            alerts: [
              {
                id: "job_queued_lag",
                metric: "queued_lag_seconds",
                severity: "warning",
                type: "webhook.retry_due",
                value: 301,
                threshold: 300,
              },
              {
                id: "job_dead_letters_tool_operation_dispatch_request",
                metric: "dead_letter_jobs",
                severity: "warning",
                type: "tool.operation.dispatch_request",
                value: 1,
                threshold: 1,
              },
            ],
          }),
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs(["jobs", "summary"]),
      readFile: async () => new Uint8Array(),
    });

    expect(exitCode).toBe(0);
    expect(output.stdout()).toContain("queued_lag_seconds");
    expect(output.stdout()).toContain("dead_letter_jobs");
  });

  it("prints SSO settings from the CLI", async () => {
    const output = createOutput();
    const exitCode = await executeCommand({
      client: {
        admin: {
          ssoSettings: async () => ({
            generatedAt: "",
            configurationSource: "environment",
            status: "enabled",
            localLogin: { seededDevelopmentLoginEnabled: false },
            oidc: {
              detectedProviderPreset: "keycloak",
              providerPresets: [
                {
                  id: "keycloak",
                  name: "Keycloak",
                  recommendedGroupClaim: "groups",
                  issuerHint: "https://keycloak.example.com/realms/{realm}",
                  notes: [],
                },
              ],
              bearerTokenAuthEnabled: true,
              browserPkceLoginEnabled: true,
              issuerConfigured: true,
              issuerHost: "idp.example.com",
              clientIdConfigured: true,
              groupClaim: "groups",
              adminGroupCount: 1,
              groupMappingCount: 0,
              workspaceGroupMappingCount: 0,
              workspaceGroupPrefixConfigured: false,
              jitProvisioningEnabled: true,
              accountLinkingEnabled: false,
            },
            notes: [],
          }),
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs(["sso", "settings"]),
      readFile: async () => new Uint8Array(),
    });

    expect(exitCode).toBe(0);
    expect(output.stdout()).toContain("idp.example.com");
  });

  it("updates SSO settings from CLI flags", async () => {
    const output = createOutput();
    const calls: unknown[] = [];
    const exitCode = await executeCommand({
      client: {
        admin: {
          updateSsoSettings: async (input: unknown) => {
            calls.push(input);
            return {
              generatedAt: "",
              configurationSource: "database",
              status: "enabled",
              localLogin: { seededDevelopmentLoginEnabled: false },
              oidc: {
                detectedProviderPreset: "keycloak",
                providerPresets: [
                  {
                    id: "keycloak",
                    name: "Keycloak",
                    recommendedGroupClaim: "groups",
                    issuerHint: "https://keycloak.example.com/realms/{realm}",
                    notes: [],
                  },
                ],
                bearerTokenAuthEnabled: true,
                browserPkceLoginEnabled: true,
                issuerConfigured: true,
                issuerHost: "idp.example.com",
                clientIdConfigured: true,
                groupClaim: "groups",
                adminGroupCount: 1,
                groupMappingCount: 1,
                workspaceGroupMappingCount: 1,
                workspaceGroupPrefixConfigured: true,
                jitProvisioningEnabled: true,
                accountLinkingEnabled: false,
              },
              notes: [],
            };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "sso",
        "update",
        "--enable",
        "--provider-preset",
        "keycloak",
        "--issuer-url",
        "https://idp.example.com/realms/romeo",
        "--client-id",
        "romeo-web",
        "--admin-groups",
        "platform-admins",
        "--group-map",
        "reviewers=group_reviewers",
        "--workspace-group-map",
        "engineering=workspace_default",
        "--workspace-group-prefix",
        "workspace:",
      ]),
      readFile: async () => new Uint8Array(),
    });

    expect(exitCode).toBe(0);
    expect(calls).toEqual([
      {
        oidc: {
          enabled: true,
          providerPreset: "keycloak",
          issuerUrl: "https://idp.example.com/realms/romeo",
          clientId: "romeo-web",
          adminGroups: ["platform-admins"],
          groupMap: { reviewers: "group_reviewers" },
          workspaceGroupMap: { engineering: "workspace_default" },
          workspaceGroupPrefix: "workspace:",
        },
      },
    ]);
    expect(output.stdout()).toContain('"database"');
  });

  it("prints sanitized SSO connection test results from the CLI", async () => {
    const output = createOutput();
    const exitCode = await executeCommand({
      client: {
        admin: {
          testSsoSettings: async () => ({
            generatedAt: "",
            status: "passed",
            issuerHost: "idp.example.com",
            checks: [
              {
                id: "configuration",
                status: "pass",
                code: "oidc_config_complete",
              },
              {
                id: "discovery",
                status: "pass",
                code: "oidc_discovery_reachable",
              },
              { id: "jwks", status: "pass", code: "oidc_jwks_reachable" },
            ],
            notes: [],
          }),
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs(["sso", "test"]),
      readFile: async () => new Uint8Array(),
    });

    expect(exitCode).toBe(0);
    expect(output.stdout()).toContain("oidc_jwks_reachable");
  });

  it("deprovisions an OIDC user from CLI flags", async () => {
    const output = createOutput();
    const calls: unknown[] = [];
    const exitCode = await executeCommand({
      client: {
        admin: {
          deprovisionOidcUser: async (input: unknown) => {
            calls.push(input);
            return {
              status: "disabled",
              issuerHost: "idp.example.com",
              user: {
                id: "user_oidc_1",
                orgId: "org_default",
                email: "oidc-user-1@example.com",
                name: "OIDC User One",
                disabledAt: "2026-06-27T00:00:00.000Z",
              },
            };
          },
        },
      } as never,
      fetchImpl: fetch,
      io: output.io,
      parsed: parseArgs([
        "sso",
        "deprovision-oidc",
        "--issuer-url",
        "https://idp.example.com/realms/romeo",
        "--oidc-subject",
        "oidc-user-1",
        "--confirm-oidc-subject",
        "oidc-user-1",
      ]),
      readFile: async () => new Uint8Array(),
    });

    expect(exitCode).toBe(0);
    expect(calls).toEqual([
      {
        issuerUrl: "https://idp.example.com/realms/romeo",
        oidcSubject: "oidc-user-1",
        confirmOidcSubject: "oidc-user-1",
      },
    ]);
    expect(output.stdout()).toContain('"disabled"');
  });
});

function createOutput(): {
  io: CliIo;
  stdout: () => string;
  stderr: () => string;
} {
  let stdout = "";
  let stderr = "";
  return {
    io: {
      stdout: {
        write: (chunk: string | Uint8Array) => (
          (stdout += String(chunk)),
          true
        ),
      },
      stderr: {
        write: (chunk: string | Uint8Array) => (
          (stderr += String(chunk)),
          true
        ),
      },
    },
    stdout: () => stdout,
    stderr: () => stderr,
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

function billingLifecycleEnforcementResult(statusChanged: boolean) {
  return {
    before: billingLifecycleReport("attention_required"),
    after: billingLifecycleReport("healthy"),
    action: {
      type: "mark_past_due",
      statusChanged,
      previousStatus: "trialing",
      newStatus: statusChanged ? "past_due" : "trialing",
    },
  };
}
