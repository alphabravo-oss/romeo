import { describe, expect, it } from "vitest";
import { createApiKeyToken, hashApiKey } from "@romeo/auth";
import { readEnv } from "@romeo/config";

import { createRomeoApi } from "./api";
import { listDataConnectorCatalogEntries } from "./domain/data-connector-catalog";
import { dataConnectorTypes } from "./domain/data-connectors";
import { InMemoryRomeoRepository } from "./repositories/in-memory";
import {
  S3DataConnectorExecutor,
  WebsiteDataConnectorExecutor,
} from "./services/data-connector-executors";
import { DelegatedOAuthService } from "./services/delegated-oauth-service";
import { DelegatedOAuthTokenVault } from "./services/delegated-oauth-token-vault";
import { GitHubDataConnectorExecutor } from "./services/github-data-connector-executor";
import { EnvironmentSecretResolver } from "./services/secret-resolver";

function connectorEnv(
  driver:
    | "website-fetch"
    | "github-fetch"
    | "s3-fetch"
    | "notion-fetch"
    | "linear-fetch"
    | "slack-fetch"
    | "managed-fetch",
  overrides: Record<string, string> = {},
) {
  return readEnv({ DATA_CONNECTOR_EXECUTION_DRIVER: driver, ...overrides });
}

describe("data connector API", () => {
  it("keeps the connector catalog aligned with supported connector types", () => {
    expect(
      listDataConnectorCatalogEntries()
        .map((entry) => entry.type)
        .sort(),
    ).toEqual([...dataConnectorTypes].sort());
  });

  it("exposes sanitized connector catalog runtime posture", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      env: readEnv({
        DATA_CONNECTOR_EXECUTION_DRIVER: "managed-fetch",
        DATA_CONNECTOR_EGRESS_POLICY: "require_allowlist",
        DATA_CONNECTOR_FETCH_ALLOWED_HOSTS:
          "docs.example.com,*.trusted.example",
        DATA_CONNECTOR_FETCH_RETRY_ATTEMPTS: "2",
        DATA_CONNECTOR_FETCH_RETRY_BACKOFF_MS: "0",
        DATA_CONNECTOR_GITHUB_TOKEN: "secret-github-token-value",
        DELEGATED_OAUTH_GITHUB_CLIENT_ID: "github-client-id",
        DELEGATED_OAUTH_GITHUB_CLIENT_SECRET: "secret-github-client-secret",
        DELEGATED_OAUTH_TOKEN_ENCRYPTION_KEY:
          "delegated-oauth-token-key-32-bytes",
        MANAGED_SECRET_ENCRYPTION_KEY: "managed-secret-key-32-byte-value",
        S3_ENDPOINT: "https://s3.internal.example",
        S3_ACCESS_KEY_ID: "secret-s3-access-key",
        S3_SECRET_ACCESS_KEY: "secret-s3-secret-key",
        SECRET_RESOLVER_DRIVER: "env",
      }),
    });

    const response = await api.request("/api/v1/data-connectors/catalog");
    const catalog = await response.json();
    const body = JSON.stringify(catalog);
    const website = catalog.data.connectors.find(
      (entry: { type: string }) => entry.type === "website",
    );
    const github = catalog.data.connectors.find(
      (entry: { type: string }) => entry.type === "github",
    );
    const s3 = catalog.data.connectors.find(
      (entry: { type: string }) => entry.type === "s3",
    );
    const confluence = catalog.data.connectors.find(
      (entry: { type: string }) => entry.type === "confluence",
    );
    const jira = catalog.data.connectors.find(
      (entry: { type: string }) => entry.type === "jira",
    );
    const notion = catalog.data.connectors.find(
      (entry: { type: string }) => entry.type === "notion",
    );
    const linear = catalog.data.connectors.find(
      (entry: { type: string }) => entry.type === "linear",
    );
    const slack = catalog.data.connectors.find(
      (entry: { type: string }) => entry.type === "slack",
    );

    expect(response.status).toBe(200);
    expect(catalog.data.executionDriver).toBe("managed-fetch");
    expect(catalog.data.allowedHostRuleCount).toBe(2);
    expect(catalog.data.fetchLimits).toMatchObject({
      retryAttempts: 2,
      retryBackoffMs: 0,
    });
    expect(catalog.data.secretResolver).toMatchObject({
      driver: "env",
      managedSecretConfigured: true,
      externalValueResolverConfigured: true,
    });
    expect(website.runtime.syncEnabled).toBe(true);
    expect(website.runtime.blockedReasons).toEqual([]);
    for (const connector of [
      website,
      confluence,
      jira,
      notion,
      linear,
      slack,
    ]) {
      expect(connector.runtime.syncEnabled).toBe(true);
      expect(connector.runtime.blockedReasons).toEqual([]);
      expect(connector.egress).toMatchObject({
        required: true,
        allowlistSupported: true,
        privateNetworkDeniedByExecutor: true,
      });
    }
    expect(github.runtime.credentialPosture).toMatchObject({
      deployment_secret: true,
      connector_secret_ref: true,
      delegated_oauth: true,
    });
    expect(s3.runtime.credentialPosture).toMatchObject({
      deployment_secret: true,
      connector_secret_ref: true,
    });
    expect(confluence.runtime.credentialPosture).toMatchObject({
      deployment_secret: false,
      connector_secret_ref: true,
      delegated_oauth: false,
    });
    expect(jira.runtime.credentialPosture).toMatchObject({
      deployment_secret: false,
      connector_secret_ref: true,
      delegated_oauth: false,
    });
    expect(notion.runtime.credentialPosture).toMatchObject({
      deployment_secret: false,
      connector_secret_ref: true,
      delegated_oauth: false,
    });
    expect(linear.runtime.credentialPosture).toMatchObject({
      deployment_secret: false,
      connector_secret_ref: true,
      delegated_oauth: false,
    });
    expect(slack.runtime.credentialPosture).toMatchObject({
      deployment_secret: false,
      connector_secret_ref: true,
      delegated_oauth: false,
    });
    expect(body).not.toContain("secret-github-token-value");
    expect(body).not.toContain("secret-github-client-secret");
    expect(body).not.toContain("secret-s3-access-key");
    expect(body).not.toContain("secret-s3-secret-key");
    expect(body).not.toContain("docs.example.com");
    expect(body).not.toContain("s3.internal.example");
  });

  it("creates a local import connector and syncs text into a knowledge base", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());
    const createResponse = await api.request("/api/v1/data-connectors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        knowledgeBaseId: "kb_default",
        type: "local_import",
        name: "Local docs",
        config: { ignoredRawPath: "/tmp/local-notes" },
      }),
    });
    const created = await createResponse.json();

    const syncResponse = await api.request(
      `/api/v1/data-connectors/${created.data.id}/sync`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          items: [
            {
              fileName: "connector-notes.md",
              mimeType: "text/markdown",
              content:
                "Romeo data connectors import local text through governed knowledge-base ingestion.",
            },
          ],
        }),
      },
    );
    const sync = await syncResponse.json();

    const sourcesResponse = await api.request(
      "/api/v1/knowledge-bases/kb_default/sources",
    );
    const sources = await sourcesResponse.json();
    const queryResponse = await api.request(
      "/api/v1/knowledge-bases/kb_default/query",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "governed connectors" }),
      },
    );
    const query = await queryResponse.json();
    const syncsResponse = await api.request(
      `/api/v1/data-connectors/${created.data.id}/syncs`,
    );
    const syncs = await syncsResponse.json();

    expect(createResponse.status).toBe(201);
    expect(created.data.config).toEqual({ mode: "manual" });
    expect(syncResponse.status).toBe(202);
    expect(sync.data.status).toBe("completed");
    expect(sync.data.sourceIds).toHaveLength(1);
    expect(
      sources.data.some(
        (source: { fileName: string; status: string }) =>
          source.fileName === "connector-notes.md" &&
          source.status === "indexed",
      ),
    ).toBe(true);
    expect(query.data[0].content).toContain("Romeo data connectors");
    expect(syncs.data[0].status).toBe("completed");
  });

  it("maps connector sources to the connector owner when requested", async () => {
    const repository = new InMemoryRomeoRepository();
    const adminApi = createRomeoApi(repository);
    const createResponse = await adminApi.request("/api/v1/data-connectors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        knowledgeBaseId: "kb_default",
        type: "local_import",
        name: "Owner mapped docs",
        config: { sourceAccessMode: "connector_owner" },
      }),
    });
    const created = await createResponse.json();
    const syncResponse = await adminApi.request(
      `/api/v1/data-connectors/${created.data.id}/sync`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          items: [
            {
              fileName: "owner-only.md",
              mimeType: "text/markdown",
              content:
                "Romeo connector owner-only source should not leak to other knowledge-base users.",
            },
          ],
        }),
      },
    );
    const sync = await syncResponse.json();
    const adminQueryResponse = await adminApi.request(
      "/api/v1/knowledge-bases/kb_default/query",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "owner-only source" }),
      },
    );
    const adminQuery = await adminQueryResponse.json();

    await repository.createUser({
      id: "user_reader",
      orgId: "org_default",
      email: "reader@romeo.local",
      name: "Reader User",
    });
    await repository.createResourceGrant({
      id: "grant_reader_kb_read",
      resourceType: "knowledge_base",
      resourceId: "kb_default",
      principalType: "user",
      principalId: "user_reader",
      permission: "read",
    });
    await repository.createResourceGrant({
      id: "grant_reader_kb_use",
      resourceType: "knowledge_base",
      resourceId: "kb_default",
      principalType: "user",
      principalId: "user_reader",
      permission: "use",
    });
    const token = createApiKeyToken();
    await repository.createApiKey({
      id: "api_key_reader",
      orgId: "org_default",
      userId: "user_reader",
      name: "Reader key",
      hashedToken: await hashApiKey(token),
      scopes: ["knowledge:read", "knowledge:query"],
      createdAt: new Date().toISOString(),
    });
    const readerApi = createRomeoApi(repository, {
      env: readEnv({
        DEV_SEEDED_LOGIN: "false",
        SESSION_SECRET: "prod-session-secret-32-bytes-long",
        WEBHOOK_SIGNING_KEY: "prod-webhook-signing-key-32-bytes",
      }),
    });
    const readerSourcesResponse = await readerApi.request(
      "/api/v1/knowledge-bases/kb_default/sources",
      {
        headers: { authorization: `Bearer ${token}` },
      },
    );
    const readerSources = await readerSourcesResponse.json();
    const readerQueryResponse = await readerApi.request(
      "/api/v1/knowledge-bases/kb_default/query",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ query: "owner-only source" }),
      },
    );
    const readerQuery = await readerQueryResponse.json();

    expect(createResponse.status).toBe(201);
    expect(created.data.config).toMatchObject({
      mode: "manual",
      sourceAccessMode: "connector_owner",
    });
    expect(syncResponse.status).toBe(202);
    expect(sync.data.summary.sourceAccessMode).toBe("connector_owner");
    expect(adminQuery.data[0].content).toContain("owner-only source");
    expect(readerSourcesResponse.status).toBe(200);
    expect(
      readerSources.data.some((source: { id: string }) =>
        sync.data.sourceIds.includes(source.id),
      ),
    ).toBe(false);
    expect(readerQueryResponse.status).toBe(200);
    expect(readerQuery.data).toEqual([]);
  });

  it("deletes sources superseded by the latest local connector sync", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());
    const createResponse = await api.request("/api/v1/data-connectors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        knowledgeBaseId: "kb_default",
        type: "local_import",
        name: "Rotating local docs",
      }),
    });
    const created = await createResponse.json();

    const firstSyncResponse = await api.request(
      `/api/v1/data-connectors/${created.data.id}/sync`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          items: [
            {
              fileName: "old.md",
              mimeType: "text/markdown",
              content: "Romeo old connector source should disappear.",
            },
          ],
        }),
      },
    );
    const firstSync = await firstSyncResponse.json();
    const reuseSyncResponse = await api.request(
      `/api/v1/data-connectors/${created.data.id}/sync`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          items: [
            {
              fileName: "old.md",
              mimeType: "text/markdown",
              content: "Romeo old connector source should disappear.",
            },
          ],
        }),
      },
    );
    const reuseSync = await reuseSyncResponse.json();
    const secondSyncResponse = await api.request(
      `/api/v1/data-connectors/${created.data.id}/sync`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          items: [
            {
              fileName: "new.md",
              mimeType: "text/markdown",
              content: "Romeo new connector source should remain.",
            },
          ],
        }),
      },
    );
    const secondSync = await secondSyncResponse.json();

    const sourcesResponse = await api.request(
      "/api/v1/knowledge-bases/kb_default/sources",
    );
    const sources = await sourcesResponse.json();
    const oldQueryResponse = await api.request(
      "/api/v1/knowledge-bases/kb_default/query",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "old connector source disappear" }),
      },
    );
    const oldQuery = await oldQueryResponse.json();
    const newQueryResponse = await api.request(
      "/api/v1/knowledge-bases/kb_default/query",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "new connector source remain" }),
      },
    );
    const newQuery = await newQueryResponse.json();

    expect(firstSyncResponse.status).toBe(202);
    expect(reuseSyncResponse.status).toBe(202);
    expect(reuseSync.data.sourceIds).toEqual(firstSync.data.sourceIds);
    expect(reuseSync.data.summary.createdSourceCount).toBe(0);
    expect(reuseSync.data.summary.reusedSourceCount).toBe(1);
    expect(reuseSync.data.summary.deletedSourceCount).toBe(0);
    expect(secondSyncResponse.status).toBe(202);
    expect(secondSync.data.summary.deletedSourceCount).toBe(1);
    expect(secondSync.data.summary.deletedSourceIds).toEqual(
      firstSync.data.sourceIds,
    );
    expect(
      sources.data.some(
        (source: { fileName: string }) => source.fileName === "old.md",
      ),
    ).toBe(false);
    expect(
      sources.data.some(
        (source: { fileName: string }) => source.fileName === "new.md",
      ),
    ).toBe(true);
    expect(
      oldQuery.data.every(
        (hit: { citation: { documentId: string } }) =>
          hit.citation.documentId !== firstSync.data.sourceIds[0],
      ),
    ).toBe(true);
    expect(newQuery.data[0].content).toContain("Romeo new connector");
  });

  it("blocks outbound connector creation until worker policy exists", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());
    const createResponse = await api.request("/api/v1/data-connectors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        knowledgeBaseId: "kb_default",
        type: "github",
        name: "Romeo GitHub",
        config: {
          repository: "openai/romeo",
          secretRef: "vault://connectors/github-token",
        },
      }),
    });
    const blocked = await createResponse.json();

    expect(createResponse.status).toBe(409);
    expect(blocked.error.code).toBe("connector_runtime_not_configured");
    expect(blocked.error.details).toMatchObject({
      type: "github",
      blockedReasons: ["connector_driver_not_enabled"],
    });
    expect(JSON.stringify(blocked)).not.toContain(
      "vault://connectors/github-token",
    );
  });

  it("blocks managed connector creation when fail-closed egress posture is incomplete", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      env: connectorEnv("website-fetch", {
        DATA_CONNECTOR_EGRESS_POLICY: "require_allowlist",
      }),
    });
    const createResponse = await api.request("/api/v1/data-connectors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        knowledgeBaseId: "kb_default",
        type: "website",
        name: "Fail closed docs",
        config: { url: "https://docs.example.com/guide" },
      }),
    });
    const blocked = await createResponse.json();

    expect(createResponse.status).toBe(409);
    expect(blocked.error.code).toBe("connector_runtime_not_configured");
    expect(blocked.error.details).toMatchObject({
      type: "website",
      blockedReasons: ["egress_allowlist_required"],
    });
    expect(JSON.stringify(blocked)).not.toContain("docs.example.com");
  });

  it("syncs a GitHub connector through the opt-in GitHub fetch executor", async () => {
    const fetches: Array<{ headers: HeadersInit | undefined; url: string }> =
      [];
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      env: connectorEnv("github-fetch"),
      dataConnectorExecutor: new GitHubDataConnectorExecutor({
        token: "github-token",
        fetchImpl: async (input, init) => {
          fetches.push({ url: String(input), headers: init?.headers });
          if (String(input).includes("/git/trees/main")) {
            return new Response(
              JSON.stringify({
                tree: [
                  { path: "docs/intro.md", type: "blob", size: 72 },
                  { path: "docs/private.bin", type: "blob", size: 12 },
                  { path: "src/index.ts", type: "blob", size: 20 },
                ],
                truncated: false,
              }),
              { headers: { "content-type": "application/json" } },
            );
          }
          return new Response(
            "Romeo GitHub connector imports bounded repository markdown.",
            {
              headers: {
                "content-type": "text/markdown",
                "content-length": "62",
              },
            },
          );
        },
      }),
    });
    const createResponse = await api.request("/api/v1/data-connectors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        knowledgeBaseId: "kb_default",
        type: "github",
        name: "GitHub docs",
        config: {
          repository: "openai/romeo",
          branch: "main",
          pathPrefix: "/docs/",
          maxItems: 5,
        },
      }),
    });
    const created = await createResponse.json();
    const syncResponse = await api.request(
      `/api/v1/data-connectors/${created.data.id}/sync`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    const sync = await syncResponse.json();
    const queryResponse = await api.request(
      "/api/v1/knowledge-bases/kb_default/query",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "repository markdown" }),
      },
    );
    const query = await queryResponse.json();
    const auditResponse = await api.request("/api/v1/audit-logs");
    const audit = await auditResponse.json();

    expect(createResponse.status).toBe(201);
    expect(created.data.config).toMatchObject({
      repository: "openai/romeo",
      branch: "main",
      pathPrefix: "docs",
      maxItems: 5,
    });
    expect(syncResponse.status).toBe(202);
    expect(fetches.map((fetch) => fetch.url)).toEqual([
      "https://api.github.com/repos/openai/romeo/git/trees/main?recursive=1",
      "https://api.github.com/repos/openai/romeo/contents/docs/intro.md?ref=main",
    ]);
    expect(fetches[0]?.headers).toMatchObject({
      authorization: "Bearer github-token",
    });
    expect(sync.data.summary).toMatchObject({
      connectorType: "github",
      repository: "openai/romeo",
      branch: "main",
      pathPrefix: "docs",
      fileCount: 1,
    });
    expect(JSON.stringify(sync.data.summary)).not.toContain(
      "repository markdown",
    );
    expect(JSON.stringify(sync.data.summary)).not.toContain("github-token");
    expect(query.data[0].content).toContain("Romeo GitHub connector");
    expect(JSON.stringify(audit.data)).not.toContain("github-token");
  });

  it("retries GitHub rate-limit responses without storing token material", async () => {
    const fetches: Array<{ headers: HeadersInit | undefined; url: string }> =
      [];
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      env: connectorEnv("github-fetch"),
      dataConnectorExecutor: new GitHubDataConnectorExecutor({
        token: "github-rate-limit-token",
        retryAttempts: 1,
        retryBackoffMs: 0,
        fetchImpl: async (input, init) => {
          fetches.push({ url: String(input), headers: init?.headers });
          if (
            String(input).includes("/git/trees/main") &&
            fetches.length === 1
          ) {
            return new Response(
              "rate limited token details should not persist",
              {
                status: 429,
                headers: { "retry-after": "0" },
              },
            );
          }
          if (String(input).includes("/git/trees/main")) {
            return new Response(
              JSON.stringify({
                tree: [{ path: "docs/retry.md", type: "blob", size: 70 }],
                truncated: false,
              }),
              {
                headers: { "content-type": "application/json" },
              },
            );
          }
          return new Response(
            "Romeo GitHub connector retry imports the final repository markdown.",
            {
              headers: {
                "content-type": "text/markdown",
                "content-length": "68",
              },
            },
          );
        },
      }),
    });
    const createResponse = await api.request("/api/v1/data-connectors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        knowledgeBaseId: "kb_default",
        type: "github",
        name: "GitHub retry docs",
        config: {
          repository: "openai/romeo",
          branch: "main",
          pathPrefix: "docs",
          maxItems: 5,
        },
      }),
    });
    const created = await createResponse.json();

    const syncResponse = await api.request(
      `/api/v1/data-connectors/${created.data.id}/sync`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    const sync = await syncResponse.json();
    const auditResponse = await api.request("/api/v1/audit-logs");
    const audit = await auditResponse.json();

    expect(syncResponse.status).toBe(202);
    expect(fetches.map((fetch) => fetch.url)).toEqual([
      "https://api.github.com/repos/openai/romeo/git/trees/main?recursive=1",
      "https://api.github.com/repos/openai/romeo/git/trees/main?recursive=1",
      "https://api.github.com/repos/openai/romeo/contents/docs/retry.md?ref=main",
    ]);
    expect(fetches[0]?.headers).toMatchObject({
      authorization: "Bearer github-rate-limit-token",
    });
    expect(sync.data.summary).toMatchObject({
      connectorType: "github",
      fileCount: 1,
    });
    expect(JSON.stringify(sync.data.summary)).not.toContain(
      "github-rate-limit-token",
    );
    expect(JSON.stringify(sync.data.summary)).not.toContain("rate limited");
    expect(JSON.stringify(audit.data)).not.toContain("github-rate-limit-token");
    expect(JSON.stringify(audit.data)).not.toContain("rate limited");
  });

  it("syncs a GitHub connector with a connector-managed token", async () => {
    const authHeaders: string[] = [];
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      env: connectorEnv("github-fetch"),
      dataConnectorExecutor: new GitHubDataConnectorExecutor({
        token: "deployment-github-token",
        secretResolver: new EnvironmentSecretResolver({
          GITHUB_CONNECTOR_TOKEN: "connector-github-token",
        }),
        fetchImpl: async (input, init) => {
          const authorization = (
            init?.headers as Record<string, string> | undefined
          )?.authorization;
          if (authorization !== undefined) authHeaders.push(authorization);
          if (String(input).includes("/git/trees/main")) {
            return new Response(
              JSON.stringify({
                tree: [
                  { path: "docs/managed-token.md", type: "blob", size: 48 },
                ],
                truncated: false,
              }),
              { headers: { "content-type": "application/json" } },
            );
          }
          return new Response(
            "Romeo GitHub connector uses managed token refs.",
            {
              headers: {
                "content-type": "text/markdown",
                "content-length": "50",
              },
            },
          );
        },
      }),
    });
    const createResponse = await api.request("/api/v1/data-connectors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        knowledgeBaseId: "kb_default",
        type: "github",
        name: "Managed GitHub docs",
        config: {
          repository: "openai/romeo",
          branch: "main",
          pathPrefix: "docs",
          maxItems: 5,
          secretRef: "env://GITHUB_CONNECTOR_TOKEN",
        },
      }),
    });
    const created = await createResponse.json();
    const syncResponse = await api.request(
      `/api/v1/data-connectors/${created.data.id}/sync`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    const sync = await syncResponse.json();
    const auditResponse = await api.request("/api/v1/audit-logs");
    const audit = await auditResponse.json();

    expect(createResponse.status).toBe(201);
    expect(created.data.config.secretRef).toBe("env://GITHUB_CONNECTOR_TOKEN");
    expect(syncResponse.status).toBe(202);
    expect(authHeaders).toEqual([
      "Bearer connector-github-token",
      "Bearer connector-github-token",
    ]);
    expect(JSON.stringify(sync.data.summary)).not.toContain(
      "connector-github-token",
    );
    expect(JSON.stringify(sync.data.summary)).not.toContain(
      "deployment-github-token",
    );
    expect(JSON.stringify(audit.data)).not.toContain("connector-github-token");
  });

  it("syncs a GitHub connector with a delegated OAuth connection token", async () => {
    const repository = new InMemoryRomeoRepository();
    const env = readEnv({
      DATA_CONNECTOR_EXECUTION_DRIVER: "github-fetch",
      DELEGATED_OAUTH_TOKEN_ENCRYPTION_KEY: "delegated-connector-token-key-32",
      SESSION_SECRET: "prod-session-secret-32-bytes-long",
      WEBHOOK_SIGNING_KEY: "prod-webhook-signing-key-32-bytes",
    });
    const delegatedOAuth = new DelegatedOAuthService(repository, env);
    const authHeaders: string[] = [];
    await repository.createDelegatedOAuthConnection({
      id: "delegated_oauth_connection_sync",
      orgId: "org_default",
      workspaceId: "workspace_default",
      userId: "user_dev_admin",
      providerId: "github",
      connectorType: "github",
      providerAccountId: "12345",
      providerAccountLogin: "octocat",
      scopes: ["repo"],
      status: "active",
      token: new DelegatedOAuthTokenVault(
        env.DELEGATED_OAUTH_TOKEN_ENCRYPTION_KEY,
      ).encrypt({
        accessToken: "delegated-github-token",
        tokenType: "bearer",
        scopes: ["repo"],
        obtainedAt: "2026-07-01T00:00:00.000Z",
        expiresAt: "2999-01-01T00:00:00.000Z",
      }),
      accessTokenExpiresAt: "2999-01-01T00:00:00.000Z",
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    });
    const api = createRomeoApi(repository, {
      env,
      dataConnectorExecutor: new GitHubDataConnectorExecutor({
        delegatedOAuthCredentials: delegatedOAuth,
        fetchImpl: async (input, init) => {
          const authorization = (
            init?.headers as Record<string, string> | undefined
          )?.authorization;
          if (authorization !== undefined) authHeaders.push(authorization);
          if (String(input).includes("/git/trees/main")) {
            return new Response(
              JSON.stringify({
                tree: [{ path: "docs/delegated.md", type: "blob", size: 55 }],
                truncated: false,
              }),
              { headers: { "content-type": "application/json" } },
            );
          }
          return new Response(
            "Romeo GitHub connector uses delegated OAuth tokens.",
            {
              headers: {
                "content-type": "text/markdown",
                "content-length": "55",
              },
            },
          );
        },
      }),
    });

    const createResponse = await api.request("/api/v1/data-connectors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        knowledgeBaseId: "kb_default",
        type: "github",
        name: "Delegated GitHub docs",
        config: {
          repository: "openai/romeo",
          branch: "main",
          pathPrefix: "docs",
          delegatedOAuthConnectionId: "delegated_oauth_connection_sync",
        },
      }),
    });
    const created = await createResponse.json();
    const syncResponse = await api.request(
      `/api/v1/data-connectors/${created.data.id}/sync`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    const sync = await syncResponse.json();
    const connection = await repository.getDelegatedOAuthConnection(
      "delegated_oauth_connection_sync",
    );
    const auditResponse = await api.request("/api/v1/audit-logs");
    const audit = await auditResponse.json();

    expect(createResponse.status).toBe(201);
    expect(created.data.config.delegatedOAuthConnectionId).toBe(
      "delegated_oauth_connection_sync",
    );
    expect(syncResponse.status).toBe(202);
    expect(authHeaders).toEqual([
      "Bearer delegated-github-token",
      "Bearer delegated-github-token",
    ]);
    expect(connection?.lastUsedAt).toEqual(expect.any(String));
    expect(JSON.stringify(sync.data.summary)).not.toContain(
      "delegated-github-token",
    );
    expect(JSON.stringify(audit.data)).not.toContain("delegated-github-token");
  });

  it("refreshes an expired delegated OAuth GitHub connector token before sync", async () => {
    const repository = new InMemoryRomeoRepository();
    const env = readEnv({
      DATA_CONNECTOR_EXECUTION_DRIVER: "github-fetch",
      DELEGATED_OAUTH_GITHUB_CLIENT_ID: "github-client-id",
      DELEGATED_OAUTH_GITHUB_CLIENT_SECRET: "github-client-secret",
      DELEGATED_OAUTH_TOKEN_ENCRYPTION_KEY:
        "delegated-refresh-token-key-32bytes",
      SESSION_SECRET: "prod-session-secret-32-bytes-long",
      WEBHOOK_SIGNING_KEY: "prod-webhook-signing-key-32-bytes",
    });
    const delegatedOAuth = new DelegatedOAuthService(repository, env, {
      fetchImpl: async (input, init) => {
        expect(String(input)).toBe(
          "https://github.com/login/oauth/access_token",
        );
        expect(String(init?.body)).toContain("grant_type=refresh_token");
        expect(String(init?.body)).toContain("refresh_token=old-refresh-token");
        return new Response(
          JSON.stringify({
            access_token: "refreshed-github-token",
            refresh_token: "new-refresh-token",
            token_type: "bearer",
            scope: "repo",
            expires_in: 3600,
          }),
          { headers: { "content-type": "application/json" } },
        );
      },
    });
    const vault = new DelegatedOAuthTokenVault(
      env.DELEGATED_OAUTH_TOKEN_ENCRYPTION_KEY,
    );
    await repository.createDelegatedOAuthConnection({
      id: "delegated_oauth_connection_refresh",
      orgId: "org_default",
      workspaceId: "workspace_default",
      userId: "user_dev_admin",
      providerId: "github",
      connectorType: "github",
      providerAccountId: "12345",
      scopes: ["repo"],
      status: "active",
      token: vault.encrypt({
        accessToken: "expired-github-token",
        refreshToken: "old-refresh-token",
        tokenType: "bearer",
        scopes: ["repo"],
        obtainedAt: "2026-07-01T00:00:00.000Z",
        expiresAt: "2026-07-01T00:00:01.000Z", // deliberately-expired: 1s token lifetime exercises the GitHub OAuth refresh-before-sync path
      }),
      accessTokenExpiresAt: "2026-07-01T00:00:01.000Z",
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    });
    const authHeaders: string[] = [];
    const api = createRomeoApi(repository, {
      env,
      dataConnectorExecutor: new GitHubDataConnectorExecutor({
        delegatedOAuthCredentials: delegatedOAuth,
        fetchImpl: async (input, init) => {
          const authorization = (
            init?.headers as Record<string, string> | undefined
          )?.authorization;
          if (authorization !== undefined) authHeaders.push(authorization);
          if (String(input).includes("/git/trees/main")) {
            return new Response(
              JSON.stringify({
                tree: [{ path: "docs/refresh.md", type: "blob", size: 55 }],
                truncated: false,
              }),
              {
                headers: { "content-type": "application/json" },
              },
            );
          }
          return new Response(
            "Romeo GitHub connector refreshed delegated OAuth tokens.",
            {
              headers: {
                "content-type": "text/markdown",
                "content-length": "64",
              },
            },
          );
        },
      }),
    });

    const createResponse = await api.request("/api/v1/data-connectors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        knowledgeBaseId: "kb_default",
        type: "github",
        name: "Refreshing delegated GitHub docs",
        config: {
          repository: "openai/romeo",
          delegatedOAuthConnectionId: "delegated_oauth_connection_refresh",
        },
      }),
    });
    const created = await createResponse.json();
    const syncResponse = await api.request(
      `/api/v1/data-connectors/${created.data.id}/sync`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    const sync = await syncResponse.json();
    const connection = await repository.getDelegatedOAuthConnection(
      "delegated_oauth_connection_refresh",
    );
    const refreshedToken =
      connection === undefined ? undefined : vault.decrypt(connection.token);
    const auditResponse = await api.request("/api/v1/audit-logs");
    const audit = await auditResponse.json();

    expect(syncResponse.status).toBe(202);
    expect(authHeaders).toEqual([
      "Bearer refreshed-github-token",
      "Bearer refreshed-github-token",
    ]);
    expect(connection?.status).toBe("active");
    expect(connection?.lastUsedAt).toEqual(expect.any(String));
    expect(refreshedToken?.accessToken).toBe("refreshed-github-token");
    expect(refreshedToken?.refreshToken).toBe("new-refresh-token");
    expect(JSON.stringify(sync.data.summary)).not.toContain(
      "refreshed-github-token",
    );
    expect(JSON.stringify(sync.data.summary)).not.toContain(
      "old-refresh-token",
    );
    expect(JSON.stringify(audit.data)).not.toContain("refreshed-github-token");
    expect(JSON.stringify(audit.data)).not.toContain("old-refresh-token");
  });

  it("serializes delegated OAuth connector refresh across service instances", async () => {
    const repository = new InMemoryRomeoRepository();
    const env = readEnv({
      DELEGATED_OAUTH_GITHUB_CLIENT_ID: "github-client-id",
      DELEGATED_OAUTH_GITHUB_CLIENT_SECRET: "github-client-secret",
      DELEGATED_OAUTH_TOKEN_ENCRYPTION_KEY:
        "delegated-cross-pod-token-key-32bytes",
      SESSION_SECRET: "prod-session-secret-32-bytes-long",
      WEBHOOK_SIGNING_KEY: "prod-webhook-signing-key-32-bytes",
    });
    let refreshCalls = 0;
    const fetchImpl: typeof fetch = async (input, init) => {
      refreshCalls += 1;
      expect(String(input)).toBe("https://github.com/login/oauth/access_token");
      expect(String(init?.body)).toContain(
        "refresh_token=old-cross-pod-refresh-token",
      );
      await new Promise((resolve) => setTimeout(resolve, 25));
      return new Response(
        JSON.stringify({
          access_token: "cross-pod-refreshed-github-token",
          refresh_token: "cross-pod-new-refresh-token",
          token_type: "bearer",
          scope: "repo",
          expires_in: 3600,
        }),
        { headers: { "content-type": "application/json" } },
      );
    };
    const firstService = new DelegatedOAuthService(repository, env, {
      fetchImpl,
    });
    const secondService = new DelegatedOAuthService(repository, env, {
      fetchImpl,
    });
    const vault = new DelegatedOAuthTokenVault(
      env.DELEGATED_OAUTH_TOKEN_ENCRYPTION_KEY,
    );
    await repository.createDelegatedOAuthConnection({
      id: "delegated_oauth_connection_cross_pod_refresh",
      orgId: "org_default",
      workspaceId: "workspace_default",
      userId: "user_dev_admin",
      providerId: "github",
      connectorType: "github",
      providerAccountId: "12345",
      scopes: ["repo"],
      status: "active",
      token: vault.encrypt({
        accessToken: "expired-cross-pod-github-token",
        refreshToken: "old-cross-pod-refresh-token",
        tokenType: "bearer",
        scopes: ["repo"],
        obtainedAt: "2026-07-01T00:00:00.000Z",
        expiresAt: "2026-07-01T00:00:01.000Z", // deliberately-expired: forces both concurrent getConnectorAccessToken calls onto the refresh path, so the test can prove refreshes are serialized to a single call
      }),
      accessTokenExpiresAt: "2026-07-01T00:00:01.000Z",
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    });
    const connector = await repository.createDataConnector({
      id: "data_connector_cross_pod_delegated_oauth",
      orgId: "org_default",
      workspaceId: "workspace_default",
      knowledgeBaseId: "kb_default",
      type: "github",
      name: "Cross-pod delegated GitHub docs",
      config: {
        repository: "openai/romeo",
        branch: "main",
        pathPrefix: "",
        delegatedOAuthConnectionId:
          "delegated_oauth_connection_cross_pod_refresh",
      },
      status: "active",
      createdBy: "user_dev_admin",
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    });

    const [firstToken, secondToken] = await Promise.all([
      firstService.getConnectorAccessToken({
        connectionId: "delegated_oauth_connection_cross_pod_refresh",
        connector,
      }),
      secondService.getConnectorAccessToken({
        connectionId: "delegated_oauth_connection_cross_pod_refresh",
        connector,
      }),
    ]);
    const connection = await repository.getDelegatedOAuthConnection(
      "delegated_oauth_connection_cross_pod_refresh",
    );
    const refreshedToken =
      connection === undefined ? undefined : vault.decrypt(connection.token);

    expect(firstToken).toBe("cross-pod-refreshed-github-token");
    expect(secondToken).toBe("cross-pod-refreshed-github-token");
    expect(refreshCalls).toBe(1);
    expect(refreshedToken?.accessToken).toBe(
      "cross-pod-refreshed-github-token",
    );
    expect(refreshedToken?.refreshToken).toBe("cross-pod-new-refresh-token");
  });

  it("fails GitHub connector sync closed when a delegated OAuth connection is revoked", async () => {
    const repository = new InMemoryRomeoRepository();
    const env = readEnv({
      DATA_CONNECTOR_EXECUTION_DRIVER: "github-fetch",
      DELEGATED_OAUTH_TOKEN_ENCRYPTION_KEY:
        "delegated-revoked-token-key-32bytes",
      SESSION_SECRET: "prod-session-secret-32-bytes-long",
      WEBHOOK_SIGNING_KEY: "prod-webhook-signing-key-32-bytes",
    });
    const delegatedOAuth = new DelegatedOAuthService(repository, env);
    await repository.createDelegatedOAuthConnection({
      id: "delegated_oauth_connection_revoked",
      orgId: "org_default",
      workspaceId: "workspace_default",
      userId: "user_dev_admin",
      providerId: "github",
      connectorType: "github",
      providerAccountId: "12345",
      scopes: ["repo"],
      status: "revoked",
      token: new DelegatedOAuthTokenVault(
        env.DELEGATED_OAUTH_TOKEN_ENCRYPTION_KEY,
      ).encrypt({
        accessToken: "revoked-github-token",
        tokenType: "bearer",
        scopes: ["repo"],
        obtainedAt: "2026-07-01T00:00:00.000Z",
      }),
      revokedAt: "2026-07-01T00:05:00.000Z",
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:05:00.000Z",
    });
    const api = createRomeoApi(repository, {
      env,
      dataConnectorExecutor: new GitHubDataConnectorExecutor({
        delegatedOAuthCredentials: delegatedOAuth,
        fetchImpl: async () => {
          throw new Error(
            "fetch should not run for revoked delegated OAuth connections",
          );
        },
      }),
    });
    const createResponse = await api.request("/api/v1/data-connectors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        knowledgeBaseId: "kb_default",
        type: "github",
        name: "Revoked delegated GitHub docs",
        config: {
          repository: "openai/romeo",
          delegatedOAuthConnectionId: "delegated_oauth_connection_revoked",
        },
      }),
    });
    const created = await createResponse.json();
    const syncResponse = await api.request(
      `/api/v1/data-connectors/${created.data.id}/sync`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    const sync = await syncResponse.json();
    const syncsResponse = await api.request(
      `/api/v1/data-connectors/${created.data.id}/syncs`,
    );
    const syncs = await syncsResponse.json();
    const auditResponse = await api.request("/api/v1/audit-logs");
    const audit = await auditResponse.json();

    expect(syncResponse.status).toBe(409);
    expect(sync.error.code).toBe("connector_delegated_oauth_revoked");
    expect(syncs.data[0].status).toBe("failed");
    expect(syncs.data[0].errorCode).toBe("connector_delegated_oauth_revoked");
    expect(JSON.stringify(syncs.data)).not.toContain("revoked-github-token");
    expect(JSON.stringify(audit.data)).not.toContain("revoked-github-token");
  });

  it("rejects GitHub connectors with multiple credential sources", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());
    const createResponse = await api.request("/api/v1/data-connectors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        knowledgeBaseId: "kb_default",
        type: "github",
        name: "Ambiguous GitHub docs",
        config: {
          repository: "openai/romeo",
          secretRef: "env://GITHUB_CONNECTOR_TOKEN",
          delegatedOAuthConnectionId: "delegated_oauth_connection_sync",
        },
      }),
    });
    const rejected = await createResponse.json();

    expect(createResponse.status).toBe(400);
    expect(rejected.error.code).toBe("invalid_connector_config");
  });

  it("rejects unsafe GitHub connector path prefixes", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());
    const createResponse = await api.request("/api/v1/data-connectors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        knowledgeBaseId: "kb_default",
        type: "github",
        name: "Bad GitHub docs",
        config: { repository: "openai/romeo", pathPrefix: "../secrets" },
      }),
    });
    const rejected = await createResponse.json();

    expect(createResponse.status).toBe(400);
    expect(rejected.error.code).toBe("invalid_connector_config");
  });

  it("syncs a website connector through the opt-in fetch executor", async () => {
    const fetches: string[] = [];
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      env: connectorEnv("website-fetch"),
      dataConnectorExecutor: new WebsiteDataConnectorExecutor({
        allowedHosts: ["*.example.com"],
        fetchImpl: async (input) => {
          fetches.push(String(input));
          return new Response(
            "<main>Romeo website connector sync imports governed public docs.</main>",
            {
              headers: { "content-type": "text/html; charset=utf-8" },
            },
          );
        },
      }),
    });
    const createResponse = await api.request("/api/v1/data-connectors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        knowledgeBaseId: "kb_default",
        type: "website",
        name: "Romeo docs",
        syncIntervalMinutes: 30,
        config: { url: "https://docs.example.com/guide" },
      }),
    });
    const created = await createResponse.json();

    const syncResponse = await api.request(
      `/api/v1/data-connectors/${created.data.id}/sync`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    const sync = await syncResponse.json();
    const queryResponse = await api.request(
      "/api/v1/knowledge-bases/kb_default/query",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "governed public docs" }),
      },
    );
    const query = await queryResponse.json();
    const auditResponse = await api.request("/api/v1/audit-logs");
    const audit = await auditResponse.json();
    const listResponse = await api.request(
      "/api/v1/data-connectors?workspaceId=workspace_default",
    );
    const connectors = await listResponse.json();
    const updatedConnector = connectors.data.find(
      (connector: { id: string }) => connector.id === created.data.id,
    );

    expect(createResponse.status).toBe(201);
    expect(created.data.syncIntervalMinutes).toBe(30);
    expect(created.data.nextSyncAt).toBeDefined();
    expect(syncResponse.status).toBe(202);
    expect(fetches).toEqual(["https://docs.example.com/guide"]);
    expect(sync.data.status).toBe("completed");
    expect(sync.data.itemCount).toBe(1);
    expect(sync.data.summary).toMatchObject({
      connectorType: "website",
      fetchedHost: "docs.example.com",
      fetchedPath: "/guide",
      pageCount: 1,
    });
    expect(updatedConnector.nextSyncAt).toBeDefined();
    expect(
      new Date(updatedConnector.nextSyncAt).getTime() -
        new Date(sync.data.completedAt).getTime(),
    ).toBe(30 * 60_000);
    expect(JSON.stringify(sync.data.summary)).not.toContain(
      "governed public docs",
    );
    expect(query.data[0].content).toContain("Romeo website connector");
    expect(JSON.stringify(audit.data)).not.toContain("governed public docs");
  });

  it("retries transient website connector responses before ingesting content", async () => {
    const statuses: number[] = [];
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      env: connectorEnv("website-fetch"),
      dataConnectorExecutor: new WebsiteDataConnectorExecutor({
        allowedHosts: ["docs.example.com"],
        retryAttempts: 1,
        retryBackoffMs: 0,
        fetchImpl: async () => {
          statuses.push(statuses.length === 0 ? 503 : 200);
          if (statuses.length === 1) {
            return new Response(
              "temporary unavailable details should not persist",
              {
                status: 503,
                headers: { "retry-after": "0", "content-type": "text/plain" },
              },
            );
          }
          return new Response(
            "Romeo website connector retry imports the final successful response.",
            {
              headers: { "content-type": "text/plain" },
            },
          );
        },
      }),
    });
    const createResponse = await api.request("/api/v1/data-connectors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        knowledgeBaseId: "kb_default",
        type: "website",
        name: "Retry docs",
        config: { url: "https://docs.example.com/retry" },
      }),
    });
    const created = await createResponse.json();

    const syncResponse = await api.request(
      `/api/v1/data-connectors/${created.data.id}/sync`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    const sync = await syncResponse.json();
    const queryResponse = await api.request(
      "/api/v1/knowledge-bases/kb_default/query",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "final successful response" }),
      },
    );
    const query = await queryResponse.json();

    expect(syncResponse.status).toBe(202);
    expect(statuses).toEqual([503, 200]);
    expect(sync.data.summary.fetchedByteLength).toBeGreaterThan(0);
    expect(JSON.stringify(sync.data.summary)).not.toContain(
      "temporary unavailable",
    );
    expect(query.data[0].content).toContain("final successful response");
  });

  it("blocks website connector syncs outside the configured egress allowlist before fetch", async () => {
    const fetches: string[] = [];
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      env: connectorEnv("website-fetch"),
      dataConnectorExecutor: new WebsiteDataConnectorExecutor({
        allowedHosts: ["allowed.example.com"],
        fetchImpl: async (input) => {
          fetches.push(String(input));
          return new Response("should not fetch", {
            headers: { "content-type": "text/plain" },
          });
        },
      }),
    });
    const createResponse = await api.request("/api/v1/data-connectors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        knowledgeBaseId: "kb_default",
        type: "website",
        name: "Blocked docs",
        config: { url: "https://blocked.example.com/guide" },
      }),
    });
    const created = await createResponse.json();

    const syncResponse = await api.request(
      `/api/v1/data-connectors/${created.data.id}/sync`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    const blocked = await syncResponse.json();
    const syncsResponse = await api.request(
      `/api/v1/data-connectors/${created.data.id}/syncs`,
    );
    const syncs = await syncsResponse.json();

    expect(createResponse.status).toBe(201);
    expect(syncResponse.status).toBe(403);
    expect(blocked.error.code).toBe("connector_egress_host_blocked");
    expect(fetches).toEqual([]);
    expect(syncs.data[0].status).toBe("failed");
    expect(syncs.data[0].errorCode).toBe("connector_egress_host_blocked");
  });

  it("requires website connector allowlists when egress policy is fail-closed", async () => {
    const fetches: string[] = [];
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      env: connectorEnv("website-fetch"),
      dataConnectorExecutor: new WebsiteDataConnectorExecutor({
        egressPolicy: "require_allowlist",
        fetchImpl: async (input) => {
          fetches.push(String(input));
          return new Response("should not fetch", {
            headers: { "content-type": "text/plain" },
          });
        },
      }),
    });
    const createResponse = await api.request("/api/v1/data-connectors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        knowledgeBaseId: "kb_default",
        type: "website",
        name: "Fail closed docs",
        config: { url: "https://docs.example.com/guide" },
      }),
    });
    const created = await createResponse.json();

    const syncResponse = await api.request(
      `/api/v1/data-connectors/${created.data.id}/sync`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    const blocked = await syncResponse.json();
    const syncsResponse = await api.request(
      `/api/v1/data-connectors/${created.data.id}/syncs`,
    );
    const syncs = await syncsResponse.json();

    expect(createResponse.status).toBe(201);
    expect(syncResponse.status).toBe(403);
    expect(blocked.error.code).toBe("connector_egress_allowlist_required");
    expect(fetches).toEqual([]);
    expect(syncs.data[0].status).toBe("failed");
    expect(syncs.data[0].errorCode).toBe("connector_egress_allowlist_required");
  });

  it("blocks website connector syncs whose host resolves to a private address before fetch", async () => {
    const fetches: string[] = [];
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      env: connectorEnv("website-fetch"),
      dataConnectorExecutor: new WebsiteDataConnectorExecutor({
        allowedHosts: ["docs.example.com"],
        hostLookup: async () => [{ address: "10.42.0.15", family: 4 }],
        fetchImpl: async (input) => {
          fetches.push(String(input));
          return new Response("should not fetch", {
            headers: { "content-type": "text/plain" },
          });
        },
      }),
    });
    const createResponse = await api.request("/api/v1/data-connectors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        knowledgeBaseId: "kb_default",
        type: "website",
        name: "Rebinding docs",
        config: { url: "https://docs.example.com/guide" },
      }),
    });
    const created = await createResponse.json();

    const syncResponse = await api.request(
      `/api/v1/data-connectors/${created.data.id}/sync`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    const blocked = await syncResponse.json();
    const syncsResponse = await api.request(
      `/api/v1/data-connectors/${created.data.id}/syncs`,
    );
    const syncs = await syncsResponse.json();

    expect(createResponse.status).toBe(201);
    expect(syncResponse.status).toBe(403);
    expect(blocked.error.code).toBe("connector_private_network_host_blocked");
    expect(fetches).toEqual([]);
    expect(syncs.data[0].status).toBe("failed");
    expect(syncs.data[0].errorCode).toBe(
      "connector_private_network_host_blocked",
    );
  });

  it("syncs an RSS connector through the opt-in fetch executor", async () => {
    const fetches: string[] = [];
    const feed = `<?xml version="1.0"?>
      <rss version="2.0">
        <channel>
          <title>Romeo release notes</title>
          <item>
            <title>Connector update</title>
            <link>https://docs.example.com/releases/connectors</link>
            <pubDate>Sat, 27 Jun 2026 12:00:00 GMT</pubDate>
            <description>Romeo RSS connector sync imports bounded feed entries.</description>
          </item>
        </channel>
      </rss>`;
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      env: connectorEnv("website-fetch"),
      dataConnectorExecutor: new WebsiteDataConnectorExecutor({
        fetchImpl: async (input) => {
          fetches.push(String(input));
          return new Response(feed, {
            headers: { "content-type": "application/rss+xml; charset=utf-8" },
          });
        },
      }),
    });
    const createResponse = await api.request("/api/v1/data-connectors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        knowledgeBaseId: "kb_default",
        type: "rss",
        name: "Release feed",
        config: { url: "https://docs.example.com/feed.xml", maxItems: 10 },
      }),
    });
    const created = await createResponse.json();

    const syncResponse = await api.request(
      `/api/v1/data-connectors/${created.data.id}/sync`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    const sync = await syncResponse.json();
    const queryResponse = await api.request(
      "/api/v1/knowledge-bases/kb_default/query",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "bounded feed entries" }),
      },
    );
    const query = await queryResponse.json();
    const auditResponse = await api.request("/api/v1/audit-logs");
    const audit = await auditResponse.json();

    expect(createResponse.status).toBe(201);
    expect(created.data.config).toEqual({
      url: "https://docs.example.com/feed.xml",
      maxItems: 10,
    });
    expect(syncResponse.status).toBe(202);
    expect(fetches).toEqual(["https://docs.example.com/feed.xml"]);
    expect(sync.data.summary).toMatchObject({
      connectorType: "rss",
      fetchedHost: "docs.example.com",
      fetchedPath: "/feed.xml",
      contentType: "application/rss+xml",
      feedItemCount: 1,
      pageCount: 1,
    });
    expect(JSON.stringify(sync.data.summary)).not.toContain(
      "bounded feed entries",
    );
    expect(query.data[0].content).toContain("Romeo RSS connector");
    expect(JSON.stringify(audit.data)).not.toContain("bounded feed entries");
  });

  it("syncs an S3 connector through the opt-in object reader", async () => {
    const reads: unknown[] = [];
    const secretRef = "env://S3_CONNECTOR_TOKEN";
    const objectBody = "Romeo S3 connector imports bounded text objects.";
    const objectBytes = new TextEncoder().encode(objectBody);
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      env: connectorEnv("s3-fetch", {
        S3_ENDPOINT: "https://s3.example.com",
        SECRET_RESOLVER_DRIVER: "env",
      }),
      dataConnectorExecutor: new S3DataConnectorExecutor({
        async listObjects(input) {
          reads.push({ list: input });
          return [
            {
              key: "handbook/policies/access.md",
              contentType: "text/markdown",
              sizeBytes: objectBytes.byteLength,
            },
          ];
        },
        async getObject(input) {
          reads.push({ get: input });
          return {
            body: objectBytes,
            contentType: "text/markdown",
          };
        },
      }),
    });
    const createResponse = await api.request("/api/v1/data-connectors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        knowledgeBaseId: "kb_default",
        type: "s3",
        name: "S3 handbook",
        config: {
          bucket: "romeo-docs",
          prefix: "handbook/",
          region: "us-east-1",
          maxItems: 5,
          secretRef,
        },
      }),
    });
    const created = await createResponse.json();
    const syncResponse = await api.request(
      `/api/v1/data-connectors/${created.data.id}/sync`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    const sync = await syncResponse.json();
    const queryResponse = await api.request(
      "/api/v1/knowledge-bases/kb_default/query",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "bounded text objects" }),
      },
    );
    const query = await queryResponse.json();
    const auditResponse = await api.request("/api/v1/audit-logs");
    const audit = await auditResponse.json();

    expect(createResponse.status).toBe(201);
    expect(created.data.config).toMatchObject({
      bucket: "romeo-docs",
      prefix: "handbook/",
      region: "us-east-1",
      maxItems: 5,
      secretRef,
    });
    expect(syncResponse.status).toBe(202);
    expect(reads).toEqual([
      {
        list: {
          bucket: "romeo-docs",
          prefix: "handbook/",
          region: "us-east-1",
          maxKeys: 5,
          secretRef,
        },
      },
      {
        get: {
          bucket: "romeo-docs",
          key: "handbook/policies/access.md",
          region: "us-east-1",
          secretRef,
        },
      },
    ]);
    expect(sync.data.summary).toMatchObject({
      connectorType: "s3",
      bucket: "romeo-docs",
      prefix: "handbook/",
      region: "us-east-1",
      objectCount: 1,
      totalByteLength: objectBytes.byteLength,
    });
    expect(sync.data.summary).not.toHaveProperty("secretRef");
    expect(query.data[0].content).toContain("Romeo S3 connector");
    expect(JSON.stringify(sync.data.summary)).not.toContain(
      "bounded text objects",
    );
    expect(JSON.stringify(audit.data)).not.toContain("bounded text objects");
  });

  it("rejects unsupported S3 object content without storing object bytes", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      env: connectorEnv("s3-fetch", {
        S3_ACCESS_KEY_ID: "s3-access-key",
        S3_ENDPOINT: "https://s3.example.com",
        S3_SECRET_ACCESS_KEY: "s3-secret-key",
      }),
      dataConnectorExecutor: new S3DataConnectorExecutor({
        async listObjects() {
          return [
            {
              key: "handbook/archive.bin",
              contentType: "application/octet-stream",
              sizeBytes: 4,
            },
          ];
        },
        async getObject() {
          return {
            body: new Uint8Array([1, 2, 3, 4]),
            contentType: "application/octet-stream",
          };
        },
      }),
    });
    const createResponse = await api.request("/api/v1/data-connectors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        knowledgeBaseId: "kb_default",
        type: "s3",
        name: "S3 binary",
        config: { bucket: "romeo-docs", prefix: "handbook/" },
      }),
    });
    const created = await createResponse.json();
    const syncResponse = await api.request(
      `/api/v1/data-connectors/${created.data.id}/sync`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    const blocked = await syncResponse.json();
    const syncsResponse = await api.request(
      `/api/v1/data-connectors/${created.data.id}/syncs`,
    );
    const syncs = await syncsResponse.json();

    expect(syncResponse.status).toBe(415);
    expect(blocked.error.code).toBe("connector_response_unsupported");
    expect(syncs.data[0].status).toBe("failed");
    expect(syncs.data[0].errorCode).toBe("connector_response_unsupported");
    expect(JSON.stringify(syncs.data[0])).not.toContain("archive.bin");
  });

  it("records website connector executor failures without storing response content", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      env: connectorEnv("website-fetch"),
      dataConnectorExecutor: new WebsiteDataConnectorExecutor({
        maxBytes: 10,
        fetchImpl: async () =>
          new Response(
            "Romeo response body that is too large for this connector policy.",
            {
              headers: { "content-type": "text/plain" },
            },
          ),
      }),
    });
    const createResponse = await api.request("/api/v1/data-connectors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        knowledgeBaseId: "kb_default",
        type: "website",
        name: "Large docs",
        config: { url: "https://docs.example.com/large" },
      }),
    });
    const created = await createResponse.json();
    const syncResponse = await api.request(
      `/api/v1/data-connectors/${created.data.id}/sync`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    const blocked = await syncResponse.json();
    const syncsResponse = await api.request(
      `/api/v1/data-connectors/${created.data.id}/syncs`,
    );
    const syncs = await syncsResponse.json();

    expect(syncResponse.status).toBe(413);
    expect(blocked.error.code).toBe("connector_response_too_large");
    expect(syncs.data[0].status).toBe("failed");
    expect(syncs.data[0].errorCode).toBe("connector_response_too_large");
    expect(JSON.stringify(syncs.data[0])).not.toContain("Romeo response body");
  });

  it("rejects local or private website connector targets", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());
    const response = await api.request("/api/v1/data-connectors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        knowledgeBaseId: "kb_default",
        type: "website",
        name: "Metadata endpoint",
        config: { url: "https://localhost/admin" },
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("private_network_host_blocked");
  });
});
