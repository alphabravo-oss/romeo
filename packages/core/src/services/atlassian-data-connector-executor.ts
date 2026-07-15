import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import type { DataConnector, LocalImportSyncItem } from "../domain/entities";
import { ApiError } from "../errors";
import {
  assertConnectorHostAllowed,
  type DataConnectorExecutionResult,
  type DataConnectorExecutor,
  type WebsiteConnectorEgressPolicy,
  type WebsiteConnectorHostLookup,
} from "./data-connector-executors";
import {
  retryConnectorResponse,
  type DataConnectorRetryPolicy,
} from "./data-connector-retry";
import type { SecretResolver } from "./secret-resolver";

type AtlassianConnectorType = "confluence" | "jira";

interface AtlassianConnectorConfig {
  apiPath: string;
  baseUrl: URL;
  maxItems: number;
  query: string;
  secretRef: string;
  type: AtlassianConnectorType;
}

interface AtlassianSecret {
  apiToken?: unknown;
  bearerToken?: unknown;
  email?: unknown;
  token?: unknown;
}

export class AtlassianDataConnectorExecutor implements DataConnectorExecutor {
  private readonly allowedHosts: string[];
  private readonly egressPolicy: WebsiteConnectorEgressPolicy;
  private readonly fetchImpl: typeof fetch;
  private readonly hostLookup: WebsiteConnectorHostLookup | undefined;
  private readonly maxBytes: number;
  private readonly maxItems: number;
  private readonly retryPolicy: DataConnectorRetryPolicy;
  private readonly secretResolver: SecretResolver | undefined;
  private readonly timeoutMs: number;

