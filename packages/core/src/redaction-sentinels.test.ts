import { readEnv } from "@romeo/config";
import { describe, expect, it } from "vitest";

import { createRomeoApi } from "./api";
import { InMemoryRomeoRepository } from "./repositories/in-memory";

describe("redaction sentinel evidence", () => {
  it("keeps raw content and one-time secrets out of operational ledgers and exports", async () => {
    const repository = new InMemoryRomeoRepository();
    const api = createRomeoApi(repository, {
      env: readEnv({ WEBHOOK_SIGNING_KEY: "redaction-sentinel-webhook-key" }),
      webhookFetch: async () => new Response(null, { status: 204 }),
    });

    const promptSentinel = "HAM_REDACTION_PROMPT_SENTINEL";
    const connectorSentinel = "HAM_REDACTION_CONNECTOR_SENTINEL";
    const commentSentinel = "HAM_REDACTION_COMMENT_SENTINEL";
    const webhookSentinel = "HAM_REDACTION_WEBHOOK_SENTINEL";

    const webhookResponse = await api.request("/api/v1/webhooks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: "https://hooks.example/redaction",
        eventTypes: ["webhook.test", "run.completed"],
      }),
    });
    const webhook = await webhookResponse.json();
    const webhookSecret = String(webhook.data.signingSecret);
    await api.request(`/api/v1/webhooks/${webhook.data.subscription.id}/test`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        payload: {
          rawBody: webhookSentinel,
          metadata: { nested: webhookSentinel },
        },
      }),
    });

    const chatResponse = await api.request("/api/v1/chats", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        title: "Redaction sentinel run",
      }),
    });
    const chat = await chatResponse.json();
    const runResponse = await api.request("/api/v1/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chatId: chat.data.id,
        agentId: "agent_default",
        content: promptSentinel,
      }),
    });
    const run = await runResponse.json();
    await waitFor(
      async () =>
        (await repository.getRun(run.data.id))?.status === "completed",
    );

    const connectorResponse = await api.request("/api/v1/data-connectors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        knowledgeBaseId: "kb_default",
        type: "local_import",
        name: "Redaction sentinel connector",
      }),
    });
    const connector = await connectorResponse.json();
    await api.request(`/api/v1/data-connectors/${connector.data.id}/sync`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        items: [
          {
            fileName: "redaction.md",
            mimeType: "text/markdown",
            content: connectorSentinel,
          },
        ],
      }),
    });

    await api.request("/api/v1/notification-channels", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "webhook",
        name: "Redaction notification webhook",
        config: { url: "https://hooks.example/notify" },
      }),
    });
    await api.request("/api/v1/chats/chat_welcome/comments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        body: `Please review @user_dev_admin ${commentSentinel}`,
      }),
    });

    const complianceReportResponse = await api.request(
      "/api/v1/governance/compliance-report",
    );
    const complianceReport = await complianceReportResponse.json();
    const complianceCsvResponse = await api.request(
      "/api/v1/governance/compliance-report.csv",
    );
    const complianceCsv = await complianceCsvResponse.text();

    expect(webhookResponse.status).toBe(201);
    expect(webhookSecret).toMatch(/^whsec_/);
    expect(runResponse.status).toBe(202);
    expect(connectorResponse.status).toBe(201);

    expectOperationalSurfacesDoNotContain(
      {
        auditLogs: await repository.listAuditLogs("org_default"),
        usageEvents: await repository.listUsageEvents("org_default"),
        backgroundJobs: await repository.listBackgroundJobs("org_default"),
        dataConnectorSyncs:
          await repository.listDataConnectorSyncs("org_default"),
        userNotifications: await repository.listUserNotifications(
          "org_default",
          "user_dev_admin",
        ),
        notificationDeliveries: await repository.listNotificationDeliveries(
          "org_default",
          "user_dev_admin",
        ),
        webhookSubscriptions:
          await repository.listWebhookSubscriptions("org_default"),
        webhookDeliveries:
          await repository.listWebhookDeliveries("org_default"),
        complianceReport: complianceReport.data,
        complianceCsv,
      },
      [
        promptSentinel,
        connectorSentinel,
        commentSentinel,
        webhookSentinel,
        webhookSecret,
      ],
    );
  });
});

function expectOperationalSurfacesDoNotContain(
  surfaces: Record<string, unknown>,
  sentinels: string[],
): void {
  for (const [label, value] of Object.entries(surfaces)) {
    const serialized = JSON.stringify(value);
    for (const sentinel of sentinels) {
      expect(serialized, `${label} leaked ${sentinel}`).not.toContain(sentinel);
    }
  }
}

async function waitFor(predicate: () => Promise<boolean>): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for condition.");
}
