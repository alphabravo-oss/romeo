import { useQuery } from "@tanstack/react-query";

import {
  getGaEvidencePosture,
  getPostgresOperationalPosture,
} from "../features/operational-posture";
import {
  getJobsOperationalSummary,
  type BackgroundJobTypeSummary,
  type JobOperationalAlert,
} from "../features/jobs";
import { getQuotasDistributedStatus } from "../features/operational-governance";
import type {
  GaEvidencePostureGate,
  PostgresOperationalWarningCode,
} from "../features/operational-posture";
import { PanelState } from "../lib/panel-state";
import { type MessageKey, useLocale } from "../lib/i18n";
import { LocalizedDateTime } from "../lib/locale-format";
import { Section, StatRow } from "./console";
import { type ColumnDef, DataTable, createColumnHelper } from "./DataTable";
import { humanizeWarningCode } from "./posture-warning-text";
import { Tabs } from "./Tabs";
import {
  jobStatusDot,
  OperationalStatusDot,
  operationalStatusLabel,
  quotaHealthDot,
} from "./operational-status";

/**
 * Read-only "System posture" panel. Consolidates four admin GET endpoints into
 * one tabbed view, each backed by an independent query:
 *   - GA evidence  → /api/v1/admin/ga/evidence-posture
 *   - Postgres     → /api/v1/admin/postgres/operational-posture
 *   - Jobs         → /api/v1/jobs/operational-summary
 *   - Quotas       → /api/v1/quotas/distributed-status
 * All headline numbers and rows are derived from real query data. Nothing here
 * mutates server state.
 */
export function OperationsPosturePanel(): React.ReactNode {
  const { t } = useLocale();
  return (
    <Section>
      <div className="mb-3 text-sm text-muted">{t("opSystemPosture")}</div>
      <Tabs
        tabs={[
          {
            id: "ga",
            label: t("opGaEvidence"),
            content: <GaEvidenceSection />,
          },
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

/* --------------------------------- GA evidence ---------------------------- */

const gaGateCol = createColumnHelper<GaEvidencePostureGate>();
type Translate = (key: MessageKey) => string;

function gaGateColumns(t: Translate): ColumnDef<GaEvidencePostureGate, any>[] {
  return [
    gaGateCol.accessor("title", {
      header: t("opGate"),
      cell: (c) => <span className="font-medium">{c.getValue()}</span>,
    }),
    gaGateCol.accessor("phase", {
      header: t("opPhase"),
      cell: (c) => (
        <span className="rm-cell-muted rm-mono" translate="no">
          {c.getValue()}
        </span>
      ),
    }),
    gaGateCol.accessor("status", {
      header: t("opStatus"),
      cell: (c) => (
        <span
          className={`rm-status ${
            c.getValue() === "satisfied" || c.getValue() === "excepted"
              ? "pass"
              : "warn"
          }`}
        >
          {operationalStatusLabel(c.getValue(), t)}
        </span>
      ),
    }),
    gaGateCol.accessor((row) => (row.requiredForGa ? t("opYes") : t("opNo")), {
      id: "requiredForGa",
      header: t("opRequiredForGa"),
      cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>,
    }),
    gaGateCol.accessor(
      (row) => (row.securityCritical ? t("opYes") : t("opNo")),
      {
        id: "securityCritical",
        header: t("opSecurityCritical"),
        cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>,
      },
    ),
  ];
}

function GaEvidenceSection(): React.ReactNode {
  const { t } = useLocale();
  const query = useQuery({
    queryKey: ["postureGaEvidence"],
    queryFn: getGaEvidencePosture,
  });

  return (
    <PanelState query={query} isEmpty={() => false}>
      {(report) => {
        const blockedGates = report.gates.filter(
          (gate) => gate.status === "blocked",
        ).length;
        return (
          <div className="grid gap-4">
            <StatRow
              items={[
                {
                  label: t("opStatus"),
                  value: (
                    <>
                      <OperationalStatusDot
                        status={report.status === "passed" ? "pass" : "warn"}
                      />
                      {operationalStatusLabel(report.status, t)}
                    </>
                  ),
                },
                {
                  label: t("opChecklist"),
                  value: operationalStatusLabel(report.checklist.status, t),
                },
                { label: t("opGates"), value: report.gates.length },
                { label: t("opBlockedGates"), value: blockedGates },
                {
                  label: t("opRequiredLiveBlockers"),
                  value: report.requiredLiveBlockers.length,
                },
                { label: t("opWarnings"), value: report.warnings.length },
              ]}
            />
            {report.warnings.length > 0 ? (
              <div className="grid gap-1">
                <div className="text-xs font-medium text-muted">
                  {t("opWarnings")}
                </div>
                <ul className="grid gap-1">
                  {report.warnings.map((warning) => (
                    <li className="text-sm" key={warning}>
                      {humanizeWarningCode(warning)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="grid gap-1">
              <div className="text-xs font-medium text-muted">
                {t("opGates")}
              </div>
              <DataTable
                columns={gaGateColumns(t)}
                data={report.gates}
                empty={t("opNoGaGates")}
              />
            </div>
          </div>
        );
      }}
    </PanelState>
  );
}

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
  const query = useQuery({
    queryKey: ["postgresOperationalPosture"],
    queryFn: getPostgresOperationalPosture,
  });

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
                {
                  label: t("opQueryPlanReview"),
                  value: operationalStatusLabel(
                    report.queryPlanReview.representativeVolumeEvidence.status,
                    t,
                  ),
                },
                {
                  label: t("opSlowQueryTelemetry"),
                  value: operationalStatusLabel(
                    report.slowQueryTelemetry.status,
                    t,
                  ),
                },
                {
                  label: t("opLockTelemetry"),
                  value: operationalStatusLabel(report.lockTelemetry.status, t),
                },
                {
                  label: t("opArchivalPartitioning"),
                  value: operationalStatusLabel(
                    report.archivalPartitioning.status,
                    t,
                  ),
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
  const query = useQuery({
    queryKey: ["jobsOperationalSummary"],
    queryFn: getJobsOperationalSummary,
  });

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
  const query = useQuery({
    queryKey: ["quotasDistributedStatus"],
    queryFn: getQuotasDistributedStatus,
  });

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
