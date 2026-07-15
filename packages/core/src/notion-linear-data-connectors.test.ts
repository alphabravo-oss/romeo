import { describe, expect, it } from "vitest";
import { readEnv } from "@romeo/config";

import { createRomeoApi } from "./api";
import { InMemoryRomeoRepository } from "./repositories/in-memory";
import { LinearDataConnectorExecutor } from "./services/linear-data-connector-executor";
import { NotionDataConnectorExecutor } from "./services/notion-data-connector-executor";
import { EnvironmentSecretResolver } from "./services/secret-resolver";

const notionHost = "api.notion.example";
const notionSecretRef = "env://NOTION_CONNECTOR_SECRET";
const notionToken = "secret-notion-token";
const linearHost = "api.linear.example";
const linearSecretRef = "env://LINEAR_CONNECTOR_SECRET";
const linearApiKey = "secret-linear-api-key";

function connectorEnv(
  driver: "notion-fetch" | "linear-fetch",
  host: string,
  overrides: Record<string, string> = {},
) {
  return readEnv({
    DATA_CONNECTOR_EGRESS_POLICY: "require_allowlist",
    DATA_CONNECTOR_EXECUTION_DRIVER: driver,
    DATA_CONNECTOR_FETCH_ALLOWED_HOSTS: host,
    SECRET_RESOLVER_DRIVER: "env",
    ...overrides,
  });
}

