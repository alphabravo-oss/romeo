import { describe, expect, it } from "vitest";

import { createRomeoApi } from "./api";
import { InMemoryRomeoRepository } from "./repositories/in-memory";
import { EnvironmentSecretResolver } from "./services/secret-resolver";
import { activeContentPolicyFor } from "./services/content-policy-service";
import { testEnv } from "./test-support/env";

describe("content policy version and approval HTTP", () => {
  it("creates, dry-runs, publishes, and rolls back an immutable version", async () => {
    const repository = new InMemoryRomeoRepository();
    const api = createRomeoApi(repository, {
      env: testEnv(),
    });
    const created = await api.request("/api/v1/admin/content-policy/versions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        detectors: {
          credit_card: "disabled",
          email_address: "redact",
          us_ssn: "disabled",
          api_token: "block",
        },
        approvalRequired: true,
      }),
    });
    expect(created.status).toBe(200);
    const version = (await created.json()).data;
    expect(version.state).toBe("draft");
    const sentinel =
      "email private@example.com token sk-abcdefghijklmnopqrstuvwxyz123456";
    const dry = await api.request(
      `/api/v1/admin/content-policy/versions/${version.id}/dry-run`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: sentinel }),
      },
    );
    expect(dry.status).toBe(200);
    const dryBody = await dry.json();
    expect(dryBody.data.action).toBe("block");
    expect(JSON.stringify(dryBody)).not.toContain("private@example.com");
    expect(JSON.stringify(dryBody)).not.toContain(
      "sk-abcdefghijklmnopqrstuvwxyz",
    );

    const published = await api.request(
      `/api/v1/admin/content-policy/versions/${version.id}/publish`,
      { method: "POST" },
    );
    expect(published.status).toBe(200);
    expect((await published.json()).data.state).toBe("published");
    expect(
      (
        await repository.getSystemSetting(
          "content_policy.v1:org_default",
          "org_default",
        )
      )?.value,
    ).toMatchObject({
      versionId: version.id,
      approvalRequired: true,
      approvalTtlSeconds: 3_600,
    });

    const listed = await api.request("/api/v1/admin/content-policy/versions");
    expect(listed.status).toBe(200);
    expect((await listed.json()).data).toHaveLength(1);

    const second = await api.request("/api/v1/admin/content-policy/versions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        detectors: {
          credit_card: "disabled",
          email_address: "audit",
          us_ssn: "disabled",
          api_token: "audit",
        },
      }),
    });
    const secondId = (await second.json()).data.id;
    await api.request(
      `/api/v1/admin/content-policy/versions/${secondId}/publish`,
      {
        method: "POST",
      },
    );
    const rolled = await api.request("/api/v1/admin/content-policy/rollback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ versionId: version.id }),
    });
    expect(rolled.status).toBe(200);
    expect((await rolled.json()).data.id).toBe(version.id);

    const decisions = await api.request(
      "/api/v1/admin/content-policy/decisions",
    );
    expect(decisions.status).toBe(200);
    expect(JSON.stringify(await decisions.json())).not.toContain(
      "private@example.com",
    );
    expect(
      await repository.listContentPolicyDecisions("org_default", 100),
    ).toHaveLength(1);
    expect(
      await repository.getSystemSetting(
        "content_policy.decisions.v1:org_default",
        "org_default",
      ),
    ).toBeUndefined();
  });

  it("rejects caller-fabricated approvals because runtime decisions own creation", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      env: testEnv(),
    });
    const requested = await api.request(
      "/api/v1/admin/content-policy/approvals",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          runId: "run_policy",
          decisionId: "dec_policy",
          expiresAt: "2027-08-14T12:00:00.000Z",
        }),
      },
    );
    expect(requested.status).toBe(403);
    expect((await requested.json()).error.code).toBe(
      "content_policy_approval_required",
    );
    const listed = await api.request("/api/v1/admin/content-policy/approvals");
    expect((await listed.json()).data).toEqual([]);
  });

  it("pauses a governed run, rejects mismatched resolution, and resumes exactly once", async () => {
    const repository = new InMemoryRomeoRepository();
    const provider = await repository.getProvider("provider_openai_compatible");
    if (provider === undefined) throw new Error("Expected provider fixture.");
    await repository.updateProvider({
      ...provider,
      baseUrl: "https://provider.example.test/v1",
      credentialRef: "env://ROMEO_PROVIDER_API_KEY",
    });
    const providerBodies: string[] = [];
    let providerCalls = 0;
    const api = createRomeoApi(repository, {
      env: testEnv(),
      startBackgroundWorkers: false,
      providerFetch: async (_input, init) => {
        providerCalls += 1;
        providerBodies.push(typeof init?.body === "string" ? init.body : "");
        const events =
          providerCalls === 1
            ? [
                { choices: [{ delta: { content: "private@" } }] },
                { choices: [{ delta: { content: "example.com" } }] },
              ]
            : [
                { choices: [{ delta: { content: "Approved safe answer." } }] },
                { choices: [{ delta: {}, finish_reason: "stop" }] },
              ];
        return new Response(providerSse(events), {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      },
      secretResolver: new EnvironmentSecretResolver({
        ROMEO_PROVIDER_API_KEY: "test-provider-key",
      }),
    });
    const versionResponse = await api.request(
      "/api/v1/admin/content-policy/versions",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          detectors: {
            credit_card: "disabled",
            email_address: "block",
            us_ssn: "disabled",
            api_token: "disabled",
          },
          approvalRequired: true,
          approvalTtlSeconds: 300,
        }),
      },
    );
    const versionId = (await versionResponse.json()).data.id;
    expect(
      await api.request(
        `/api/v1/admin/content-policy/versions/${versionId}/publish`,
        { method: "POST" },
      ),
    ).toMatchObject({ status: 200 });
    expect(
      (
        await repository.getSystemSetting(
          "content_policy.v1:org_default",
          "org_default",
        )
      )?.value,
    ).toMatchObject({
      versionId,
      approvalRequired: true,
      detectors: expect.objectContaining({ email_address: "block" }),
    });
    expect(
      await activeContentPolicyFor(repository, "org_default"),
    ).toMatchObject({
      versionId,
      approvalRequired: true,
      detectors: expect.objectContaining({ email_address: "block" }),
    });
    const chat = await (
      await api.request("/api/v1/chats", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: "workspace_default",
          title: "Policy approval continuation",
        }),
      })
    ).json();
    const started = await api.request("/api/v1/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chatId: chat.data.id,
        agentId: "agent_default",
        modelId: "model_openai_compatible_default",
        content: "Return the requested account contact.",
      }),
    });
    const runId = (await started.json()).data.id;
    expect(started.status).toBe(202);
    await waitForRunStatus(repository, runId, "waiting_tool_approval");

    const listed = await (
      await api.request("/api/v1/admin/content-policy/approvals")
    ).json();
    expect(listed.data).toEqual([
      expect.objectContaining({
        runId,
        policyVersionId: versionId,
        state: "pending",
      }),
    ]);
    const approvalId = listed.data[0].id;
    const mismatch = await api.request(
      `/api/v1/admin/content-policy/approvals/${approvalId}/resolve`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision: "approve", runId: "run_spoofed" }),
      },
    );
    expect(mismatch.status).toBe(403);
    const resolved = await api.request(
      `/api/v1/admin/content-policy/approvals/${approvalId}/resolve`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision: "approve", runId }),
      },
    );
    expect(resolved.status).toBe(200);
    await waitForRunStatus(repository, runId, "completed");

    const events = await repository.listRunEvents(runId);
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "run.waiting_tool_approval",
        "run.continuing",
        "run.completed",
      ]),
    );
    expect(providerCalls).toBe(2);
    expect(JSON.stringify({ events, providerBodies })).not.toContain(
      "private@example.com",
    );
    expect(
      await repository.getMessage(`msg_run_terminal_${runId}`),
    ).toMatchObject({ content: "Approved safe answer." });
  });
});

async function waitForRunStatus(
  repository: InMemoryRomeoRepository,
  runId: string,
  expected: "completed" | "waiting_tool_approval",
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if ((await repository.getRun(runId))?.status === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const run = await repository.getRun(runId);
  const eventTypes = (await repository.listRunEvents(runId)).map(
    (event) => event.type,
  );
  const assistant = await repository.getMessage(`msg_run_terminal_${runId}`);
  throw new Error(
    `Run ${runId} did not reach ${expected}; status=${run?.status ?? "missing"}; events=${eventTypes.join(",")}; assistant=${assistant?.content ?? "missing"}.`,
  );
}

function providerSse(events: unknown[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const event of events)
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}
