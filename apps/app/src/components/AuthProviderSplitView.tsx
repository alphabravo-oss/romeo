import { Button, StatusBadge, Switch } from "@romeo/ui";
import Settings2 from "lucide-react/dist/esm/icons/settings-2.mjs";
import TestTube2 from "lucide-react/dist/esm/icons/test-tube-2.mjs";
import { useMemo } from "react";

import type {
  AuthProviderCatalogEntry,
  AuthProviderConnectionTestReport,
  AuthProviderId,
  EffectiveAuthProviderSetting,
} from "../features/auth-provider-administration";
import { useLocale } from "../lib/i18n";
import { authProviderIcon } from "./AuthProviderIcons";
import {
  canDeprovisionProvider,
  canTestProvider,
} from "./auth-provider-card-actions";
import { splitProviderZones } from "./auth-provider-zones";
import { createColumnHelper, DataTable } from "./DataTable";
import { PanelStats } from "./PanelStats";

interface AuthProviderRow {
  configured: boolean;
  enabled: boolean;
  entry: AuthProviderCatalogEntry;
  id: string;
  setting: EffectiveAuthProviderSetting | undefined;
  status: "implemented" | "planned";
  test: AuthProviderConnectionTestReport | undefined;
}

const providerColumn = createColumnHelper<AuthProviderRow>();

export function AuthProviderSplitView({
  busy,
  catalog,
  deprovisioning,
  effectiveById,
  onConfigure,
  onDeprovision,
  onTest,
  onToggle,
  testing,
  testResults,
}: {
  busy: boolean;
  catalog: AuthProviderCatalogEntry[];
  deprovisioning: boolean;
  effectiveById: Map<AuthProviderId, EffectiveAuthProviderSetting>;
  onConfigure: (entry: AuthProviderCatalogEntry) => void;
  onDeprovision: (entry: AuthProviderCatalogEntry) => void;
  onTest: (entry: AuthProviderCatalogEntry) => void;
  onToggle: (entry: AuthProviderCatalogEntry, enabled: boolean) => void;
  testing: boolean;
  testResults: Record<string, AuthProviderConnectionTestReport>;
}): React.ReactNode {
  const { t } = useLocale();
  const rows = useMemo<AuthProviderRow[]>(
    () =>
      catalog.map((entry) => {
        const setting = effectiveById.get(entry.id);
        return {
          configured:
            setting?.oidc?.issuerConfigured === true ||
            setting?.secretRefConfigured === true ||
            entry.id === "local",
          enabled: setting?.enabled ?? false,
          entry,
          id: entry.id,
          setting,
          status: entry.status,
          test: testResults[entry.id],
        };
      }),
    [catalog, effectiveById, testResults],
  );
  const zones = useMemo(() => splitProviderZones(rows), [rows]);
  const enabledCount = useMemo(
    () => rows.filter((row) => row.enabled).length,
    [rows],
  );
  const columns = useMemo(
    () => [
      providerColumn.accessor((row) => row.entry.name, {
        id: "provider",
        header: t("provider"),
        cell: ({ row }) => (
          <span className="flex min-w-0 items-center gap-2">
            <span className="shrink-0">
              {authProviderIcon(row.original.entry.id)}
            </span>
            <span className="block min-w-0">
              <strong className="block truncate" translate="no">
                {row.original.entry.name}
              </strong>
              <small className="block truncate text-muted">
                {row.original.entry.protocol}
              </small>
            </span>
          </span>
        ),
      }),
      providerColumn.accessor("status", {
        header: t("status"),
        cell: ({ row }) => (
          <StatusBadge
            tone={
              row.original.status === "planned"
                ? "neutral"
                : row.original.configured
                  ? "success"
                  : "warning"
            }
          >
            {row.original.status === "planned"
              ? t("authComingSoon")
              : row.original.configured
                ? t("authZoneActive")
                : t("authNotConfigured")}
          </StatusBadge>
        ),
      }),
      providerColumn.accessor(
        (row) =>
          row.test?.status === "disabled"
            ? "not_tested"
            : (row.test?.status ?? "not_tested"),
        {
          id: "test",
          header: t("authTest"),
          cell: ({ getValue }) => <AuthProviderTestStatus value={getValue()} />,
        },
      ),
      providerColumn.accessor("enabled", {
        header: t("authEnabled"),
        cell: ({ row }) => (
          <Switch
            checked={row.original.enabled}
            disabled={row.original.status === "planned" || busy}
            label={t("authEnabled")}
            onCheckedChange={(checked) =>
              onToggle(row.original.entry, checked === true)
            }
          />
        ),
      }),
      providerColumn.display({
        id: "actions",
        header: t("managedModelActions"),
        cell: ({ row }) => (
          <div className="flex flex-wrap items-center justify-end gap-1">
            <Button
              disabled={row.original.status === "planned"}
              onClick={() => onConfigure(row.original.entry)}
              size="sm"
              variant="secondary"
            >
              <Settings2 aria-hidden size={14} />
              {row.original.configured
                ? t("authEditConfiguration")
                : t("authConfigure")}
            </Button>
            {canTestProvider(row.original.entry) ? (
              <Button
                disabled={testing}
                onClick={() => onTest(row.original.entry)}
                pending={testing}
                size="sm"
              >
                <TestTube2 aria-hidden size={14} />
                {t("authTest")}
              </Button>
            ) : null}
            {canDeprovisionProvider(row.original.entry) ? (
              <Button
                aria-haspopup="dialog"
                disabled={deprovisioning}
                onClick={() => onDeprovision(row.original.entry)}
                size="sm"
                variant="ghost"
              >
                {t("authDeprovisionUser")}
              </Button>
            ) : null}
          </div>
        ),
        enableHiding: false,
        enableSorting: false,
      }),
    ],
    [
      busy,
      deprovisioning,
      onConfigure,
      onDeprovision,
      onTest,
      onToggle,
      t,
      testing,
    ],
  );

  return (
    <div className="grid gap-4">
      <PanelStats
        items={[
          { label: t("authActiveSlots"), value: zones.active.length },
          { label: t("authEnabled"), value: enabledCount },
          { label: t("authAvailableSlots"), value: zones.available.length },
        ]}
      />

      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        minTableWidth={840}
        preferenceKey="authentication-providers"
        searchVisibility="always"
      />
    </div>
  );
}

function AuthProviderTestStatus({
  value,
}: {
  value: "failed" | "not_tested" | "partial" | "passed";
}) {
  const { t } = useLocale();
  if (value === "not_tested")
    return <span className="text-xs text-muted">—</span>;
  return (
    <StatusBadge
      tone={
        value === "passed"
          ? "success"
          : value === "partial"
            ? "warning"
            : "danger"
      }
    >
      {t(
        value === "passed"
          ? "authTestPassed"
          : value === "partial"
            ? "authTestPartial"
            : "authTestFailed",
      )}
    </StatusBadge>
  );
}
