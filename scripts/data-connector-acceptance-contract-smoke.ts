import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { readEnv } from "../packages/config/src/index";
import { createRomeoApi } from "../packages/core/src/api";
import { dataConnectorTypes } from "../packages/core/src/domain/data-connectors";
import { InMemoryRomeoRepository } from "../packages/core/src/repositories/in-memory";
import { AtlassianDataConnectorExecutor } from "../packages/core/src/services/atlassian-data-connector-executor";
import { WebsiteDataConnectorExecutor } from "../packages/core/src/services/data-connector-executors";
import { LinearDataConnectorExecutor } from "../packages/core/src/services/linear-data-connector-executor";
import { NotionDataConnectorExecutor } from "../packages/core/src/services/notion-data-connector-executor";
import { EnvironmentSecretResolver } from "../packages/core/src/services/secret-resolver";
import { SlackDataConnectorExecutor } from "../packages/core/src/services/slack-data-connector-executor";

const output = argValue("--output");
const pid = process.pid;
const rawSentinels = {
  allowedHost: `connector-acceptance-${pid}.example.com`,
  atlassianApiToken: `SECRET_ATLASSIAN_API_TOKEN_${pid}`,
  atlassianConfluenceContent: `RAW_ATLASSIAN_CONFLUENCE_CONTENT_${pid}`,
  atlassianCql: `space = "OPS_${pid}" and type = page`,
  atlassianHost: `atlassian-${pid}.example.com`,
  atlassianJiraContent: `RAW_ATLASSIAN_JIRA_CONTENT_${pid}`,
  atlassianJql: `project = OPS${pid} and status != Done`,
  atlassianSecretRef: `env://ATLASSIAN_ACCEPTANCE_SECRET_${pid}`,
  delegatedOAuthConnectionId: `delegated_oauth_connector_acceptance_${pid}`,
  delegatedOAuthSecret: `SECRET_DELEGATED_OAUTH_${pid}`,
  githubToken: `SECRET_GITHUB_CONNECTOR_TOKEN_${pid}`,
  linearApiKey: `SECRET_LINEAR_API_KEY_${pid}`,
  linearContent: `RAW_LINEAR_CONTENT_${pid}`,
  linearHost: `linear-${pid}.example.com`,
  linearQuery: `linear acceptance ${pid}`,
  linearSecretRef: `env://LINEAR_ACCEPTANCE_SECRET_${pid}`,
  notionContent: `RAW_NOTION_CONTENT_${pid}`,
  notionHost: `notion-${pid}.example.com`,
  notionQuery: `notion acceptance ${pid}`,
  notionSecretRef: `env://NOTION_ACCEPTANCE_SECRET_${pid}`,
  notionToken: `SECRET_NOTION_TOKEN_${pid}`,
  privateDnsHost: `connector-private-${pid}.example.com`,
  s3AccessKey: `SECRET_S3_ACCESS_${pid}`,
  s3Endpoint: `https://s3-connector-${pid}.internal.example`,
  s3SecretKey: `SECRET_S3_SECRET_${pid}`,
  secretRef: `vault://connectors/acceptance-${pid}`,
  slackChannelId: `C${pid}ABC`,
  slackContent: `RAW_SLACK_CONTENT_${pid}`,
  slackHost: `slack-${pid}.example.com`,
  slackSecretRef: `env://SLACK_ACCEPTANCE_SECRET_${pid}`,
  slackToken: `SECRET_SLACK_TOKEN_${pid}`,
  wildcardHost: `*.trusted-connector-${pid}.example`,
};
const atlassianSecret = JSON.stringify({
  email: `admin-${pid}@example.com`,
  apiToken: rawSentinels.atlassianApiToken,
});
const linearSecret = JSON.stringify({ apiKey: rawSentinels.linearApiKey });

const catalogApi = createRomeoApi(new InMemoryRomeoRepository(), {
  env: readEnv({
    DATA_CONNECTOR_EGRESS_POLICY: "require_allowlist",
    DATA_CONNECTOR_EXECUTION_DRIVER: "managed-fetch",
    DATA_CONNECTOR_FETCH_ALLOWED_HOSTS: `${rawSentinels.allowedHost},${rawSentinels.wildcardHost}`,
    DATA_CONNECTOR_FETCH_RETRY_ATTEMPTS: "2",
    DATA_CONNECTOR_FETCH_RETRY_BACKOFF_MS: "0",
    DATA_CONNECTOR_GITHUB_TOKEN: rawSentinels.githubToken,
    DELEGATED_OAUTH_GITHUB_CLIENT_ID: `connector-client-${pid}`,
    DELEGATED_OAUTH_GITHUB_CLIENT_SECRET: rawSentinels.delegatedOAuthSecret,
    DELEGATED_OAUTH_TOKEN_ENCRYPTION_KEY: "delegated-oauth-token-key-32-bytes",
    DEV_SEEDED_LOGIN: "true",
    MANAGED_SECRET_ENCRYPTION_KEY: "managed-secret-key-32-byte-value",
    S3_ACCESS_KEY_ID: rawSentinels.s3AccessKey,
    S3_ENDPOINT: rawSentinels.s3Endpoint,
    S3_SECRET_ACCESS_KEY: rawSentinels.s3SecretKey,
    SECRET_RESOLVER_DRIVER: "env",
  }),
});

