import { Button, StatusBadge } from "@romeo/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import {
  getDelegatedOauthPosture,
  type DelegatedOAuthConnectionSummary,
  type DelegatedOAuthProvider,
  listDelegatedOAuthConnections,
  listDelegatedOAuthProviders,
  revokeDelegatedOAuthConnection,
  startDelegatedOAuth,
} from "../features/delegated-oauth";
import { useLocale, type MessageKey } from "../lib/i18n";
import { PanelState } from "../lib/panel-state";
import { LocalizedDateTime } from "../lib/locale-format";
import { toast } from "../lib/toast";
import { useConfirm } from "./ConfirmDialog";
import { type ColumnDef, DataTable, createColumnHelper } from "./DataTable";
import { PanelStats } from "./PanelStats";
import { useWorkspace } from "./WorkspaceContext";

const connectionCol = createColumnHelper<DelegatedOAuthConnectionSummary>();
const providerCol = createColumnHelper<DelegatedOAuthProvider>();

export function ConnectedAppsPanel() {
  const queryClient = useQueryClient();
  const { t } = useLocale();
  const { workspaceId } = useWorkspace();
  const { ask, dialog } = useConfirm();

  const providersQuery = useQuery({
    queryKey: ["delegatedOAuthProviders"],
    queryFn: listDelegatedOAuthProviders,
  });
  const connectionsQuery = useQuery({
    queryKey: ["delegatedOAuthConnections", workspaceId ?? null],
    queryFn: () => listDelegatedOAuthConnections(workspaceId),
  });
  const postureQuery = useQuery({
    queryKey: ["delegatedOAuthPosture"],
    queryFn: getDelegatedOauthPosture,
  });
  const startMutation = useMutation({ mutationFn: startDelegatedOAuth });
  const revokeMutation = useMutation({
    mutationFn: revokeDelegatedOAuthConnection,
  });

  async function handleConnect(provider: DelegatedOAuthProvider) {
    if (workspaceId === undefined) {
      toast(t("connectedAppsSelectWorkspace"), "error");
      return;
    }
    const connectorType = provider.connectorTypes[0];
    if (connectorType === undefined) {
      toast(t("connectedAppsNoConnectorTypes"), "error");
      return;
    }
    try {
      const result = await startMutation.mutateAsync({
        providerId: provider.id,
        workspaceId,
        connectorType,
      });
      window.open(result.authorizationUrl, "_blank", "noopener,noreferrer");
      toast(t("connectedAppsAuthorizationOpened"), "success");
    } catch {
      toast(t("connectedAppsCouldNotStart"), "error");
    }
  }

  async function handleRevoke(connectionId: string) {
    if (
      !(await ask({
        title: t("connectedAppsRevokeTitle"),
        body: t("connectedAppsRevokeBody"),
        confirmLabel: t("connectedAppsRevoke"),
        tone: "danger",
      }))
    )
      return;
    try {
      await revokeMutation.mutateAsync(connectionId);
      await queryClient.invalidateQueries({
        queryKey: ["delegatedOAuthConnections"],
      });
      toast(t("connectedAppsRevoked"), "success");
    } catch {
      toast(t("connectedAppsCouldNotRevoke"), "error");
    }
  }

  const columns = useMemo<ColumnDef<DelegatedOAuthConnectionSummary, any>[]>(
    () => [
      connectionCol.accessor("providerId", {
        header: t("connectedAppsProvider"),
        cell: (c) => <span className="font-medium">{c.getValue()}</span>,
      }),
      connectionCol.accessor(
        (row) => row.providerAccountLoginHash ?? row.providerAccountHash,
        {
          id: "account",
          header: t("connectedAppsAccount"),
          cell: (c) => (
            <span className="rm-cell-muted rm-mono" translate="no">
              {c.getValue()}
            </span>
          ),
        },
      ),
      connectionCol.accessor("connectorType", {
        header: t("connectedAppsConnector"),
        cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>,
      }),
      connectionCol.accessor("status", {
        header: t("connectedAppsStatus"),
        cell: (c) => (
          <span className="rm-cell-muted">
            {t(connectedAppStatusMessageKey(c.getValue()))}
          </span>
        ),
      }),
      connectionCol.accessor((row) => row.createdAt, {
        id: "createdAt",
        header: t("connectedAppsConnected"),
        cell: (c) => (
          <span className="rm-cell-muted">
            <LocalizedDateTime value={c.getValue()} />
          </span>
        ),
      }),
      connectionCol.display({
        id: "actions",
        header: "",
        cell: (c) =>
          c.row.original.status === "revoked" ? null : (
            <Button
              disabled={revokeMutation.isPending}
              onClick={() => void handleRevoke(c.row.original.id)}
              type="button"
            >
              {t("connectedAppsRevoke")}
            </Button>
          ),
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [revokeMutation.isPending, t],
  );
  const providerColumns = useMemo<ColumnDef<DelegatedOAuthProvider, any>[]>(
    () => [
      providerCol.accessor("displayName", {
        header: t("connectedAppsProvider"),
        cell: (cell) => <span className="font-medium">{cell.getValue()}</span>,
      }),
      providerCol.accessor("authorizationHost", {
        header: t("connectedAppsAuthorizationHost"),
        cell: (cell) => (
          <span className="rm-mono text-sm" translate="no">
            {cell.getValue()}
          </span>
        ),
      }),
      providerCol.accessor((row) => row.connectorTypes.join(", "), {
        id: "connectors",
        header: t("connectedAppsConnector"),
        cell: (cell) => <span translate="no">{cell.getValue()}</span>,
      }),
      providerCol.accessor("configured", {
        header: t("connectedAppsStatus"),
        cell: (cell) => (
          <StatusBadge tone={cell.getValue() ? "success" : "warning"}>
            {cell.getValue()
              ? t("connectedAppsConfigured")
              : t("connectedAppsNotConfigured")}
          </StatusBadge>
        ),
      }),
      providerCol.display({
        id: "actions",
        header: "",
        cell: (cell) => (
          <Button
            disabled={!cell.row.original.configured || startMutation.isPending}
            onClick={() => void handleConnect(cell.row.original)}
            size="sm"
            type="button"
          >
            {startMutation.isPending
              ? t("connectedAppsConnecting")
              : t("connectedAppsConnect")}
          </Button>
        ),
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [startMutation.isPending, t, workspaceId],
  );

  return (
    <section className="rm-panel p-4">
      <div className="rm-card-header">
        <div className="rm-card-title">{t("connectedAppsTitle")}</div>
        <Button
          disabled={connectionsQuery.isFetching}
          onClick={() => void connectionsQuery.refetch()}
          type="button"
        >
          {connectionsQuery.isFetching ? t("refreshing") : t("refresh")}
        </Button>
      </div>

      <div className="mt-3">
        <div className="text-sm text-muted">{t("connectedAppsPosture")}</div>
        <div className="mt-2">
          <PanelState query={postureQuery} empty={t("connectedAppsNoPosture")}>
            {(posture) => {
              const totals = posture.providers.reduce(
                (acc, provider) => ({
                  active: acc.active + provider.connectionCounts.active,
                  expiringAccessToken:
                    acc.expiringAccessToken +
                    provider.connectionCounts.expiringAccessToken,
                  reauthorizationRequired:
                    acc.reauthorizationRequired +
                    provider.connectionCounts.reauthorizationRequired,
                  revoked: acc.revoked + provider.connectionCounts.revoked,
                  total: acc.total + provider.connectionCounts.total,
                }),
                {
                  active: 0,
                  expiringAccessToken: 0,
                  reauthorizationRequired: 0,
                  revoked: 0,
                  total: 0,
                },
              );
              return (
                <>
                  <PanelStats
                    items={[
                      {
                        label: t("connectedAppsStatus"),
                        value:
                          posture.status === "healthy"
                            ? t("connectedAppsHealthy")
                            : t("connectedAppsAttention"),
                      },
                      {
                        label: t("connectedAppsConnections"),
                        value: totals.total,
                      },
                      { label: t("connectedAppsActive"), value: totals.active },
                      {
                        label: t("connectedAppsAttention"),
                        value:
                          totals.reauthorizationRequired +
                          totals.expiringAccessToken +
                          totals.revoked,
                      },
                    ]}
                  />
                  {posture.warnings.length > 0 ? (
                    <div className="mt-3 rounded-md border border-border p-3">
                      <strong className="text-sm">
                        {t("connectedAppsWarnings")}
                      </strong>
                      <ul className="mt-1 grid gap-1 text-sm text-muted">
                      {posture.warnings.map((warning) => (
                        <li className="grid gap-0.5" key={warning}>
                          <span>{connectedAppWarningLabel(warning, t)}</span>
                          <code className="text-xs" translate="no">
                            {warning}
                          </code>
                        </li>
                      ))}
                      </ul>
                    </div>
                  ) : null}
                </>
              );
            }}
          </PanelState>
        </div>
      </div>

      <div className="mt-4">
        <div className="text-sm text-muted">
          {t("connectedAppsAvailableProviders")}
        </div>
        <div className="mt-2">
          <PanelState
            query={providersQuery}
            empty={t("connectedAppsNoProviders")}
          >
            {(providers) => (
              <DataTable
                columns={providerColumns}
                data={providers}
                getRowId={(provider) => provider.id}
                minTableWidth={720}
              />
            )}
          </PanelState>
        </div>
      </div>

      <div className="mt-4">
        <div className="text-sm text-muted">
          {t("connectedAppsActiveConnections")}
        </div>
        <div className="mt-2">
          <PanelState
            query={connectionsQuery}
            empty={t("connectedAppsNoConnections")}
          >
            {(rows) => <DataTable columns={columns} data={rows} />}
          </PanelState>
        </div>
      </div>
      {dialog}
    </section>
  );
}

function connectedAppStatusMessageKey(
  status: DelegatedOAuthConnectionSummary["status"],
): MessageKey {
  if (status === "active") return "connectedAppsStatusActive";
  if (status === "reauthorization_required") return "connectedAppsStatusReauth";
  return "connectedAppsStatusRevoked";
}

function connectedAppWarningLabel(
  warning: string,
  t: (key: MessageKey) => string,
): string {
  if (warning.startsWith("delegated_oauth_provider_not_configured:")) {
    return `${t("connectedAppsProviderNotConfiguredWarning")}: ${
      warning.split(":")[1] ?? ""
    }`;
  }
  return t("connectedAppsPostureWarning");
}
