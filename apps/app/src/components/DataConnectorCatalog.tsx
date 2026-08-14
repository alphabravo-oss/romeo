import { Button } from "@romeo/ui";

import type {
  DataConnectorCatalogItem,
  DataConnectorCatalogReport,
  DataConnectorType,
} from "../features/types";
import { type MessageKey, useLocale } from "../lib/i18n";
import { dataConnectorIcon } from "./DataConnectorIcons";
import { PanelStats } from "./PanelStats";

export function DataConnectorCatalog(props: {
  canCreate: boolean;
  onAdd: (type: DataConnectorType) => void;
  report: DataConnectorCatalogReport;
}) {
  const { t } = useLocale();
  return (
    <div className="grid gap-4">
      <PanelStats
        items={[
          { label: t("connectorTypes"), value: props.report.connectors.length },
          {
            label: t("connectorSyncReadyCount"),
            value: props.report.connectors.filter(
              (connector) => connector.runtime.syncEnabled,
            ).length,
          },
          {
            label: t("connectorExecutionDriver"),
            value: props.report.executionDriver,
          },
        ]}
      />
      <div
        className="grid gap-3"
        style={{
          gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
        }}
      >
        {props.report.connectors.map((entry) => (
          <CatalogCard
            canCreate={props.canCreate}
            entry={entry}
            key={entry.type}
            onAdd={() => props.onAdd(entry.type)}
          />
        ))}
      </div>
    </div>
  );
}

/** Human-readable labels for the runtime blocked reasons the catalog returns. */
const BLOCKED_REASON_KEYS: Record<string, MessageKey> = {
  connector_driver_not_enabled: "connectorDriverNotEnabled",
  egress_allowlist_required: "connectorEgressAllowlistRequired",
  s3_endpoint_missing: "connectorS3EndpointMissing",
  s3_credentials_not_configured: "connectorS3CredentialsMissing",
};

const WARNING_KEYS: Record<string, MessageKey> = {
  private_repository_credentials_not_configured:
    "connectorPrivateRepositoryCredentialsMissing",
};

const CATALOG_NAME_KEYS: Partial<Record<DataConnectorType, MessageKey>> = {
  local_import: "connectorLocalImportName",
  website: "connectorWebsiteName",
  rss: "connectorRssName",
  github: "connectorGithubName",
  s3: "connectorS3Name",
};

const CATALOG_DESCRIPTION_KEYS: Partial<Record<DataConnectorType, MessageKey>> =
  {
    local_import: "connectorLocalImportDescription",
    website: "connectorWebsiteDescription",
    rss: "connectorRssDescription",
    github: "connectorGithubDescription",
    s3: "connectorS3Description",
  };

function labelFor(
  t: (key: MessageKey) => string,
  map: Record<string, MessageKey>,
  key: string,
): string {
  const labelKey = map[key];
  return labelKey ? t(labelKey) : key.replace(/_/g, " ");
}

function catalogText(
  t: (key: MessageKey) => string,
  map: Partial<Record<DataConnectorType, MessageKey>>,
  type: DataConnectorType,
  fallback: string,
): string {
  const key = map[type];
  return key === undefined ? fallback : t(key);
}

/** App-store card for one catalog connector type. */
function CatalogCard(props: {
  entry: DataConnectorCatalogItem;
  canCreate: boolean;
  onAdd: () => void;
}): React.ReactNode {
  const { t } = useLocale();
  const { entry, canCreate, onAdd } = props;
  const planned = entry.implementationStatus !== "implemented";
  const syncReady = entry.runtime.syncEnabled;

  return (
    <div style={{ padding: 14, opacity: planned ? 0.75 : 1 }}>
      <div className="flex items-start gap-3">
        <div style={{ flexShrink: 0, display: "flex", alignItems: "center" }}>
          {dataConnectorIcon(entry.type)}
        </div>
        <div className="min-w-0" style={{ flex: 1 }}>
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium truncate">
              {catalogText(t, CATALOG_NAME_KEYS, entry.type, entry.displayName)}
            </span>
            {planned ? (
              <span className="rm-status" style={{ color: "var(--rm-muted)" }}>
                {t("connectorComingSoon")}
              </span>
            ) : (
              <span className={`rm-status ${syncReady ? "pass" : "warn"}`}>
                {syncReady
                  ? t("connectorSyncReady")
                  : t("connectorSetupNeeded")}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span
              className="rm-status"
              style={{ fontSize: 11, color: "var(--rm-muted)" }}
            >
              {entry.syncMode === "inline_items"
                ? t("connectorInline")
                : t("connectorManagedFetch")}
            </span>
          </div>
        </div>
      </div>

      <div className="text-xs text-muted mt-2">
        {catalogText(
          t,
          CATALOG_DESCRIPTION_KEYS,
          entry.type,
          entry.description,
        )}
      </div>

      {!planned && entry.runtime.blockedReasons.length ? (
        <div className="mt-2 grid gap-1">
          {entry.runtime.blockedReasons.map((reason) => (
            <div
              className="text-xs"
              key={reason}
              style={{ color: "var(--rm-muted)" }}
            >
              • {labelFor(t, BLOCKED_REASON_KEYS, reason)}
            </div>
          ))}
        </div>
      ) : null}

      {!planned && entry.runtime.warnings.length ? (
        <div className="mt-2 grid gap-1">
          {entry.runtime.warnings.map((warning) => (
            <div
              className="text-xs"
              key={warning}
              style={{ color: "var(--rm-muted)" }}
            >
              ⚠ {labelFor(t, WARNING_KEYS, warning)}
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 mt-3">
        <Button
          variant="outline"
          disabled={planned || !canCreate}
          onClick={onAdd}
          type="button"
        >
          {planned ? t("connectorComingSoon") : t("connectorAdd")}
        </Button>
      </div>
    </div>
  );
}

/** Primary required/optional config field per connector type shown in the create dialog. */
export function connectorConfigHint(
  type: DataConnectorType,
  t: (key: MessageKey) => string,
): {
  key: string;
  label: string;
  placeholder: string;
  required: boolean;
} | null {
  switch (type) {
    case "website":
      return {
        key: "url",
        label: t("connectorWebsiteUrl"),
        placeholder: "https://example.com",
        required: true,
      };
    case "rss":
      return {
        key: "url",
        label: t("connectorFeedUrl"),
        placeholder: "https://example.com/feed.xml",
        required: true,
      };
    case "github":
      return {
        key: "repository",
        label: t("connectorRepository"),
        placeholder: "owner/repo",
        required: true,
      };
    case "s3":
      return {
        key: "bucket",
        label: t("connectorBucket"),
        placeholder: "my-bucket",
        required: true,
      };
    case "local_import":
    default:
      return null;
  }
}

/** Build the create config record from the single config field value. */
export function buildDataConnectorConfig(
  type: DataConnectorType,
  configText: string,
  t: (key: MessageKey) => string,
): Record<string, unknown> {
  const hint = connectorConfigHint(type, t);
  if (!hint) return {};
  const value = configText.trim();
  if (!value) return {};
  return { [hint.key]: value };
}

export function mimeTypeFor(fileName: string): string {
  if (fileName.endsWith(".md")) return "text/markdown";
  if (fileName.endsWith(".json")) return "application/json";
  if (fileName.endsWith(".csv")) return "text/csv";
  return "text/plain";
}
