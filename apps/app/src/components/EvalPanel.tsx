import { Input, Textarea, Button } from "@romeo/ui";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import {
  createEvalSuite,
  getEvalDashboard,
  listEvalRatings,
  listEvalResults,
  listEvalRuns,
  listEvalSuites,
  rateEvalResult,
  runEvalSuite,
} from "../features";
import { toast } from "../lib/toast";
import { useLocale } from "../lib/i18n";
import { LocalizedNumber } from "../lib/locale-format";
import type { Agent, EvalResultHumanRatingValue } from "../features/types";
import { PanelState } from "../lib/panel-state";
import { PanelStats } from "./PanelStats";
import { EvalDashboardSummary } from "./EvalDashboardSummary";
import { FormDialog } from "./FormDialog";
import { resolveActiveSuite } from "./eval-selection";
import { evalRatingKey, rubricFromInput } from "./eval-form-utils";

export function EvalPanel({ activeAgent }: { activeAgent: Agent | undefined }) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const agentId = activeAgent?.id;
  const [ratingComment, setRatingComment] = useState("");
  const [suiteDialogOpen, setSuiteDialogOpen] = useState(false);
  const [selectedSuiteId, setSelectedSuiteId] = useState<string>();
  const [selectedRunId, setSelectedRunId] = useState<string>();
  const [selectedResultId, setSelectedResultId] = useState<string>();
  const suitesQuery = useQuery({
    queryKey: ["evalSuites", agentId],
    queryFn: () => listEvalSuites(agentId!),
    enabled: agentId !== undefined,
  });
  const runsQuery = useQuery({
    queryKey: ["evalRuns", agentId],
    queryFn: () => listEvalRuns(agentId!),
    enabled: agentId !== undefined,
  });
  const dashboardQuery = useQuery({
    queryKey: ["evalDashboard", agentId],
    queryFn: () => getEvalDashboard(agentId!),
    enabled: agentId !== undefined,
  });
  const activeRun = useMemo(
    () => resolveActiveSuite(runsQuery.data ?? [], selectedRunId),
    [runsQuery.data, selectedRunId],
  );
  const resultsQuery = useQuery({
    queryKey: ["evalResults", activeRun?.id],
    queryFn: () => listEvalResults(activeRun!.id),
    enabled: activeRun !== undefined,
  });
  const ratingsQuery = useQuery({
    queryKey: ["evalRatings", activeRun?.id],
    queryFn: () => listEvalRatings(activeRun!.id),
    enabled: activeRun !== undefined,
  });
  const createMutation = useMutation({ mutationFn: createEvalSuite });
  const runMutation = useMutation({ mutationFn: runEvalSuite });
  const rateMutation = useMutation({ mutationFn: rateEvalResult });
  const suites = suitesQuery.data ?? [];
  const activeSuite = useMemo(
    () => resolveActiveSuite(suites, selectedSuiteId),
    [selectedSuiteId, suites],
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
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["evalSuites", agentId] }),
          queryClient.invalidateQueries({
            queryKey: ["evalDashboard", agentId],
          }),
        ]);
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
      await runMutation.mutateAsync(activeSuite.id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["evalRuns", agentId] }),
        queryClient.invalidateQueries({ queryKey: ["evalDashboard", agentId] }),
      ]);
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
        rating,
        ...(ratingComment.trim().length === 0
          ? {}
          : { comment: ratingComment.trim() }),
      });
      await queryClient.invalidateQueries({
        queryKey: ["evalRatings", activeRun.id],
      });
      toast(t("evalRatingSaved"), "success");
    } catch {
      toast(t("evalCouldNotSaveRating"), "error");
    }
  }

  if (activeAgent === undefined) {
    return (
      <section className="rm-panel p-4">
        <div className="rm-empty">{t("evalSelectAgent")}</div>
      </section>
    );
  }

  return (
    <section className="rm-panel p-4">
      <div className="rm-card-header">
        <div className="text-sm text-muted">{t("evals")}</div>
        <div className="flex gap-2">
          <Button
            variant="primary"
            onClick={() => setSuiteDialogOpen(true)}
            type="button"
          >
            + {t("evalNewSuite")}
          </Button>
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
            <Button
              variant="primary"
              onClick={() => setSuiteDialogOpen(true)}
              type="button"
            >
              + {t("evalNewSuite")}
            </Button>
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
              <div className="grid max-h-80 gap-2 overflow-y-auto">
                {allSuites.map((suite) => (
                  <Button
                    aria-current={
                      activeSuite?.id === suite.id ? "true" : undefined
                    }
                    className="w-full justify-start rounded-md p-2 text-left"
                    key={suite.id}
                    onClick={() => setSelectedSuiteId(suite.id)}
                    type="button"
                  >
                    <div className="min-w-0 flex-1 whitespace-normal">
                      <div className="font-medium">{suite.name}</div>
                      <div className="break-words text-muted">{suite.id}</div>
                    </div>
                  </Button>
                ))}
              </div>
            </div>
          )}
        </PanelState>
        <PanelState query={runsQuery} empty={t("evalNoRuns")}>
          {(allRuns) => (
            <div className="grid max-h-80 gap-2 overflow-y-auto">
              {allRuns.map((run) => (
                <Button
                  aria-current={activeRun?.id === run.id ? "true" : undefined}
                  className="w-full justify-start rounded-md p-2 text-left"
                  key={run.id}
                  onClick={() => {
                    setSelectedRunId(run.id);
                    setSelectedResultId(undefined);
                  }}
                  type="button"
                >
                  <div className="min-w-0 flex-1 whitespace-normal">
                    <div className="font-medium">
                      {t(
                        run.status === "passed"
                          ? "evalStatusPassed"
                          : "evalStatusFailed",
                      )}{" "}
                      -{" "}
                      <LocalizedNumber
                        options={{ maximumFractionDigits: 0, style: "percent" }}
                        value={run.score}
                      />
                    </div>
                    <div className="break-words text-muted">{run.modelId}</div>
                  </div>
                </Button>
              ))}
            </div>
          )}
        </PanelState>
        {activeRun === undefined ? null : (
          <PanelState query={resultsQuery} empty={t("evalNoResults")}>
            {(results) => (
              <div className="grid max-h-80 gap-2 overflow-y-auto">
                {results.map((result) => (
                  <Button
                    aria-current={
                      activeResult?.id === result.id ? "true" : undefined
                    }
                    className="w-full justify-start rounded-md p-2 text-left"
                    key={result.id}
                    onClick={() => setSelectedResultId(result.id)}
                    type="button"
                  >
                    <div className="line-clamp-2 min-w-0 flex-1 whitespace-normal break-words">
                      {result.output}
                    </div>
                  </Button>
                ))}
              </div>
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
                <div className="rounded-md border border-border p-2">
                  <div className="font-medium">
                    {t("evalHumanRating")}{" "}
                    {activeRating === undefined
                      ? t("evalNoRating")
                      : t(evalRatingKey(activeRating.rating))}
                  </div>
                  <div className="line-clamp-2 break-words text-muted">
                    {activeResult.output}
                  </div>
                  <Input
                    aria-label={t("evalRatingComment")}
                    className="mt-2"
                    onChange={(event) =>
                      setRatingComment(event.currentTarget.value)
                    }
                    placeholder={t("evalRatingComment")}
                    value={ratingComment}
                  />
                  <div className="mt-2 grid grid-cols-3 gap-2">
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
    </section>
  );
}
