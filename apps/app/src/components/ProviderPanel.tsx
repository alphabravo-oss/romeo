import {
  Button,
  DropdownMenu,
  EmptyState,
  IconButton,
  StatusBadge,
} from "@romeo/ui";
import EllipsisVertical from "lucide-react/dist/esm/icons/ellipsis-vertical.mjs";
import { useCallback, useMemo } from "react";

import type {
  Provider,
  ProviderOperationalProviderSummary,
  ProviderVerification,
} from "../features/providers/types";
import { useLocale } from "../lib/i18n";
import { toast } from "../lib/toast";
import { ConnectionDialog } from "./ProviderConnectionDialog";
import { DataTable, createColumnHelper, type ColumnDef } from "./DataTable";
import { PanelStats } from "./PanelStats";
import { ProviderCatalogStatus } from "./ProviderCatalogStatus";
import { ProviderDetailsPage } from "./ProviderDetailsSheet";
import { useConfirm } from "./ConfirmDialog";
import { useProviderPanelState } from "./useProviderPanelState";
import { useProviderModelToggle } from "./useProviderModelToggle";
import type { ProviderPanelProps } from "./provider-panel-types";

export type { ProviderFormInput } from "./ProviderConnectionDialog";

interface ProviderTableRow {
  availableModelCount: number;
  chatModelCount: number;
  enabledModelCount: number;
  dependentAgentCount: number;
  operational: ProviderOperationalProviderSummary | undefined;
  provider: Provider;
  totalModelCount: number;
  verification: ProviderVerification | undefined;
}

const providerColumn = createColumnHelper<ProviderTableRow>();

