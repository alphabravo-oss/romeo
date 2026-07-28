import { Input, NativeSelect, Button } from "@romeo/ui";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import {
  applyBillingPlan,
  getBillingPlan,
  syncExternalBillingEvent,
} from "../features/billing";
import type {
  BillingPlanQuotaTemplate,
  BillingPlanStatus,
  ExternalBillingEventType,
} from "../features/billing";
import { toast } from "../lib/toast";
import { useLocale } from "../lib/i18n";
import { type ColumnDef, DataTable, createColumnHelper } from "./DataTable";
import { EntitlementsTab, LifecycleTab } from "./BillingGovernanceTabs";
import { Tabs } from "./Tabs";

const templateCol = createColumnHelper<BillingPlanQuotaTemplate>();

const planStatuses: BillingPlanStatus[] = [
  "active",
  "canceled",
  "past_due",
  "trialing",
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

  const planForm = useForm({
    defaultValues: {
      code: "pro",
      name: "Pro",
      status: "active" as BillingPlanStatus,
      metric: "tool.call" as BillingPlanQuotaTemplate["metric"],
      limit: 1000,
      resetInterval: "monthly" as BillingPlanQuotaTemplate["resetInterval"],
    },
    onSubmit: async ({ value }) => {
      try {
        await applyMutation.mutateAsync({
          code: value.code,
          name: value.name,
          status: value.status,
          source: "manual",
          quotaTemplates: [
            {
              metric: value.metric,
              limit: value.limit,
              resetInterval: value.resetInterval,
            },
          ],
        });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["billingPlan"] }),
          queryClient.invalidateQueries({ queryKey: ["quotas"] }),
        ]);
        toast(t("billingPlanUpdated"), "success");
      } catch (caught) {
        toast(t("couldNotUpdateBillingPlan"), "error");
        throw caught;
      }
    },
  });

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

  const columns = useMemo<ColumnDef<BillingPlanQuotaTemplate, any>[]>(
    () => [
      templateCol.accessor("metric", {
        header: t("metric"),
        cell: (c) => <span className="font-medium">{c.getValue()}</span>,
      }),
      templateCol.accessor("limit", {
        header: t("limit"),
        cell: (c) => <span>{c.getValue()}</span>,
      }),
      templateCol.accessor("resetInterval", {
        header: t("reset"),
        cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>,
      }),
    ],
    [t],
  );

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
            ({plan.code}) — {plan.status} / {plan.source}
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
              <form
                className="grid gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void planForm.handleSubmit();
                }}
              >
                <planForm.Field name="code" validators={{ onChange: required }}>
                  {(field) => (
                    <Input
                      name="code"
                      aria-label={t("planCode")}
                      onBlur={field.handleBlur}
                      onChange={(event) =>
                        field.handleChange(event.currentTarget.value)
                      }
                      placeholder={t("planCode")}
                      value={field.state.value}
                    />
                  )}
                </planForm.Field>
                <planForm.Field name="name" validators={{ onChange: required }}>
                  {(field) => (
                    <Input
                      name="name"
                      aria-label={t("planName")}
                      onBlur={field.handleBlur}
                      onChange={(event) =>
                        field.handleChange(event.currentTarget.value)
                      }
                      placeholder={t("planName")}
                      value={field.state.value}
                    />
                  )}
                </planForm.Field>
                <planForm.Field name="status">
                  {(field) => (
                    <NativeSelect
                      name="status"
                      aria-label="Status"
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
                          {option}
                        </option>
                      ))}
                    </NativeSelect>
                  )}
                </planForm.Field>
                <planForm.Field name="metric">
                  {(field) => (
                    <NativeSelect
                      name="metric"
                      aria-label="Metric"
                      onBlur={field.handleBlur}
                      onChange={(event) =>
                        field.handleChange(
                          event.currentTarget
                            .value as BillingPlanQuotaTemplate["metric"],
                        )
                      }
                      value={field.state.value}
                    >
                      <option value="run.started">run.started</option>
                      <option value="tool.call">tool.call</option>
                      <option value="storage.byte">storage.byte</option>
                    </NativeSelect>
                  )}
                </planForm.Field>
                <planForm.Field name="limit">
                  {(field) => (
                    <Input
                      name="limit"
                      aria-label="Limit"
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
                <planForm.Field name="resetInterval">
                  {(field) => (
                    <NativeSelect
                      name="resetInterval"
                      aria-label="Reset Interval"
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
                <planForm.Subscribe
                  selector={(state) => ({
                    canSubmit: state.canSubmit,
                    isSubmitting: state.isSubmitting,
                  })}
                >
                  {({ canSubmit, isSubmitting }) => (
                    <Button disabled={!canSubmit || isSubmitting} type="submit">
                      {isSubmitting ? t("saving") : t("savePlan")}
                    </Button>
                  )}
                </planForm.Subscribe>
              </form>
            ),
          },
          {
            id: "quota-tiers",
            label: t("quotaTiers"),
            content: (
              <DataTable
                columns={columns}
                data={plan?.quotaTemplates ?? []}
                empty={t("noPlanQuotas")}
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
                    <NativeSelect
                      name="eventType"
                      aria-label="Event Type"
                      onBlur={field.handleBlur}
                      onChange={(event) =>
                        field.handleChange(
                          event.currentTarget.value as ExternalBillingEventType,
                        )
                      }
                      value={field.state.value}
                    >
                      {eventTypes.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </NativeSelect>
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
