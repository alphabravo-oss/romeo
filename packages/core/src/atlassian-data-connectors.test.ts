import { describe, expect, it } from "vitest";
import { readEnv } from "@romeo/config";

import { createRomeoApi } from "./api";
import { InMemoryRomeoRepository } from "./repositories/in-memory";
import { AtlassianDataConnectorExecutor } from "./services/atlassian-data-connector-executor";
import { EnvironmentSecretResolver } from "./services/secret-resolver";

const atlassianHost = "team.atlassian.example";
const atlassianSecretRef = "env://ATLASSIAN_CONNECTOR_SECRET";
const atlassianSecret = JSON.stringify({
  email: "admin@example.com",
  apiToken: "secret-atlassian-token",
});

function atlassianEnv(overrides: Record<string, string> = {}) {
  return readEnv({
    DATA_CONNECTOR_EGRESS_POLICY: "require_allowlist",
    DATA_CONNECTOR_EXECUTION_DRIVER: "atlassian-fetch",
    DATA_CONNECTOR_FETCH_ALLOWED_HOSTS: atlassianHost,
    SECRET_RESOLVER_DRIVER: "env",
    ...overrides,
  });
}

describe("Atlassian data connector API", () => {
  it("syncs Confluence and Jira through the opt-in Atlassian fetch executor", async () => {
    const confluenceCql = 'space = "OPS" and type = page';
    const jiraJql = "project = OPS and status != Done";
    const fetches: Array<{ authorization: string; url: string }> = [];
    const secretResolver = new EnvironmentSecretResolver({
      ATLASSIAN_CONNECTOR_SECRET: atlassianSecret,
    });
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      env: atlassianEnv(),
      dataConnectorExecutor: new AtlassianDataConnectorExecutor({
        allowedHosts: [atlassianHost],
        egressPolicy: "require_allowlist",
        fetchImpl: async (input, init) => {
          const url = new URL(String(input));
          const authorization = headerValue(init?.headers, "authorization");
          fetches.push({ authorization, url: url.toString() });
          if (url.pathname.endsWith("/content/search")) {
            expect(url.searchParams.get("cql")).toBe(confluenceCql);
            return jsonResponse({
              results: [
                {
                  id: "123",
                  type: "page",
                  title: "Queue Runbook",
                  body: {
                    storage: {
                      value:
                        "<p>Restart queue worker safely without leaking credentials.</p>",
                    },
                  },
                  _links: {
                    webui: "/wiki/spaces/OPS/pages/123/Queue+Runbook",
                  },
                },
              ],
            });
          }
          if (url.pathname.endsWith("/search/jql")) {
            expect(url.searchParams.get("jql")).toBe(jiraJql);
            return jsonResponse({
              issues: [
                {
                  key: "OPS-7",
                  fields: {
                    summary: "Queue lag",
                    status: { name: "Open" },
                    issuetype: { name: "Bug" },
                    priority: { name: "High" },
                    assignee: { displayName: "SRE" },
                    created: "2026-06-27T12:00:00.000+0000",
                    updated: "2026-06-28T12:00:00.000+0000",
                    description: {
                      type: "doc",
                      content: [
                        {
                          type: "paragraph",
                          content: [
                            {
                              type: "text",
                              text: "Investigate retry backlog safely.",
                            },
                          ],
                        },
                      ],
                    },
                  },
                },
              ],
            });
          }
          return jsonResponse({}, 404);
        },
        retryBackoffMs: 0,
        secretResolver,
      }),
    });

    const confluence = await createConnector(api, {
      type: "confluence",
      name: "Confluence runbooks",
      config: {
        baseUrl: `https://${atlassianHost}`,
        cql: confluenceCql,
        maxItems: 5,
        secretRef: atlassianSecretRef,
      },
    });
    const confluenceSync = await syncConnector(api, confluence.body.data.id);
    const confluenceQuery = await queryKnowledge(api, "Restart queue worker");

    const jira = await createConnector(api, {
      type: "jira",
      name: "Jira incidents",
      config: {
        baseUrl: `https://${atlassianHost}`,
        jql: jiraJql,
        maxItems: 5,
        secretRef: atlassianSecretRef,
      },
    });
    const jiraSync = await syncConnector(api, jira.body.data.id);
    const jiraQuery = await queryKnowledge(api, "retry backlog");
    const auditResponse = await api.request("/api/v1/audit-logs");
    const audit = await auditResponse.json();

    expect(confluence.response.status).toBe(201);
    expect(confluence.body.data.config).toMatchObject({
      apiPath: "/wiki/rest/api/content/search",
      baseUrl: `https://${atlassianHost}/`,
      maxItems: 5,
      secretRef: atlassianSecretRef,
    });
    expect(confluenceSync.response.status).toBe(202);
    expect(confluenceSync.body.data.status).toBe("completed");
    expect(confluenceSync.body.data.summary).toMatchObject({
      connector: "confluence",
      connectorType: "confluence",
      contentCount: 1,
      siteHost: atlassianHost,
    });
    expect(JSON.stringify(confluenceSync.body.data.summary)).not.toContain(
      confluenceCql,
    );
    expect(JSON.stringify(confluenceSync.body.data.summary)).not.toContain(
      atlassianSecret,
    );
    expect(confluenceQuery.body.data[0].content).toContain(
      "Restart queue worker safely",
    );

    expect(jira.response.status).toBe(201);
    expect(jira.body.data.config).toMatchObject({
      apiPath: "/rest/api/3/search/jql",
      baseUrl: `https://${atlassianHost}/`,
      maxItems: 5,
      secretRef: atlassianSecretRef,
    });
    expect(jiraSync.response.status).toBe(202);
    expect(jiraSync.body.data.status).toBe("completed");
    expect(jiraSync.body.data.summary).toMatchObject({
      connector: "jira",
      connectorType: "jira",
      issueCount: 1,
      siteHost: atlassianHost,
    });
    expect(JSON.stringify(jiraSync.body.data.summary)).not.toContain(jiraJql);
    expect(JSON.stringify(jiraSync.body.data.summary)).not.toContain(
      atlassianSecret,
    );
    expect(jiraQuery.body.data[0].content).toContain(
      "Investigate retry backlog safely",
    );

    expect(fetches).toHaveLength(2);
    expect(
      fetches.every((fetch) => fetch.authorization.startsWith("Basic ")),
    ).toBe(true);
    expect(JSON.stringify(audit.data)).not.toContain("secret-atlassian-token");
    expect(JSON.stringify(audit.data)).not.toContain(
      "Restart queue worker safely",
    );
    expect(JSON.stringify(audit.data)).not.toContain(
      "Investigate retry backlog safely",
    );
  });

  it("fails managed Atlassian connector creation closed without value-capable secret resolution", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      env: atlassianEnv({
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
        type: "confluence",
        name: "Blocked Confluence",
        config: {
          baseUrl: `https://${atlassianHost}`,
          cql: "type = page",
          secretRef: atlassianSecretRef,
        },
      }),
    });
    const blocked = await response.json();
    const listResponse = await api.request("/api/v1/data-connectors");
    const list = await listResponse.json();

    expect(response.status).toBe(409);
    expect(blocked.error.code).toBe("connector_runtime_not_configured");
    expect(blocked.error.details).toMatchObject({
      type: "confluence",
      blockedReasons: ["atlassian_credentials_not_configured"],
    });
    expect(
      list.data.some(
        (connector: { name?: string; type?: string }) =>
          connector.name === "Blocked Confluence" ||
          connector.type === "confluence",
      ),
    ).toBe(false);
    expect(JSON.stringify(blocked)).not.toContain("secret-atlassian-token");
  });

  it("blocks Atlassian private DNS targets before fetch", async () => {
    const fetches: string[] = [];
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      env: atlassianEnv(),
      dataConnectorExecutor: new AtlassianDataConnectorExecutor({
        allowedHosts: [atlassianHost],
        egressPolicy: "require_allowlist",
        fetchImpl: async (input) => {
          fetches.push(String(input));
          return jsonResponse({ results: [] });
        },
        hostLookup: async () => [{ address: "10.42.0.15", family: 4 }],
        secretResolver: new EnvironmentSecretResolver({
          ATLASSIAN_CONNECTOR_SECRET: atlassianSecret,
        }),
      }),
    });
    const created = await createConnector(api, {
      type: "confluence",
      name: "Private DNS Confluence",
      config: {
        baseUrl: `https://${atlassianHost}`,
        cql: "type = page",
        secretRef: atlassianSecretRef,
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
    type: "confluence" | "jira";
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
