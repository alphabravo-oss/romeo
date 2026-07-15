import { describe, expect, it } from "vitest";
import { readEnv } from "@romeo/config";

import { createRomeoApi } from "./api";
import { InMemoryRomeoRepository } from "./repositories/in-memory";
import { EnvironmentSecretResolver } from "./services/secret-resolver";
import { SlackDataConnectorExecutor } from "./services/slack-data-connector-executor";

const slackHost = "slack.example";
const slackChannelId = "C12345ABC";
const slackSecretRef = "env://SLACK_CONNECTOR_SECRET";
const slackToken = "xoxb-secret-slack-token";

function slackEnv(overrides: Record<string, string> = {}) {
  return readEnv({
    DATA_CONNECTOR_EGRESS_POLICY: "require_allowlist",
    DATA_CONNECTOR_EXECUTION_DRIVER: "slack-fetch",
    DATA_CONNECTOR_FETCH_ALLOWED_HOSTS: slackHost,
    SECRET_RESOLVER_DRIVER: "env",
    ...overrides,
  });
}

describe("Slack data connector API", () => {
  it("syncs Slack channel messages through the opt-in Slack fetch executor", async () => {
    const fetches: Array<{ headers: HeadersInit | undefined; url: URL }> = [];
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      env: slackEnv(),
      dataConnectorExecutor: new SlackDataConnectorExecutor({
        allowedHosts: [slackHost],
        egressPolicy: "require_allowlist",
        fetchImpl: async (input, init) => {
          const url = new URL(String(input));
          fetches.push({ headers: init?.headers, url });
          expect(url.pathname).toBe("/api/conversations.history");
          expect(url.searchParams.get("channel")).toBe(slackChannelId);
          expect(url.searchParams.get("limit")).toBe("2");
          expect(url.searchParams.get("oldest")).toBe("1719500000.000100");
          expect(headerValue(init?.headers, "authorization")).toBe(
            `Bearer ${slackToken}`,
          );
          return jsonResponse({
            ok: true,
            messages: [
              {
                type: "message",
                user: "U12345",
                text: "Deploy rollback runbook from Slack &amp; safe steps.",
                ts: "1719500100.000200",
              },
            ],
          });
        },
        retryBackoffMs: 0,
        secretResolver: new EnvironmentSecretResolver({
          SLACK_CONNECTOR_SECRET: JSON.stringify({ botToken: slackToken }),
        }),
      }),
    });

    const created = await createConnector(api, {
      type: "slack",
      name: "Slack incidents",
      config: {
        apiUrl: `https://${slackHost}/api`,
        channelIds: [slackChannelId],
        maxItemsPerChannel: 2,
        oldest: "1719500000.000100",
        secretRef: slackSecretRef,
      },
    });
    const sync = await syncConnector(api, created.body.data.id);
    const queryResponse = await queryKnowledge(api, "rollback runbook");
    const auditResponse = await api.request("/api/v1/audit-logs");
    const audit = await auditResponse.json();

    expect(created.response.status).toBe(201);
    expect(created.body.data.config).toMatchObject({
      apiUrl: `https://${slackHost}/api`,
      channelIds: [slackChannelId],
      maxItemsPerChannel: 2,
      oldest: "1719500000.000100",
      secretRef: slackSecretRef,
    });
    expect(sync.response.status).toBe(202);
    expect(sync.body.data.status).toBe("completed");
    expect(sync.body.data.summary).toMatchObject({
      apiHost: slackHost,
      channelCount: 1,
      connector: "slack",
      connectorType: "slack",
      messageCount: 1,
    });
    expect(JSON.stringify(sync.body.data.summary)).not.toContain(
      slackChannelId,
    );
    expect(JSON.stringify(sync.body.data.summary)).not.toContain(slackToken);
    expect(JSON.stringify(sync.body.data.summary)).not.toContain(
      slackSecretRef,
    );
    expect(JSON.stringify(sync.body.data.summary)).not.toContain(
      "rollback runbook",
    );
    expect(queryResponse.body.data[0].content).toContain(
      "Deploy rollback runbook from Slack & safe steps.",
    );
    expect(fetches).toHaveLength(1);
    expect(JSON.stringify(audit.data)).not.toContain(slackToken);
    expect(JSON.stringify(audit.data)).not.toContain("rollback runbook");
  });

  it("fails managed Slack connector creation closed without value-capable secret resolution", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      env: slackEnv({
        MANAGED_SECRET_ENCRYPTION_KEY: "",
        SECRET_RESOLVER_DRIVER: "disabled",
      }),
    });

    const response = await api.request("/api/v1/data-connectors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        knowledgeBaseId: "kb_default",
        type: "slack",
        name: "Blocked Slack",
        config: {
          apiUrl: `https://${slackHost}/api`,
          channelIds: [slackChannelId],
          secretRef: slackSecretRef,
        },
      }),
    });
    const blocked = await response.json();
    const listResponse = await api.request("/api/v1/data-connectors");
    const list = await listResponse.json();

    expect(response.status).toBe(409);
    expect(blocked.error.code).toBe("connector_runtime_not_configured");
    expect(blocked.error.details).toMatchObject({
      type: "slack",
      blockedReasons: ["slack_credentials_not_configured"],
    });
    expect(
      list.data.some(
        (row: { name?: string; type?: string }) =>
          row.name === "Blocked Slack" || row.type === "slack",
      ),
    ).toBe(false);
    expect(JSON.stringify(blocked)).not.toContain(slackToken);
  });

  it("blocks Slack private DNS targets before fetch", async () => {
    const fetches: string[] = [];
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      env: slackEnv(),
      dataConnectorExecutor: new SlackDataConnectorExecutor({
        allowedHosts: [slackHost],
        egressPolicy: "require_allowlist",
        fetchImpl: async (input) => {
          fetches.push(String(input));
          return jsonResponse({ ok: true, messages: [] });
        },
        hostLookup: async () => [{ address: "10.42.0.15", family: 4 }],
        secretResolver: new EnvironmentSecretResolver({
          SLACK_CONNECTOR_SECRET: slackToken,
        }),
      }),
    });
    const created = await createConnector(api, {
      type: "slack",
      name: "Private DNS Slack",
      config: {
        apiUrl: `https://${slackHost}/api`,
        channelIds: [slackChannelId],
        secretRef: slackSecretRef,
      },
    });

    const syncResponse = await api.request(
      `/api/v1/data-connectors/${created.body.data.id}/sync`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    const blocked = await syncResponse.json();
    const syncsResponse = await api.request(
      `/api/v1/data-connectors/${created.body.data.id}/syncs`,
    );
    const syncs = await syncsResponse.json();

    expect(created.response.status).toBe(201);
    expect(syncResponse.status).toBe(403);
    expect(blocked.error.code).toBe("connector_private_network_host_blocked");
    expect(fetches).toEqual([]);
    expect(syncs.data[0].status).toBe("failed");
    expect(syncs.data[0].errorCode).toBe(
      "connector_private_network_host_blocked",
    );
  });
});

async function createConnector(
  api: ReturnType<typeof createRomeoApi>,
  body: {
    config: Record<string, unknown>;
    name: string;
    type: "slack";
  },
) {
  const response = await api.request("/api/v1/data-connectors", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      workspaceId: "workspace_default",
      knowledgeBaseId: "kb_default",
      ...body,
    }),
  });
  return { body: await response.json(), response };
}

async function syncConnector(
  api: ReturnType<typeof createRomeoApi>,
  connectorId: string,
) {
  const response = await api.request(
    `/api/v1/data-connectors/${connectorId}/sync`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    },
  );
  return { body: await response.json(), response };
}

async function queryKnowledge(
  api: ReturnType<typeof createRomeoApi>,
  query: string,
) {
  const response = await api.request(
    "/api/v1/knowledge-bases/kb_default/query",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query }),
    },
  );
  return { body: await response.json(), response };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function headerValue(headers: HeadersInit | undefined, key: string): string {
  if (headers === undefined) return "";
  if (headers instanceof Headers) return headers.get(key) ?? "";
  if (Array.isArray(headers)) {
    return (
      headers.find(([candidate]) => candidate.toLowerCase() === key)?.[1] ?? ""
    );
  }
  return headers[key] ?? "";
}