  constructor(
    options: {
      allowedHosts?: string[];
      egressPolicy?: WebsiteConnectorEgressPolicy;
      fetchImpl?: typeof fetch;
      hostLookup?: WebsiteConnectorHostLookup;
      maxBytes?: number;
      maxItems?: number;
      retryAttempts?: number;
      retryBackoffMs?: number;
      secretResolver?: SecretResolver;
      timeoutMs?: number;
    } = {},
  ) {
    this.allowedHosts = options.allowedHosts ?? [];
    this.egressPolicy = options.egressPolicy ?? "allow_public";
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.hostLookup = options.hostLookup;
    this.maxBytes = options.maxBytes ?? 2_000_000;
    this.maxItems = options.maxItems ?? 50;
    this.retryPolicy = {
      retryAttempts: options.retryAttempts ?? 1,
      retryBackoffMs: options.retryBackoffMs ?? 250,
    };
    this.secretResolver = options.secretResolver;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async sync(connector: DataConnector): Promise<DataConnectorExecutionResult> {
    const config = readAtlassianConfig(connector);
    await assertConnectorHostAllowed(config.baseUrl, {
      allowedHosts: this.allowedHosts,
      egressPolicy: this.egressPolicy,
      ...(this.hostLookup === undefined ? {} : { hostLookup: this.hostLookup }),
    });
    const authorization = await this.authorizationHeader(config.secretRef);
    if (config.type === "confluence")
      return this.syncConfluence(config, authorization);
    return this.syncJira(config, authorization);
  }

  private async syncConfluence(
    config: AtlassianConnectorConfig,
    authorization: string,
  ): Promise<DataConnectorExecutionResult> {
    const url = atlassianApiUrl(config);
    url.searchParams.set("cql", config.query);
    url.searchParams.set(
      "limit",
      String(Math.min(config.maxItems, this.maxItems)),
    );
    url.searchParams.set("expand", "body.storage,version");

    const payload = await this.fetchJson(
      url,
      authorization,
      "Confluence connector search failed.",
    );
    const results = arrayValue(payload, "results").slice(
      0,
      Math.min(config.maxItems, this.maxItems),
    );
    const items: LocalImportSyncItem[] = [];
    let totalBytes = 0;
    for (const item of results) {
      if (!isRecord(item)) continue;
      const id = stringValue(item.id) ?? stableHash(JSON.stringify(item));
      const title = stringValue(item.title) ?? `Confluence content ${id}`;
      const contentType = stringValue(item.type) ?? "content";
      const body = storageBody(item);
      const webui = webuiPath(item);
      const content = markdownDocument([
        `# ${title}`,
        `Type: ${contentType}`,
        webui === undefined ? undefined : `Path: ${webui}`,
        stripHtml(body),
      ]);
      const sizeBytes = new TextEncoder().encode(content).length;
      totalBytes += sizeBytes;
      items.push({
        fileName: safeFileName(`confluence-${id}-${title}.md`),
        mimeType: "text/markdown",
        content,
        sizeBytes,
      });
    }
    return {
      items,
      summary: {
        connector: "confluence",
        siteHost: config.baseUrl.hostname,
        queryHash: stableHash(config.query),
        contentCount: items.length,
        totalByteLength: totalBytes,
      },
    };
  }

  private async syncJira(
    config: AtlassianConnectorConfig,
    authorization: string,
  ): Promise<DataConnectorExecutionResult> {
    const url = atlassianApiUrl(config);
    url.searchParams.set("jql", config.query);
    url.searchParams.set(
      "maxResults",
      String(Math.min(config.maxItems, this.maxItems)),
    );
    url.searchParams.set(
      "fields",
      "summary,description,status,issuetype,priority,assignee,updated,created",
    );

    const payload = await this.fetchJson(
      url,
      authorization,
      "Jira connector search failed.",
    );
    const issues = arrayValue(payload, "issues").slice(
      0,
      Math.min(config.maxItems, this.maxItems),
    );
    const items: LocalImportSyncItem[] = [];
    let totalBytes = 0;
    for (const issue of issues) {
      if (!isRecord(issue)) continue;
      const key = stringValue(issue.key) ?? stableHash(JSON.stringify(issue));
      const fields = isRecord(issue.fields) ? issue.fields : {};
      const summary = stringValue(fields.summary) ?? `Jira issue ${key}`;
      const description = atlassianDocumentText(fields.description);
      const content = markdownDocument([
        `# ${key}: ${summary}`,
        labeledValue("Type", nestedName(fields.issuetype)),
        labeledValue("Status", nestedName(fields.status)),
        labeledValue("Priority", nestedName(fields.priority)),
        labeledValue("Assignee", nestedName(fields.assignee)),
        labeledValue("Created", stringValue(fields.created)),
        labeledValue("Updated", stringValue(fields.updated)),
        description,
      ]);
      const sizeBytes = new TextEncoder().encode(content).length;
      totalBytes += sizeBytes;
      items.push({
        fileName: safeFileName(`jira-${key}-${summary}.md`),
        mimeType: "text/markdown",
        content,
        sizeBytes,
      });
    }
    return {
      items,
      summary: {
        connector: "jira",
        siteHost: config.baseUrl.hostname,
        queryHash: stableHash(config.query),
        issueCount: items.length,
        totalByteLength: totalBytes,
      },
    };
  }

  private async authorizationHeader(secretRef: string): Promise<string> {
    if (this.secretResolver?.resolveValue === undefined) {
      throw new ApiError(
        "connector_atlassian_secret_ref_unsupported",
        "Atlassian connector secret references require a value-capable secret resolver.",
        409,
      );
    }
    const resolution = await this.secretResolver.resolveValue(secretRef);
    if (!resolution.available || resolution.value === undefined) {
      throw new ApiError(
        "connector_atlassian_secret_ref_unavailable",
        "Atlassian connector secret reference is unavailable.",
        409,
        {
          ...(resolution.failureCode === undefined
            ? {}
            : { failureCode: resolution.failureCode }),
          secretRefScheme: resolution.scheme,
        },
      );
    }
    return atlassianAuthorization(resolution.value);
  }

  private async fetchJson(
    url: URL,
    authorization: string,
    errorMessage: string,
  ): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await retryConnectorResponse(
        () =>
          this.fetchImpl(url.toString(), {
            headers: {
              accept: "application/json",
              authorization,
              "user-agent": "RomeoDataConnector/0.1",
            },
            redirect: "manual",
            signal: controller.signal,
          }),
        this.retryPolicy,
      );
    } catch {
      throw new ApiError("connector_fetch_failed", errorMessage, 502);
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok)
      throw new ApiError("connector_fetch_failed", errorMessage, 502, {
        status: response.status,
      });
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > this.maxBytes) {
      throw new ApiError(
        "connector_response_too_large",
        "Atlassian connector response exceeds the configured size limit.",
        413,
      );
    }
    const body = await response.arrayBuffer();
    if (body.byteLength > this.maxBytes)
      throw new ApiError(
        "connector_response_too_large",
        "Atlassian connector response exceeds the configured size limit.",
        413,
      );
    try {
      const parsed = JSON.parse(new TextDecoder().decode(body)) as unknown;
      if (!isRecord(parsed)) throw new Error("invalid");
      return parsed;
    } catch {
      throw new ApiError(
        "connector_fetch_failed",
        "Atlassian connector response is invalid.",
        502,
      );
    }
  }
}

