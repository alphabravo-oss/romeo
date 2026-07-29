import {
  Button,
  DropdownMenu,
  IconButton,
  Sheet,
  StatusBadge,
  Switch,
} from "@romeo/ui";
import MoreHorizontal from "lucide-react/dist/esm/icons/ellipsis.mjs";
import Settings2 from "lucide-react/dist/esm/icons/settings-2.mjs";
import TestTube2 from "lucide-react/dist/esm/icons/test-tube-2.mjs";
import { useMemo, useState } from "react";

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
import { DataTable, createColumnHelper, type ColumnDef } from "./DataTable";
import { PanelStats } from "./PanelStats";

interface AuthProviderRow {
  configured: boolean;
  enabled: boolean;
  entry: AuthProviderCatalogEntry;
  setting: EffectiveAuthProviderSetting | undefined;
  source: string;
  test: AuthProviderConnectionTestReport | undefined;
}

const column = createColumnHelper<AuthProviderRow>();

export function AuthProviderTableView({
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
}) {
  const { t } = useLocale();
  const [selectedProviderId, setSelectedProviderId] =
    useState<AuthProviderId>();
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
          setting,
          source: setting?.source ?? "default",
          test: testResults[entry.id],
        };
      }),
    [catalog, effectiveById, testResults],
  );
  const selectedRow = selectedProviderId
    ? rows.find((row) => row.entry.id === selectedProviderId)
    : undefined;
  const columns = useMemo<ColumnDef<AuthProviderRow, any>[]>(
    () => [
      column.accessor((row) => row.entry.name, {
        id: "provider",
        header: t("authProvider"),
        cell: ({ row }) => (
          <div className="flex min-w-0 items-center gap-3">
            <span className="shrink-0">
              {authProviderIcon(row.original.entry.id)}
            </span>
            <strong className="truncate" translate="no">
              {row.original.entry.name}
            </strong>
          </div>
        ),
      }),
      column.accessor((row) => row.entry.protocol, {
        id: "protocol",
        header: t("authProtocol"),
        cell: (context) => (
          <StatusBadge translate="no">{context.getValue()}</StatusBadge>
        ),
      }),
      column.accessor((row) => row.source, {
        id: "source",
        header: t("authSource"),
        cell: (context) => <span translate="no">{context.getValue()}</span>,
      }),
      column.accessor((row) => row.enabled, {
        id: "status",
        header: t("status"),
        cell: ({ row }) =>
          row.original.entry.status === "planned" ? (
            <StatusBadge>{t("authComingSoon")}</StatusBadge>
          ) : (
            <StatusBadge tone={row.original.enabled ? "success" : "neutral"}>
              {row.original.enabled ? t("authOn") : t("authOff")}
            </StatusBadge>
          ),
      }),
      column.accessor((row) => row.configured, {
        id: "configuration",
        header: t("authConfiguration"),
        cell: (context) => (
          <StatusBadge tone={context.getValue() ? "success" : "warning"}>
            {context.getValue() ? t("authConfigured") : t("authNotConfigured")}
          </StatusBadge>
        ),
      }),
      column.accessor((row) => row.test?.status ?? "not_tested", {
        id: "connection",
        header: t("authConnection"),
        cell: (context) => {
          const status = context.getValue();
          return (
            <StatusBadge
              tone={
                status === "passed"
                  ? "success"
                  : status === "partial"
                    ? "warning"
                    : status === "failed"
                      ? "danger"
                      : "neutral"
              }
            >
              {status === "not_tested" ? t("authNotTested") : status}
            </StatusBadge>
          );
        },
      }),
      column.display({
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row: { original: row } }) => {
          const planned = row.entry.status === "planned";
          const canTest = canTestProvider(row.entry);
          const canDeprovision = canDeprovisionProvider(row.entry);
          return (
            <div className="flex justify-end gap-1">
              <Button
                onClick={() => setSelectedProviderId(row.entry.id)}
                size="sm"
              >
                {t("authManageProvider")}
              </Button>
              <DropdownMenu
                items={[
                  {
                    disabled: planned || busy,
                    label: row.enabled ? t("authDisable") : t("authEnable"),
                    onSelect: () => onToggle(row.entry, !row.enabled),
                  },
                  {
                    disabled: planned,
                    label: t("authConfigure"),
                    onSelect: () => onConfigure(row.entry),
                  },
                  ...(canTest
                    ? [
                        {
                          disabled: testing,
                          label: testing ? t("authTesting") : t("authTest"),
                          onSelect: () => onTest(row.entry),
                        },
                      ]
                    : []),
                  ...(canDeprovision
                    ? [
                        {
                          danger: true,
                          disabled: deprovisioning,
                          label: t("authDeprovision"),
                          onSelect: () => onDeprovision(row.entry),
                          separatorBefore: true,
                        },
                      ]
                    : []),
                ]}
                trigger={
                  <IconButton
                    aria-label={`${t("moreActions")}: ${row.entry.name}`}
                    size="sm"
                    variant="ghost"
                  >
                    <MoreHorizontal aria-hidden size={16} />
                  </IconButton>
                }
              />
            </div>
          );
        },
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
          { label: t("authTotal"), value: catalog.length },
          {
            label: t("authEnabled"),
            value: rows.filter((row) => row.enabled).length,
          },
          {
            label: t("authConfigured"),
            value: rows.filter((row) => row.configured).length,
          },
        ]}
      />
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => row.entry.id}
        minTableWidth={860}
      />
      <AuthProviderDetailsSheet
        busy={busy}
        deprovisioning={deprovisioning}
        onClose={() => setSelectedProviderId(undefined)}
        onConfigure={onConfigure}
        onDeprovision={onDeprovision}
        onTest={onTest}
        onToggle={onToggle}
        open={selectedRow !== undefined}
        row={selectedRow}
        testing={testing}
      />
    </div>
  );
}

