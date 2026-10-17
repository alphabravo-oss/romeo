import { useQuery } from "@tanstack/react-query";

import { postgresOperationalPostureQueryOptions } from "../features/operational-posture";
import {
  jobsOperationalSummaryQueryOptions,
  type BackgroundJobTypeSummary,
  type JobOperationalAlert,
} from "../features/jobs";
import { quotasDistributedStatusQueryOptions } from "../features/operational-governance";
import type { PostgresOperationalWarningCode } from "../features/operational-posture";
import { PanelState } from "../lib/panel-state";
import { type MessageKey, useLocale } from "../lib/i18n";
import { LocalizedDateTime } from "../lib/locale-format";
import { Section, StatRow } from "./console";
import { type ColumnDef, DataTable, createColumnHelper } from "./DataTable";
import { humanizeWarningCode } from "./posture-warning-text";
import { Tabs, type RoutedTabsState } from "./Tabs";
import {
  jobStatusDot,
  OperationalStatusDot,
  operationalStatusLabel,
  quotaHealthDot,
} from "./operational-status";

/**
 * Read-only "System posture" panel. Consolidates three admin GET endpoints into
 * one tabbed view, each backed by an independent query:
 *   - Postgres     → /api/v1/admin/postgres/operational-posture
 *   - Jobs         → /api/v1/jobs/operational-summary
 *   - Quotas       → /api/v1/quotas/distributed-status
 * All headline numbers and rows are derived from real query data. Nothing here
 * mutates server state.
 */
export function OperationsPosturePanel({
  tabState,
}: {
  tabState?: RoutedTabsState;
}): React.ReactNode {
  const { t } = useLocale();
  return (
    <Section>
      <Tabs
        activeId={tabState?.activeId}
        onActiveIdChange={tabState?.onActiveIdChange}
        tabs={[
          {
            id: "postgres",
            label: t("opPostgres"),
            content: <PostgresSection />,
          },
          { id: "jobs", label: t("opJobs"), content: <JobsSection /> },
          { id: "quotas", label: t("opQuotas"), content: <QuotasSection /> },
        ]}
      />
    </Section>
  );
}

type Translate = (key: MessageKey) => string;

/* ---------------------------------- Postgres ------------------------------ */

interface PostgresWarningRow {
  code: PostgresOperationalWarningCode;
}

const pgWarnCol = createColumnHelper<PostgresWarningRow>();

function pgWarnColumns(t: Translate): ColumnDef<PostgresWarningRow, any>[] {
  return [
    pgWarnCol.accessor("code", {
      header: t("opWarning"),
      cell: (c) => <span>{humanizeWarningCode(c.getValue())}</span>,
    }),
  ];
}

function PostgresSection(): React.ReactNode {
  const { t } = useLocale();
  const query = useQuery(postgresOperationalPostureQueryOptions());

  return (
    <PanelState query={query} isEmpty={() => false}>
      {(report) => {
        const warningRows = report.warnings.map((code) => ({ code }));
        return (
          <div className="grid gap-4">
            <StatRow
              items={[
                {
                  label: t("opStatus"),
                  value: (
                    <>
                      <OperationalStatusDot
                        status={report.status === "ready" ? "pass" : "warn"}
                      />
                      {operationalStatusLabel(report.status, t)}
                    </>
                  ),
                },
                { label: t("opDriver"), value: report.repository.driver },
                {
                  label: t("opDatabaseUrl"),
                  value: report.repository.databaseUrlConfigured
                    ? t("opConfiguredLower")
                    : t("opNotConfigured"),
                },
                {
                  label: t("opPoolMaxPerProcess"),
                  value: report.pool.maxConnectionsPerProcess,
                },
              ]}
            />
            <div className="grid gap-1">
              <div className="text-xs font-medium text-muted">
                {t("opWarnings")}
              </div>
              <DataTable
                columns={pgWarnColumns(t)}
                data={warningRows}
                empty={t("opNoPostgresWarnings")}
              />
            </div>
          </div>
        );
      }}
    </PanelState>
  );
}

/* ------------------------------------ Jobs -------------------------------- */

const jobTypeCol = createColumnHelper<BackgroundJobTypeSummary>();

function jobTypeColumns(
  t: Translate,
): ColumnDef<BackgroundJobTypeSummary, any>[] {
  return [
    jobTypeCol.accessor("type", {
      header: t("opType"),
      cell: (c) => (
        <span className="font-medium">
          {humanizeOperationalType(c.getValue())}
        </span>
      ),
    }),
    jobTypeCol.accessor("total", {
      header: t("opTotal"),
      cell: (c) => <span>{c.getValue()}</span>,
    }),
    jobTypeCol.accessor("queued", {
      header: t("opQueued"),
      cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>,
    }),
    jobTypeCol.accessor("running", {
      header: t("opRunning"),
      cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>,
    }),
    jobTypeCol.accessor("failed", {
      header: t("opFailed"),
      cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>,
    }),
    jobTypeCol.accessor("deadLettered", {
      header: t("opDeadLettered"),
      cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>,
    }),
    jobTypeCol.accessor("recentFailed", {
      header: t("opRecentFailed"),
      cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>,
    }),
  ];
}

