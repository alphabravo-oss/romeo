import { getDataConnectorCatalogEntry } from "../domain/data-connector-catalog";
import type { DataConnector, DataConnectorType } from "../domain/entities";
import { ApiError } from "../errors";
import {
  boundedString,
  isSafeGitHubPathPart,
  normalizeApiPath,
  normalizeExternalHttpsUrl,
  normalizePathPrefix,
} from "./data-connector-config-paths";
import { assertManagedSecretRef } from "./secret-refs";

export function normalizeConnectorConfig(
  type: DataConnectorType,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const catalogEntry = getDataConnectorCatalogEntry(type);
  if (catalogEntry.implementationStatus !== "implemented") {
    throw new ApiError(
      "connector_type_not_implemented",
      "Data connector type is not implemented.",
      400,
      { type },
    );
  }
  if (type === "local_import")
    return withOptionalSourceAccessMode({ mode: "manual" }, config);
  if (type === "github")
    return withOptionalSourceAccessMode(normalizeGitHubConfig(config), config);
  if (type === "s3")
    return withOptionalSourceAccessMode(normalizeS3Config(config), config);
  if (type === "confluence")
    return withOptionalSourceAccessMode(
      normalizeAtlassianConfig(config, {
        apiPath: "/wiki/rest/api/content/search",
        queryKey: "cql",
      }),
      config,
    );
  if (type === "jira")
    return withOptionalSourceAccessMode(
      normalizeAtlassianConfig(config, {
        apiPath: "/rest/api/3/search/jql",
        queryKey: "jql",
      }),
      config,
    );
  if (type === "notion")
    return withOptionalSourceAccessMode(normalizeNotionConfig(config), config);
  if (type === "linear")
    return withOptionalSourceAccessMode(normalizeLinearConfig(config), config);
  if (type === "slack")
    return withOptionalSourceAccessMode(normalizeSlackConfig(config), config);
  if (type === "website") {
    return withOptionalSourceAccessMode(
      {
        url: normalizeExternalHttpsUrl(requiredString(config, "url")),
        maxPages: boundedInt(config.maxPages, 1, 100, 10, "maxPages"),
      },
      config,
    );
  }
  if (type === "rss") {
    return withOptionalSourceAccessMode(
      {
        url: normalizeExternalHttpsUrl(requiredString(config, "url")),
        maxItems: boundedInt(config.maxItems, 1, 100, 20, "maxItems"),
      },
      config,
    );
  }
  return unsupportedConnectorType(type);
}

function unsupportedConnectorType(type: never): never {
  throw new ApiError(
    "connector_type_not_implemented",
    "Data connector type is not implemented.",
    400,
    { type },
  );
}

function normalizeAtlassianConfig(
  config: Record<string, unknown>,
  defaults: { apiPath: string; queryKey: "cql" | "jql" },
): Record<string, unknown> {
  return withRequiredSecretRef(
    {
      baseUrl: normalizeExternalHttpsUrl(requiredString(config, "baseUrl")),
      apiPath: normalizeApiPath(
        optionalString(config, "apiPath") ?? defaults.apiPath,
      ),
      [defaults.queryKey]: boundedString(
        requiredString(config, defaults.queryKey),
        1_000,
        defaults.queryKey,
      ),
      maxItems: boundedInt(config.maxItems, 1, 100, 25, "maxItems"),
    },
    config,
  );
}

function normalizeNotionConfig(
  config: Record<string, unknown>,
): Record<string, unknown> {
  return withRequiredSecretRef(
    {
      apiUrl: normalizeExternalHttpsUrl(
        optionalString(config, "apiUrl") ?? "https://api.notion.com",
      ),
      apiVersion: normalizeDateVersion(
        optionalString(config, "apiVersion") ?? "2026-03-11",
        "apiVersion",
      ),
      query: boundedString(requiredString(config, "query"), 500, "query"),
      maxItems: boundedInt(config.maxItems, 1, 100, 25, "maxItems"),
      maxBlocksPerPage: boundedInt(
        config.maxBlocksPerPage,
        1,
        100,
        25,
        "maxBlocksPerPage",
      ),
    },
    config,
  );
}

function normalizeLinearConfig(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const query = optionalString(config, "query");
  return withRequiredSecretRef(
    {
      apiUrl: normalizeExternalHttpsUrl(
        optionalString(config, "apiUrl") ?? "https://api.linear.app/graphql",
      ),
      ...(query === undefined
        ? {}
        : { query: boundedString(query, 500, "query") }),
      maxItems: boundedInt(config.maxItems, 1, 100, 25, "maxItems"),
    },
    config,
  );
}

