import type { DataConnectorType } from "./data-connectors";

export type DataConnectorImplementationStatus = "implemented" | "planned";
export type DataConnectorSyncMode = "inline_items" | "managed_fetch";
export type DataConnectorExecutionBoundary =
  | "api_ingest"
  | "bounded_runtime_fetch";
export type DataConnectorCredentialSource =
  | "none"
  | "deployment_secret"
  | "connector_secret_ref"
  | "delegated_oauth";

export interface DataConnectorEgressPolicy {
  required: boolean;
  allowlistSupported: boolean;
  hostSource: "none" | "connector_url" | "github_api" | "s3_endpoint";
  privateNetworkDeniedByExecutor: boolean;
}

export interface DataConnectorLimitPolicy {
  maxConfigItems?: number;
  maxInlineItems?: number;
  maxInlineItemBytes?: number;
}

export interface DataConnectorCatalogEntry {
  type: DataConnectorType;
  displayName: string;
  description: string;
  implementationStatus: DataConnectorImplementationStatus;
  syncMode: DataConnectorSyncMode;
  executionBoundary: DataConnectorExecutionBoundary;
  supportsScheduledSync: boolean;
  supportsDelegatedOAuth: boolean;
  credentialSources: DataConnectorCredentialSource[];
  requiredConfigKeys: string[];
  optionalConfigKeys: string[];
  egress: DataConnectorEgressPolicy;
  limits: DataConnectorLimitPolicy;
  securityControls: string[];
}

const connectorCatalog: DataConnectorCatalogEntry[] = [
  {
    type: "local_import",
    displayName: "Local import",
    description: "User-supplied text files imported through the API.",
    implementationStatus: "implemented",
    syncMode: "inline_items",
    executionBoundary: "api_ingest",
    supportsScheduledSync: false,
    supportsDelegatedOAuth: false,
    credentialSources: ["none"],
    requiredConfigKeys: [],
    optionalConfigKeys: ["sourceAccessMode"],
    egress: {
      required: false,
      allowlistSupported: false,
      hostSource: "none",
      privateNetworkDeniedByExecutor: true,
    },
    limits: { maxInlineItems: 20, maxInlineItemBytes: 200_000 },
    securityControls: [
      "knowledge-base write grant required",
      "source ownership can be connector-owner scoped",
      "sync summaries exclude file content",
    ],
  },
  {
    type: "website",
    displayName: "Website",
    description: "Bounded HTTPS page fetch into a knowledge base.",
    implementationStatus: "implemented",
    syncMode: "managed_fetch",
    executionBoundary: "bounded_runtime_fetch",
    supportsScheduledSync: true,
    supportsDelegatedOAuth: false,
    credentialSources: ["none"],
    requiredConfigKeys: ["url"],
    optionalConfigKeys: ["maxPages", "sourceAccessMode"],
    egress: {
      required: true,
      allowlistSupported: true,
      hostSource: "connector_url",
      privateNetworkDeniedByExecutor: true,
    },
    limits: { maxConfigItems: 100 },
    securityControls: [
      "HTTPS URL required",
      "redirects disabled",
      "response byte limit enforced",
      "host allowlist available",
      "transient rate-limit and server failures use bounded retry",
    ],
  },
  {
    type: "rss",
    displayName: "RSS or Atom feed",
    description: "Bounded HTTPS feed fetch with text extraction.",
    implementationStatus: "implemented",
    syncMode: "managed_fetch",
    executionBoundary: "bounded_runtime_fetch",
    supportsScheduledSync: true,
    supportsDelegatedOAuth: false,
    credentialSources: ["none"],
    requiredConfigKeys: ["url"],
    optionalConfigKeys: ["maxItems", "sourceAccessMode"],
    egress: {
      required: true,
      allowlistSupported: true,
      hostSource: "connector_url",
      privateNetworkDeniedByExecutor: true,
    },
    limits: { maxConfigItems: 100 },
    securityControls: [
      "HTTPS URL required",
      "redirects disabled",
      "response byte limit enforced",
      "host allowlist available",
      "transient rate-limit and server failures use bounded retry",
    ],
  },
  {
    type: "github",
    displayName: "GitHub repository",
    description: "Bounded GitHub repository content import.",
    implementationStatus: "implemented",
    syncMode: "managed_fetch",
    executionBoundary: "bounded_runtime_fetch",
    supportsScheduledSync: true,
    supportsDelegatedOAuth: true,
    credentialSources: ["connector_secret_ref", "delegated_oauth"],
    requiredConfigKeys: ["repository"],
    optionalConfigKeys: [
      "branch",
      "pathPrefix",
      "maxItems",
      "secretRef",
      "delegatedOAuthConnectionId",
      "sourceAccessMode",
    ],
    egress: {
      required: true,
      allowlistSupported: false,
      hostSource: "github_api",
      privateNetworkDeniedByExecutor: true,
    },
    limits: { maxConfigItems: 100 },
    securityControls: [
      "owner/repo repository validation",
      "path-prefix normalization",
      "secretRef and delegated OAuth are mutually exclusive",
      "token values stay inside executor memory",
      "transient rate-limit and server failures use bounded retry",
    ],
  },
  {
    type: "s3",
    displayName: "S3-compatible object prefix",
    description: "Bounded S3-compatible object listing and text import.",
    implementationStatus: "implemented",
    syncMode: "managed_fetch",
    executionBoundary: "bounded_runtime_fetch",
    supportsScheduledSync: true,
    supportsDelegatedOAuth: false,
    credentialSources: ["connector_secret_ref"],
    requiredConfigKeys: ["bucket", "secretRef"],
    optionalConfigKeys: ["prefix", "region", "maxItems", "sourceAccessMode"],
    egress: {
      required: true,
      allowlistSupported: false,
      hostSource: "s3_endpoint",
      privateNetworkDeniedByExecutor: true,
    },
    limits: { maxConfigItems: 100 },
    securityControls: [
      "bucket-name validation",
      "prefix-scoped object listing",
      "object byte limit enforced",
      "connector secret refs require value-capable resolver",
      "transient rate-limit and server failures use bounded retry",
    ],
  },
];

export function listDataConnectorCatalogEntries(): DataConnectorCatalogEntry[] {
  return connectorCatalog.map(cloneCatalogEntry);
}

export function getDataConnectorCatalogEntry(
  type: DataConnectorType,
): DataConnectorCatalogEntry {
  const entry = connectorCatalog.find((item) => item.type === type);
  if (entry === undefined) {
    throw new Error(`Data connector catalog is missing type: ${type}`);
  }
  return cloneCatalogEntry(entry);
}

function cloneCatalogEntry(
  entry: DataConnectorCatalogEntry,
): DataConnectorCatalogEntry {
  return {
    ...entry,
    credentialSources: [...entry.credentialSources],
    requiredConfigKeys: [...entry.requiredConfigKeys],
    optionalConfigKeys: [...entry.optionalConfigKeys],
    egress: { ...entry.egress },
    limits: { ...entry.limits },
    securityControls: [...entry.securityControls],
  };
}
