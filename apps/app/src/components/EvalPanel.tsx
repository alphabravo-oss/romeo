import { Input, NativeSelect, Textarea, Button } from "@romeo/ui";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import {
  createEvalSuiteMutationOptions,
  evalDashboardQueryOptions,
  evalRatingsQueryOptions,
  evalReasoningComparisonQueryOptions,
  evalResultsQueryOptions,
  evalRunsQueryOptions,
  evalSuitesQueryOptions,
  rateEvalResultMutationOptions,
  runEvalSuiteMutationOptions,
} from "../features";
import { toast } from "../lib/toast";
import { useLocale } from "../lib/i18n";
import type {
  Agent,
  EvalResultHumanRatingValue,
  RunEvalSuiteRequest,
} from "../features/types";
import { PanelState } from "../lib/panel-state";
import { AddButton } from "./AddButton";
import { PanelStats } from "./PanelStats";
import { EvalDashboardSummary } from "./EvalDashboardSummary";
import { EvalReasoningComparisonPanel } from "./EvalReasoningComparisonPanel";
import { FormDialog } from "./FormDialog";
import { ResourceRow } from "./ResourceRow";
import { Section } from "./console";
import { resolveActiveSuite } from "./eval-selection";
import { evalRatingKey, rubricFromInput } from "./eval-form-utils";
import {
  EvalResultTable,
  EvalRunTable,
  EvalSuiteTable,
} from "./EvalInventoryTables";

