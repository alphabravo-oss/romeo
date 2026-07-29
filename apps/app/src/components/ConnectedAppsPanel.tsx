import { Button, StatusBadge } from "@romeo/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link2 from "lucide-react/dist/esm/icons/link-2.mjs";
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
import { ProviderSlotCard } from "./ProviderSlotCard";
import { splitProviderZones } from "./auth-provider-zones";
import { useWorkspace } from "./WorkspaceContext";

const connectionCol = createColumnHelper<DelegatedOAuthConnectionSummary>();

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
  const connectionCountByProvider = useMemo(
    () =>
      new Map(
        (providersQuery.data ?? []).map((provider) => [
          provider.id,
          (connectionsQuery.data ?? []).filter(
            (connection) =>
              connection.providerId === provider.id &&
              connection.status !== "revoked",
          ).length,
        ]),
      ),
    [connectionsQuery.data, providersQuery.data],
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
          <PanelState
            empty={t("connectedAppsNoPosture")}
            emptyDescription={t("connectedAppsNoPostureDescription")}
            emptyIcon={<Link2 aria-hidden size={24} />}
            query={postureQuery}
          >
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
            emptyDescription={t("connectedAppsNoProvidersDescription")}
            emptyIcon={<Link2 aria-hidden size={24} />}
          >
            {(providers) => {
              const zones = splitProviderZones(
                providers.map((provider) => {
                  const connectionCount =
                    connectionCountByProvider.get(provider.id) ?? 0;
                  return {
                    ...provider,
                    configured: connectionCount > 0,
                    connectionCount,
                    enabled: connectionCount > 0,
                    status: provider.configured
                      ? ("implemented" as const)
                      : ("planned" as const),
                  };
                }),
              );
              return (
                <div className="grid gap-4">
                  {zones.active.length > 0 ? (
                    <section className="rm-provider-zone">
                      <h3 className="rm-provider-zone__label">
                        {t("authZoneActive")}
                      </h3>
                      <div className="rm-provider-zone__grid">
                        {zones.active.map((provider) => (
                          <ProviderSlotCard
                            actions={
                              <Button
                                disabled={startMutation.isPending}
                                onClick={() => void handleConnect(provider)}
                                size="sm"
                                type="button"
                                variant="secondary"
                              >
                                {startMutation.isPending
                                  ? t("connectedAppsConnecting")
                                  : t("authConfigure")}
                              </Button>
                            }
                            configured
                            enabled
                            facts={[
                              {
                                label: t("connectedAppsConnections"),
                                value: String(provider.connectionCount),
                              },
                            ]}
                            icon={<Link2 aria-hidden size={22} />}
                            key={provider.id}
                            name={provider.displayName}
                            protocol={t("connectedAppsOAuthProtocol")}
                          />
                        ))}
                      </div>
                    </section>
                  ) : null}

                  {zones.available.length > 0 ? (
                    <section className="rm-provider-zone">
                      <h3 className="rm-provider-zone__label">
                        {t("authZoneAvailable")}
                      </h3>
                      <div className="rm-provider-zone__grid rm-provider-zone__grid--dense">
                        {zones.available.map((provider) => (
                          <Button
                            key={provider.id}
                            disabled={startMutation.isPending}
                            onClick={() => void handleConnect(provider)}
                            variant="outline"
                          >
                            <Link2 aria-hidden size={18} />
                            <span translate="no">{provider.displayName}</span>
                            <span>{t("authConfigure")}</span>
                          </Button>
                        ))}
                      </div>
                    </section>
                  ) : null}

                  {zones.unavailable.length > 0 ? (
                    <section className="rm-provider-zone">
                      <h3 className="rm-provider-zone__label">
                        {t("authZoneUnavailable")}
                      </h3>
                      <div className="rm-provider-card__facts">
                        {zones.unavailable.map((provider) => (
                          <StatusBadge key={provider.id} tone="warning">
                            <span translate="no">{provider.displayName}</span> ·{" "}
                            {t("connectedAppsNotConfiguredWarning")}
                          </StatusBadge>
                        ))}
                      </div>
                    </section>
                  ) : null}
                </div>
              );
            }}
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
            emptyDescription={t("connectedAppsNoConnectionsDescription")}
            emptyIcon={<Link2 aria-hidden size={24} />}
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
    return t("connectedAppsNotConfiguredWarning");
  }
  return t("connectedAppsPostureWarning");
}
