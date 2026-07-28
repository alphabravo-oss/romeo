import CheckCircle2 from "lucide-react/dist/esm/icons/circle-check-big.mjs";
import CircleAlert from "lucide-react/dist/esm/icons/circle-alert.mjs";
import Pencil from "lucide-react/dist/esm/icons/pencil.mjs";
import Download from "lucide-react/dist/esm/icons/download.mjs";
import PlugZap from "lucide-react/dist/esm/icons/plug-zap.mjs";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw.mjs";
import Trash2 from "lucide-react/dist/esm/icons/trash-2.mjs";
import {
  Button,
  EmptyState,
  Field,
  Input,
  StatusBadge,
  Switch,
} from "@romeo/ui";

import type {
  BaseModel,
  Provider,
  ProviderOperationalSummary,
  ProviderVerification,
} from "../features/providers/types";
import { toast } from "../lib/toast";
import {
  LocalizedDuration,
  LocalizedNumber,
  LocalizedTokens,
} from "../lib/locale-format";
import { useLocale } from "../lib/i18n";
import { PanelStats } from "./PanelStats";
import {
  ConnectionDialog,
  type ProviderFormInput,
} from "./ProviderConnectionDialog";
import { useProviderPanelState } from "./useProviderPanelState";

export type { ProviderFormInput } from "./ProviderConnectionDialog";

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
  const {
    confirmDialog,
    dialog,
    expandedProviders,
    modelsByProvider,
    pull,
    pullNames,
    remove,
    setDialog,
    setExpandedProviders,
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

  return (
    <section className="rm-panel p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="rm-card-title">{t("connections")}</div>
          <p className="text-sm text-muted">{t("connectionsDescription")}</p>
        </div>
        <Button onClick={() => setDialog("new")} variant="primary">
          + {t("addConnection")}
        </Button>
      </div>

      <div className="mt-4 grid gap-4">
        <PanelStats
          items={[
            { label: t("connections"), value: providers.length },
            {
              label: t("enabled"),
              value: providers.filter((provider) => provider.enabled).length,
            },
            {
              label: t("posture"),
              value: operationalSummary?.status ?? t("unknown"),
            },
          ]}
        />

        {operationalSummary?.runtime ? (
          <div className="grid gap-2">
            <div className="text-xs font-medium uppercase tracking-wide text-muted">
              {t("runtimeLast")}{" "}
              <LocalizedNumber
                value={Math.round(
                  operationalSummary.runtime.lookbackSeconds / 60,
                )}
              />{" "}
              {t("minutes")}
            </div>
            <PanelStats
              items={[
                {
                  label: t("ttftP95"),
                  value: (
                    <LocalizedDuration
                      milliseconds={
                        operationalSummary.runtime.timeToFirstTokenP95Ms
                      }
                    />
                  ),
                },
                {
                  label: t("outputSpeed"),
                  value: (
                    <>
                      <LocalizedNumber
                        options={{ maximumFractionDigits: 1 }}
                        value={
                          operationalSummary.runtime.outputThroughputAverage
                        }
                      />{" "}
                      tok/s
                    </>
                  ),
                },
                {
                  label: t("queueP95"),
                  value: (
                    <LocalizedDuration
                      milliseconds={operationalSummary.runtime.queueWaitP95Ms}
                    />
                  ),
                },
                {
                  label: t("reconnects"),
                  value: operationalSummary.runtime.sseReconnectCount,
                },
                {
                  label: t("providerErrors"),
                  value: operationalSummary.runtime.providerErrorCount,
                },
                {
                  label: t("storageErrors"),
                  value: operationalSummary.runtime.objectStoreFailureCount,
                },
                {
                  label: t("contextAverage"),
                  value: (
                    <LocalizedTokens
                      value={Math.round(
                        operationalSummary.runtime.contextInputTokensAverage,
                      )}
                    />
                  ),
                },
              ]}
            />
            {operationalSummary.alerts.length > 0 ? (
              <ul aria-label={t("operationalAlerts")} className="grid gap-1">
                {operationalSummary.alerts.map((alert) => (
                  <li className="rm-connection-result error" key={alert.id}>
                    <CircleAlert aria-hidden="true" size={14} />
                    <span>{operationalAlertLabel(alert.code)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {providers.length === 0 ? (
          <EmptyState
            action={
              <Button onClick={() => setDialog("new")} variant="primary">
                + {t("addConnection")}
              </Button>
            }
            title={t("connectEndpoint")}
          />
        ) : (
          <div className="grid gap-3">
            {providers.map((provider) => {
              const result = verification[provider.id];
              const providerModels = modelsByProvider.get(provider.id) ?? [];
              const chatModels = providerModels.filter(
                (model) =>
                  !model.capabilities.modalities.includes("embeddings"),
              );
              const embeddingModels = providerModels.filter((model) =>
                model.capabilities.modalities.includes("embeddings"),
              );
              const expanded = expandedProviders.has(provider.id);
              return (
                <article
                  className={`rm-connection-card ${provider.enabled ? "" : "disabled"}`}
                  key={provider.id}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{provider.name}</span>
                      <StatusBadge
                        tone={provider.enabled ? "success" : "neutral"}
                      >
                        {provider.enabled ? t("enabled") : t("disabled")}
                      </StatusBadge>
                      <StatusBadge>{provider.type}</StatusBadge>
                    </div>
                    <div
                      className="mt-1 truncate text-xs text-muted"
                      title={provider.baseUrl}
                    >
                      {provider.baseUrl}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                      <span>
                        {provider.credentialConfigured
                          ? t("managedCredential")
                          : t("noCredential")}
                      </span>
                      <span>
                        {provider.modelIds?.length
                          ? `${provider.modelIds.length} ${t("modelsAllowed")}`
                          : t("automaticDiscovery")}
                      </span>
                      <span>
                        {chatModels.filter((model) => model.enabled).length}/
                        {chatModels.length} {t("chatModelsAvailable")}
                      </span>
                      {embeddingModels.length > 0 ? (
                        <span>
                          {embeddingModels.length} {t("embeddingModels")}
                        </span>
                      ) : null}
                    </div>
                    {result ? (
                      <div
                        className={`rm-connection-result ${result.ok ? "success" : "error"}`}
                      >
                        {result.ok ? (
                          <CheckCircle2 size={14} />
                        ) : (
                          <CircleAlert size={14} />
                        )}
                        <span>{result.message}</span>
                        {result.latencyMs !== undefined ? (
                          <small>{result.latencyMs} ms</small>
                        ) : null}
                        {result.checks?.length ? (
                          <ul className="rm-connection-checks">
                            {result.checks.map((check) => (
                              <li className={check.status} key={check.label}>
                                <strong>{check.label}:</strong> {check.detail}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <div className="rm-connection-actions">
                    <Switch
                      checked={provider.enabled}
                      disabled={isUpdating}
                      label={t("enabled")}
                      onCheckedChange={(checked) =>
                        void onUpdateProvider({
                          providerId: provider.id,
                          name: provider.name,
                          baseUrl: provider.baseUrl,
                          ...(provider.modelIds === undefined
                            ? {}
                            : { modelIds: provider.modelIds }),
                          enabled: checked === true,
                        })
                      }
                    />
                    <Button
                      disabled={verifyingProviderId === provider.id}
                      onClick={() => void verify(provider.id)}
                      pending={verifyingProviderId === provider.id}
                    >
                      <PlugZap size={14} /> {t("verify")}
                    </Button>
                    <Button
                      disabled={syncingProviderId === provider.id}
                      onClick={() => void sync(provider.id)}
                      pending={syncingProviderId === provider.id}
                    >
                      <RefreshCw size={14} /> {t("refreshModels")}
                    </Button>
                    <Button onClick={() => setDialog(provider)}>
                      <Pencil size={14} /> {t("configure")}
                    </Button>
                  </div>
                  {providerModels.length > 0 ? (
                    <div className="rm-connection-models">
                      <div className="rm-connection-models-header">
                        <strong>{t("discoveredModels")}</strong>
                        {providerModels.length > 4 ? (
                          <Button
                            onClick={() =>
                              setExpandedProviders((current) => {
                                const next = new Set(current);
                                if (next.has(provider.id))
                                  next.delete(provider.id);
                                else next.add(provider.id);
                                return next;
                              })
                            }
                            size="sm"
                            variant="ghost"
                          >
                            {expanded ? t("showLess") : t("showAll")}
                          </Button>
                        ) : null}
                      </div>
                      <ul className="rm-connection-model-list">
                        {(expanded
                          ? providerModels
                          : providerModels.slice(0, 4)
                        ).map((model) => (
                          <li key={model.id}>
                            <span title={model.name}>{model.name}</span>
                            <span className="flex items-center gap-2">
                              <StatusBadge
                                tone={model.enabled ? "success" : "neutral"}
                              >
                                {model.capabilities.modalities.includes(
                                  "embeddings",
                                )
                                  ? t("embeddingOnly")
                                  : model.enabled
                                    ? t("availableInChat")
                                    : t("notAvailableInChat")}
                              </StatusBadge>
                              {provider.type === "ollama" ? (
                                <Button
                                  aria-label={`${t("deleteOllamaModel")} ${model.name}`}
                                  disabled={deletingModelId === model.id}
                                  onClick={() =>
                                    void remove(provider.id, model)
                                  }
                                  pending={deletingModelId === model.id}
                                  size="sm"
                                  variant="ghost"
                                >
                                  <Trash2 aria-hidden="true" size={14} />
                                </Button>
                              ) : null}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <div className="rm-connection-models empty">
                      {t("noModelsDiscovered")}
                    </div>
                  )}
                  {provider.type === "ollama" ? (
                    <form
                      className="rm-ollama-pull"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void pull(provider.id);
                      }}
                    >
                      <div>
                        <Field
                          description={t("pullOllamaModelDescription")}
                          label={t("pullOllamaModel")}
                        >
                          <Input
                            name="pullNames"
                            onChange={(event) =>
                              setPullNames((current) => ({
                                ...current,
                                [provider.id]: event.currentTarget.value,
                              }))
                            }
                            placeholder="llama3.2:latest"
                            value={pullNames[provider.id] ?? ""}
                          />
                        </Field>
                        <Button
                          disabled={
                            pullingProviderId === provider.id ||
                            !pullNames[provider.id]?.trim()
                          }
                          pending={pullingProviderId === provider.id}
                          type="submit"
                        >
                          <Download aria-hidden="true" size={14} />
                          {t("pullModel")}
                        </Button>
                      </div>
                      {pullingProviderId === provider.id ? (
                        <progress
                          aria-label={t("pullingModel")}
                          className="rm-ollama-pull-progress"
                        />
                      ) : null}
                    </form>
                  ) : null}
                </article>
              );
            })}
          </div>
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
    </section>
  );
}

function operationalAlertLabel(code: string): string {
  return code
    .split("_")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