function normalizeSlackConfig(
  config: Record<string, unknown>,
): Record<string, unknown> {
  return withRequiredSecretRef(
    {
      apiUrl: normalizeExternalHttpsUrl(
        optionalString(config, "apiUrl") ?? "https://slack.com/api",
      ),
      channelIds: requiredSlackChannelIds(config.channelIds),
      maxItemsPerChannel: boundedInt(
        config.maxItemsPerChannel,
        1,
        100,
        50,
        "maxItemsPerChannel",
      ),
      ...optionalSlackTimestamp(config, "oldest"),
      ...optionalSlackTimestamp(config, "latest"),
    },
    config,
  );
}

function requiredSlackChannelIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 50) {
    throw new ApiError(
      "invalid_connector_config",
      "Slack connector channelIds must be a non-empty array of at most 50 channel IDs.",
      400,
    );
  }
  const channelIds = value.map((item) => {
    if (typeof item !== "string" || !/^[A-Z0-9]{2,32}$/u.test(item.trim())) {
      throw new ApiError(
        "invalid_connector_config",
        "Slack connector channelIds must contain Slack channel IDs.",
        400,
      );
    }
    return item.trim();
  });
  return [...new Set(channelIds)];
}

function optionalSlackTimestamp(
  config: Record<string, unknown>,
  key: "latest" | "oldest",
): Record<string, unknown> {
  const value = optionalString(config, key);
  if (value === undefined) return {};
  if (!/^\d{10}(?:\.\d{1,6})?$/u.test(value)) {
    throw new ApiError(
      "invalid_connector_config",
      `Slack connector ${key} must be a Slack timestamp.`,
      400,
    );
  }
  return { [key]: value };
}

function normalizeDateVersion(value: string, key: string): string {
  const normalized = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(normalized)) {
    throw new ApiError(
      "invalid_connector_config",
      `Connector config ${key} must use YYYY-MM-DD format.`,
      400,
    );
  }
  return normalized;
}

function withRequiredSecretRef(
  base: Record<string, unknown>,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const secretRef = requiredString(config, "secretRef");
  assertManagedSecretRef(secretRef);
  return { ...base, secretRef };
}

function withOptionalSourceAccessMode(
  base: Record<string, unknown>,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const mode = optionalString(config, "sourceAccessMode");
  if (mode === undefined || mode === "knowledge_base") return base;
  if (mode !== "connector_owner")
    throw new ApiError(
      "invalid_connector_config",
      "Connector sourceAccessMode is invalid.",
      400,
    );
  return { ...base, sourceAccessMode: mode };
}

export function scheduleFields(
  syncIntervalMinutes: number | undefined,
  now: string,
): Pick<DataConnector, "syncIntervalMinutes" | "nextSyncAt"> {
  if (syncIntervalMinutes === undefined) return {};
  return {
    syncIntervalMinutes: normalizeSyncIntervalMinutes(syncIntervalMinutes),
    nextSyncAt: now,
  };
}

export function nextScheduleFields(
  connector: DataConnector,
  from: string,
): Pick<DataConnector, "syncIntervalMinutes" | "nextSyncAt"> {
  if (connector.syncIntervalMinutes === undefined) return {};
  return {
    syncIntervalMinutes: connector.syncIntervalMinutes,
    nextSyncAt: new Date(
      new Date(from).getTime() + connector.syncIntervalMinutes * 60_000,
    ).toISOString(),
  };
}

function normalizeSyncIntervalMinutes(value: number): number {
  return boundedInt(value, 5, 43_200, value, "syncIntervalMinutes");
}

function normalizeGitHubConfig(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const repository = requiredString(config, "repository").trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new ApiError(
      "invalid_connector_config",
      "GitHub connector repository must use owner/repo format.",
      400,
    );
  }
  const branch = optionalString(config, "branch") ?? "main";
  if (!isSafeGitHubPathPart(branch))
    throw new ApiError(
      "invalid_connector_config",
      "GitHub connector branch is invalid.",
      400,
    );
  const pathPrefix = normalizePathPrefix(
    optionalString(config, "pathPrefix") ?? "",
  );
  const maxItems = boundedInt(config.maxItems, 1, 100, 50, "maxItems");
  return withOptionalCredentialSource(
    {
      repository,
      branch,
      pathPrefix,
      maxItems,
    },
    config,
  );
}