function readAtlassianConfig(
  connector: DataConnector,
): AtlassianConnectorConfig {
  if (connector.type !== "confluence" && connector.type !== "jira") {
    throw new ApiError(
      "connector_execution_disabled",
      "Connector execution is disabled for this connector type.",
      409,
    );
  }
  const baseUrl = stringConfig(connector, "baseUrl");
  return {
    type: connector.type,
    baseUrl: new URL(baseUrl),
    apiPath: stringConfig(connector, "apiPath"),
    maxItems: numberConfig(connector, "maxItems", 25),
    query: stringConfig(
      connector,
      connector.type === "confluence" ? "cql" : "jql",
    ),
    secretRef: stringConfig(connector, "secretRef"),
  };
}

function atlassianApiUrl(config: AtlassianConnectorConfig): URL {
  const url = new URL(config.baseUrl.toString());
  const basePath = url.pathname.replace(/\/+$/u, "");
  url.pathname = `${basePath}${config.apiPath}`;
  url.search = "";
  url.hash = "";
  return url;
}

function atlassianAuthorization(value: string): string {
  const parsed = parseSecret(value);
  if (typeof parsed.bearerToken === "string" && parsed.bearerToken.length > 0)
    return `Bearer ${parsed.bearerToken}`;
  if (typeof parsed.token === "string" && parsed.token.length > 0)
    return `Bearer ${parsed.token}`;
  if (
    typeof parsed.email === "string" &&
    parsed.email.length > 0 &&
    typeof parsed.apiToken === "string" &&
    parsed.apiToken.length > 0
  ) {
    return `Basic ${Buffer.from(`${parsed.email}:${parsed.apiToken}`, "utf8").toString("base64")}`;
  }
  throw new ApiError(
    "connector_atlassian_secret_ref_invalid",
    "Atlassian connector secret must be JSON with email/apiToken or bearerToken.",
    400,
  );
}

function parseSecret(value: string): AtlassianSecret {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (isRecord(parsed)) return parsed;
  } catch {
    // Fall through to the stable invalid-secret error below.
  }
  throw new ApiError(
    "connector_atlassian_secret_ref_invalid",
    "Atlassian connector secret must be JSON with email/apiToken or bearerToken.",
    400,
  );
}

function stringConfig(connector: DataConnector, key: string): string {
  const value = connector.config[key];
  if (typeof value !== "string")
    throw new ApiError(
      "invalid_connector_config",
      `Atlassian connector requires ${key}.`,
      400,
    );
  return value;
}

function numberConfig(
  connector: DataConnector,
  key: string,
  fallback: number,
): number {
  const value = connector.config[key];
  return Number.isInteger(value) ? Number(value) : fallback;
}

function arrayValue(record: Record<string, unknown>, key: string): unknown[] {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

function storageBody(item: Record<string, unknown>): string {
  const body = isRecord(item.body) ? item.body : {};
  const storage = isRecord(body.storage) ? body.storage : {};
  return stringValue(storage.value) ?? "";
}

function webuiPath(item: Record<string, unknown>): string | undefined {
  const links = isRecord(item._links) ? item._links : {};
  return stringValue(links.webui);
}

function nestedName(value: unknown): string | undefined {
  return isRecord(value) ? stringValue(value.name) : undefined;
}

function labeledValue(
  label: string,
  value: string | undefined,
): string | undefined {
  return value === undefined || value.trim().length === 0
    ? undefined
    : `${label}: ${value}`;
}

function atlassianDocumentText(value: unknown): string {
  if (typeof value === "string") return value;
  const lines: string[] = [];
  collectAtlassianText(value, lines);
  return lines.join(" ").replace(/\s+/gu, " ").trim();
}

function collectAtlassianText(value: unknown, lines: string[]): void {
  if (typeof value === "string") {
    lines.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectAtlassianText(item, lines);
    return;
  }
  if (!isRecord(value)) return;
  if (typeof value.text === "string") lines.push(value.text);
  if (Array.isArray(value.content)) collectAtlassianText(value.content, lines);
}

function stripHtml(value: string): string {
  return decodeHtmlEntities(
    value
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
      .replace(/<br\s*\/?>/giu, "\n")
      .replace(/<\/(p|div|li|h[1-6]|tr)>/giu, "\n")
      .replace(/<[^>]+>/gu, " ")
      .replace(/[ \t]+/gu, " ")
      .replace(/\n\s+/gu, "\n")
      .trim(),
  );
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;/giu, "'");
}

function markdownDocument(parts: Array<string | undefined>): string {
  return parts
    .map((part) => (part === undefined ? "" : part.trim()))
    .filter((part) => part.length > 0)
    .join("\n\n");
}

function safeFileName(value: string): string {
  return (
    value.replace(/[^A-Za-z0-9._-]/gu, "_").slice(0, 140) ||
    "atlassian-source.md"
  );
}

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}