export function ProviderPanel({
  agents,
  isCreating,
  isUpdating,
  pullingProviderId,
  deletingModelId,
  syncingProviderId,
  verifyingProviderId,
  onCreateProvider,
  onPullProviderModel,
  onDeleteProviderModel,
  onSyncProvider,
  onUpdateModel,
  onUpdateProvider,
  onVerifyProvider,
  operationalSummary,
  providers,
  models,
  onProviderSelectionChange,
  selectedProviderId,
}: ProviderPanelProps) {
  const { t } = useLocale();
  const { ask: askDependencyImpact, dialog: dependencyImpactDialog } =
    useConfirm();
  const updateModelEnabled = useProviderModelToggle({
    agents,
    ask: askDependencyImpact,
    onUpdateModel,
    t,
  });
  const {
    confirmDialog,
    dialog,
    modelsByProvider,
    pull,
    pullNames,
    remove,
    setDialog,
    setPullNames,
    sync,
    verification,
    verify,
  } = useProviderPanelState({
    models,
    onDeleteProviderModel,
    onPullProviderModel,
    onSyncProvider,
    onVerifyProvider,
  });

  const operationalByProvider = useMemo(
    () =>
      new Map(
        (operationalSummary?.providers ?? []).map((provider) => [
          provider.providerId,
          provider,
        ]),
      ),
    [operationalSummary?.providers],
  );
  const rows = useMemo<ProviderTableRow[]>(
    () =>
      providers.map((provider) => {
        const providerModels = modelsByProvider.get(provider.id) ?? [];
        const chatModels = providerModels.filter(
          (model) => !model.capabilities.modalities.includes("embeddings"),
        );
        return {
          availableModelCount: chatModels.filter(
            (model) => model.available !== false,
          ).length,
          chatModelCount: chatModels.length,
          enabledModelCount: chatModels.filter(
            (model) => model.enabled && model.available !== false,
          ).length,
          dependentAgentCount: agents.filter((agent) =>
            providerModels.some((model) => model.id === agent.baseModelId),
          ).length,
          operational: operationalByProvider.get(provider.id),
          provider,
          totalModelCount: providerModels.length,
          verification: verification[provider.id],
        };
      }),
    [agents, modelsByProvider, operationalByProvider, providers, verification],
  );

  const updateEnabled = useCallback(
    async (provider: Provider, enabled: boolean) => {
      const dependentAgents = agents.filter((agent) =>
        (modelsByProvider.get(provider.id) ?? []).some(
          (model) => model.id === agent.baseModelId,
        ),
      );
      if (
        !enabled &&
        dependentAgents.length > 0 &&
        !(await askDependencyImpact({
          title: t("providerDisableImpactTitle"),
          body: t("providerDisableImpactDescription", {
            agents: dependentAgents.length,
            models: new Set(dependentAgents.map((agent) => agent.baseModelId))
              .size,
            names: dependentAgents
              .slice(0, 5)
              .map((agent) => agent.name)
              .join(", "),
          }),
          confirmLabel: t("disableProvider"),
          tone: "danger",
        }))
      )
        return;
      await onUpdateProvider({
        providerId: provider.id,
        name: provider.name,
        baseUrl: provider.baseUrl,
        ...(provider.modelIds === undefined
          ? {}
          : { modelIds: provider.modelIds }),
        enabled,
      });
    },
    [agents, askDependencyImpact, modelsByProvider, onUpdateProvider, t],
  );

  const columns = useMemo<ColumnDef<ProviderTableRow, any>[]>(
    () => [
      providerColumn.accessor((row) => row.provider.name, {
        id: "provider",
        header: t("providerCredentials"),
        cell: (context) => {
          const provider = context.row.original.provider;
          return (
            <div className="min-w-0">
              <strong className="block truncate" translate="no">
                {provider.name}
              </strong>
              <span
                className="mt-1 block truncate text-xs text-muted"
                title={provider.baseUrl}
                translate="no"
              >
                {provider.baseUrl}
              </span>
            </div>
          );
        },
      }),
      providerColumn.accessor((row) => row.provider.type, {
        id: "type",
        header: t("providerType"),
        cell: (context) => (
          <StatusBadge translate="no">{context.getValue()}</StatusBadge>
        ),
      }),
      providerColumn.accessor(
        (row) =>
          row.verification
            ? row.verification.ok
              ? "available"
              : "unavailable"
            : (row.operational?.status ??
              (row.provider.enabled ? "available" : "disabled")),
        {
          id: "health",
          header: t("connectionHealth"),
          cell: (context) => {
            const status = context.getValue();
            return (
              <StatusBadge
                tone={
                  status === "available"
                    ? "success"
                    : status === "degraded"
                      ? "warning"
                      : status === "disabled"
                        ? "neutral"
                        : "danger"
                }
              >
                {status}
              </StatusBadge>
            );
          },
        },
      ),
      providerColumn.accessor((row) => row.enabledModelCount, {
        id: "models",
        header: t("models"),
        cell: (context) => {
          const row = context.row.original;
          return (
            <span title={`${row.chatModelCount} ${t("cachedModels")}`}>
              {row.enabledModelCount}/{row.availableModelCount}
            </span>
          );
        },
      }),
      providerColumn.accessor((row) => row.dependentAgentCount, {
        id: "dependentAgents",
        header: t("providerDependentAssistants"),
      }),
      providerColumn.accessor(
        (row) => row.provider.catalogSync?.status ?? "never",
        {
          id: "catalog",
          header: t("catalog"),
          cell: (context) => {
            return (
              <ProviderCatalogStatus
                compact
                provider={context.row.original.provider}
              />
            );
          },
        },
      ),
      providerColumn.display({
        id: "actions",
        header: "",
        enableSorting: false,
        cell: (context) => {
          const provider = context.row.original.provider;
          const verifying = verifyingProviderId === provider.id;
          const syncing = syncingProviderId === provider.id;
          return (
            <div className="flex justify-end gap-1">
              <Button
                onClick={() => onProviderSelectionChange(provider.id)}
                size="sm"
              >
                {t("manageProvider")}
              </Button>
              <DropdownMenu
                items={[
                  {
                    disabled: verifying,
                    label: t("verify"),
                    onSelect: () => void verify(provider.id),
                  },
                  {
                    disabled: syncing,
                    label: t("refreshModels"),
                    onSelect: () => void sync(provider.id),
                  },
                  {
                    label: provider.enabled
                      ? t("disableProvider")
                      : t("enableProvider"),
                    onSelect: () =>
                      void updateEnabled(provider, !provider.enabled),
                  },
                  {
                    label: t("configure"),
                    onSelect: () => setDialog(provider),
                  },
                ]}
                trigger={
                  <IconButton
                    aria-label={`${t("moreActions")}: ${provider.name}`}
                    size="sm"
                    variant="ghost"
                  >
                    <EllipsisVertical aria-hidden size={16} />
                  </IconButton>
                }
              />
            </div>
          );
        },
      }),
    ],
    [
      onProviderSelectionChange,
      setDialog,
      syncingProviderId,
      t,
      verifyingProviderId,
      verify,
      sync,
      updateEnabled,
    ],
  );

  const selectedProvider = selectedProviderId
    ? providers.find((provider) => provider.id === selectedProviderId)
    : undefined;
  const selectedModels = selectedProvider
    ? (modelsByProvider.get(selectedProvider.id) ?? [])
    : [];
  const selectedVerification = selectedProvider
    ? verification[selectedProvider.id]
    : undefined;
  const availableProviders =
    operationalSummary?.providers.filter(
      (provider) => provider.status === "available",
    ).length ?? providers.filter((provider) => provider.enabled).length;

  if (selectedProvider) {
    return (
      <>
        <ProviderDetailsPage
          dependentAgents={agents.filter((agent) =>
            selectedModels.some((model) => model.id === agent.baseModelId),
          )}
          deletingModelId={deletingModelId}
          isUpdating={isUpdating}
          models={selectedModels}
          onBack={() => onProviderSelectionChange(null)}
          onConfigure={() => setDialog(selectedProvider)}
          onDeleteModel={remove}
          onPullModel={pull}
          onRefresh={() => void sync(selectedProvider.id)}
          onToggle={(enabled) => void updateEnabled(selectedProvider, enabled)}
          onToggleModel={updateModelEnabled}
          onVerify={() => void verify(selectedProvider.id)}
          provider={selectedProvider}
          pullName={pullNames[selectedProvider.id] ?? ""}
          pulling={pullingProviderId === selectedProvider.id}
          setPullName={(value) =>
            setPullNames((current) => ({
              ...current,
              [selectedProvider.id]: value,
            }))
          }
          syncing={syncingProviderId === selectedProvider.id}
          verification={selectedVerification}
          verifying={verifyingProviderId === selectedProvider.id}
        />
        {dialog ? (
          <ConnectionDialog
            busy={isCreating || isUpdating}
            key={dialog === "new" ? "new" : dialog.id}
            onClose={() => setDialog(undefined)}
            onSave={async (value) => {
              await onUpdateProvider({
                providerId: selectedProvider.id,
                name: value.name,
                baseUrl: value.baseUrl,
                ...(value.apiKey === undefined ? {} : { apiKey: value.apiKey }),
                ...(value.modelIds === undefined
                  ? {}
                  : { modelIds: value.modelIds }),
                refreshModels: true,
              });
              toast(t("connectionUpdated"), "success");
              setDialog(undefined);
            }}
            provider={selectedProvider}
          />
        ) : null}
        {confirmDialog}
        {dependencyImpactDialog}
      </>
    );
  }

  return (
    <section className="rm-panel p-4">
      <div className="rm-card-header">
        <div>
          <div className="rm-card-title">{t("providerCredentials")}</div>
          <p className="text-sm text-muted">{t("connectionsDescription")}</p>
        </div>
        <Button onClick={() => setDialog("new")} variant="primary">
          + {t("addProvider")}
        </Button>
      </div>

      <div className="mt-4 grid gap-4">
        <PanelStats
          items={[
            { label: t("connections"), value: providers.length },
            { label: t("availability"), value: availableProviders },
            {
              label: t("operationalAlerts"),
              value: operationalSummary?.alerts.length ?? 0,
            },
          ]}
        />

        {providers.length === 0 ? (
          <EmptyState title={t("connectEndpoint")}>
            {t("connectionsDescription")}
          </EmptyState>
        ) : (
          <DataTable
            columns={columns}
            data={rows}
            getRowId={(row) => row.provider.id}
            minTableWidth={960}
          />
        )}
      </div>

      {dialog ? (
        <ConnectionDialog
          busy={isCreating || isUpdating}
          key={dialog === "new" ? "new" : dialog.id}
          onClose={() => setDialog(undefined)}
          onSave={async (value) => {
            if (dialog === "new") await onCreateProvider(value);
            else
              await onUpdateProvider({
                providerId: dialog.id,
                name: value.name,
                baseUrl: value.baseUrl,
                ...(value.apiKey === undefined ? {} : { apiKey: value.apiKey }),
                ...(value.modelIds === undefined
                  ? {}
                  : { modelIds: value.modelIds }),
                refreshModels: true,
              });
            toast(
              dialog === "new" ? t("connectionAdded") : t("connectionUpdated"),
              "success",
            );
            setDialog(undefined);
          }}
          provider={dialog === "new" ? undefined : dialog}
        />
      ) : null}
      {confirmDialog}
      {dependencyImpactDialog}
    </section>
  );
}
