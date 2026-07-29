import { Button, Field, Input, NativeSelect } from "@romeo/ui";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import {
  applyBillingPlan,
  getBillingPlan,
  syncExternalBillingEvent,
} from "../features/billing";
import type {
  BillingPlan,
  BillingPlanQuotaTemplate,
  BillingPlanStatus,
  ExternalBillingEventType,
} from "../features/billing";
import { toast } from "../lib/toast";
import { useLocale } from "../lib/i18n";
import { type ColumnDef, DataTable, createColumnHelper } from "./DataTable";
import { EntitlementsTab, LifecycleTab } from "./BillingGovernanceTabs";
import {
  billingEventTypeKey,
  billingMetricKey,
  billingPlanStatusKey,
} from "./billing-display";
import {
  buildApplyPayload,
  buildPlanDefaults,
  type BillingQuotaMetric,
} from "./billing-plan-payload";
import { useConfirm } from "./ConfirmDialog";
import { Tabs } from "./Tabs";

const templateCol = createColumnHelper<BillingPlanQuotaTemplate>();

const planStatuses: BillingPlanStatus[] = [
  "active",
  "canceled",
  "past_due",
  "trialing",
];
const quotaMetrics: BillingQuotaMetric[] = [
  "image.cost.micro_usd",
  "image.generated",
  "web.search.request",
  "web.url.fetch",
  "run.started",
  "storage.byte",
  "tool.call",
];
const eventTypes: ExternalBillingEventType[] = [
  "customer.updated",
  "invoice.paid",
  "invoice.payment_failed",
  "subscription.canceled",
  "subscription.created",
  "subscription.updated",
];

export function BillingPanel() {
  const { t } = useLocale();
  const required = ({ value }: { value: string }) =>
    !value?.trim() ? t("required") : undefined;
  const queryClient = useQueryClient();
  const planQuery = useQuery({
    queryKey: ["billingPlan"],
    queryFn: getBillingPlan,
  });
  const applyMutation = useMutation({ mutationFn: applyBillingPlan });
  const syncMutation = useMutation({ mutationFn: syncExternalBillingEvent });

  const plan = planQuery.data ?? null;

  const eventForm = useForm({
    defaultValues: {
      provider: "stripe",
      eventType: "invoice.paid" as ExternalBillingEventType,
    },
    onSubmit: async ({ value }) => {
      try {
        await syncMutation.mutateAsync({
          provider: value.provider,
          eventType: value.eventType,
        });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["billingPlan"] }),
          queryClient.invalidateQueries({ queryKey: ["quotas"] }),
        ]);
        toast(t("externalEventSynced"), "success");
      } catch (caught) {
        toast(t("couldNotSyncExternalEvent"), "error");
        throw caught;
      }
    },
  });

  return (
    <section className="rm-panel p-4">
      <div className="rm-card-header">
        <div className="rm-card-title">{t("billing")}</div>
        <Button
          disabled={planQuery.isFetching}
          onClick={() => void planQuery.refetch()}
          type="button"
        >
          {planQuery.isFetching ? t("refreshing") : t("refresh")}
        </Button>
      </div>

      <div className="text-sm text-muted mb-2">
        {plan ? (
          <span>
            {t("currentPlan")}: <span className="font-medium">{plan.name}</span>{" "}
            ({plan.code}) — {t(billingPlanStatusKey(plan.status))} /{" "}
            {plan.source}
          </span>
        ) : (
          <span>{t("noBillingPlan")}</span>
        )}
      </div>

      <Tabs
        tabs={[
          {
            id: "plan",
            label: t("plan"),
            content: (
              <BillingPlanEditor
                isApplying={applyMutation.isPending}
                key={plan?.updatedAt ?? "new"}
                onApply={async (input) => {
                  try {
                    await applyMutation.mutateAsync(input);
                    await Promise.all([
                      queryClient.invalidateQueries({
                        queryKey: ["billingPlan"],
                      }),
                      queryClient.invalidateQueries({ queryKey: ["quotas"] }),
                    ]);
                    toast(t("billingPlanUpdated"), "success");
                  } catch (caught) {
                    toast(t("couldNotUpdateBillingPlan"), "error");
                    throw caught;
                  }
                }}
                plan={plan}
              />
            ),
          },
          {
            id: "external-events",
            label: t("externalEvents"),
            content: (
              <form
                className="grid gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void eventForm.handleSubmit();
                }}
              >
                <eventForm.Field
                  name="provider"
                  validators={{ onChange: required }}
                >
                  {(field) => (
                    <Input
                      name="provider"
                      aria-label={t("providerExample")}
                      onBlur={field.handleBlur}
                      onChange={(event) =>
                        field.handleChange(event.currentTarget.value)
                      }
                      placeholder={t("providerExample")}
                      value={field.state.value}
                    />
                  )}
                </eventForm.Field>
                <eventForm.Field name="eventType">
                  {(field) => (
                    <Field label={t("billingEventType")}>
                      <NativeSelect
                        name="eventType"
                        onBlur={field.handleBlur}
                        onChange={(event) =>
                          field.handleChange(
                            event.currentTarget
                              .value as ExternalBillingEventType,
                          )
                        }
                        value={field.state.value}
                      >
                        {eventTypes.map((option) => (
                          <option key={option} value={option}>
                            {t(billingEventTypeKey(option))}
                          </option>
                        ))}
                      </NativeSelect>
                    </Field>
                  )}
                </eventForm.Field>
                <eventForm.Subscribe
                  selector={(state) => ({
                    canSubmit: state.canSubmit,
                    isSubmitting: state.isSubmitting,
                  })}
                >
                  {({ canSubmit, isSubmitting }) => (
                    <Button disabled={!canSubmit || isSubmitting} type="submit">
                      {isSubmitting ? t("syncing") : t("syncExternalEvent")}
                    </Button>
                  )}
                </eventForm.Subscribe>
              </form>
            ),
          },
          {
            id: "entitlements",
            label: t("entitlements"),
            content: <EntitlementsTab />,
          },
          {
            id: "lifecycle",
            label: t("lifecycle"),
            content: <LifecycleTab />,
          },
        ]}
      />
    </section>
  );
}

