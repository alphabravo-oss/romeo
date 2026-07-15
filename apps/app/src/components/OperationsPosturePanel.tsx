import { useQuery } from "@tanstack/react-query";

import {
  getGaEvidencePosture,
  getJobsOperationalSummary,
  getPostgresOperationalPosture,
  getQuotasDistributedStatus,
} from "../api/posture-client";
import type {
  BackgroundJobTypeSummary,
  GaEvidencePostureGate,
  JobOperationalAlert,
  PostgresOperationalWarningCode,
} from "../api/posture-types";
import { PanelState } from "../lib/panel-state";
import { type ColumnDef, DataTable, createColumnHelper } from "./DataTable";
import { PanelStats } from "./PanelStats";
import { Tabs } from "./Tabs";

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
  return (
    <section className="rm-panel p-4">
      <div className="mb-3 text-sm text-muted">System posture</div>
      <Tabs
        tabs={[
          { id: "ga", label: "GA evidence", content: <GaEvidenceSection /> },
          { id: "postgres", label: "Postgres", content: <PostgresSection /> },
          { id: "jobs", label: "Jobs", content: <JobsSection /> },
          { id: "quotas", label: "Quotas", content: <QuotasSection /> },
        ]}
      />
    </section>
  );
}

function StatusDot({ status }: { status: "pass" | "warn" | "fail" }): React.ReactNode {
  return <span className={`rm-status-dot ${status}`} />;
}

/* --------------------------------- GA evidence ---------------------------- */

const gaGateCol = createColumnHelper<GaEvidencePostureGate>();

const gaGateColumns: ColumnDef<GaEvidencePostureGate, any>[] = [
  gaGateCol.accessor("title", {
    header: "Gate",
    cell: (c) => <span className="font-medium">{c.getValue()}</span>,
  }),
  gaGateCol.accessor("phase", {
    header: "Phase",
    cell: (c) => <span className="rm-cell-muted rm-mono">{c.getValue()}</span>,
  }),
  gaGateCol.accessor("status", {
    header: "Status",
    cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>,
  }),
  gaGateCol.accessor((row) => (row.requiredForGa ? "yes" : "no"), {
    id: "requiredForGa",
    header: "Required for GA",
    cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>,
  }),
  gaGateCol.accessor((row) => (row.securityCritical ? "yes" : "no"), {
    id: "securityCritical",
    header: "Security critical",
    cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>,
  }),
];

