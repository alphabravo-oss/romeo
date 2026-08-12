import {
  Button,
  Field,
  Input,
  NativeSelect,
  Switch,
  Textarea,
} from "@romeo/ui";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import { listModels, listProviders } from "../features/providers/queries";
import {
  getRagPolicy,
  policyFieldsForVectorBackend,
  ragPolicyTiers,
  updateRagPolicy,
  vectorBackendPresetFromPolicy,
  type RagPolicyReport,
  type RagPolicyTier,
  type RagVectorBackendPreset,
  type UpdateRagPolicyRequest,
} from "../features/rag-governance";
import { useLocale, type MessageKey } from "../lib/i18n";
import { LocalizedDateTime } from "../lib/locale-format";
import { PanelState } from "../lib/panel-state";
import { toast } from "../lib/toast";
import { PanelStats } from "./PanelStats";
import { AdminDisclosure } from "./AdminDisclosure";
import { PageActions } from "./PageActions";

const TIER_LABEL_KEYS: Record<RagPolicyTier, MessageKey> = {
  user_private: "ragTierUserPrivate",
  workspace: "ragTierWorkspace",
  org: "ragTierOrg",
  shared: "ragTierShared",
};

const TIER_HELP_KEYS: Record<RagPolicyTier, MessageKey> = {
  user_private: "ragTierUserPrivateHelp",
  workspace: "ragTierWorkspaceHelp",
  org: "ragTierOrgHelp",
  shared: "ragTierSharedHelp",
};

const BACKEND_LABEL_KEYS: Record<RagVectorBackendPreset, MessageKey> = {
  pgvector: "ragBackendPgvector",
  qdrant: "ragBackendQdrant",
};

export function RagPolicyTab() {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const policyQuery = useQuery({
    queryKey: ["ragPolicy"],
    queryFn: getRagPolicy,
  });

  return (
    <div className="grid gap-2">
      <div className="rm-card-header">
        <div>
          <div className="rm-card-title">{t("ragSetupTitle")}</div>
          <p className="text-sm text-muted">{t("ragSetupDescription")}</p>
        </div>
        <PageActions
          onRefresh={() => void policyQuery.refetch()}
          refreshLabel={t("refresh")}
          refreshing={policyQuery.isFetching}
        />
      </div>
      <PanelState
        query={policyQuery}
        empty={t("noRagPolicy")}
        isEmpty={() => false}
      >
        {(report) => <PolicyEditor report={report} queryClient={queryClient} />}
      </PanelState>
    </div>
  );
}

