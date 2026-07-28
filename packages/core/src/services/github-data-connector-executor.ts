import { Octokit } from "octokit";

import type { DataConnector, LocalImportSyncItem } from "../domain/entities";
import { ApiError } from "../errors";
import type {
  DataConnectorExecutionResult,
  DataConnectorExecutor,
} from "./data-connector-executors";
import type { SecretResolver } from "./secret-resolver";

export interface DelegatedOAuthConnectorCredentialProvider {
  getConnectorAccessToken(input: {
    connectionId: string;
    connector: DataConnector;
  }): Promise<string>;
}

interface GitHubTreeItem {
  path?: unknown;
  size?: unknown;
  type?: unknown;
}

interface GitHubTreeResponse {
  tree?: unknown;
  truncated?: unknown;
}

export class GitHubDataConnectorExecutor implements DataConnectorExecutor {
  private readonly fetchImpl: typeof fetch;
  private readonly maxBytes: number;
  private readonly maxItems: number;
  private readonly secretResolver: SecretResolver | undefined;
  private readonly delegatedOAuthCredentials:
    | DelegatedOAuthConnectorCredentialProvider
    | undefined;
  private readonly retryAttempts: number;
  private readonly retryBackoffMs: number;
  private readonly timeoutMs: number;
  private readonly token: string | undefined;

  constructor(
    options: {
      delegatedOAuthCredentials?: DelegatedOAuthConnectorCredentialProvider;
      fetchImpl?: typeof fetch;
      maxBytes?: number;
      maxItems?: number;
      retryAttempts?: number;
      retryBackoffMs?: number;
      secretResolver?: SecretResolver;
      timeoutMs?: number;
      token?: string;
    } = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.delegatedOAuthCredentials = options.delegatedOAuthCredentials;
    this.maxBytes = options.maxBytes ?? 2_000_000;
    this.maxItems = options.maxItems ?? 50;
    this.retryAttempts = options.retryAttempts ?? 1;
    this.retryBackoffMs = options.retryBackoffMs ?? 250;
    this.secretResolver = options.secretResolver;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.token =
      options.token === undefined || options.token.length === 0
        ? undefined
        : options.token;
  }

  async sync(connector: DataConnector): Promise<DataConnectorExecutionResult> {
    if (connector.type !== "github")
      throw new ApiError(
        "connector_execution_disabled",
        "Connector execution is disabled for this connector type.",
        409,
      );
    const config = readGitHubConfig(connector);
    const maxItems = Math.min(config.maxItems, this.maxItems);
    const token = await this.connectorToken(connector, config);
    const client = new Octokit({
      ...(token === undefined ? {} : { auth: token }),
      request: { fetch: this.fetchImpl },
      retry: { retryAfterBaseValue: this.retryBackoffMs },
    });
    const tree = await this.fetchTree(client, config);
    const files = tree
      .filter((item) => item.type === "blob" && typeof item.path === "string")
      .map((item) => ({
        path: item.path as string,
        size: typeof item.size === "number" ? item.size : undefined,
      }))
      .filter((item) => pathIsInsidePrefix(item.path, config.pathPrefix))
      .filter((item) => supportedTextPath(item.path))
      .sort((left, right) => left.path.localeCompare(right.path))
      .slice(0, maxItems);

    if (files.length === 0)
      return { items: [], summary: summary(config, 0, 0) };

    const items: LocalImportSyncItem[] = [];
    let totalBytes = 0;
    for (const file of files) {
      if (file.size !== undefined && file.size > this.maxBytes)
        throw new ApiError(
          "connector_response_too_large",
          "GitHub file exceeds the configured size limit.",
          413,
        );
      const fetched = await this.fetchFile(client, config, file.path);
      if (fetched.sizeBytes > this.maxBytes)
        throw new ApiError(
          "connector_response_too_large",
          "GitHub file exceeds the configured size limit.",
          413,
        );
      totalBytes += fetched.sizeBytes;
      items.push({
        fileName: githubFileName(file.path, config.pathPrefix),
        mimeType: mimeTypeFromPath(file.path),
        content: fetched.content,
        sizeBytes: fetched.sizeBytes,
      });
    }

    return { items, summary: summary(config, items.length, totalBytes) };
  }

