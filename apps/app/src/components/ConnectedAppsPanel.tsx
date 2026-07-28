import { Button } from "@romeo/ui";
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
            <span className="rm-cell-muted rm-mono">{c.getValue()}</span>
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
                      label: t("connectedAppsProviders"),
                      value: posture.providers.length,
                    },
                    {
                      label: t("connectedAppsConnections"),
                      value: totals.total,
                    },
                    { label: t("connectedAppsActive"), value: totals.active },
                    {
                      label: t("connectedAppsReauthRequired"),
                      value: totals.reauthorizationRequired,
                    },
                    {
                      label: t("connectedAppsExpiringTokens"),
                      value: totals.expiringAccessToken,
                    },
                    {
                      label: t("connectedAppsStatusRevoked"),
                      value: totals.revoked,
                    },
                    {
                      label: t("connectedAppsWarnings"),
                      value: posture.warnings.length,
                    },
                  ]}
                />
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
              <div className="grid gap-2 text-sm">
                {providers.map((provider) => (
                  <div
                    className="rounded-md border border-border p-3"
                    key={provider.id}
                  >
                    <div className="font-medium">{provider.displayName}</div>
                    <div className="break-words text-muted">
                      {provider.authorizationHost}
                      {provider.configured
                        ? ""
                        : ` - ${t("connectedAppsNotConfigured")}`}
                    </div>
                    <Button
                      className="mt-2"
                      disabled={!provider.configured || startMutation.isPending}
                      onClick={() => void handleConnect(provider)}
                      type="button"
                    >
                      {startMutation.isPending
                        ? t("connectedAppsConnecting")
                        : t("connectedAppsConnect")}
                    </Button>
                  </div>
                ))}
              </div>
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