export function EvalPanel({ activeAgent }: { activeAgent: Agent | undefined }) {
  const { t } = useLocale();
  const agentId = activeAgent?.id;
  const [ratingComment, setRatingComment] = useState("");
  const [suiteDialogOpen, setSuiteDialogOpen] = useState(false);
  const [selectedSuiteId, setSelectedSuiteId] = useState<string>();
  const [selectedRunId, setSelectedRunId] = useState<string>();
  const [selectedResultId, setSelectedResultId] = useState<string>();
  const [reasoningVariant, setReasoningVariant] = useState("off");
  const suitesQuery = useQuery(evalSuitesQueryOptions(agentId));
  const runsQuery = useQuery(evalRunsQueryOptions(agentId));
  const dashboardQuery = useQuery(evalDashboardQueryOptions(agentId));
  const activeRun = useMemo(
    () => resolveActiveSuite(runsQuery.data ?? [], selectedRunId),
    [runsQuery.data, selectedRunId],
  );
  const resultsQuery = useQuery(evalResultsQueryOptions(activeRun?.id));
  const ratingsQuery = useQuery(evalRatingsQueryOptions(activeRun?.id));
  const createMutation = useMutation(createEvalSuiteMutationOptions());
  const runMutation = useMutation(runEvalSuiteMutationOptions(agentId));
  const rateMutation = useMutation(rateEvalResultMutationOptions());
  const activeSuite = useMemo(
    () => resolveActiveSuite(suitesQuery.data ?? [], selectedSuiteId),
    [selectedSuiteId, suitesQuery.data],
  );
  const comparisonQuery = useQuery(
    evalReasoningComparisonQueryOptions(activeSuite?.id),
  );
  const activeResult = useMemo(
    () => resolveActiveSuite(resultsQuery.data ?? [], selectedResultId),
    [resultsQuery.data, selectedResultId],
  );
  const form = useForm({
    defaultValues: {
      name: "",
      input: "",
      expectedContains: "",
      mustContain: "",
      mustNotContain: "",
      expectedTools: "",
      requiredCitations: "",
    },
    onSubmit: async ({ value }) => {
      if (!agentId) return;
      const rubric = rubricFromInput(
        value.mustContain,
        value.mustNotContain,
        value.expectedTools,
        value.requiredCitations,
      );
      try {
        await createMutation.mutateAsync({
          agentId,
          name: value.name,
          cases: [
            {
              input: value.input,
              expectedContains: value.expectedContains,
              ...(rubric === undefined ? {} : { rubric }),
            },
          ],
        });
        toast(t("evalSuiteCreated"), "success");
        setSuiteDialogOpen(false);
      } catch {
        toast(t("evalCouldNotCreateSuite"), "error");
      }
    },
  });

  async function handleRun() {
    if (!activeSuite || !agentId) return;
    try {
      await runMutation.mutateAsync({
        suiteId: activeSuite.id,
        reasoningPolicy: policyForVariant(reasoningVariant),
      });
      toast(t("evalRunStarted"), "success");
    } catch {
      toast(t("evalCouldNotRunSuite"), "error");
    }
  }

  async function handleRate(rating: EvalResultHumanRatingValue) {
    if (!activeResult || !activeRun) return;
    try {
      await rateMutation.mutateAsync({
        resultId: activeResult.id,
        runId: activeRun.id,
        rating,
        ...(ratingComment.trim().length === 0
          ? {}
          : { comment: ratingComment.trim() }),
      });
      toast(t("evalRatingSaved"), "success");
    } catch {
      toast(t("evalCouldNotSaveRating"), "error");
    }
  }

  if (activeAgent === undefined) {
    return (
      <Section description={t("evalSelectAgent")} title={t("evalSuites")}>
        <p className="rm-list-empty">{t("evalSelectAgent")}</p>
      </Section>
    );
  }

  return (
    <div className="rm-console-page">
      <div className="rm-console-toolbar">
        <div className="flex gap-2">
          <Button
            variant="primary"
            onClick={() => setSuiteDialogOpen(true)}
            type="button"
          >
            {t("evalNewSuite")}
          </Button>
          <NativeSelect
            aria-label={t("evalReasoningPolicy")}
            onChange={(event) => setReasoningVariant(event.currentTarget.value)}
            value={reasoningVariant}
          >
            <option value="off">{t("evalReasoningOff")}</option>
            <option value="auto">{t("evalReasoningAuto")}</option>
            <option value="low">{t("evalReasoningLow")}</option>
            <option value="medium">{t("evalReasoningMedium")}</option>
            <option value="high">{t("evalReasoningHigh")}</option>
          </NativeSelect>
          <Button
            disabled={!activeSuite || runMutation.isPending}
            onClick={() => void handleRun()}
            type="button"
          >
            {runMutation.isPending
              ? t("evalRunning")
              : `${t("evalRunSuite")}${activeSuite ? ` — ${activeSuite.name}` : ""}`}
          </Button>
        </div>
      </div>
      <FormDialog
        onClose={() => setSuiteDialogOpen(false)}
        open={suiteDialogOpen}
        title={t("evalNewSuiteTitle")}
      >
        <form
          className="grid gap-2 text-sm"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <form.Field
            name="name"
            validators={{
              onChange: ({ value }: { value: string }) =>
                !value?.trim() ? t("required") : undefined,
            }}
          >
            {(field) => (
              <>
                <Input
                  name="name"
                  aria-label={t("evalSuiteName")}
                  onBlur={field.handleBlur}
                  onChange={(event) =>
                    field.handleChange(event.currentTarget.value)
                  }
                  placeholder={t("evalSuiteName")}
                  value={field.state.value}
                />
                {field.state.meta.errors.length ? (
                  <div className="rm-composer-error">
                    {field.state.meta.errors.join(", ")}
                  </div>
                ) : null}
              </>
            )}
          </form.Field>
          <form.Field name="input">
            {(field) => (
              <Textarea
                name="input"
                aria-label={t("evalPrompt")}
                className="min-h-20 resize-y"
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(event.currentTarget.value)
                }
                placeholder={t("evalPrompt")}
                value={field.state.value}
              />
            )}
          </form.Field>
          <form.Field name="expectedContains">
            {(field) => (
              <Input
                name="expectedContains"
                aria-label={t("evalExpectedText")}
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(event.currentTarget.value)
                }
                placeholder={t("evalExpectedText")}
                value={field.state.value}
              />
            )}
          </form.Field>
          <form.Field name="mustContain">
            {(field) => (
              <Input
                name="mustContain"
                aria-label={t("evalMustContain")}
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(event.currentTarget.value)
                }
                placeholder={t("evalMustContain")}
                value={field.state.value}
              />
            )}
          </form.Field>
          <form.Field name="mustNotContain">
            {(field) => (
              <Input
                name="mustNotContain"
                aria-label={t("evalMustNotContain")}
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(event.currentTarget.value)
                }
                placeholder={t("evalMustNotContain")}
                value={field.state.value}
              />
            )}
          </form.Field>
          <form.Field name="expectedTools">
            {(field) => (
              <Input
                name="expectedTools"
                aria-label={t("evalExpectedTools")}
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(event.currentTarget.value)
                }
                placeholder={t("evalExpectedTools")}
                value={field.state.value}
              />
            )}
          </form.Field>
          <form.Field name="requiredCitations">
            {(field) => (
              <Input
                name="requiredCitations"
                aria-label={t("evalRequiredCitations")}
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(event.currentTarget.value)
                }
                placeholder={t("evalRequiredCitations")}
                value={field.state.value}
              />
            )}
          </form.Field>
          <form.Subscribe
            selector={(state) => ({
              canSubmit: state.canSubmit,
              isSubmitting: state.isSubmitting,
            })}
          >
            {({ canSubmit, isSubmitting }) => (
              <Button
                disabled={
                  !agentId ||
                  !canSubmit ||
                  isSubmitting ||
                  createMutation.isPending
                }
                type="submit"
              >
                {createMutation.isPending
                  ? t("evalCreating")
                  : t("evalCreateSuite")}
              </Button>
            )}
          </form.Subscribe>
        </form>
      </FormDialog>
      <div className="mt-4 grid gap-2 text-sm">
        <PanelState
          query={dashboardQuery}
          empty={t("evalNotAvailable")}
          isEmpty={() => false}
        >
          {(dashboard) => <EvalDashboardSummary dashboard={dashboard} />}
        </PanelState>
        <PanelState
          query={suitesQuery}
          empty={t("evalNoSuites")}
          emptyAction={
            <AddButton onClick={() => setSuiteDialogOpen(true)}>
              {t("evalNewSuite")}
            </AddButton>
          }
        >
          {(allSuites) => (
            <div className="grid gap-4">
              <PanelStats
                items={[
                  { label: t("evalTotalSuites"), value: allSuites.length },
                  {
                    label: t("evalRuns"),
                    value: runsQuery.isError
                      ? t("failed")
                      : (runsQuery.data?.length ?? t("loading")),
                  },
                ]}
              />
              <EvalSuiteTable data={allSuites} onSelect={setSelectedSuiteId} />
            </div>
          )}
        </PanelState>
        <PanelState query={runsQuery} empty={t("evalNoRuns")}>
          {(allRuns) => (
            <EvalRunTable
              data={allRuns}
              onSelect={(runId) => {
                setSelectedRunId(runId);
                setSelectedResultId(undefined);
              }}
            />
          )}
        </PanelState>
        {activeSuite === undefined ? null : (
          <PanelState
            query={comparisonQuery}
            empty={t("evalNoReasoningComparisons")}
            isEmpty={() => false}
          >
            {(comparison) => (
              <EvalReasoningComparisonPanel comparison={comparison} />
            )}
          </PanelState>
        )}
        {activeRun === undefined ? null : (
          <PanelState query={resultsQuery} empty={t("evalNoResults")}>
            {(results) => (
              <EvalResultTable data={results} onSelect={setSelectedResultId} />
            )}
          </PanelState>
        )}
        {activeResult ? (
          <PanelState
            query={ratingsQuery}
            empty={t("evalNoRating")}
            isEmpty={() => false}
          >
            {(ratings) => {
              const activeRating = ratings.find(
                (rating) => rating.resultId === activeResult.id,
              );
              return (
                <div className="grid gap-3">
                  <ResourceRow
                    meta={activeResult.output}
                    title={`${t("evalHumanRating")} · ${
                      activeRating === undefined
                        ? t("evalNoRating")
                        : t(evalRatingKey(activeRating.rating))
                    }`}
                  />
                  <Input
                    aria-label={t("evalRatingComment")}
                    onChange={(event) =>
                      setRatingComment(event.currentTarget.value)
                    }
                    placeholder={t("evalRatingComment")}
                    value={ratingComment}
                  />
                  <div className="rm-resource-row__actions rm-resource-row__actions--start">
                    {(["pass", "neutral", "fail"] as const).map((rating) => (
                      <Button
                        disabled={rateMutation.isPending}
                        key={rating}
                        onClick={() => void handleRate(rating)}
                        type="button"
                      >
                        {t(evalRatingKey(rating))}
                      </Button>
                    ))}
                  </div>
                </div>
              );
            }}
          </PanelState>
        ) : null}
      </div>
    </div>
  );
}

function policyForVariant(
  variant: string,
): NonNullable<RunEvalSuiteRequest["reasoningPolicy"]> {
  if (variant === "off") return { schemaVersion: 1, mode: "off" };
  if (variant === "low" || variant === "medium" || variant === "high")
    return { schemaVersion: 1, mode: "auto", effort: variant };
  return { schemaVersion: 1, mode: "auto" };
}