function PolicyEditor(props: {
  report: RagPolicyReport;
  queryClient: ReturnType<typeof useQueryClient>;
}) {
  const { t } = useLocale();
  const { report, queryClient } = props;
  const updateMutation = useMutation({ mutationFn: updateRagPolicy });
  const providersQuery = useQuery({
    queryKey: ["providers"],
    queryFn: listProviders,
  });
  const modelsQuery = useQuery({
    queryKey: ["models"],
    queryFn: listModels,
  });

  const embeddingOptions = useMemo(() => {
    const providers = new Map(
      (providersQuery.data ?? []).map((provider) => [provider.id, provider]),
    );
    return (modelsQuery.data ?? [])
      .filter(
        (model) =>
          model.enabled && model.capabilities.modalities.includes("embeddings"),
      )
      .map((model) => ({
        providerId: model.providerId,
        model: model.name,
        label: `${providers.get(model.providerId)?.name ?? model.providerId} · ${model.displayName || model.name}`,
      }));
  }, [modelsQuery.data, providersQuery.data]);

  const form = useForm({
    defaultValues: {
      vectorBackend: vectorBackendPresetFromPolicy(report),
      enabledTiers: report.enabledTiers,
      embeddingKey: embeddingKeyFromPolicy(report),
      topK: String(
        report.retrieval?.topK ?? report.defaultMaxResultsPerTier.workspace,
      ),
      similarityThreshold: String(
        report.retrieval?.similarityThreshold ?? 0.35,
      ),
      hybridSearch: report.retrieval?.hybridSearch ?? true,
      hybridBm25Weight: String(report.retrieval?.hybridBm25Weight ?? 0.35),
      agenticEnabled: report.agentic?.enabled ?? false,
      agenticUserMode: report.agentic?.userMode ?? "optional",
      dataResidencyTags: report.dataResidencyTags.join("\n"),
    },
    onSubmit: async ({ value }) => {
      if (value.enabledTiers.length === 0) {
        toast(t("enableAtLeastOneTier"), "error");
        return;
      }
      const topK = Number(value.topK);
      const similarityThreshold = Number(value.similarityThreshold);
      const hybridBm25Weight = Number(value.hybridBm25Weight);
      if (
        !Number.isInteger(topK) ||
        topK < 1 ||
        topK > 20 ||
        !Number.isFinite(similarityThreshold) ||
        similarityThreshold < 0 ||
        similarityThreshold > 1 ||
        !Number.isFinite(hybridBm25Weight) ||
        hybridBm25Weight < 0 ||
        hybridBm25Weight > 1
      ) {
        toast(t("ragRetrievalInvalid"), "error");
        return;
      }
      const backendFields = policyFieldsForVectorBackend(value.vectorBackend);
      const embedding = embeddingFromKey(value.embeddingKey);
      const defaultMaxResultsPerTier = Object.fromEntries(
        ragPolicyTiers.map((tier) => [tier, topK]),
      ) as UpdateRagPolicyRequest["defaultMaxResultsPerTier"];
      try {
        await updateMutation.mutateAsync({
          enabledTiers: value.enabledTiers,
          defaultMaxResultsPerTier,
          allowedEmbeddingProviderModels:
            embedding === undefined ? [] : [embedding],
          retrieval: {
            topK,
            similarityThreshold,
            hybridSearch: value.hybridSearch,
            hybridBm25Weight,
          },
          agentic: {
            enabled: value.agenticEnabled,
            userMode: value.agenticUserMode,
          },
          dataResidencyTags: value.dataResidencyTags
            .split(/[\n,]/u)
            .map((tag) => tag.trim())
            .filter((tag) => tag.length > 0),
          ...backendFields,
        } as UpdateRagPolicyRequest);
        await queryClient.invalidateQueries({ queryKey: ["ragPolicy"] });
        await queryClient.invalidateQueries({ queryKey: ["ragPosture"] });
        await queryClient.invalidateQueries({
          queryKey: ["agenticRagSettings"],
        });
        toast(t("ragPolicyUpdated"), "success");
      } catch {
        toast(t("couldNotUpdateRagPolicy"), "error");
      }
    },
  });

  return (
    <div className="grid gap-4">
      <PanelStats
        items={[
          { label: t("source"), value: report.source },
          {
            label: t("ragVectorBackend"),
            value: t(BACKEND_LABEL_KEYS[vectorBackendPresetFromPolicy(report)]),
          },
          { label: t("enabledTiers"), value: report.enabledTiers.length },
          {
            label: t("ragEmbeddingModel"),
            value:
              report.allowedEmbeddingProviderModels[0]?.model ??
              t("ragEmbeddingModelUnset"),
          },
        ]}
      />

      <form
        className="grid gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void form.handleSubmit();
        }}
      >
        <section className="grid gap-3 rounded-md border border-border p-3">
          <div>
            <div className="font-medium text-sm">{t("ragEmbeddingModel")}</div>
            <p className="text-xs text-muted">{t("ragEmbeddingModelHelp")}</p>
          </div>
          <form.Field name="embeddingKey">
            {(field) => (
              <Field label={t("ragEmbeddingModel")}>
                <NativeSelect
                  id="rag-embedding-model"
                  name="embeddingKey"
                  onChange={(event) =>
                    field.handleChange(event.currentTarget.value)
                  }
                  value={field.state.value}
                >
                  <option value="">{t("ragEmbeddingModelUnset")}</option>
                  {embeddingOptions.map((option) => (
                    <option
                      key={`${option.providerId}\0${option.model}`}
                      value={`${option.providerId}\0${option.model}`}
                    >
                      {option.label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
          </form.Field>
          {embeddingOptions.length === 0 ? (
            <p className="text-xs text-muted">{t("ragEmbeddingEnableFirst")}</p>
          ) : null}
          <p className="text-xs text-muted">
            {t("ragEmbeddingReindexWarning")}
          </p>
        </section>

        <section className="grid gap-3 rounded-md border border-border p-3">
          <div>
            <div className="font-medium text-sm">{t("ragRetrievalTitle")}</div>
            <p className="text-xs text-muted">{t("ragRetrievalHelp")}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <form.Field name="topK">
              {(field) => (
                <Field description={t("ragTopKHelp")} label={t("ragTopK")}>
                  <Input
                    inputMode="numeric"
                    max={20}
                    min={1}
                    name="topK"
                    onChange={(event) =>
                      field.handleChange(event.currentTarget.value)
                    }
                    type="number"
                    value={field.state.value}
                  />
                </Field>
              )}
            </form.Field>
            <form.Field name="similarityThreshold">
              {(field) => (
                <Field
                  description={t("ragSimilarityHelp")}
                  label={t("ragSimilarityThreshold")}
                >
                  <Input
                    max={1}
                    min={0}
                    name="similarityThreshold"
                    onChange={(event) =>
                      field.handleChange(event.currentTarget.value)
                    }
                    step="0.05"
                    type="number"
                    value={field.state.value}
                  />
                </Field>
              )}
            </form.Field>
          </div>
          <form.Field name="hybridSearch">
            {(field) => (
              <Switch
                checked={field.state.value}
                label={t("ragHybridSearch")}
                onCheckedChange={(checked) =>
                  field.handleChange(checked === true)
                }
              />
            )}
          </form.Field>
          <p className="text-xs text-muted">{t("ragHybridSearchHelp")}</p>
          <form.Subscribe selector={(state) => state.values.hybridSearch}>
            {(hybrid) =>
              hybrid ? (
                <form.Field name="hybridBm25Weight">
                  {(field) => (
                    <Field
                      description={t("ragBm25WeightHelp")}
                      label={t("ragBm25Weight")}
                    >
                      <Input
                        max={1}
                        min={0}
                        name="hybridBm25Weight"
                        onChange={(event) =>
                          field.handleChange(event.currentTarget.value)
                        }
                        step="0.05"
                        type="number"
                        value={field.state.value}
                      />
                    </Field>
                  )}
                </form.Field>
              ) : null
            }
          </form.Subscribe>
        </section>

        <section className="grid gap-3 rounded-md border border-border p-3">
          <div>
            <div className="font-medium text-sm">{t("ragAgenticTitle")}</div>
            <p className="text-xs text-muted">{t("ragAgenticHelp")}</p>
          </div>
          <form.Field name="agenticEnabled">
            {(field) => (
              <Switch
                checked={field.state.value}
                label={t("ragAgenticEnabled")}
                onCheckedChange={(checked) =>
                  field.handleChange(checked === true)
                }
              />
            )}
          </form.Field>
          <form.Subscribe selector={(state) => state.values.agenticEnabled}>
            {(enabled) =>
              enabled ? (
                <form.Field name="agenticUserMode">
                  {(field) => (
                    <Field
                      description={t("ragAgenticUserModeHelp")}
                      label={t("ragAgenticUserMode")}
                    >
                      <NativeSelect
                        id="rag-agentic-user-mode"
                        name="agenticUserMode"
                        onChange={(event) =>
                          field.handleChange(
                            event.currentTarget.value === "required"
                              ? "required"
                              : "optional",
                          )
                        }
                        value={field.state.value}
                      >
                        <option value="optional">
                          {t("ragAgenticUserOptional")}
                        </option>
                        <option value="required">
                          {t("ragAgenticUserRequired")}
                        </option>
                      </NativeSelect>
                    </Field>
                  )}
                </form.Field>
              ) : null
            }
          </form.Subscribe>
        </section>

        <section className="grid gap-3 rounded-md border border-border p-3">
          <div>
            <div className="font-medium text-sm">
              {t("enabledRetrievalTiers")}
            </div>
            <p className="text-xs text-muted">{t("ragTiersHelp")}</p>
          </div>
          <form.Field name="enabledTiers">
            {(field) => (
              <div className="grid gap-2">
                {ragPolicyTiers.map((tier) => {
                  const checked = field.state.value.includes(tier);
                  return (
                    <label
                      className="grid grid-cols-[auto_1fr] items-start gap-2 text-sm"
                      key={tier}
                    >
                      <Input
                        checked={checked}
                        name="enabledTiers"
                        onChange={(event) => {
                          field.handleChange(
                            event.currentTarget.checked
                              ? [...field.state.value, tier]
                              : field.state.value.filter(
                                  (value) => value !== tier,
                                ),
                          );
                        }}
                        type="checkbox"
                      />
                      <span>
                        <strong className="block">
                          {t(TIER_LABEL_KEYS[tier])}
                        </strong>
                        <span className="text-xs text-muted">
                          {t(TIER_HELP_KEYS[tier])}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </form.Field>
        </section>

        <AdminDisclosure
          description={t("ragAdvancedHelp")}
          title={t("ragAdvancedTitle")}
        >
          <div className="grid gap-5">
            <section className="grid gap-3">
              <div>
                <div className="font-medium text-sm">
                  {t("ragVectorBackend")}
                </div>
                <p className="text-xs text-muted">
                  {t("ragVectorBackendHelp")}
                </p>
              </div>
              <form.Field name="vectorBackend">
                {(field) => (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {(["pgvector", "qdrant"] as const).map((preset) => (
                      <label
                        className={`flex cursor-pointer flex-col gap-1 rounded-md border p-3 text-sm ${
                          field.state.value === preset
                            ? "border-[var(--rm-accent)] bg-[color-mix(in_srgb,var(--rm-accent)_8%,transparent)]"
                            : "border-border"
                        }`}
                        key={preset}
                      >
                        <span className="flex items-center gap-2 font-medium">
                          <Input
                            checked={field.state.value === preset}
                            name="vectorBackend"
                            onChange={() => field.handleChange(preset)}
                            type="radio"
                          />
                          {t(BACKEND_LABEL_KEYS[preset])}
                        </span>
                        <span className="text-xs text-muted pl-6">
                          {preset === "pgvector"
                            ? t("ragBackendPgvectorHelp")
                            : t("ragBackendQdrantHelp")}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </form.Field>
            </section>
            <section className="grid gap-3">
              <div className="font-medium text-sm">
                {t("dataResidencyTags")}
              </div>
              <form.Field name="dataResidencyTags">
                {(field) => (
                  <div className="grid gap-1">
                    <Textarea
                      name="dataResidencyTags"
                      onChange={(event) =>
                        field.handleChange(event.currentTarget.value)
                      }
                      placeholder={"eu\nus-gov"}
                      rows={2}
                      value={field.state.value}
                    />
                    <div className="text-xs text-muted">
                      {t("emptyResidencyTags")}
                    </div>
                  </div>
                )}
              </form.Field>
            </section>
          </div>
        </AdminDisclosure>

        <form.Subscribe
          selector={(state) => ({
            canSubmit: state.canSubmit,
            isSubmitting: state.isSubmitting,
          })}
        >
          {({ canSubmit, isSubmitting }) => (
            <div className="flex items-center gap-2">
              <Button
                disabled={!canSubmit || isSubmitting}
                type="submit"
                variant="primary"
              >
                {isSubmitting ? t("saving") : t("saveRagPolicy")}
              </Button>
              {report.updatedAt ? (
                <span className="text-xs text-muted">
                  {t("updated")} <LocalizedDateTime value={report.updatedAt} />
                </span>
              ) : null}
            </div>
          )}
        </form.Subscribe>
      </form>
    </div>
  );
}

function embeddingKeyFromPolicy(report: RagPolicyReport): string {
  const first = report.allowedEmbeddingProviderModels[0];
  return first === undefined ? "" : `${first.providerId}\0${first.model}`;
}

function embeddingFromKey(
  key: string,
): { providerId: string; model: string } | undefined {
  if (key.length === 0) return undefined;
  const separator = key.indexOf("\0");
  if (separator <= 0) return undefined;
  const providerId = key.slice(0, separator);
  const model = key.slice(separator + 1);
  if (providerId.length === 0 || model.length === 0) return undefined;
  return { providerId, model };
}
