import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { getReadinessReport, listJobs, listProviders } from "../api/client";
import type { ProviderOperationalSummary } from "../api/types";
import { JobPanel } from "./JobPanel";
import { ReadinessPanel } from "./ReadinessPanel";

function StatCard({
  label,
  value,
  status,
  sub,
}: {
  label: string;
  value: ReactNode;
  status?: "pass" | "warn" | "fail" | undefined;
  sub?: string;
}) {
  return (
    <div className="rm-stat">
      <div className="rm-stat-label">{label}</div>
      <div className="rm-stat-value">
        {status ? <span className={`rm-status-dot ${status}`} /> : null}
        {value}
      </div>
      {sub ? <div className="rm-stat-sub">{sub}</div> : null}
    </div>
  );
}

export function AdminOverview({
  providerSummary,
  agentCount,
}: {
  providerSummary: ProviderOperationalSummary | undefined;
  agentCount: number;
}) {
  const readiness = useQuery({
    queryKey: ["readiness"],
    queryFn: getReadinessReport,
  });
  const jobs = useQuery({ queryKey: ["jobs"], queryFn: listJobs });
  const providers = useQuery({ queryKey: ["providers"], queryFn: listProviders });

  const checks = readiness.data?.checks ?? [];
  const passing = checks.filter((c) => c.status === "pass").length;
  const total = checks.length;
  const ready = readiness.data?.status === "ready";

  const jobList = jobs.data ?? [];
  const activeJobs = jobList.filter(
    (j) => j.status === "queued" || j.status === "running",
  ).length;

  const alertCount = providerSummary?.alerts.length ?? 0;
  const providerHealthy = providerSummary?.status === "healthy";

  return (
    <div className="grid gap-5">
      <div className="rm-stat-grid">
        <StatCard
          label="Readiness"
          status={total === 0 ? undefined : ready ? "pass" : "warn"}
          sub={ready ? "all checks passing" : "needs attention"}
          value={total > 0 ? `${passing}/${total}` : "—"}
        />
        <StatCard
          label="Providers"
          status={providerSummary ? (providerHealthy ? "pass" : "warn") : undefined}
          sub={`${providers.data?.length ?? 0} configured · ${alertCount} alerts`}
          value={providerSummary?.status ?? "—"}
        />
        <StatCard
          label="Background jobs"
          status={activeJobs > 0 ? "warn" : undefined}
          sub={`${jobList.length} total`}
          value={activeJobs}
        />
        <StatCard
          label="Agents"
          sub="configured in workspace"
          value={agentCount}
        />
      </div>

      <ReadinessPanel />
      <JobPanel />
    </div>
  );
}