  private async fetchTree(
    client: Octokit,
    config: GitHubConnectorConfig,
  ): Promise<GitHubTreeItem[]> {
    const response = await this.requestGitHub(() =>
      client.request("GET /repos/{owner}/{repo}/git/trees/{tree_sha}", {
        owner: config.owner,
        repo: config.repo,
        tree_sha: config.branch,
        recursive: "1",
        request: {
          retries: this.retryAttempts,
          timeout: this.timeoutMs,
        },
      }),
    );
    const body = response.data as GitHubTreeResponse;
    if (body.truncated === true)
      throw new ApiError(
        "connector_item_limit_exceeded",
        "GitHub connector tree is too large to sync safely.",
        413,
      );
    if (!Array.isArray(body.tree))
      throw new ApiError(
        "connector_fetch_failed",
        "GitHub connector tree response is invalid.",
        502,
      );
    return body.tree.filter(
      (item): item is GitHubTreeItem =>
        typeof item === "object" && item !== null,
    );
  }

  private async fetchFile(
    client: Octokit,
    config: GitHubConnectorConfig,
    path: string,
  ): Promise<{ content: string; sizeBytes: number }> {
    const response = await this.requestGitHub(() =>
      client.request("GET /repos/{owner}/{repo}/contents/{path}", {
        owner: config.owner,
        repo: config.repo,
        path,
        ref: config.branch,
        headers: { accept: "application/vnd.github.raw" },
        request: {
          retries: this.retryAttempts,
          timeout: this.timeoutMs,
        },
      }),
    );
    const declaredLength = Number(response.headers["content-length"]);
    if (Number.isFinite(declaredLength) && declaredLength > this.maxBytes) {
      throw new ApiError(
        "connector_response_too_large",
        "GitHub file exceeds the configured size limit.",
        413,
      );
    }
    const content = githubRawContent(response.data);
    const sizeBytes = new TextEncoder().encode(content).byteLength;
    if (sizeBytes > this.maxBytes)
      throw new ApiError(
        "connector_response_too_large",
        "GitHub file exceeds the configured size limit.",
        413,
      );
    return {
      content,
      sizeBytes,
    };
  }

  private async connectorToken(
    connector: DataConnector,
    config: GitHubConnectorConfig,
  ): Promise<string | undefined> {
    if (config.delegatedOAuthConnectionId !== undefined) {
      if (this.delegatedOAuthCredentials === undefined) {
        throw new ApiError(
          "connector_delegated_oauth_unsupported",
          "GitHub delegated OAuth credentials require delegated OAuth support.",
          409,
        );
      }
      return this.delegatedOAuthCredentials.getConnectorAccessToken({
        connectionId: config.delegatedOAuthConnectionId,
        connector,
      });
    }
    if (config.secretRef === undefined) return this.token;
    if (this.secretResolver?.resolveValue === undefined) {
      throw new ApiError(
        "connector_github_secret_ref_unsupported",
        "GitHub connector secret references require a value-capable secret resolver.",
        409,
      );
    }
    const resolution = await this.secretResolver.resolveValue(config.secretRef);
    if (!resolution.available || resolution.value === undefined) {
      throw new ApiError(
        "connector_github_secret_ref_unavailable",
        "GitHub connector secret reference is unavailable.",
        409,
        {
          ...(resolution.failureCode === undefined
            ? {}
            : { failureCode: resolution.failureCode }),
          secretRefScheme: resolution.scheme,
        },
      );
    }
    return resolution.value;
  }