describe("Notion and Linear data connector API", () => {
  it("syncs Notion pages through the opt-in Notion fetch executor", async () => {
    const fetches: Array<{
      body?: unknown;
      headers: HeadersInit | undefined;
      url: URL;
    }> = [];
    const query = "incident runbook";
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      env: connectorEnv("notion-fetch", notionHost),
      dataConnectorExecutor: new NotionDataConnectorExecutor({
        allowedHosts: [notionHost],
        egressPolicy: "require_allowlist",
        fetchImpl: async (input, init) => {
          const url = new URL(String(input));
          fetches.push({
            body:
              typeof init?.body === "string"
                ? (JSON.parse(init.body) as unknown)
                : undefined,
            headers: init?.headers,
            url,
          });
          expect(headerValue(init?.headers, "authorization")).toBe(
            `Bearer ${notionToken}`,
          );
          expect(headerValue(init?.headers, "notion-version")).toBe(
            "2026-03-11",
          );
          if (url.pathname === "/v1/search") {
            expect(init?.method).toBe("POST");
            expect(JSON.parse(String(init?.body))).toMatchObject({
              filter: { property: "object", value: "page" },
              page_size: 3,
              query,
            });
            return jsonResponse({
              results: [
                {
                  id: "page-1",
                  object: "page",
                  url: "https://notion.so/page-1",
                  created_time: "2026-06-27T12:00:00.000Z",
                  last_edited_time: "2026-06-28T12:00:00.000Z",
                  properties: {
                    Name: {
                      type: "title",
                      title: [{ plain_text: "Incident Runbook" }],
                    },
                  },
                },
              ],
            });
          }
          if (url.pathname === "/v1/blocks/page-1/children") {
            expect(init?.method).toBe("GET");
            expect(url.searchParams.get("page_size")).toBe("5");
            return jsonResponse({
              results: [
                {
                  id: "block-1",
                  type: "paragraph",
                  paragraph: {
                    rich_text: [
                      {
                        plain_text:
                          "Restart service safely from Notion without exposing credentials.",
                      },
                    ],
                  },
                },
              ],
            });
          }
          return jsonResponse({}, 404);
        },
        retryBackoffMs: 0,
        secretResolver: new EnvironmentSecretResolver({
          NOTION_CONNECTOR_SECRET: notionToken,
        }),
      }),
    });

    const created = await createConnector(api, {
      type: "notion",
      name: "Notion runbooks",
      config: {
        apiUrl: `https://${notionHost}`,
        query,
        maxItems: 3,
        maxBlocksPerPage: 5,
        secretRef: notionSecretRef,
      },
    });
    const sync = await syncConnector(api, created.body.data.id);
    const queryResponse = await queryKnowledge(api, "Restart service safely");
    const auditResponse = await api.request("/api/v1/audit-logs");
    const audit = await auditResponse.json();

    expect(created.response.status).toBe(201);
    expect(created.body.data.config).toMatchObject({
      apiUrl: `https://${notionHost}/`,
      apiVersion: "2026-03-11",
      maxBlocksPerPage: 5,
      maxItems: 3,
      query,
      secretRef: notionSecretRef,
    });
    expect(sync.response.status).toBe(202);
    expect(sync.body.data.status).toBe("completed");
    expect(sync.body.data.summary).toMatchObject({
      apiHost: notionHost,
      blockCount: 1,
      connector: "notion",
      connectorType: "notion",
      pageCount: 1,
    });
    expect(JSON.stringify(sync.body.data.summary)).not.toContain(query);
    expect(JSON.stringify(sync.body.data.summary)).not.toContain(notionToken);
    expect(JSON.stringify(sync.body.data.summary)).not.toContain(
      notionSecretRef,
    );
    expect(JSON.stringify(sync.body.data.summary)).not.toContain(
      "Restart service safely",
    );
    expect(queryResponse.body.data[0].content).toContain(
      "Restart service safely from Notion",
    );
    expect(fetches.map((fetch) => fetch.url.pathname)).toEqual([
      "/v1/search",
      "/v1/blocks/page-1/children",
    ]);
    expect(JSON.stringify(audit.data)).not.toContain(notionToken);
    expect(JSON.stringify(audit.data)).not.toContain("Restart service safely");
  });

  it("syncs Linear issues through the opt-in Linear fetch executor", async () => {
    const fetches: Array<{
      body: unknown;
      headers: HeadersInit | undefined;
      url: URL;
    }> = [];
    const query = "retry";
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      env: connectorEnv("linear-fetch", linearHost),
      dataConnectorExecutor: new LinearDataConnectorExecutor({
        allowedHosts: [linearHost],
        egressPolicy: "require_allowlist",
        fetchImpl: async (input, init) => {
          const url = new URL(String(input));
          const body = JSON.parse(String(init?.body)) as {
            query?: string;
            variables?: { first?: number };
          };
          fetches.push({ body, headers: init?.headers, url });
          expect(url.pathname).toBe("/graphql");
          expect(init?.method).toBe("POST");
          expect(headerValue(init?.headers, "authorization")).toBe(
            linearApiKey,
          );
          expect(body.query).toContain("RomeoLinearIssues");
          expect(body.variables?.first).toBe(10);
          return jsonResponse({
            data: {
              issues: {
                nodes: [
                  {
                    id: "issue-1",
                    identifier: "OPS-1",
                    title: "Retry backlog",
                    description:
                      "Investigate retry backlog safely without leaking secrets.",
                    url: "https://linear.app/acme/issue/OPS-1",
                    priority: 1,
                    createdAt: "2026-06-27T12:00:00.000Z",
                    updatedAt: "2026-06-28T12:00:00.000Z",
                    state: { name: "Open" },
                    team: { key: "OPS", name: "Operations" },
                    assignee: { name: "SRE" },
                    labels: { nodes: [{ name: "Incident" }] },
                  },
                  {
                    id: "issue-2",
                    identifier: "OPS-2",
                    title: "Unrelated",
                    description: "This issue should be filtered out.",
                  },
                ],
              },
            },
          });
        },
        retryBackoffMs: 0,
        secretResolver: new EnvironmentSecretResolver({
          LINEAR_CONNECTOR_SECRET: JSON.stringify({ apiKey: linearApiKey }),
        }),
      }),
    });

    const created = await createConnector(api, {
      type: "linear",
      name: "Linear incidents",
      config: {
        apiUrl: `https://${linearHost}/graphql`,
        query,
        maxItems: 10,
        secretRef: linearSecretRef,
      },
    });
    const sync = await syncConnector(api, created.body.data.id);
    const queryResponse = await queryKnowledge(api, "retry backlog safely");
    const auditResponse = await api.request("/api/v1/audit-logs");
    const audit = await auditResponse.json();

    expect(created.response.status).toBe(201);
    expect(created.body.data.config).toMatchObject({
      apiUrl: `https://${linearHost}/graphql`,
      maxItems: 10,
      query,
      secretRef: linearSecretRef,
    });
    expect(sync.response.status).toBe(202);
    expect(sync.body.data.status).toBe("completed");
    expect(sync.body.data.summary).toMatchObject({
      apiHost: linearHost,
      connector: "linear",
      connectorType: "linear",
      issueCount: 1,
    });
    expect(sync.body.data.itemCount).toBe(1);
    expect(JSON.stringify(sync.body.data.summary)).not.toContain(query);
    expect(JSON.stringify(sync.body.data.summary)).not.toContain(linearApiKey);
    expect(JSON.stringify(sync.body.data.summary)).not.toContain(
      linearSecretRef,
    );
    expect(JSON.stringify(sync.body.data.summary)).not.toContain(
      "retry backlog safely",
    );
    expect(queryResponse.body.data[0].content).toContain(
      "Investigate retry backlog safely",
    );
    expect(fetches).toHaveLength(1);
    expect(JSON.stringify(audit.data)).not.toContain(linearApiKey);
    expect(JSON.stringify(audit.data)).not.toContain("retry backlog safely");
  });

  it("fails managed Notion and Linear connector creation closed without value-capable secret resolution", async () => {
    for (const connector of [
      {
        blockedReason: "notion_credentials_not_configured",
        config: {
          apiUrl: `https://${notionHost}`,
          query: "incident runbook",
          secretRef: notionSecretRef,
        },
        driver: "notion-fetch" as const,
        host: notionHost,
        name: "Blocked Notion",
        secret: notionToken,
        type: "notion" as const,
      },
      {
        blockedReason: "linear_credentials_not_configured",
        config: {
          apiUrl: `https://${linearHost}/graphql`,
          secretRef: linearSecretRef,
        },
        driver: "linear-fetch" as const,
        host: linearHost,
        name: "Blocked Linear",
        secret: linearApiKey,
        type: "linear" as const,
      },
    ]) {
      const api = createRomeoApi(new InMemoryRomeoRepository(), {
        env: connectorEnv(connector.driver, connector.host, {
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
          type: connector.type,
          name: connector.name,
          config: connector.config,
        }),
      });
      const blocked = await response.json();
      const listResponse = await api.request("/api/v1/data-connectors");
      const list = await listResponse.json();

      expect(response.status).toBe(409);
      expect(blocked.error.code).toBe("connector_runtime_not_configured");
      expect(blocked.error.details).toMatchObject({
        type: connector.type,
        blockedReasons: [connector.blockedReason],
      });
      expect(
        list.data.some(
          (row: { name?: string; type?: string }) =>
            row.name === connector.name || row.type === connector.type,
        ),
      ).toBe(false);
      expect(JSON.stringify(blocked)).not.toContain(connector.secret);
    }
  });

  it("blocks Notion private DNS targets before fetch", async () => {
    const fetches: string[] = [];
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      env: connectorEnv("notion-fetch", notionHost),
      dataConnectorExecutor: new NotionDataConnectorExecutor({
        allowedHosts: [notionHost],
        egressPolicy: "require_allowlist",
        fetchImpl: async (input) => {
          fetches.push(String(input));
          return jsonResponse({ results: [] });
        },
        hostLookup: async () => [{ address: "10.42.0.15", family: 4 }],
        secretResolver: new EnvironmentSecretResolver({
          NOTION_CONNECTOR_SECRET: notionToken,
        }),
      }),
    });
    const created = await createConnector(api, {
      type: "notion",
      name: "Private DNS Notion",
      config: {
        apiUrl: `https://${notionHost}`,
        query: "incident runbook",
        secretRef: notionSecretRef,
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
    type: "notion" | "linear";
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