function normalizeS3Config(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const bucket = requiredString(config, "bucket").trim();
  if (
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) ||
    bucket.includes("..")
  ) {
    throw new ApiError(
      "invalid_connector_config",
      "S3 connector bucket name is invalid.",
      400,
    );
  }
  return withOptionalSecretRef(
    {
      bucket,
      prefix: optionalString(config, "prefix") ?? "",
      region: optionalString(config, "region") ?? "us-east-1",
      maxItems: boundedInt(config.maxItems, 1, 100, 50, "maxItems"),
    },
    config,
  );
}

function withOptionalSecretRef(
  base: Record<string, unknown>,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const secretRef = optionalString(config, "secretRef");
  if (secretRef === undefined) return base;
  assertManagedSecretRef(secretRef);
  return { ...base, secretRef };
}

function withOptionalCredentialSource(
  base: Record<string, unknown>,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const secretRef = optionalString(config, "secretRef");
  const delegatedOAuthConnectionId = optionalString(
    config,
    "delegatedOAuthConnectionId",
  );
  if (secretRef !== undefined && delegatedOAuthConnectionId !== undefined) {
    throw new ApiError(
      "invalid_connector_config",
      "GitHub connector can use secretRef or delegatedOAuthConnectionId, not both.",
      400,
    );
  }
  if (secretRef !== undefined) {
    assertManagedSecretRef(secretRef);
    return { ...base, secretRef };
  }
  if (delegatedOAuthConnectionId !== undefined) {
    if (!/^[A-Za-z0-9_-]{1,160}$/u.test(delegatedOAuthConnectionId)) {
      throw new ApiError(
        "invalid_connector_config",
        "GitHub connector delegatedOAuthConnectionId is invalid.",
        400,
      );
    }
    return { ...base, delegatedOAuthConnectionId };
  }
  return base;
}

export function connectorSourceAccessMode(
  config: Record<string, unknown>,
): "connector_owner" | "knowledge_base" {
  return config.sourceAccessMode === "connector_owner"
    ? "connector_owner"
    : "knowledge_base";
}

export function connectorSourceMetadata(
  connector: DataConnector,
): Record<string, unknown> {
  if (connectorSourceAccessMode(connector.config) !== "connector_owner")
    return {};
  return {
    sourceAccess: {
      mode: "connector_owner",
      connectorId: connector.id,
      ownerId: connector.createdBy,
    },
  };
}

function requiredString(config: Record<string, unknown>, key: string): string {
  const value = config[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ApiError(
      "invalid_connector_config",
      `Connector config requires ${key}.`,
      400,
    );
  }
  return value.trim();
}

function optionalString(
  config: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = config[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length === 0)
    throw new ApiError(
      "invalid_connector_config",
      `Connector config ${key} must be a string.`,
      400,
    );
  return value.trim();
}

function boundedInt(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
  key: string,
): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) {
    throw new ApiError(
      "invalid_connector_config",
      `Connector config ${key} must be between ${min} and ${max}.`,
      400,
    );
  }
  return Number(value);
}

export function connectorSyncErrorMessage(code: string): string {
  if (code === "connector_execution_disabled")
    return "Connector execution is disabled until worker, network, and secret policies are configured.";
  if (code === "connector_egress_allowlist_required")
    return "Connector egress policy requires a host allowlist.";
  if (code === "connector_egress_host_blocked")
    return "Connector host is not in the configured egress allowlist.";
  if (code === "connector_private_network_host_blocked")
    return "Connector host resolves to a private or local network.";
  if (code === "connector_dns_lookup_failed")
    return "Connector host DNS lookup failed.";
  if (code === "connector_sync_items_required")
    return "Local import connector sync requires at least one item.";
  if (code === "connector_delegated_oauth_not_found")
    return "Delegated OAuth connection is unavailable for this connector.";
  if (code === "connector_delegated_oauth_revoked")
    return "Delegated OAuth connection has been revoked.";
  if (code === "connector_delegated_oauth_reauthorization_required")
    return "Delegated OAuth connection requires reauthorization.";
  if (code === "connector_delegated_oauth_expired")
    return "Delegated OAuth connection has expired and requires reauthorization.";
  if (code === "connector_delegated_oauth_refresh_failed")
    return "Delegated OAuth connection refresh failed and requires reauthorization.";
  if (code === "connector_delegated_oauth_unsupported")
    return "Delegated OAuth credential selection is not enabled for this connector executor.";
  return "Connector sync failed.";
}
