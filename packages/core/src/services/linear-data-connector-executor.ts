import { IssuesQuery, type Issue, type LinearRequest } from "@linear/sdk";
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

interface LinearConnectorConfig {
  apiUrl: URL;
  maxItems: number;
  query?: string;
  secretRef: string;
}

interface LinearSecret {
  accessToken?: unknown;
  apiKey?: unknown;
  bearerToken?: unknown;
  token?: unknown;
}

export class LinearDataConnectorExecutor implements DataConnectorExecutor {
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
    if (connector.type !== "linear") {
      throw new ApiError(
        "connector_execution_disabled",
        "Connector execution is disabled for this connector type.",
        409,
      );
    }
    const config = readLinearConfig(connector);
    await assertConnectorHostAllowed(config.apiUrl, {
      allowedHosts: this.allowedHosts,
      egressPolicy: this.egressPolicy,
      ...(this.hostLookup === undefined ? {} : { hostLookup: this.hostLookup }),
    });
    const authorization = await this.authorizationHeader(config.secretRef);
    const maxItems = Math.min(config.maxItems, this.maxItems);
    const request: LinearRequest = (document, variables) =>
      this.fetchGraphql(config, authorization, document, variables);
    const connection = await new IssuesQuery(request).fetch({
      first: maxItems,
    });
    const issues = connection.nodes
      .filter((issue) => linearIssueMatches(issue, config.query))
      .slice(0, maxItems);
    const items: LocalImportSyncItem[] = [];
    let totalBytes = 0;
    for (const issue of issues) {
      const id = issue.id || stableHash(JSON.stringify(issue));
      const identifier = issue.identifier || id;
      const title = issue.title || `Linear issue ${identifier}`;
      const content = markdownDocument([
        `# ${identifier}: ${title}`,
        labeledValue("URL", issue.url),
        labeledValue("Priority", String(issue.priority)),
        labeledValue("Created", issue.createdAt.toISOString()),
        labeledValue("Updated", issue.updatedAt.toISOString()),
        labeledValue("Archived", issue.archivedAt?.toISOString()),
        issue.description ?? undefined,
      ]);
      const sizeBytes = new TextEncoder().encode(content).length;
      if (sizeBytes > this.maxBytes) {
        throw new ApiError(
          "connector_response_too_large",
          "Linear connector response exceeds the configured size limit.",
          413,
        );
      }
      totalBytes += sizeBytes;
      items.push({
        fileName: safeFileName(`linear-${identifier}-${title}.md`),
        mimeType: "text/markdown",
        content,
        sizeBytes,
      });
    }
    return {
      items,
      summary: {
        connector: "linear",
        apiHost: config.apiUrl.hostname,
        ...(config.query === undefined
          ? {}
          : { queryHash: stableHash(config.query) }),
        issueCount: items.length,
        totalByteLength: totalBytes,
      },
    };
  }

  private async authorizationHeader(secretRef: string): Promise<string> {
    if (this.secretResolver?.resolveValue === undefined) {
      throw new ApiError(
        "connector_linear_secret_ref_unsupported",
        "Linear connector secret references require a value-capable secret resolver.",
        409,
      );
    }
    const resolution = await this.secretResolver.resolveValue(secretRef);
    if (!resolution.available || resolution.value === undefined) {
      throw new ApiError(
        "connector_linear_secret_ref_unavailable",
        "Linear connector secret reference is unavailable.",
        409,
        {
          ...(resolution.failureCode === undefined
            ? {}
            : { failureCode: resolution.failureCode }),
          secretRefScheme: resolution.scheme,
        },
      );
    }
    return linearAuthorization(resolution.value);
  }

  private async fetchGraphql<Result, Variables extends Record<string, unknown>>(
    config: LinearConnectorConfig,
    authorization: string,
    document: string,
    variables?: Variables,
  ): Promise<Result> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: globalThis.Response;
    try {
      response = await retryConnectorResponse(
        () =>
          this.fetchImpl(config.apiUrl.toString(), {
            body: JSON.stringify({
              query: document,
              variables,
            }),
            headers: {
              accept: "application/json",
              authorization,
              "content-type": "application/json",
              "user-agent": "RomeoDataConnector/0.1",
            },
            method: "POST",
            redirect: "manual",
            signal: controller.signal,
          }),
        this.retryPolicy,
      );
    } catch {
      throw new ApiError(
        "connector_fetch_failed",
        "Linear connector issue query failed.",
        502,
      );
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok)
      throw new ApiError(
        "connector_fetch_failed",
        "Linear connector issue query failed.",
        502,
        { status: response.status },
      );
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > this.maxBytes) {
      throw new ApiError(
        "connector_response_too_large",
        "Linear connector response exceeds the configured size limit.",
        413,
      );
    }
    const responseBody = await response.arrayBuffer();
    if (responseBody.byteLength > this.maxBytes) {
      throw new ApiError(
        "connector_response_too_large",
        "Linear connector response exceeds the configured size limit.",
        413,
      );
    }
    try {
      const parsed = JSON.parse(new TextDecoder().decode(responseBody));
      if (!isRecord(parsed)) throw new Error("invalid");
      if (Array.isArray(parsed.errors) && parsed.errors.length > 0) {
        throw new ApiError(
          "connector_fetch_failed",
          "Linear connector issue query returned GraphQL errors.",
          502,
          { errorCount: parsed.errors.length },
        );
      }
      return parsed.data as Result;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        "connector_fetch_failed",
        "Linear connector response is invalid.",
        502,
      );
    }
  }
}