function GaEvidenceSection(): React.ReactNode {
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
            <PanelStats
              items={[
                {
                  label: "Status",
                  value: (
                    <>
                      <StatusDot
                        status={report.status === "passed" ? "pass" : "warn"}
                      />
                      {report.status}
                    </>
                  ),
                },
                { label: "Checklist", value: report.checklist.status },
                { label: "Gates", value: report.gates.length },
                { label: "Blocked gates", value: blockedGates },
                {
                  label: "Required live blockers",
                  value: report.requiredLiveBlockers.length,
                },
                { label: "Warnings", value: report.warnings.length },
              ]}
            />
            {report.warnings.length > 0 ? (
              <div className="grid gap-1">
                <div className="text-xs font-medium text-muted">Warnings</div>
                <ul className="grid gap-1">
                  {report.warnings.map((warning) => (
                    <li className="rm-mono text-sm" key={warning}>
                      {warning}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="grid gap-1">
              <div className="text-xs font-medium text-muted">Gates</div>
              <DataTable
                columns={gaGateColumns}
                data={report.gates}
                empty="No GA gates reported."
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

const pgWarnColumns: ColumnDef<PostgresWarningRow, any>[] = [
  pgWarnCol.accessor("code", {
    header: "Warning",
    cell: (c) => <span className="rm-mono">{c.getValue()}</span>,
  }),
];

function PostgresSection(): React.ReactNode {
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
            <PanelStats
              items={[
                {
                  label: "Status",
                  value: (
                    <>
                      <StatusDot
                        status={report.status === "ready" ? "pass" : "warn"}
                      />
                      {report.status}
                    </>
                  ),
                },
                { label: "Driver", value: report.repository.driver },
                {
                  label: "Database URL",
                  value: report.repository.databaseUrlConfigured
                    ? "configured"
                    : "not configured",
                },
                {
                  label: "Pool max / process",
                  value: report.pool.maxConnectionsPerProcess,
                },
                {
                  label: "Query plan review",
                  value:
                    report.queryPlanReview.representativeVolumeEvidence.status,
                },
                {
                  label: "Slow query telemetry",
                  value: report.slowQueryTelemetry.status,
                },
                {
                  label: "Lock telemetry",
                  value: report.lockTelemetry.status,
                },
                {
                  label: "Archival partitioning",
                  value: report.archivalPartitioning.status,
                },
              ]}
            />
            <div className="grid gap-1">
              <div className="text-xs font-medium text-muted">Warnings</div>
              <DataTable
                columns={pgWarnColumns}
                data={warningRows}
                empty="No Postgres warnings."
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

const jobTypeColumns: ColumnDef<BackgroundJobTypeSummary, any>[] = [
  jobTypeCol.accessor("type", {
    header: "Type",
    cell: (c) => <span className="font-medium">{c.getValue()}</span>,
  }),
  jobTypeCol.accessor("total", {
    header: "Total",
    cell: (c) => <span>{c.getValue()}</span>,
  }),
  jobTypeCol.accessor("queued", {
    header: "Queued",
    cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>,
  }),
  jobTypeCol.accessor("running", {
    header: "Running",
    cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>,
  }),
  jobTypeCol.accessor("failed", {
    header: "Failed",
    cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>,
  }),
  jobTypeCol.accessor("deadLettered", {
    header: "Dead-lettered",
    cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>,
  }),
  jobTypeCol.accessor("recentFailed", {
    header: "Recent failed",
    cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>,
  }),
];

const jobAlertCol = createColumnHelper<JobOperationalAlert>();

const jobAlertColumns: ColumnDef<JobOperationalAlert, any>[] = [
  jobAlertCol.accessor("severity", {
    header: "Severity",
    cell: (c) => <span className="font-medium">{c.getValue().toUpperCase()}</span>,
  }),
  jobAlertCol.accessor("metric", {
    header: "Metric",
    cell: (c) => <span className="rm-mono">{c.getValue()}</span>,
  }),
  jobAlertCol.accessor("type", {
    header: "Type",
    cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>,
  }),
  jobAlertCol.accessor((row) => `${row.value} / ${row.threshold}`, {
    id: "valueThreshold",
    header: "Value / Threshold",
    cell: (c) => <span>{c.getValue()}</span>,
  }),
];

function JobsSection(): React.ReactNode {
  const query = useQuery({
    queryKey: ["jobsOperationalSummary"],
    queryFn: getJobsOperationalSummary,
  });

  return (
    <PanelState query={query} isEmpty={() => false}>
      {(summary) => (
        <div className="grid gap-4">
          <PanelStats
            items={[
              {
                label: "Status",
                value: (
                  <>
                    <StatusDot status={jobStatusDot(summary.status)} />
                    {summary.status}
                  </>
                ),
              },
              { label: "Total jobs", value: summary.totals.total },
              { label: "Queued", value: summary.totals.queued },
              { label: "Running", value: summary.totals.running },
              { label: "Failed", value: summary.totals.failed },
              { label: "Dead-lettered", value: summary.totals.deadLettered },
              { label: "Recent failed", value: summary.totals.recentFailed },
              { label: "Alerts", value: summary.alerts.length },
            ]}
          />
          <div className="grid gap-1">
            <div className="text-xs font-medium text-muted">Alerts</div>
            <DataTable
              columns={jobAlertColumns}
              data={summary.alerts}
              empty="No job alerts."
            />
          </div>
          <div className="grid gap-1">
            <div className="text-xs font-medium text-muted">By type</div>
            <DataTable
              columns={jobTypeColumns}
              data={summary.byType}
              empty="No background jobs."
            />
          </div>
        </div>
      )}
    </PanelState>
  );
}

function jobStatusDot(
  status: "critical" | "degraded" | "healthy",
): "pass" | "warn" | "fail" {
  if (status === "healthy") return "pass";
  if (status === "critical") return "fail";
  return "warn";
}

/* ----------------------------------- Quotas ------------------------------- */

function QuotasSection(): React.ReactNode {
  const query = useQuery({
    queryKey: ["quotasDistributedStatus"],
    queryFn: getQuotasDistributedStatus,
  });

  return (
    <PanelState query={query} isEmpty={() => false}>
      {(status) => (
        <div className="grid gap-4">
          <PanelStats
            items={[
              {
                label: "Health",
                value: (
                  <>
                    <StatusDot status={quotaHealthDot(status.healthy)} />
                    {status.healthy === null
                      ? "unknown"
                      : status.healthy
                        ? "healthy"
                        : "unhealthy"}
                  </>
                ),
              },
              { label: "Driver", value: status.driver },
              { label: "Enabled", value: status.enabled ? "yes" : "no" },
              { label: "Configured", value: status.configured ? "yes" : "no" },
              { label: "Status code", value: status.details.statusCode },
              {
                label: "Fail closed",
                value: status.details.failClosed ? "yes" : "no",
              },
            ]}
          />
          <dl className="grid gap-1 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Key prefix</dt>
              <dd className="rm-mono">{status.keyPrefix}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Checked at</dt>
              <dd className="rm-cell-muted">
                {new Date(status.checkedAt).toLocaleString()}
              </dd>
            </div>
          </dl>
        </div>
      )}
    </PanelState>
  );
}

function quotaHealthDot(healthy: boolean | null): "pass" | "warn" | "fail" {
  if (healthy === null) return "warn";
  return healthy ? "pass" : "fail";
}