function AuthProviderDetailsSheet({
  busy,
  deprovisioning,
  onClose,
  onConfigure,
  onDeprovision,
  onTest,
  onToggle,
  open,
  row,
  testing,
}: {
  busy: boolean;
  deprovisioning: boolean;
  onClose: () => void;
  onConfigure: (entry: AuthProviderCatalogEntry) => void;
  onDeprovision: (entry: AuthProviderCatalogEntry) => void;
  onTest: (entry: AuthProviderCatalogEntry) => void;
  onToggle: (entry: AuthProviderCatalogEntry, enabled: boolean) => void;
  open: boolean;
  row: AuthProviderRow | undefined;
  testing: boolean;
}) {
  const { t } = useLocale();
  const entry = row?.entry;
  const planned = entry?.status === "planned";
  const canTest = entry ? canTestProvider(entry) : false;
  const canDeprovision = entry ? canDeprovisionProvider(entry) : false;
  return (
    <Sheet
      closeLabel={t("close")}
      description={t("authProviderDetails")}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
      open={open}
      title={entry?.name ?? t("authProviders")}
    >
      {entry && row ? (
        <div className="grid gap-5">
          <div className="rm-model-meta-grid">
            <span>
              <small>{t("authProtocol")}</small>
              <span translate="no">{entry.protocol}</span>
            </span>
            <span>
              <small>{t("status")}</small>
              <StatusBadge
                tone={planned ? "neutral" : row.enabled ? "success" : "neutral"}
              >
                {planned
                  ? t("authComingSoon")
                  : row.enabled
                    ? t("authOn")
                    : t("authOff")}
              </StatusBadge>
            </span>
            <span>
              <small>{t("authSource")}</small>
              <span translate="no">{row.source}</span>
            </span>
          </div>
          <div className="grid gap-2 rounded-md border border-border p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium">
                {t("authConfiguration")}
              </span>
              <StatusBadge tone={row.configured ? "success" : "warning"}>
                {row.configured ? t("authConfigured") : t("authNotConfigured")}
              </StatusBadge>
            </div>
            {row.setting?.disabledReason ? (
              <p className="text-sm text-muted">{row.setting.disabledReason}</p>
            ) : null}
            {entry.id === "local" ? (
              <p className="text-sm text-muted">
                {t("authLocalProviderGuidance")}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Switch
              checked={row.enabled}
              disabled={planned || busy}
              label={t("authEnabled")}
              onCheckedChange={(checked) => onToggle(entry, checked === true)}
            />
            <Button
              disabled={planned}
              onClick={() => onConfigure(entry)}
              variant="primary"
            >
              <Settings2 aria-hidden size={14} /> {t("authConfigure")}
            </Button>
            {canTest ? (
              <Button
                disabled={testing}
                onClick={() => onTest(entry)}
                pending={testing}
              >
                <TestTube2 aria-hidden size={14} /> {t("authTest")}
              </Button>
            ) : null}
          </div>
          {row.test ? (
            <div className="grid gap-2 border-t border-border pt-4">
              <div className="flex items-center justify-between gap-3">
                <strong>{t("authConnectionChecks")}</strong>
                <StatusBadge
                  tone={
                    row.test.status === "passed"
                      ? "success"
                      : row.test.status === "partial"
                        ? "warning"
                        : "danger"
                  }
                >
                  {row.test.status}
                </StatusBadge>
              </div>
              {row.test.checks.map((check) => (
                <div
                  className="flex items-center justify-between gap-3 text-sm"
                  key={check.id}
                >
                  <span className="text-muted">{check.id}</span>
                  <StatusBadge
                    tone={
                      check.status === "pass"
                        ? "success"
                        : check.status === "skip"
                          ? "warning"
                          : "danger"
                    }
                  >
                    {check.status}
                  </StatusBadge>
                </div>
              ))}
            </div>
          ) : null}
          {canDeprovision ? (
            <div className="border-t border-border pt-4">
              <Button
                disabled={deprovisioning}
                onClick={() => onDeprovision(entry)}
                variant="danger"
              >
                {t("authDeprovision")}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </Sheet>
  );
}
