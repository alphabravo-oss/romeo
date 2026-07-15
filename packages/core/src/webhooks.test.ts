import { seededSubject } from "@romeo/auth";
import { readEnv } from "@romeo/config";
import { describe, expect, it } from "vitest";

import { createRomeoApi } from "./api";
import { InMemoryRomeoRepository } from "./repositories/in-memory";
import { WebhookService } from "./services/webhook-service";

interface FetchCall {
  url: string;
  init?: RequestInit;
}

const env = readEnv({ WEBHOOK_SIGNING_KEY: "test-webhook-signing-key" });

describe("webhook API", () => {
  it("rejects unsafe webhook targets", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository(), { env });
    const httpResponse = await api.request("/api/v1/webhooks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: "http://hooks.example/romeo",
        eventTypes: ["run.completed"],
      }),
    });
    const privateIpResponse = await api.request("/api/v1/webhooks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: "https://127.0.0.1/hook",
        eventTypes: ["run.completed"],
      }),
    });

    expect(httpResponse.status).toBe(400);
    expect(privateIpResponse.status).toBe(400);
  });

  it("creates subscriptions, signs test deliveries, and stores delivery logs", async () => {
    const calls: FetchCall[] = [];
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      env,
      webhookFetch: async (input, init) => {
        pushCall(calls, input, init);
        return new Response(null, { status: 204 });
      },
    });

    const createResponse = await api.request("/api/v1/webhooks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: "https://hooks.example/romeo",
        eventTypes: ["run.completed"],
      }),
    });
    const created = await createResponse.json();

    const listResponse = await api.request("/api/v1/webhooks");
    const list = await listResponse.json();

    const webhookBodySentinel = "SECRET_WEBHOOK_BODY_SENTINEL";
    const testResponse = await api.request(
      `/api/v1/webhooks/${created.data.subscription.id}/test`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          payload: { check: "signed", rawBody: webhookBodySentinel },
        }),
      },
    );
    const delivery = await testResponse.json();

    const deliveryListResponse = await api.request(
      `/api/v1/webhooks/${created.data.subscription.id}/deliveries`,
    );
    const deliveryList = await deliveryListResponse.json();

    expect(createResponse.status).toBe(201);
    expect(created.data.signingSecret).toMatch(/^whsec_/);
    expect(list.data).toHaveLength(1);
    expect(list.data[0].signingSecret).toBeUndefined();
    expect(testResponse.status).toBe(202);
    expect(delivery.data.status).toBe("delivered");
    expect(delivery.data.attemptCount).toBe(1);
    expect(delivery.data.responseStatus).toBe(204);
    expect(delivery.data.payload).toEqual({
      redacted: true,
      keyCount: 4,
      keys: ["check", "rawBody", "requestedBy", "subscriptionId"],
    });
    expect(JSON.stringify(delivery.data)).not.toContain(webhookBodySentinel);
    expect(deliveryList.data).toHaveLength(1);
    expect(JSON.stringify(deliveryList.data)).not.toContain(
      webhookBodySentinel,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://hooks.example/romeo");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.headers).toMatchObject({
      "content-type": "application/json",
      "user-agent": "Romeo-Webhooks/0.1",
      "x-romeo-event": "webhook.test",
    });
    expect(
      String(
        (calls[0]?.init?.headers as Record<string, string>)[
          "x-romeo-signature"
        ],
      ),
    ).toMatch(/^v1=/);
    expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({
      id: delivery.data.id,
      type: "webhook.test",
      data: {
        check: "signed",
        rawBody: webhookBodySentinel,
        subscriptionId: created.data.subscription.id,
      },
    });
  });

  it("records failed deliveries with retry metadata and blocks disabled subscriptions", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      env,
      webhookFetch: async () => new Response(null, { status: 500 }),
    });

    const createResponse = await api.request("/api/v1/webhooks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: "https://hooks.example/fail",
        eventTypes: ["webhook.test"],
      }),
    });
    const created = await createResponse.json();

    const testResponse = await api.request(
      `/api/v1/webhooks/${created.data.subscription.id}/test`,
      { method: "POST" },
    );
    const delivery = await testResponse.json();

    const disableResponse = await api.request(
      `/api/v1/webhooks/${created.data.subscription.id}/disable`,
      { method: "POST" },
    );
    const disabledTestResponse = await api.request(
      `/api/v1/webhooks/${created.data.subscription.id}/test`,
      { method: "POST" },
    );
    const disabledTest = await disabledTestResponse.json();

    expect(testResponse.status).toBe(202);
    expect(delivery.data.status).toBe("failed");
    expect(delivery.data.errorCode).toBe("http_error");
    expect(delivery.data.nextAttemptAt).toEqual(expect.any(String));
    expect(disableResponse.status).toBe(200);
    expect(disabledTestResponse.status).toBe(409);
    expect(disabledTest.error.code).toBe("webhook_disabled");
  });

  it("retries due failed deliveries through a background job", async () => {
    const repository = new InMemoryRomeoRepository();
    const calls: FetchCall[] = [];
    let status = 500;
    const api = createRomeoApi(repository, {
      env,
      webhookFetch: async (input, init) => {
        pushCall(calls, input, init);
        return new Response(null, { status });
      },
    });

    const createResponse = await api.request("/api/v1/webhooks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: "https://hooks.example/retry",
        eventTypes: ["webhook.test"],
      }),
    });
    const created = await createResponse.json();
    const failedResponse = await api.request(
      `/api/v1/webhooks/${created.data.subscription.id}/test`,
      { method: "POST" },
    );
    const failed = await failedResponse.json();
    await repository.updateWebhookDelivery({
      ...failed.data,
      nextAttemptAt: "2020-01-01T00:00:00.000Z",
    });
    status = 204;

    const retryResponse = await api.request(
      "/api/v1/webhook-deliveries/retry-due",
      { method: "POST" },
    );
    const retry = await retryResponse.json();
    const jobsResponse = await api.request("/api/v1/jobs");
    const jobs = await jobsResponse.json();

    expect(retryResponse.status).toBe(202);
    expect(retry.data.job.status).toBe("completed");
    expect(retry.data.deliveries[0].status).toBe("delivered");
    expect(retry.data.deliveries[0].attemptCount).toBe(2);
    expect(retry.data.deliveries[0].payload).toEqual({
      redacted: true,
      keyCount: 2,
      keys: ["requestedBy", "subscriptionId"],
    });
    expect(JSON.parse(String(calls[1]?.init?.body)).data).toEqual({
      redacted: true,
      keyCount: 2,
      keys: ["requestedBy", "subscriptionId"],
    });
    expect(calls).toHaveLength(2);
    expect(
      jobs.data.some(
        (job: { type: string; status: string }) =>
          job.type === "webhook.retry_due" && job.status === "completed",
      ),
    ).toBe(true);
  });

  it("retries first-party event webhooks from a safe stored envelope", async () => {
    const repository = new InMemoryRomeoRepository();
    const calls: FetchCall[] = [];
    let status = 500;
    const service = new WebhookService(repository, {
      signingKey: env.WEBHOOK_SIGNING_KEY,
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return new Response(null, { status });
      },
    });
    const rawSentinel = "raw first-party webhook payload must not persist";
    await service.create({
      subject: seededSubject,
      url: "https://hooks.example/run-retry",
      eventTypes: ["run.completed"],
    });

    const [initial] = await service.emit({
      orgId: "org_default",
      eventType: "run.completed",
      payload: {
        runId: "run_retry_safe_payload",
        chatId: "chat_welcome",
        workspaceId: "workspace_default",
        agentId: "agent_default",
        modelId: "model_openai_compatible_default",
        providerId: "provider_openai_compatible",
        status: "completed",
        completedAt: "2026-07-03T12:00:00.000Z",
        rawBody: rawSentinel,
      },
    });
    const stored = (await repository.listWebhookDeliveries("org_default"))[0];
    if (stored === undefined) throw new Error("Expected stored delivery.");
    await repository.updateWebhookDelivery({
      ...stored,
      nextAttemptAt: "2020-01-01T00:00:00.000Z",
    });
    status = 204;

    const retry = await service.retryDueDeliveries(seededSubject);
    const firstAttemptBody = JSON.parse(String(calls[0]?.init?.body));
    const retryBody = JSON.parse(String(calls[1]?.init?.body));

    expect(initial?.payload).toEqual({
      redacted: true,
      keyCount: 8,
      keys: [
        "agentId",
        "chatId",
        "completedAt",
        "modelId",
        "providerId",
        "runId",
        "status",
        "workspaceId",
      ],
    });
    expect(stored.payload).toMatchObject({
      runId: "run_retry_safe_payload",
      status: "completed",
    });
    expect(JSON.stringify(stored)).not.toContain(rawSentinel);
    expect(firstAttemptBody.data).toEqual(retryBody.data);
    expect(retryBody.data).toMatchObject({
      runId: "run_retry_safe_payload",
      workspaceId: "workspace_default",
      status: "completed",
    });
    expect(JSON.stringify(retryBody)).not.toContain(rawSentinel);
    expect(retry.deliveries[0]?.payload).toEqual(initial?.payload);
  });

  it("emits run completion events to subscribed webhooks", async () => {
    const calls: FetchCall[] = [];
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      env,
      webhookFetch: async (input, init) => {
        pushCall(calls, input, init);
        return new Response(null, { status: 204 });
      },
    });

    await api.request("/api/v1/webhooks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: "https://hooks.example/runs",
        eventTypes: ["run.completed"],
      }),
    });

    const chatResponse = await api.request("/api/v1/chats", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        title: "Webhook run",
      }),
    });
    const chat = await chatResponse.json();
    const runResponse = await api.request("/api/v1/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chatId: chat.data.id,
        agentId: "agent_default",
        content: "Emit a webhook.",
      }),
    });
    const run = await runResponse.json();

    await waitFor(() => calls.length > 0);

    expect(runResponse.status).toBe(202);
    expect(calls[0]?.url).toBe("https://hooks.example/runs");
    expect(calls[0]?.init?.headers).toMatchObject({
      "x-romeo-event": "run.completed",
    });
    expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({
      type: "run.completed",
      data: { runId: run.data.id, status: "completed" },
    });
  });

  it("emits sanitized tool, knowledge, and quota webhook events", async () => {
    const calls: FetchCall[] = [];
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      env,
      webhookFetch: async (input, init) => {
        pushCall(calls, input, init);
        return new Response(null, { status: 204 });
      },
    });

    await api.request("/api/v1/webhooks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: "https://hooks.example/events",
        eventTypes: [
          "tool.call.succeeded",
          "tool.call.failed",
          "knowledge.source.indexed",
          "quota.alert",
        ],
      }),
    });
    await api.request("/api/v1/quotas", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scopeType: "org", metric: "tool.call", limit: 2 }),
    });
    await api.request("/api/v1/tools/tool_calculator/execute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentId: "agent_default",
        input: { expression: "2 + 2" },
      }),
    });
    await api.request("/api/v1/tools/tool_calculator/execute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentId: "agent_default",
        input: { expression: "2 +" },
      }),
    });
    await api.request("/api/v1/knowledge-bases/kb_default/sources", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fileName: "webhooks.md",
        mimeType: "text/markdown",
        sizeBytes: 32,
        content: "Romeo webhook source indexing.",
      }),
    });

    await waitFor(() => calls.length >= 4);

    const deliveries = calls.map(toDeliveryBody);
    const toolSucceeded = deliveries.find(
      (delivery) => delivery.eventType === "tool.call.succeeded",
    );
    const toolFailed = deliveries.find(
      (delivery) => delivery.eventType === "tool.call.failed",
    );
    const knowledgeIndexed = deliveries.find(
      (delivery) => delivery.eventType === "knowledge.source.indexed",
    );
    const quotaAlert = deliveries.find(
      (delivery) => delivery.eventType === "quota.alert",
    );

    expect(toolSucceeded?.body.data).toMatchObject({
      agentId: "agent_default",
      toolId: "tool_calculator",
      status: "success",
      inputKeys: ["expression"],
      outputKeys: ["expression", "result"],
    });
    expect(JSON.stringify(toolSucceeded?.body.data)).not.toContain("2 + 2");
    expect(toolFailed?.body.data).toMatchObject({
      agentId: "agent_default",
      toolId: "tool_calculator",
      status: "failure",
      errorCode: "tool_execution_error",
      inputKeys: ["expression"],
    });
    expect(JSON.stringify(toolFailed?.body.data)).not.toContain("2 +");
    expect(knowledgeIndexed?.body.data).toMatchObject({
      knowledgeBaseId: "kb_default",
      fileName: "webhooks.md",
      status: "indexed",
      chunkCount: 1,
    });
    expect(JSON.stringify(knowledgeIndexed?.body.data)).not.toContain(
      "Romeo webhook source indexing",
    );
    expect(quotaAlert?.body.data).toMatchObject({
      metric: "tool.call",
      used: 2,
      limit: 2,
      severity: "critical",
    });
  });
});

function pushCall(
  calls: FetchCall[],
  input: RequestInfo | URL,
  init: RequestInit | undefined,
): void {
  const call: FetchCall = { url: String(input) };
  if (init !== undefined) call.init = init;
  calls.push(call);
}

function toDeliveryBody(call: FetchCall): {
  eventType: string | undefined;
  body: { data: Record<string, unknown> };
} {
  return {
    eventType: headerValue(call.init?.headers, "x-romeo-event"),
    body: JSON.parse(String(call.init?.body)) as {
      data: Record<string, unknown>;
    },
  };
}

function headerValue(
  headers: RequestInit["headers"] | undefined,
  name: string,
): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  if (Array.isArray(headers))
    return headers.find(([key]) => key.toLowerCase() === name)?.[1];
  return (headers as Record<string, string> | undefined)?.[name];
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for condition.");
}
