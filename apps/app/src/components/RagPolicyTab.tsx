import { Button, Input, NativeSelect, Textarea } from "@romeo/ui";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  getRagPolicy,
  ragPolicyExternalVectorModes,
  ragPolicyPhysicalVectorIsolationEnforcements,
  ragPolicyPhysicalVectorIsolationModes,
  ragPolicyTiers,
  ragVectorIsolationPolicies,
  updateRagPolicy,
  type RagPolicyExternalVectorMode,
  type RagPolicyPhysicalVectorIsolationEnforcement,
  type RagPolicyPhysicalVectorIsolationMode,
  type RagPolicyReport,
  type RagPolicyTier,
  type RagVectorIsolationPolicy,
  type UpdateRagPolicyRequest,
} from "../features/rag-governance";
import { useLocale } from "../lib/i18n";
import { LocalizedDateTime } from "../lib/locale-format";
import { PanelState } from "../lib/panel-state";
import { toast } from "../lib/toast";
import { PanelStats } from "./PanelStats";

// ── Policy tab ────────────────────────────────────────────────────────────────

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
        <div className="rm-card-title">{t("ragRetrievalPolicy")}</div>
        <Button
          disabled={policyQuery.isFetching}
          onClick={() => void policyQuery.refetch()}
          type="button"
        >
          {policyQuery.isFetching ? t("refreshing") : t("refresh")}
        </Button>
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