const catalog = await requestJson<ConnectorCatalogResponse>(
  catalogApi,
  "/api/v1/data-connectors/catalog",
);
assertStatus(catalog.response, 200, "connector catalog");
assertCatalogPosture(catalog.body.data);
assertNoRawContent("connector catalog", JSON.stringify(catalog.body));

const disabledRepository = new InMemoryRomeoRepository();
const disabledApi = createRomeoApi(disabledRepository, {
  env: readEnv({ DEV_SEEDED_LOGIN: "true" }),
});
const blockedCreation = await postJson<ErrorResponse>(
  disabledApi,
  "/api/v1/data-connectors",
  {
    workspaceId: "workspace_default",
    knowledgeBaseId: "kb_default",
    type: "github",
    name: "Runtime blocked GitHub",
    config: {
      repository: "openai/romeo",
      secretRef: rawSentinels.secretRef,
    },
  },
);
assertStatus(blockedCreation.response, 409, "blocked managed creation");
assertErrorCode(
  blockedCreation.body,
  "connector_runtime_not_configured",
  "blocked managed creation",
);
assertDetails(blockedCreation.body, {
  type: "github",
  blockedReasons: ["connector_driver_not_enabled"],
});
assertNoRawContent(
  "blocked managed creation",
  JSON.stringify(blockedCreation.body),
);

const connectorListAfterBlock = await requestJson<{
  data: Array<{ name?: string; type?: string }>;
}>(disabledApi, "/api/v1/data-connectors");
if (
  connectorListAfterBlock.body.data.some(
    (connector) =>
      connector.name === "Runtime blocked GitHub" ||
      connector.type === "github",
  )
) {
  throw new Error("Runtime-blocked connector creation persisted a row.");
}

const credentialConflict = await postJson<ErrorResponse>(
  disabledApi,
  "/api/v1/data-connectors",
  {
    workspaceId: "workspace_default",
    knowledgeBaseId: "kb_default",
    type: "github",
    name: "Ambiguous GitHub",
    config: {
      repository: "openai/romeo",
      secretRef: rawSentinels.secretRef,
      delegatedOAuthConnectionId: rawSentinels.delegatedOAuthConnectionId,
    },
  },
);
assertStatus(credentialConflict.response, 400, "credential conflict");
assertErrorCode(
  credentialConflict.body,
  "invalid_connector_config",
  "credential conflict",
);
assertNoRawContent(
  "credential conflict",
  JSON.stringify(credentialConflict.body),
);

const failClosedApi = createRomeoApi(new InMemoryRomeoRepository(), {
  env: readEnv({
    DATA_CONNECTOR_EGRESS_POLICY: "require_allowlist",
    DATA_CONNECTOR_EXECUTION_DRIVER: "website-fetch",
    DEV_SEEDED_LOGIN: "true",
  }),
});
const failClosedCreation = await postJson<ErrorResponse>(
  failClosedApi,
  "/api/v1/data-connectors",
  {
    workspaceId: "workspace_default",
    knowledgeBaseId: "kb_default",
    type: "website",
    name: "Fail closed website",
    config: { url: `https://${rawSentinels.allowedHost}/guide` },
  },
);
assertStatus(
  failClosedCreation.response,
  409,
  "fail-closed allowlist creation",
);
assertErrorCode(
  failClosedCreation.body,
  "connector_runtime_not_configured",
  "fail-closed allowlist creation",
);
assertDetails(failClosedCreation.body, {
  type: "website",
  blockedReasons: ["egress_allowlist_required"],
});
assertNoRawContent(
  "fail-closed allowlist creation",
  JSON.stringify(failClosedCreation.body),
);

const localImport = await postJson<{ data: { id: string; config: unknown } }>(
  disabledApi,
  "/api/v1/data-connectors",
  {
    workspaceId: "workspace_default",
    knowledgeBaseId: "kb_default",
    type: "local_import",
    name: "Local import allowed",
    config: { ignoredRawPath: `/tmp/connector-acceptance-${pid}` },
  },
);
assertStatus(localImport.response, 201, "local import creation");
if (JSON.stringify(localImport.body.data.config) !== '{"mode":"manual"}') {
  throw new Error("Local import config did not normalize to manual mode.");
}
const localImportSync = await postJson<{
  data: { itemCount?: number; sourceIds?: string[]; status?: string };
}>(disabledApi, `/api/v1/data-connectors/${localImport.body.data.id}/sync`, {
  items: [
    {
      fileName: "acceptance.md",
      mimeType: "text/markdown",
      content: `RAW_LOCAL_IMPORT_CONNECTOR_CONTENT_${pid}`,
    },
  ],
});
assertStatus(localImportSync.response, 202, "local import sync");
if (
  localImportSync.body.data.status !== "completed" ||
  localImportSync.body.data.itemCount !== 1 ||
  localImportSync.body.data.sourceIds?.length !== 1
) {
  throw new Error("Local import sync did not complete with one source.");
}
assertNotContains(
  JSON.stringify(localImportSync.body),
  `RAW_LOCAL_IMPORT_CONNECTOR_CONTENT_${pid}`,
  "local import sync response",
);