function BillingPlanEditor({
  isApplying,
  onApply,
  plan,
}: {
  isApplying: boolean;
  onApply: (input: ReturnType<typeof buildApplyPayload>) => Promise<void>;
  plan: BillingPlan | null;
}) {
  const { t } = useLocale();
  const { ask, dialog } = useConfirm();
  const required = ({ value }: { value: string }) =>
    !value?.trim() ? t("required") : undefined;
  const planForm = useForm({
    defaultValues: buildPlanDefaults(plan),
    onSubmit: async ({ value }) => {
      if (
        !(await ask({
          title: t("billingApplyPlanTitle"),
          body: t("billingApplyPlanBody"),
          confirmLabel: t("billingApplyPlan"),
          tone: "danger",
        }))
      )
        return;
      await onApply(buildApplyPayload(plan, value));
    },
  });

  const columns = useMemo<ColumnDef<BillingPlanQuotaTemplate, any>[]>(
    () => [
      templateCol.accessor("metric", {
        header: t("metric"),
        cell: (cell) => (
          <planForm.Field name={`quotaTemplates[${cell.row.index}].metric`}>
            {(field) => (
              <NativeSelect
                name={`quotaTemplates[${cell.row.index}].metric`}
                aria-label={t("metric")}
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(
                    event.currentTarget
                      .value as BillingPlanQuotaTemplate["metric"],
                  )
                }
                value={field.state.value}
              >
                {quotaMetrics.map((metric) => (
                  <option key={metric} value={metric}>
                    {t(billingMetricKey(metric))}
                  </option>
                ))}
              </NativeSelect>
            )}
          </planForm.Field>
        ),
      }),
      templateCol.accessor("limit", {
        header: t("limit"),
        cell: (cell) => (
          <planForm.Field name={`quotaTemplates[${cell.row.index}].limit`}>
            {(field) => (
              <Input
                name={`quotaTemplates[${cell.row.index}].limit`}
                aria-label={t("limit")}
                min={0}
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(Number(event.currentTarget.value))
                }
                type="number"
                value={field.state.value}
              />
            )}
          </planForm.Field>
        ),
      }),
      templateCol.accessor("resetInterval", {
        header: t("reset"),
        cell: (cell) => (
          <planForm.Field
            name={`quotaTemplates[${cell.row.index}].resetInterval`}
          >
            {(field) => (
              <NativeSelect
                name={`quotaTemplates[${cell.row.index}].resetInterval`}
                aria-label={t("reset")}
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(
                    event.currentTarget
                      .value as BillingPlanQuotaTemplate["resetInterval"],
                  )
                }
                value={field.state.value}
              >
                <option value="none">{t("noReset")}</option>
                <option value="daily">{t("daily")}</option>
                <option value="monthly">{t("monthly")}</option>
              </NativeSelect>
            )}
          </planForm.Field>
        ),
      }),
      templateCol.display({
        id: "actions",
        header: "",
        cell: (cell) => (
          <Button
            onClick={() =>
              void planForm.removeFieldValue("quotaTemplates", cell.row.index)
            }
            type="button"
            variant="danger"
          >
            {t("quotaDelete")}
          </Button>
        ),
      }),
    ],
    [planForm, t],
  );

  return (
    <>
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void planForm.handleSubmit();
        }}
      >
        <planForm.Field name="code" validators={{ onChange: required }}>
          {(field) => (
            <Field label={t("planCode")}>
              <Input
                name="code"
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(event.currentTarget.value)
                }
                value={field.state.value}
              />
            </Field>
          )}
        </planForm.Field>
        <planForm.Field name="name" validators={{ onChange: required }}>
          {(field) => (
            <Field label={t("planName")}>
              <Input
                name="name"
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(event.currentTarget.value)
                }
                value={field.state.value}
              />
            </Field>
          )}
        </planForm.Field>
        <planForm.Field name="status">
          {(field) => (
            <Field label={t("status")}>
              <NativeSelect
                name="status"
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(
                    event.currentTarget.value as BillingPlanStatus,
                  )
                }
                value={field.state.value}
              >
                {planStatuses.map((option) => (
                  <option key={option} value={option}>
                    {t(billingPlanStatusKey(option))}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}
        </planForm.Field>
        <planForm.Field mode="array" name="quotaTemplates">
          {(field) => {
            const usedMetrics = new Set(
              field.state.value.map((template) => template.metric),
            );
            const nextMetric = quotaMetrics.find(
              (metric) => !usedMetrics.has(metric),
            );
            return (
              <div className="grid gap-2">
                <div className="text-sm font-medium">{t("quotaTiers")}</div>
                <DataTable
                  columns={columns}
                  data={field.state.value}
                  empty={t("noPlanQuotas")}
                />
                <Button
                  disabled={nextMetric === undefined}
                  onClick={() => {
                    if (nextMetric === undefined) return;
                    field.pushValue({
                      metric: nextMetric,
                      limit: 0,
                      resetInterval: "monthly",
                    });
                  }}
                  type="button"
                >
                  {t("addQuota")}
                </Button>
              </div>
            );
          }}
        </planForm.Field>
        <planForm.Subscribe
          selector={(state) => ({
            canSubmit: state.canSubmit,
            hasQuotaTemplates: state.values.quotaTemplates.length > 0,
            isSubmitting: state.isSubmitting,
          })}
        >
          {({ canSubmit, hasQuotaTemplates, isSubmitting }) => (
            <Button
              disabled={
                !canSubmit || !hasQuotaTemplates || isSubmitting || isApplying
              }
              pending={isSubmitting || isApplying}
              type="submit"
            >
              {isSubmitting || isApplying ? t("saving") : t("billingApplyPlan")}
            </Button>
          )}
        </planForm.Subscribe>
      </form>
      {dialog}
    </>
  );
}
