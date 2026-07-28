import { Button } from "@romeo/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import {
  enforceBillingLifecycle,
  getBillingEntitlements,
  getBillingLifecycle,
  reconcileBillingEntitlements,
  type BillingEntitlementQuotaReport,
} from "../features/billing";
import { useLocale } from "../lib/i18n";
import { PanelState } from "../lib/panel-state";
import { toast } from "../lib/toast";
import { useConfirm } from "./ConfirmDialog";
import { type ColumnDef, DataTable, createColumnHelper } from "./DataTable";
import { PanelStats } from "./PanelStats";

const entitlementCol = createColumnHelper<BillingEntitlementQuotaReport>();

export function EntitlementsTab() {
  const { t } = useLocale();
  const quotaStatusLabels = useMemo<
    Record<BillingEntitlementQuotaReport["status"], string>
  >(
    () => ({
      matched: t("matched"),
      missing: t("missing"),
      limit_mismatch: t("quotaLimitMismatch"),
      reset_interval_mismatch: t("quotaResetMismatch"),
      limit_and_reset_interval_mismatch: t("quotaLimitResetMismatch"),
    }),
    [t],
  );
  const queryClient = useQueryClient();
  const entitlementsQuery = useQuery({
    queryKey: ["billingEntitlements"],
    queryFn: getBillingEntitlements,
  });
  const reconcileMutation = useMutation({
    mutationFn: reconcileBillingEntitlements,
  });

  const columns = useMemo<ColumnDef<BillingEntitlementQuotaReport, any>[]>(
    () => [
      entitlementCol.accessor("metric", {
        header: t("metric"),
        cell: (cell) => <span className="font-medium">{cell.getValue()}</span>,
      }),
      entitlementCol.accessor("status", {
        header: t("status"),
        cell: (cell) => (
          <span className="rm-cell-muted">
            {
              quotaStatusLabels[
                cell.getValue() as BillingEntitlementQuotaReport["status"]
              ]
            }
          </span>
        ),
      }),
      entitlementCol.accessor("expectedLimit", {
        header: t("expectedLimit"),
        cell: (cell) => <span>{cell.getValue()}</span>,
      }),
      entitlementCol.accessor((row) => row.actualLimit ?? "—", {
        id: "actualLimit",
        header: t("actualLimit"),
        cell: (cell) => (
          <span className="rm-cell-muted">{cell.getValue()}</span>
        ),
      }),
      entitlementCol.accessor("expectedResetInterval", {
        header: t("expectedReset"),
        cell: (cell) => (
          <span className="rm-cell-muted">{cell.getValue()}</span>
        ),
      }),
      entitlementCol.accessor((row) => row.actualResetInterval ?? "—", {
        id: "actualReset",
        header: t("actualReset"),
        cell: (cell) => (
          <span className="rm-cell-muted">{cell.getValue()}</span>
        ),
      }),
      entitlementCol.accessor((row) => row.actualUsed ?? "—", {
        id: "actualUsed",
        header: t("used"),
        cell: (cell) => (
          <span className="rm-cell-muted">{cell.getValue()}</span>
        ),
      }),
    ],
    [quotaStatusLabels, t],
  );

  async function handleReconcile() {
    try {
      const result = await reconcileMutation.mutateAsync();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["billingEntitlements"] }),
        queryClient.invalidateQueries({ queryKey: ["billingPlan"] }),
        queryClient.invalidateQueries({ queryKey: ["quotas"] }),
      ]);
      const { createdQuotaIds, updatedQuotaIds } = result.actions;
      toast(
        `${t("reconciledEntitlements")} (${createdQuotaIds.length} ${t("entitlementsCreated")}, ${updatedQuotaIds.length} ${t("entitlementsUpdated")})`,
        "success",
      );
    } catch (caught) {
      toast(t("couldNotReconcileEntitlements"), "error");
      throw caught;
    }
  }

  return (
    <div className="grid gap-2">
      <div className="rm-card-header">
        <div className="rm-card-title">{t("entitlements")}</div>
        <div className="flex items-center gap-2">
          <Button
            disabled={entitlementsQuery.isFetching}
            onClick={() => void entitlementsQuery.refetch()}
            type="button"
          >
            {entitlementsQuery.isFetching ? t("refreshing") : t("refresh")}
          </Button>
          <Button
            variant="primary"
            disabled={reconcileMutation.isPending}
            onClick={() => void handleReconcile()}
            type="button"
          >
            {reconcileMutation.isPending ? t("reconciling") : t("reconcile")}
          </Button>
        </div>
      </div>

      <PanelState query={entitlementsQuery} isEmpty={() => false}>
        {(report) => (
          <div className="grid gap-4">
            <PanelStats
              items={[
                {
                  label: t("status"),
                  value:
                    report.status === "healthy"
                      ? t("healthy")
                      : t("attentionRequired"),
                },
                {
                  label: t("planConfigured"),
                  value: report.billingPlanConfigured ? t("yes") : t("no"),
                },
                {
                  label: t("quotaTemplates"),
                  value: report.quotaTemplateCount,
                },
                {
                  label: t("unmanagedQuotas"),
                  value: report.unmanagedOrgQuotaCount,
                },
                { label: t("warnings"), value: report.warnings.length },
              ]}
            />
            {report.warnings.length ? (
              <div className="text-sm text-muted">
                {t("warnings")}: {report.warnings.join(", ")}
              </div>
            ) : null}
            <DataTable
              columns={columns}
              data={report.quotas}
              empty={t("noPlanQuotasReconcile")}
            />
          </div>
        )}
      </PanelState>
    </div>
  );
}

