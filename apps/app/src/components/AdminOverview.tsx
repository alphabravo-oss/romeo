import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { listJobs } from "../features/jobs";
import { getReadinessReport } from "../features/readiness";
import { listProviders } from "../features/providers/queries";
import type { ProviderOperationalSummary } from "../features/providers/types";
import { useLocale } from "../lib/i18n";
import { formatNumber, LocalizedNumber } from "../lib/locale-format";
import { ADMIN_GROUPS, ADMIN_META } from "./admin-console-navigation";
import { AdminDisclosure } from "./AdminDisclosure";
import { JobPanel } from "./JobPanel";
import { ReadinessPanel } from "./ReadinessPanel";
import { summarizeReadinessChecks } from "./readiness-presentation";

function StatCard({
  label,
  value,
  status,
  sub,
}: {
  label: string;
  value: ReactNode;
  status?: "pass" | "warn" | "fail" | undefined;
  sub?: string | undefined;
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
  const { locale, t } = useLocale();
  const readiness = useQuery({
    queryKey: ["readiness"],
    queryFn: getReadinessReport,
  });
  const jobs = useQuery({ queryKey: ["jobs"], queryFn: listJobs });
  const providers = useQuery({
    queryKey: ["providers"],
    queryFn: listProviders,
  });

  const checks = readiness.data?.checks ?? [];
  const readinessSummary = summarizeReadinessChecks(checks);
  const readinessBreakdown =
    readinessSummary.total === 0
      ? undefined
      : [
          `${formatNumber(readinessSummary.pass, locale)} ${t("readinessPassing")}`,
          `${formatNumber(readinessSummary.warn, locale)} ${t("readinessWarnings")}`,
          `${formatNumber(readinessSummary.fail, locale)} ${t("readinessFailing")}`,
        ].join(" · ");

  const jobList = jobs.data ?? [];
  const activeJobs = jobList.filter(
    (j) => j.status === "queued" || j.status === "running",
  ).length;

  const alertCount = providerSummary?.alerts.length ?? 0;
  const providerHealthy = providerSummary?.status === "healthy";

  return (
    <div className="grid gap-8">
      <div className="rm-stat-grid">
        <StatCard
          label={t("overviewReadiness")}
          status={readinessSummary.tone}
          sub={readinessBreakdown}
          value={
            readinessSummary.total > 0
              ? t(
                  readinessSummary.tone === "pass"
                    ? "readinessReady"
                    : "readinessAttention",
                )
              : "—"
          }
        />
        <StatCard
          label={t("overviewProviders")}
          status={
            providerSummary ? (providerHealthy ? "pass" : "warn") : undefined
          }
          sub={`${formatNumber(providers.data?.length ?? 0, locale)} ${t("overviewConfigured")} · ${formatNumber(alertCount, locale)} ${t("overviewAlerts")}`}
          value={
            providerSummary === undefined
              ? "—"
              : t(providerHealthy ? "overviewHealthy" : "overviewDegraded")
          }
        />
        <StatCard
          label={t("overviewBackgroundJobs")}
          status={activeJobs > 0 ? "warn" : undefined}
          sub={`${formatNumber(jobList.length, locale)} ${t("overviewTotal")}`}
          value={<LocalizedNumber value={activeJobs} />}
        />
        <StatCard
          label={t("overviewAgents")}
          sub={t("overviewAgentsConfigured")}
          value={<LocalizedNumber value={agentCount} />}
        />
      </div>

      <div className="rm-admin-launch">
        {ADMIN_GROUPS.filter((group) => group.labelKey !== undefined).map(
          (group) => (
            <section className="rm-admin-launch__group" key={group.labelKey}>
              <h3 className="rm-admin-launch__heading">{t(group.labelKey!)}</h3>
              <div className="rm-admin-launch__grid">
                {group.items
                  .filter((item) => item.key !== "overview")
                  .map((item) => {
                    const Icon = item.icon;
                    return (
                      <Link
                        className="rm-admin-launch__item"
                        key={item.key}
                        search={{ section: item.key }}
                        to="/admin"
                      >
                        <span className="rm-admin-launch__icon">
                          <Icon aria-hidden size={16} />
                        </span>
                        <span className="rm-admin-launch__copy">
                          <strong>{t(item.labelKey)}</strong>
                          <span>
                            {t(
                              ADMIN_META[item.key]?.descriptionKey ??
                                item.labelKey,
                            )}
                          </span>
                        </span>
                      </Link>
                    );
                  })}
              </div>
            </section>
          ),
        )}
      </div>

      <AdminDisclosure
        defaultOpen={readinessSummary.tone !== "pass" || activeJobs > 0}
        description={t("overviewOperationsDetailHelp")}
        title={t("overviewOperationsDetail")}
      >
        <div className="grid gap-6">
          <ReadinessPanel />
          <JobPanel />
        </div>
      </AdminDisclosure>
    </div>
  );
}