const fetchAttempts: string[] = [];
const privateDnsApi = createRomeoApi(new InMemoryRomeoRepository(), {
  env: readEnv({
    DATA_CONNECTOR_EXECUTION_DRIVER: "website-fetch",
    DATA_CONNECTOR_FETCH_ALLOWED_HOSTS: rawSentinels.privateDnsHost,
    DEV_SEEDED_LOGIN: "true",
  }),
  dataConnectorExecutor: new WebsiteDataConnectorExecutor({
    allowedHosts: [rawSentinels.privateDnsHost],
    fetchImpl: async (input) => {
      fetchAttempts.push(String(input));
      return new Response("should not fetch", {
        headers: { "content-type": "text/plain" },
      });
    },
    hostLookup: async () => [{ address: "10.42.0.15", family: 4 }],
  }),
});
const privateDnsConnector = await postJson<{ data: { id: string } }>(
  privateDnsApi,
  "/api/v1/data-connectors",
  {
    workspaceId: "workspace_default",
    knowledgeBaseId: "kb_default",
    type: "website",
    name: "Private DNS website",
    config: { url: `https://${rawSentinels.privateDnsHost}/guide` },
  },
);
assertStatus(
  privateDnsConnector.response,
  201,
  "private DNS connector creation",
);
const privateDnsSync = await postJson<ErrorResponse>(
  privateDnsApi,
  `/api/v1/data-connectors/${privateDnsConnector.body.data.id}/sync`,
  {},
);
assertStatus(privateDnsSync.response, 403, "private DNS sync");
assertErrorCode(
  privateDnsSync.body,
  "connector_private_network_host_blocked",
  "private DNS sync",
);
if (fetchAttempts.length > 0) {
  throw new Error("Private DNS connector executed fetch before host denial.");
}
const privateDnsSyncs = await requestJson<{
  data: Array<{ errorCode?: string; status?: string; summary?: unknown }>;
}>(
  privateDnsApi,
  `/api/v1/data-connectors/${privateDnsConnector.body.data.id}/syncs`,
);
if (
  privateDnsSyncs.body.data[0]?.status !== "failed" ||
  privateDnsSyncs.body.data[0]?.errorCode !==
    "connector_private_network_host_blocked"
) {
  throw new Error("Private DNS sync failure was not persisted as metadata.");
}
assertNoRawContent(
  "private DNS sync response",
  JSON.stringify(privateDnsSync.body),
);
assertNoRawContent(
  "private DNS sync history",
  JSON.stringify(privateDnsSyncs.body),
);

