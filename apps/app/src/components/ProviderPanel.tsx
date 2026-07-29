import {
  Button,
  DropdownMenu,
  EmptyState,
  IconButton,
  StatusBadge,
} from "@romeo/ui";
import MoreHorizontal from "lucide-react/dist/esm/icons/ellipsis.mjs";
import { useMemo, useState } from "react";

import type {
  BaseModel,
  Provider,
  ProviderOperationalProviderSummary,
  ProviderOperationalSummary,
  ProviderVerification,
} from "../features/providers/types";
import { useLocale } from "../lib/i18n";
import { toast } from "../lib/toast";
import {
  ConnectionDialog,
  type ProviderFormInput,
} from "./ProviderConnectionDialog";
import { DataTable, createColumnHelper, type ColumnDef } from "./DataTable";
import { PanelStats } from "./PanelStats";
import { ProviderDetailsSheet } from "./ProviderDetailsSheet";
import { useProviderPanelState } from "./useProviderPanelState";

export type { ProviderFormInput } from "./ProviderConnectionDialog";

interface ProviderTableRow {
  chatModelCount: number;
  enabledModelCount: number;
  operational: ProviderOperationalProviderSummary | undefined;
  provider: Provider;
  totalModelCount: number;
  verification: ProviderVerification | undefined;
}

const providerColumn = createColumnHelper<ProviderTableRow>();

export function ProviderPanel({
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
  onUpdateProvider,
  onVerifyProvider,
  operationalSummary,
  providers,
  models,
}: {
  isCreating: boolean;
  isUpdating: boolean;
  pullingProviderId: string | undefined;
  deletingModelId: string | undefined;
  syncingProviderId: string | undefined;
  verifyingProviderId: string | undefined;
  onCreateProvider: (input: ProviderFormInput) => Promise<void>;
  onPullProviderModel: (providerId: string, model: string) => Promise<unknown>;
  onDeleteProviderModel: (
    providerId: string,
    modelId: string,
    model: string,
  ) => Promise<unknown>;
  onSyncProvider: (providerId: string) => Promise<void>;
  onUpdateProvider: (
    input: Omit<ProviderFormInput, "type"> & {
      providerId: string;
      enabled?: boolean;
      refreshModels?: boolean;
    },
  ) => Promise<void>;
  onVerifyProvider: (providerId: string) => Promise<ProviderVerification>;
  operationalSummary: ProviderOperationalSummary | undefined;
  providers: Provider[];
  models: BaseModel[];
}) {
  const { t } = useLocale();
  const [selectedProviderId, setSelectedProviderId] = useState<string>();
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
          chatModelCount: chatModels.length,
          enabledModelCount: chatModels.filter((model) => model.enabled).length,
          operational: operationalByProvider.get(provider.id),
          provider,
          totalModelCount: providerModels.length,
          verification: verification[provider.id],
        };
      }),
    [modelsByProvider, operationalByProvider, providers, verification],
  );

  const updateEnabled = (provider: Provider, enabled: boolean) =>
    onUpdateProvider({
      providerId: provider.id,
      name: provider.name,
      baseUrl: provider.baseUrl,
      ...(provider.modelIds === undefined
        ? {}
        : { modelIds: provider.modelIds }),
      enabled,
    });

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
            <span>
              {row.enabledModelCount}/{row.chatModelCount}
            </span>
          );
        },
      }),
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
                onClick={() => setSelectedProviderId(provider.id)}
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
                    <MoreHorizontal aria-hidden size={16} />
                  </IconButton>
                }
              />
            </div>
          );
        },
      }),
    ],
    [setDialog, syncingProviderId, t, verifyingProviderId, verify, sync],
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
            minTableWidth={820}
          />
        )}
      </div>

      <ProviderDetailsSheet
        deletingModelId={deletingModelId}
        isUpdating={isUpdating}
        models={selectedModels}
        onClose={() => setSelectedProviderId(undefined)}
        onConfigure={() => {
          if (selectedProvider) setDialog(selectedProvider);
        }}
        onDeleteModel={remove}
        onPullModel={pull}
        onRefresh={() => {
          if (selectedProvider) void sync(selectedProvider.id);
        }}
        onToggle={(enabled) => {
          if (selectedProvider) void updateEnabled(selectedProvider, enabled);
        }}
        onVerify={() => {
          if (selectedProvider) void verify(selectedProvider.id);
        }}
        open={selectedProvider !== undefined}
        provider={selectedProvider}
        pullName={
          selectedProvider ? (pullNames[selectedProvider.id] ?? "") : ""
        }
        pulling={pullingProviderId === selectedProvider?.id}
        setPullName={(value) => {
          if (!selectedProvider) return;
          setPullNames((current) => ({
            ...current,
            [selectedProvider.id]: value,
          }));
        }}
        syncing={syncingProviderId === selectedProvider?.id}
        verification={selectedVerification}
        verifying={verifyingProviderId === selectedProvider?.id}
      />

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
    </section>
  );
}