  private async requestGitHub<T>(request: () => Promise<T>): Promise<T> {
    try {
      return await request();
    } catch (caught) {
      const status = githubErrorStatus(caught);
      throw new ApiError(
        "connector_fetch_failed",
        "GitHub connector fetch failed.",
        502,
        status === undefined ? undefined : { status },
      );
    }
  }
}

export class RoutingDataConnectorExecutor implements DataConnectorExecutor {
  constructor(
    private readonly executors: Partial<
      Record<DataConnector["type"], DataConnectorExecutor>
    >,
  ) {}

  sync(connector: DataConnector): Promise<DataConnectorExecutionResult> {
    return (this.executors[connector.type] ?? disabledForType).sync(connector);
  }
}

const disabledForType: DataConnectorExecutor = {
  async sync() {
    throw new ApiError(
      "connector_execution_disabled",
      "Connector execution is disabled for this connector type.",
      409,
    );
  },
};

interface GitHubConnectorConfig {
  branch: string;
  delegatedOAuthConnectionId?: string;
  maxItems: number;
  owner: string;
  pathPrefix: string;
  repo: string;
  secretRef?: string;
}

function readGitHubConfig(connector: DataConnector): GitHubConnectorConfig {
  const repository = stringConfig(connector, "repository");
  const [owner, repo] = repository.split("/");
  if (owner === undefined || repo === undefined)
    throw new ApiError(
      "invalid_connector_config",
      "GitHub connector requires owner/repo.",
      400,
    );
  return {
    owner,
    repo,
    branch: stringConfig(connector, "branch"),
    pathPrefix: stringConfig(connector, "pathPrefix"),
    maxItems: numberConfig(connector, "maxItems", 50),
    ...(typeof connector.config.secretRef === "string"
      ? { secretRef: connector.config.secretRef }
      : {}),
    ...(typeof connector.config.delegatedOAuthConnectionId === "string"
      ? {
          delegatedOAuthConnectionId:
            connector.config.delegatedOAuthConnectionId,
        }
      : {}),
  };
}

function stringConfig(connector: DataConnector, key: string): string {
  const value = connector.config[key];
  if (typeof value !== "string")
    throw new ApiError(
      "invalid_connector_config",
      `GitHub connector requires ${key}.`,
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

function githubRawContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return new TextDecoder().decode(value);
  throw new ApiError(
    "connector_fetch_failed",
    "GitHub connector file response is invalid.",
    502,
  );
}

function githubErrorStatus(value: unknown): number | undefined {
  if (typeof value !== "object" || value === null || !("status" in value))
    return undefined;
  const status = (value as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

function pathIsInsidePrefix(path: string, prefix: string): boolean {
  return (
    prefix.length === 0 || path === prefix || path.startsWith(`${prefix}/`)
  );
}

function supportedTextPath(path: string): boolean {
  return [
    ".md",
    ".markdown",
    ".txt",
    ".csv",
    ".json",
    ".ndjson",
    ".html",
    ".htm",
  ].some((extension) => path.toLowerCase().endsWith(extension));
}

function mimeTypeFromPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".markdown"))
    return "text/markdown";
  if (lower.endsWith(".csv")) return "text/csv";
  if (lower.endsWith(".json") || lower.endsWith(".ndjson"))
    return "application/json";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html";
  return "text/plain";
}

function githubFileName(path: string, prefix: string): string {
  const relative =
    prefix.length === 0 ? path : path.slice(prefix.length).replace(/^\/+/u, "");
  return (
    (relative || path).replace(/[^A-Za-z0-9._-]/gu, "_").slice(0, 120) ||
    "github-source.txt"
  );
}

function summary(
  config: GitHubConnectorConfig,
  fileCount: number,
  totalByteLength: number,
): Record<string, unknown> {
  return {
    repository: `${config.owner}/${config.repo}`,
    branch: config.branch,
    pathPrefix: config.pathPrefix,
    fileCount,
    totalByteLength,
  };
}