function readLinearConfig(connector: DataConnector): LinearConnectorConfig {
  const query = connector.config.query;
  return {
    apiUrl: new URL(stringConfig(connector, "apiUrl")),
    maxItems: numberConfig(connector, "maxItems", 25),
    ...(typeof query === "string" && query.trim().length > 0
      ? { query: query.trim() }
      : {}),
    secretRef: stringConfig(connector, "secretRef"),
  };
}

function linearAuthorization(value: string): string {
  const trimmed = value.trim();
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (isRecord(parsed)) {
      const apiKey = parsed.apiKey;
      if (typeof apiKey === "string" && apiKey.trim().length > 0) {
        return apiKey.trim();
      }
      for (const key of ["bearerToken", "accessToken", "token"]) {
        const candidate = parsed[key as keyof LinearSecret];
        if (typeof candidate === "string" && candidate.trim().length > 0) {
          return `Bearer ${candidate.trim().replace(/^Bearer\s+/iu, "")}`;
        }
      }
    }
  } catch {
    // Raw API-key values are allowed when the secret backend stores only the key.
  }
  if (trimmed.length === 0) {
    throw new ApiError(
      "connector_linear_secret_ref_invalid",
      "Linear connector secret must contain an API key or bearer token.",
      400,
    );
  }
  return trimmed;
}

function linearIssueMatches(issue: Issue, query: string | undefined): boolean {
  if (query === undefined) return true;
  const needle = query.toLowerCase();
  return [issue.identifier, issue.title, issue.description ?? undefined].some(
    (value) => value?.toLowerCase().includes(needle) ?? false,
  );
}

function stringConfig(connector: DataConnector, key: string): string {
  const value = connector.config[key];
  if (typeof value !== "string")
    throw new ApiError(
      "invalid_connector_config",
      `Linear connector requires ${key}.`,
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

function labeledValue(
  label: string,
  value: string | undefined,
): string | undefined {
  return value === undefined || value.trim().length === 0
    ? undefined
    : `${label}: ${value}`;
}

function markdownDocument(parts: Array<string | undefined>): string {
  return parts
    .map((part) => (part === undefined ? "" : part.trim()))
    .filter((part) => part.length > 0)
    .join("\n\n");
}

function safeFileName(value: string): string {
  return (
    value.replace(/[^A-Za-z0-9._-]/gu, "_").slice(0, 140) || "linear-source.md"
  );
}

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