/** Comma/whitespace list <-> string[] helpers. Server trims/normalizes. */
function textToList(text: string): string[] {
  return text
    .split(/[\n,]/u)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function listToText(values: string[]): string {
  return values.join("\n");
}

function PolicyEditor(props: {
  report: RagPolicyReport;
  queryClient: ReturnType<typeof useQueryClient>;
}) {
  const { t } = useLocale();
  const { report, queryClient } = props;
  const updateMutation = useMutation({ mutationFn: updateRagPolicy });

  const form = useForm({
    defaultValues: {
      enabledTiers: report.enabledTiers,
      dataResidencyTags: listToText(report.dataResidencyTags),
      externalVectorStoreMode: report.externalVectorStore.mode,
      namespacePolicy: report.externalVectorStore.namespacePolicy,
      partitioningPolicy: report.externalVectorStore.partitioningPolicy,
      physicalIsolationMode: report.physicalVectorIsolation.mode,
      physicalIsolationEnforcement: report.physicalVectorIsolation.enforcement,
    },
    onSubmit: async ({ value }) => {
      if (value.enabledTiers.length === 0) {
        toast(t("enableAtLeastOneTier"), "error");
        return;
      }
      const input: UpdateRagPolicyRequest = {
        enabledTiers: value.enabledTiers,
        dataResidencyTags: textToList(value.dataResidencyTags),
        externalVectorStore: {
          mode: value.externalVectorStoreMode,
          namespacePolicy: value.namespacePolicy,
          partitioningPolicy: value.partitioningPolicy,
        },
        physicalVectorIsolation: {
          mode: value.physicalIsolationMode,
          enforcement: value.physicalIsolationEnforcement,
        },
      };
      try {
        await updateMutation.mutateAsync(input);
        await queryClient.invalidateQueries({ queryKey: ["ragPolicy"] });
        await queryClient.invalidateQueries({ queryKey: ["ragPosture"] });
        toast(t("ragPolicyUpdated"), "success");
      } catch (caught) {
        toast(t("couldNotUpdateRagPolicy"), "error");
        throw caught;
      }
    },
  });

  return (
    <div className="grid gap-4">
      <PanelStats
        items={[
          { label: t("source"), value: report.source },
          { label: t("enabledTiers"), value: report.enabledTiers.length },
          {
            label: t("allowedEmbeddingModels"),
            value: report.allowedEmbeddingProviderModels.length,
          },
          {
            label: t("dataResidencyTags"),
            value: report.dataResidencyTags.length,
          },
          {
            label: t("externalVectorStore"),
            value: report.externalVectorStore.mode,
          },
          {
            label: t("physicalIsolation"),
            value: report.physicalVectorIsolation.enforcement,
          },
        ]}
      />

      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void form.handleSubmit();
        }}
      >
        <form.Field name="enabledTiers">
          {(field) => (
            <div className="grid gap-1">
              <div className="text-sm text-muted">
                {t("enabledRetrievalTiers")}
              </div>
              <div className="flex flex-wrap gap-3">
                {ragPolicyTiers.map((tier) => {
                  const checked = field.state.value.includes(tier);
                  return (
                    <label
                      className="flex items-center gap-2 text-sm"
                      key={tier}
                    >
                      <Input
                        name="enabledTiers"
                        checked={checked}
                        onChange={(event) => {
                          const next: RagPolicyTier[] = event.currentTarget
                            .checked
                            ? [...field.state.value, tier]
                            : field.state.value.filter(
                                (value) => value !== tier,
                              );
                          field.handleChange(next);
                        }}
                        type="checkbox"
                      />
                      <span>{tier}</span>
                    </label>
                  );
                })}
              </div>
              <div className="text-xs text-muted">{t("atLeastOneTier")}</div>
            </div>
          )}
        </form.Field>

        <form.Field name="externalVectorStoreMode">
          {(field) => (
            <div className="grid gap-1">
              <label className="text-sm text-muted" htmlFor="rag-external-mode">
                {t("externalVectorStoreMode")}
              </label>
              <NativeSelect
                name="externalVectorStoreMode"
                id="rag-external-mode"
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(
                    event.currentTarget.value as RagPolicyExternalVectorMode,
                  )
                }
                value={field.state.value}
              >
                {ragPolicyExternalVectorModes.map((mode) => (
                  <option key={mode} value={mode}>
                    {mode}
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}
        </form.Field>

        <form.Field name="namespacePolicy">
          {(field) => (
            <div className="grid gap-1">
              <label
                className="text-sm text-muted"
                htmlFor="rag-namespace-policy"
              >
                {t("namespacePolicy")}
              </label>
              <NativeSelect
                name="namespacePolicy"
                id="rag-namespace-policy"
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(
                    event.currentTarget.value as RagVectorIsolationPolicy,
                  )
                }
                value={field.state.value}
              >
                {ragVectorIsolationPolicies.map((policy) => (
                  <option key={policy} value={policy}>
                    {policy}
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}
        </form.Field>

        <form.Field name="partitioningPolicy">
          {(field) => (
            <div className="grid gap-1">
              <label
                className="text-sm text-muted"
                htmlFor="rag-partitioning-policy"
              >
                {t("partitioningPolicy")}
              </label>
              <NativeSelect
                name="partitioningPolicy"
                id="rag-partitioning-policy"
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(
                    event.currentTarget.value as RagVectorIsolationPolicy,
                  )
                }
                value={field.state.value}
              >
                {ragVectorIsolationPolicies.map((policy) => (
                  <option key={policy} value={policy}>
                    {policy}
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}
        </form.Field>

        <form.Field name="physicalIsolationMode">
          {(field) => (
            <div className="grid gap-1">
              <label className="text-sm text-muted" htmlFor="rag-physical-mode">
                {t("physicalVectorIsolationMode")}
              </label>
              <NativeSelect
                name="physicalIsolationMode"
                id="rag-physical-mode"
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(
                    event.currentTarget
                      .value as RagPolicyPhysicalVectorIsolationMode,
                  )
                }
                value={field.state.value}
              >
                {ragPolicyPhysicalVectorIsolationModes.map((mode) => (
                  <option key={mode} value={mode}>
                    {mode}
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}
        </form.Field>

        <form.Field name="physicalIsolationEnforcement">
          {(field) => (
            <div className="grid gap-1">
              <label
                className="text-sm text-muted"
                htmlFor="rag-physical-enforcement"
              >
                {t("physicalIsolationEnforcement")}
              </label>
              <NativeSelect
                name="physicalIsolationEnforcement"
                id="rag-physical-enforcement"
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(
                    event.currentTarget
                      .value as RagPolicyPhysicalVectorIsolationEnforcement,
                  )
                }
                value={field.state.value}
              >
                {ragPolicyPhysicalVectorIsolationEnforcements.map(
                  (enforcement) => (
                    <option key={enforcement} value={enforcement}>
                      {enforcement}
                    </option>
                  ),
                )}
              </NativeSelect>
            </div>
          )}
        </form.Field>

        <form.Field name="dataResidencyTags">
          {(field) => (
            <div className="grid gap-1">
              <label
                className="text-sm text-muted"
                htmlFor="rag-residency-tags"
              >
                {t("dataResidencyTagsPerLine")}
              </label>
              <Textarea
                name="dataResidencyTags"
                id="rag-residency-tags"
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(event.currentTarget.value)
                }
                placeholder={"eu\nus-gov"}
                rows={3}
                value={field.state.value}
              />
              <div className="text-xs text-muted">
                {t("emptyResidencyTags")}
              </div>
            </div>
          )}
        </form.Field>

        <form.Subscribe
          selector={(state) => ({
            canSubmit: state.canSubmit,
            isSubmitting: state.isSubmitting,
          })}
        >
          {({ canSubmit, isSubmitting }) => (
            <div className="flex items-center gap-2">
              <Button
                variant="primary"
                disabled={!canSubmit || isSubmitting}
                type="submit"
              >
                {isSubmitting ? t("saving") : t("saveRagPolicy")}
              </Button>
              {report.updatedAt ? (
                <span className="text-xs text-muted">
                  {t("updated")} <LocalizedDateTime value={report.updatedAt} />
                  {report.updatedBy
                    ? ` ${t("updatedBy")} ${report.updatedBy}`
                    : ""}
                </span>
              ) : null}
            </div>
          )}
        </form.Subscribe>
      </form>
    </div>
  );
}