export function LifecycleTab() {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const { ask, dialog } = useConfirm();
  const lifecycleQuery = useQuery({
    queryKey: ["billingLifecycle"],
    queryFn: getBillingLifecycle,
  });
  const enforceMutation = useMutation({ mutationFn: enforceBillingLifecycle });

  async function handleEnforce() {
    const confirmed = await ask({
      title: t("enforceLifecycleTitle"),
      body: t("enforceLifecycleBody"),
      confirmLabel: t("enforceLifecycle"),
      tone: "danger",
    });
    if (!confirmed) return;
    try {
      const result = await enforceMutation.mutateAsync();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["billingLifecycle"] }),
        queryClient.invalidateQueries({ queryKey: ["billingPlan"] }),
        queryClient.invalidateQueries({ queryKey: ["billingEntitlements"] }),
      ]);
      toast(
        result.action.statusChanged
          ? `${t("lifecycleEnforced")}: ${result.action.previousStatus} → ${result.action.newStatus}`
          : t("lifecycleNoChange"),
        "success",
      );
    } catch (caught) {
      toast(t("couldNotEnforceLifecycle"), "error");
      throw caught;
    }
  }

  return (
    <div className="grid gap-2">
      <div className="rm-card-header">
        <div className="rm-card-title">{t("lifecycle")}</div>
        <div className="flex items-center gap-2">
          <Button
            disabled={lifecycleQuery.isFetching}
            onClick={() => void lifecycleQuery.refetch()}
            type="button"
          >
            {lifecycleQuery.isFetching ? t("refreshing") : t("refresh")}
          </Button>
          <Button
            variant="primary"
            disabled={enforceMutation.isPending}
            onClick={() => void handleEnforce()}
            type="button"
          >
            {enforceMutation.isPending ? t("enforcing") : t("enforceLifecycle")}
          </Button>
        </div>
      </div>

      <PanelState query={lifecycleQuery} isEmpty={() => false}>
        {(report) => (
          <div className="grid gap-4">
            <PanelStats
              items={[
                {
                  label: t("status"),
                  value:
                    report.status === "healthy"
                      ? t("healthy")
                      : t("attentionRequired"),
                },
                {
                  label: t("planConfigured"),
                  value: report.billingPlanConfigured ? t("yes") : t("no"),
                },
                {
                  label: t("recommendedAction"),
                  value:
                    report.recommendedAction === "mark_canceled"
                      ? t("markCanceled")
                      : report.recommendedAction === "mark_past_due"
                        ? t("markPastDue")
                        : t("none"),
                },
                { label: t("warnings"), value: report.warnings.length },
              ]}
            />
            {report.warnings.length ? (
              <div className="text-sm text-muted">
                {t("warnings")}: {report.warnings.join(", ")}
              </div>
            ) : null}
            {report.billingPlan ? (
              <div className="text-sm text-muted">
                {t("plan")}:{" "}
                <span className="font-medium">{report.billingPlan.name}</span> (
                {report.billingPlan.code}) — {report.billingPlan.status} /{" "}
                {report.billingPlan.source}
              </div>
            ) : null}
          </div>
        )}
      </PanelState>
      {dialog}
    </div>
  );
}