const jobAlertCol = createColumnHelper<JobOperationalAlert>();

function jobAlertColumns(t: Translate): ColumnDef<JobOperationalAlert, any>[] {
  return [
    jobAlertCol.accessor("severity", {
      header: t("opSeverity"),
      cell: (c) => (
        <span className="font-medium">{c.getValue().toUpperCase()}</span>
      ),
    }),
    jobAlertCol.accessor("metric", {
      header: t("opMetric"),
      cell: (c) => (
        <span className="rm-mono" translate="no">
          {c.getValue()}
        </span>
      ),
    }),
    jobAlertCol.accessor("type", {
      header: t("opType"),
      cell: (c) => (
        <span className="rm-cell-muted">
          {humanizeOperationalType(c.getValue())}
        </span>
      ),
    }),
    jobAlertCol.accessor((row) => `${row.value} / ${row.threshold}`, {
      id: "valueThreshold",
      header: t("opValueThreshold"),
      cell: (c) => <span>{c.getValue()}</span>,
    }),
  ];
}

function humanizeOperationalType(type: string): string {
  const words = type.replace(/[._:-]+/gu, " ").trim();
  return words.length === 0
    ? ""
    : words.charAt(0).toUpperCase() + words.slice(1);
}

function JobsSection(): React.ReactNode {
  const { t } = useLocale();
  const query = useQuery(jobsOperationalSummaryQueryOptions());

  return (
    <PanelState query={query} isEmpty={() => false}>
      {(summary) => (
        <div className="grid gap-4">
          <StatRow
            items={[
              {
                label: t("opStatus"),
                value: (
                  <>
                    <OperationalStatusDot
                      status={jobStatusDot(summary.status)}
                    />
                    {operationalStatusLabel(summary.status, t)}
                  </>
                ),
              },
              { label: t("opTotalJobs"), value: summary.totals.total },
              { label: t("opQueued"), value: summary.totals.queued },
              { label: t("opRunning"), value: summary.totals.running },
              { label: t("opFailed"), value: summary.totals.failed },
              {
                label: t("opDeadLettered"),
                value: summary.totals.deadLettered,
              },
              {
                label: t("opRecentFailed"),
                value: summary.totals.recentFailed,
              },
              { label: t("opAlerts"), value: summary.alerts.length },
            ]}
          />
          <div className="grid gap-1">
            <div className="text-xs font-medium text-muted">
              {t("opAlerts")}
            </div>
            <DataTable
              columns={jobAlertColumns(t)}
              data={summary.alerts}
              empty={t("opNoJobAlerts")}
            />
          </div>
          <div className="grid gap-1">
            <div className="text-xs font-medium text-muted">
              {t("opByType")}
            </div>
            <DataTable
              columns={jobTypeColumns(t)}
              data={summary.byType}
              empty={t("opNoBackgroundJobs")}
            />
          </div>
        </div>
      )}
    </PanelState>
  );
}

/* ----------------------------------- Quotas ------------------------------- */

function QuotasSection(): React.ReactNode {
  const { t } = useLocale();
  const query = useQuery(quotasDistributedStatusQueryOptions());

  return (
    <PanelState query={query} isEmpty={() => false}>
      {(status) => (
        <div className="grid gap-4">
          <StatRow
            items={[
              {
                label: t("opHealth"),
                value: (
                  <>
                    <OperationalStatusDot
                      status={quotaHealthDot(status.healthy)}
                    />
                    {status.healthy === null
                      ? t("opUnknown")
                      : status.healthy
                        ? t("opHealthy")
                        : t("opUnhealthy")}
                  </>
                ),
              },
              { label: t("opDriver"), value: status.driver },
              {
                label: t("opEnabled"),
                value: status.enabled ? t("opYes") : t("opNo"),
              },
              {
                label: t("opConfigured"),
                value: status.configured ? t("opYes") : t("opNo"),
              },
              { label: t("opStatusCode"), value: status.details.statusCode },
              {
                label: t("opFailClosed"),
                value: status.details.failClosed ? t("opYes") : t("opNo"),
              },
            ]}
          />
          <dl className="grid gap-1 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted">{t("opKeyPrefix")}</dt>
              <dd className="rm-mono">{status.keyPrefix}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">{t("opCheckedAt")}</dt>
              <dd className="rm-cell-muted">
                <LocalizedDateTime value={status.checkedAt} />
              </dd>
            </div>
          </dl>
        </div>
      )}
    </PanelState>
  );
}