const atlassianFetches: string[] = [];
const atlassianApi = createRomeoApi(new InMemoryRomeoRepository(), {
  env: readEnv({
    DATA_CONNECTOR_EGRESS_POLICY: "require_allowlist",
    DATA_CONNECTOR_EXECUTION_DRIVER: "atlassian-fetch",
    DATA_CONNECTOR_FETCH_ALLOWED_HOSTS: rawSentinels.atlassianHost,
    DEV_SEEDED_LOGIN: "true",
    SECRET_RESOLVER_DRIVER: "env",
  }),
  dataConnectorExecutor: new AtlassianDataConnectorExecutor({
    allowedHosts: [rawSentinels.atlassianHost],
    egressPolicy: "require_allowlist",
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      const authorization = headerValue(init?.headers, "authorization");
      if (!authorization.startsWith("Basic ")) {
        throw new Error("Atlassian connector did not send Basic auth.");
      }
      atlassianFetches.push(url.pathname);
      if (url.pathname.endsWith("/content/search")) {
        if (url.searchParams.get("cql") !== rawSentinels.atlassianCql) {
          throw new Error("Confluence connector did not pass bounded CQL.");
        }
        return jsonResponse({
          results: [
            {
              id: "acceptance-page",
              type: "page",
              title: "Acceptance Runbook",
              body: {
                storage: {
                  value: `<p>${rawSentinels.atlassianConfluenceContent}</p>`,
                },
              },
            },
          ],
        });
      }
      if (url.pathname.endsWith("/search/jql")) {
        if (url.searchParams.get("jql") !== rawSentinels.atlassianJql) {
          throw new Error("Jira connector did not pass bounded JQL.");
        }
        return jsonResponse({
          issues: [
            {
              key: `OPS-${pid}`,
              fields: {
                summary: "Acceptance incident",
                status: { name: "Open" },
                description: {
                  type: "doc",
                  content: [
                    {
                      type: "paragraph",
                      content: [
                        {
                          type: "text",
                          text: rawSentinels.atlassianJiraContent,
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
    secretResolver: new EnvironmentSecretResolver({
      [`ATLASSIAN_ACCEPTANCE_SECRET_${pid}`]: atlassianSecret,
    }),
  }),
});
const confluenceConnector = await postJson<{ data: { id: string } }>(
  atlassianApi,
  "/api/v1/data-connectors",
  {
    workspaceId: "workspace_default",
    knowledgeBaseId: "kb_default",
    type: "confluence",
    name: "Acceptance Confluence",
    config: {
      baseUrl: `https://${rawSentinels.atlassianHost}`,
      cql: rawSentinels.atlassianCql,
      secretRef: rawSentinels.atlassianSecretRef,
    },
  },
);
assertStatus(
  confluenceConnector.response,
  201,
  "Confluence connector creation",
);
const confluenceSync = await postJson<{
  data: { itemCount?: number; status?: string; summary?: unknown };
}>(
  atlassianApi,
  `/api/v1/data-connectors/${confluenceConnector.body.data.id}/sync`,
  {},
);
assertStatus(confluenceSync.response, 202, "Confluence connector sync");
assertAtlassianSyncSummary(
  confluenceSync.body.data,
  "confluence",
  rawSentinels.atlassianCql,
);

const jiraConnector = await postJson<{ data: { id: string } }>(
  atlassianApi,
  "/api/v1/data-connectors",
  {
    workspaceId: "workspace_default",
    knowledgeBaseId: "kb_default",
    type: "jira",
    name: "Acceptance Jira",
    config: {
      baseUrl: `https://${rawSentinels.atlassianHost}`,
      jql: rawSentinels.atlassianJql,
      secretRef: rawSentinels.atlassianSecretRef,
    },
  },
);
assertStatus(jiraConnector.response, 201, "Jira connector creation");
const jiraSync = await postJson<{
  data: { itemCount?: number; status?: string; summary?: unknown };
}>(
  atlassianApi,
  `/api/v1/data-connectors/${jiraConnector.body.data.id}/sync`,
  {},
);
assertStatus(jiraSync.response, 202, "Jira connector sync");
assertAtlassianSyncSummary(
  jiraSync.body.data,
  "jira",
  rawSentinels.atlassianJql,
);

const notionFetches: string[] = [];
const notionApi = createRomeoApi(new InMemoryRomeoRepository(), {
  env: readEnv({
    DATA_CONNECTOR_EGRESS_POLICY: "require_allowlist",
    DATA_CONNECTOR_EXECUTION_DRIVER: "notion-fetch",
    DATA_CONNECTOR_FETCH_ALLOWED_HOSTS: rawSentinels.notionHost,
    DEV_SEEDED_LOGIN: "true",
    SECRET_RESOLVER_DRIVER: "env",
  }),
  dataConnectorExecutor: new NotionDataConnectorExecutor({
    allowedHosts: [rawSentinels.notionHost],
    egressPolicy: "require_allowlist",
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      const authorization = headerValue(init?.headers, "authorization");
      if (authorization !== `Bearer ${rawSentinels.notionToken}`) {
        throw new Error("Notion connector did not send bearer auth.");
      }
      if (headerValue(init?.headers, "notion-version") !== "2026-03-11") {
        throw new Error("Notion connector did not send expected API version.");
      }
      notionFetches.push(url.pathname);
      if (url.pathname === "/v1/search") {
        const body = JSON.parse(String(init?.body)) as {
          page_size?: number;
          query?: string;
        };
        if (body.query !== rawSentinels.notionQuery || body.page_size !== 25) {
          throw new Error("Notion connector did not pass bounded search.");
        }
        return jsonResponse({
          results: [
            {
              id: "acceptance-page",
              object: "page",
              properties: {
                Name: {
                  type: "title",
                  title: [{ plain_text: "Acceptance Notion Page" }],
                },
              },
            },
          ],
        });
      }
      if (url.pathname === "/v1/blocks/acceptance-page/children") {
        return jsonResponse({
          results: [
            {
              id: "acceptance-block",
              type: "paragraph",
              paragraph: {
                rich_text: [{ plain_text: rawSentinels.notionContent }],
              },
            },
          ],
        });
      }
      return jsonResponse({}, 404);
    },
    retryBackoffMs: 0,
    secretResolver: new EnvironmentSecretResolver({
      [`NOTION_ACCEPTANCE_SECRET_${pid}`]: rawSentinels.notionToken,
    }),
  }),
});
const notionConnector = await postJson<{ data: { id: string } }>(
  notionApi,
  "/api/v1/data-connectors",
  {
    workspaceId: "workspace_default",
    knowledgeBaseId: "kb_default",
    type: "notion",
    name: "Acceptance Notion",
    config: {
      apiUrl: `https://${rawSentinels.notionHost}`,
      query: rawSentinels.notionQuery,
      secretRef: rawSentinels.notionSecretRef,
    },
  },
);
assertStatus(notionConnector.response, 201, "Notion connector creation");
const notionSync = await postJson<{
  data: { itemCount?: number; status?: string; summary?: unknown };
}>(
  notionApi,
  `/api/v1/data-connectors/${notionConnector.body.data.id}/sync`,
  {},
);
assertStatus(notionSync.response, 202, "Notion connector sync");
assertSecretRefConnectorSyncSummary(notionSync.body.data, "notion", [
  rawSentinels.notionQuery,
  rawSentinels.notionToken,
  rawSentinels.notionSecretRef,
  rawSentinels.notionContent,
]);

const linearFetches: string[] = [];
const linearApi = createRomeoApi(new InMemoryRomeoRepository(), {
  env: readEnv({
    DATA_CONNECTOR_EGRESS_POLICY: "require_allowlist",
    DATA_CONNECTOR_EXECUTION_DRIVER: "linear-fetch",
    DATA_CONNECTOR_FETCH_ALLOWED_HOSTS: rawSentinels.linearHost,
    DEV_SEEDED_LOGIN: "true",
    SECRET_RESOLVER_DRIVER: "env",
  }),
  dataConnectorExecutor: new LinearDataConnectorExecutor({
    allowedHosts: [rawSentinels.linearHost],
    egressPolicy: "require_allowlist",
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      const authorization = headerValue(init?.headers, "authorization");
      if (authorization !== rawSentinels.linearApiKey) {
        throw new Error("Linear connector did not send API key auth.");
      }
      const body = JSON.parse(String(init?.body)) as {
        query?: string;
        variables?: { first?: number };
      };
      if (
        url.pathname !== "/graphql" ||
        !body.query?.includes("RomeoLinearIssues") ||
        body.variables?.first !== 25
      ) {
        throw new Error("Linear connector did not send bounded issue query.");
      }
      linearFetches.push(url.pathname);
      return jsonResponse({
        data: {
          issues: {
            nodes: [
              {
                id: "acceptance-issue",
                identifier: `OPS-${pid}`,
                title: `Acceptance Linear issue ${rawSentinels.linearQuery}`,
                description: rawSentinels.linearContent,
                state: { name: "Open" },
                team: { key: "OPS" },
              },
            ],
          },
        },
      });
    },
    retryBackoffMs: 0,
    secretResolver: new EnvironmentSecretResolver({
      [`LINEAR_ACCEPTANCE_SECRET_${pid}`]: linearSecret,
    }),
  }),
});
const linearConnector = await postJson<{ data: { id: string } }>(
  linearApi,
  "/api/v1/data-connectors",
  {
    workspaceId: "workspace_default",
    knowledgeBaseId: "kb_default",
    type: "linear",
    name: "Acceptance Linear",
    config: {
      apiUrl: `https://${rawSentinels.linearHost}/graphql`,
      query: rawSentinels.linearQuery,
      secretRef: rawSentinels.linearSecretRef,
    },
  },
);
assertStatus(linearConnector.response, 201, "Linear connector creation");
const linearSync = await postJson<{
  data: { itemCount?: number; status?: string; summary?: unknown };
}>(
  linearApi,
  `/api/v1/data-connectors/${linearConnector.body.data.id}/sync`,
  {},
);
assertStatus(linearSync.response, 202, "Linear connector sync");
assertSecretRefConnectorSyncSummary(linearSync.body.data, "linear", [
  rawSentinels.linearQuery,
  rawSentinels.linearApiKey,
  rawSentinels.linearSecretRef,
  rawSentinels.linearContent,
]);

const slackFetches: string[] = [];
const slackApi = createRomeoApi(new InMemoryRomeoRepository(), {
  env: readEnv({
    DATA_CONNECTOR_EGRESS_POLICY: "require_allowlist",
    DATA_CONNECTOR_EXECUTION_DRIVER: "slack-fetch",
    DATA_CONNECTOR_FETCH_ALLOWED_HOSTS: rawSentinels.slackHost,
    DEV_SEEDED_LOGIN: "true",
    SECRET_RESOLVER_DRIVER: "env",
  }),
  dataConnectorExecutor: new SlackDataConnectorExecutor({
    allowedHosts: [rawSentinels.slackHost],
    egressPolicy: "require_allowlist",
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      const authorization = headerValue(init?.headers, "authorization");
      if (authorization !== `Bearer ${rawSentinels.slackToken}`) {
        throw new Error("Slack connector did not send bearer auth.");
      }
      if (
        url.pathname !== "/api/conversations.history" ||
        url.searchParams.get("channel") !== rawSentinels.slackChannelId ||
        url.searchParams.get("limit") !== "25"
      ) {
        throw new Error("Slack connector did not send bounded channel query.");
      }
      slackFetches.push(url.pathname);
      return jsonResponse({
        ok: true,
        messages: [
          {
            type: "message",
            user: `U${pid}ABC`,
            text: rawSentinels.slackContent,
            ts: "1719500100.000200",
          },
        ],
      });
    },
    retryBackoffMs: 0,
    secretResolver: new EnvironmentSecretResolver({
      [`SLACK_ACCEPTANCE_SECRET_${pid}`]: rawSentinels.slackToken,
    }),
  }),
});
const slackConnector = await postJson<{ data: { id: string } }>(
  slackApi,
  "/api/v1/data-connectors",
  {
    workspaceId: "workspace_default",
    knowledgeBaseId: "kb_default",
    type: "slack",
    name: "Acceptance Slack",
    config: {
      apiUrl: `https://${rawSentinels.slackHost}/api`,
      channelIds: [rawSentinels.slackChannelId],
      maxItemsPerChannel: 25,
      secretRef: rawSentinels.slackSecretRef,
    },
  },
);
assertStatus(slackConnector.response, 201, "Slack connector creation");
const slackSync = await postJson<{
  data: { itemCount?: number; status?: string; summary?: unknown };
}>(slackApi, `/api/v1/data-connectors/${slackConnector.body.data.id}/sync`, {});
assertStatus(slackSync.response, 202, "Slack connector sync");
assertSecretRefConnectorSyncSummary(slackSync.body.data, "slack", [
  rawSentinels.slackChannelId,
  rawSentinels.slackToken,
  rawSentinels.slackSecretRef,
  rawSentinels.slackContent,
]);

const evidence = {
  schemaVersion: "romeo.data-connector-acceptance-contract-smoke.v1",
  generatedAt: new Date().toISOString(),
  status: "passed",
  checks: [
    "catalog_covers_supported_connector_types",
    "catalog_exposes_runtime_and_credential_posture",
    "catalog_omits_allowed_hosts_endpoints_tokens_and_credentials",
    "managed_creation_fails_closed_when_driver_disabled",
    "runtime_blocked_creation_does_not_persist_connector",
    "managed_creation_fails_closed_when_required_allowlist_missing",
    "github_secret_ref_and_delegated_oauth_are_mutually_exclusive",
    "local_import_remains_available_without_outbound_runtime",
    "website_dns_private_address_denied_before_fetch",
    "atlassian_confluence_and_jira_sync_through_secret_refs",
    "notion_syncs_through_secret_ref",
    "linear_syncs_through_secret_ref",
    "slack_syncs_through_secret_ref",
    "connector_acceptance_evidence_omits_raw_config_and_content",
  ],
  endpoints: {
    catalog: "/api/v1/data-connectors/catalog",
    create: "/api/v1/data-connectors",
    sync: "/api/v1/data-connectors/{connectorId}/sync",
    syncs: "/api/v1/data-connectors/{connectorId}/syncs",
  },
  catalog: {
    connectorTypeCount: catalog.body.data.connectors.length,
    connectorTypes: connectorTypes(catalog.body.data),
    connectorTypesSha256: sha256(connectorTypes(catalog.body.data).join(",")),
    executionDriver: catalog.body.data.executionDriver,
    egressPolicy: catalog.body.data.egressPolicy,
    allowedHostRuleCount: catalog.body.data.allowedHostRuleCount,
    fetchLimits: catalog.body.data.fetchLimits,
    secretResolver: catalog.body.data.secretResolver,
    managedFetchBlockedReasonCount: blockedReasonCount(catalog.body.data),
    syncEnabledTypes: catalog.body.data.connectors
      .filter((connector) => connector.runtime.syncEnabled)
      .map((connector) => connector.type)
      .sort(),
  },
  authorizationAndRuntime: {
    blockedCreationStatus: blockedCreation.response.status,
    blockedCreationCode: blockedCreation.body.error.code,
    persistedAfterBlockedCreation: false,
    credentialConflictStatus: credentialConflict.response.status,
    credentialConflictCode: credentialConflict.body.error.code,
    failClosedAllowlistStatus: failClosedCreation.response.status,
    failClosedAllowlistCode: failClosedCreation.body.error.code,
    localImportCreationStatus: localImport.response.status,
    localImportSyncStatus: localImportSync.body.data.status,
    privateDnsCreationStatus: privateDnsConnector.response.status,
    privateDnsSyncStatus: privateDnsSync.response.status,
    privateDnsSyncCode: privateDnsSync.body.error.code,
    privateDnsFetchAttemptCount: fetchAttempts.length,
    confluenceCreationStatus: confluenceConnector.response.status,
    confluenceSyncStatus: confluenceSync.body.data.status,
    jiraCreationStatus: jiraConnector.response.status,
    jiraSyncStatus: jiraSync.body.data.status,
    atlassianFetchAttemptCount: atlassianFetches.length,
    notionCreationStatus: notionConnector.response.status,
    notionSyncStatus: notionSync.body.data.status,
    notionFetchAttemptCount: notionFetches.length,
    linearCreationStatus: linearConnector.response.status,
    linearSyncStatus: linearSync.body.data.status,
    linearFetchAttemptCount: linearFetches.length,
    slackCreationStatus: slackConnector.response.status,
    slackSyncStatus: slackSync.body.data.status,
    slackFetchAttemptCount: slackFetches.length,
  },
  redaction: {
    rawAllowedHostsReturned: false,
    rawEndpointUrlsReturned: false,
    rawAtlassianQueriesReturned: false,
    rawSecretRefsReturned: false,
    rawTokensReturned: false,
    rawConnectorContentReturned: false,
    rawConnectorConfigPersistedInEvidence: false,
  },
};

const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
assertNoRawContent("connector acceptance evidence", serialized);
assertNotContains(
  serialized,
  `RAW_LOCAL_IMPORT_CONNECTOR_CONTENT_${pid}`,
  "connector acceptance evidence",
);

if (output === undefined) process.stdout.write(serialized);
else {
  const outputPath = resolve(process.env.INIT_CWD ?? process.cwd(), output);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, serialized, "utf8");
  console.log(
    `Wrote data connector acceptance contract smoke to ${outputPath}`,
  );
}

interface ConnectorCatalogResponse {
  data: ConnectorCatalog;
}

interface ConnectorCatalog {
  allowedHostRuleCount: number;
  connectors: ConnectorCatalogItem[];
  egressPolicy: string;
  executionDriver: string;
  fetchLimits: {
    maxBytes: number;
    retryAttempts: number;
    retryBackoffMs: number;
    timeoutMs: number;
  };
  secretResolver: {
    driver: string;
    externalValueResolverConfigured: boolean;
    managedSecretConfigured: boolean;
  };
}

interface ConnectorCatalogItem {
  credentialSources: string[];
  egress: {
    privateNetworkDeniedByExecutor: boolean;
    required: boolean;
  };
  executionBoundary: string;
  implementationStatus: string;
  optionalConfigKeys: string[];
  requiredConfigKeys: string[];
  runtime: {
    blockedReasons: string[];
    credentialPosture: Record<string, boolean>;
    syncEnabled: boolean;
    warnings: string[];
  };
  securityControls: string[];
  syncMode: string;
  type: string;
}

interface ErrorResponse {
  error: {
    code: string;
    details: Record<string, unknown>;
    message: string;
    request_id: string;
  };
}

function assertCatalogPosture(catalog: ConnectorCatalog): void {
  const expectedTypes = [...dataConnectorTypes].sort();
  const actualTypes = connectorTypes(catalog);
  if (JSON.stringify(actualTypes) !== JSON.stringify(expectedTypes)) {
    throw new Error(
      `Connector catalog types mismatch: ${actualTypes.join(", ")}`,
    );
  }
  if (catalog.executionDriver !== "managed-fetch") {
    throw new Error("Expected managed-fetch catalog posture.");
  }
  if (catalog.egressPolicy !== "require_allowlist") {
    throw new Error("Expected fail-closed catalog egress posture.");
  }
  if (catalog.allowedHostRuleCount !== 2) {
    throw new Error("Expected sanitized allowed host rule count of 2.");
  }
  if (
    catalog.fetchLimits.retryAttempts !== 2 ||
    catalog.fetchLimits.retryBackoffMs !== 0 ||
    catalog.fetchLimits.maxBytes <= 0 ||
    catalog.fetchLimits.timeoutMs <= 0
  ) {
    throw new Error("Expected bounded fetch limit posture in catalog.");
  }
  if (
    catalog.secretResolver.driver !== "env" ||
    catalog.secretResolver.externalValueResolverConfigured !== true ||
    catalog.secretResolver.managedSecretConfigured !== true
  ) {
    throw new Error(
      "Expected sanitized value-capable secret resolver posture.",
    );
  }

  for (const connector of catalog.connectors) {
    if (connector.implementationStatus !== "implemented") {
      throw new Error(`Connector ${connector.type} is not marked implemented.`);
    }
    if (!connector.runtime.syncEnabled) {
      throw new Error(`Connector ${connector.type} is unexpectedly disabled.`);
    }
    if (connector.runtime.blockedReasons.length > 0) {
      throw new Error(
        `Connector ${connector.type} has unexpected blocked reasons.`,
      );
    }
    if (connector.securityControls.length === 0) {
      throw new Error(`Connector ${connector.type} lacks security controls.`);
    }
    if (!Array.isArray(connector.requiredConfigKeys)) {
      throw new Error(`Connector ${connector.type} lacks typed config keys.`);
    }
    if (!Array.isArray(connector.optionalConfigKeys)) {
      throw new Error(
        `Connector ${connector.type} lacks optional config keys.`,
      );
    }
  }

  const website = getConnector(catalog, "website");
  const rss = getConnector(catalog, "rss");
  const github = getConnector(catalog, "github");
  const s3 = getConnector(catalog, "s3");
  const confluence = getConnector(catalog, "confluence");
  const jira = getConnector(catalog, "jira");
  const notion = getConnector(catalog, "notion");
  const linear = getConnector(catalog, "linear");
  const slack = getConnector(catalog, "slack");
  for (const connector of [
    website,
    rss,
    github,
    s3,
    confluence,
    jira,
    notion,
    linear,
    slack,
  ]) {
    if (
      connector.executionBoundary !== "bounded_runtime_fetch" ||
      connector.egress.required !== true ||
      connector.egress.privateNetworkDeniedByExecutor !== true
    ) {
      throw new Error(`Connector ${connector.type} lacks egress protections.`);
    }
  }
  if (
    github.runtime.credentialPosture.deployment_secret !== true ||
    github.runtime.credentialPosture.connector_secret_ref !== true ||
    github.runtime.credentialPosture.delegated_oauth !== true
  ) {
    throw new Error(
      "Expected GitHub credential posture to be fully configured.",
    );
  }
  if (
    s3.runtime.credentialPosture.deployment_secret !== true ||
    s3.runtime.credentialPosture.connector_secret_ref !== true
  ) {
    throw new Error("Expected S3 credential posture to be fully configured.");
  }
  for (const connector of [confluence, jira, notion, linear, slack]) {
    if (
      connector.runtime.credentialPosture.deployment_secret !== false ||
      connector.runtime.credentialPosture.connector_secret_ref !== true ||
      connector.runtime.credentialPosture.delegated_oauth !== false
    ) {
      throw new Error(
        `Expected ${connector.type} credential posture to use connector secret refs only.`,
      );
    }
    if (connector.egress.allowlistSupported !== true) {
      throw new Error(
        `Expected ${connector.type} connector to support host allowlists.`,
      );
    }
  }
}

async function requestJson<T>(
  api: ReturnType<typeof createRomeoApi>,
  path: string,
): Promise<{ body: T; response: Response }> {
  const response = await api.request(path);
  return { body: (await response.json()) as T, response };
}

async function postJson<T>(
  api: ReturnType<typeof createRomeoApi>,
  path: string,
  body: unknown,
): Promise<{ body: T; response: Response }> {
  const response = await api.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { body: (await response.json()) as T, response };
}

function assertStatus(
  response: Response,
  expected: number,
  label: string,
): void {
  if (response.status !== expected) {
    throw new Error(
      `${label} returned ${response.status}; expected ${expected}.`,
    );
  }
}

function assertErrorCode(
  body: ErrorResponse,
  expected: string,
  label: string,
): void {
  if (body.error.code !== expected) {
    throw new Error(
      `${label} returned ${body.error.code}; expected ${expected}.`,
    );
  }
}

function assertDetails(
  body: ErrorResponse,
  expected: { blockedReasons: string[]; type: string },
): void {
  const details = body.error.details;
  if (details.type !== expected.type) {
    throw new Error(`Expected blocked connector type ${expected.type}.`);
  }
  if (
    JSON.stringify(details.blockedReasons) !==
    JSON.stringify(expected.blockedReasons)
  ) {
    throw new Error(
      `Expected blocked reasons ${expected.blockedReasons.join(", ")}.`,
    );
  }
}

function assertAtlassianSyncSummary(
  data: { itemCount?: number; status?: string; summary?: unknown },
  connectorType: "confluence" | "jira",
  rawQuery: string,
): void {
  if (data.status !== "completed" || data.itemCount !== 1) {
    throw new Error(`${connectorType} sync did not complete with one source.`);
  }
  const summary = JSON.stringify(data.summary);
  if (!summary.includes(`"connector":"${connectorType}"`)) {
    throw new Error(`${connectorType} sync summary lacks connector type.`);
  }
  for (const raw of [
    rawQuery,
    rawSentinels.atlassianApiToken,
    rawSentinels.atlassianSecretRef,
    rawSentinels.atlassianConfluenceContent,
    rawSentinels.atlassianJiraContent,
  ]) {
    assertNotContains(summary, raw, `${connectorType} sync summary`);
  }
}

function assertSecretRefConnectorSyncSummary(
  data: { itemCount?: number; status?: string; summary?: unknown },
  connectorType: "linear" | "notion" | "slack",
  rawValues: string[],
): void {
  if (data.status !== "completed" || data.itemCount !== 1) {
    throw new Error(`${connectorType} sync did not complete with one source.`);
  }
  const summary = JSON.stringify(data.summary);
  if (!summary.includes(`"connector":"${connectorType}"`)) {
    throw new Error(`${connectorType} sync summary lacks connector type.`);
  }
  for (const raw of rawValues) {
    assertNotContains(summary, raw, `${connectorType} sync summary`);
  }
}

function connectorTypes(catalog: ConnectorCatalog): string[] {
  return catalog.connectors.map((connector) => connector.type).sort();
}

function blockedReasonCount(catalog: ConnectorCatalog): number {
  return catalog.connectors.reduce(
    (count, connector) => count + connector.runtime.blockedReasons.length,
    0,
  );
}

function getConnector(
  catalog: ConnectorCatalog,
  type: string,
): ConnectorCatalogItem {
  const connector = catalog.connectors.find((item) => item.type === type);
  if (connector === undefined) {
    throw new Error(`Connector ${type} missing from catalog.`);
  }
  return connector;
}

function assertNoRawContent(label: string, value: string): void {
  for (const raw of Object.values(rawSentinels)) {
    assertNotContains(value, raw, label);
  }
}

function assertNotContains(value: string, raw: string, label: string): void {
  if (value.includes(raw)) throw new Error(`${label} leaked raw content.`);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
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

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}
