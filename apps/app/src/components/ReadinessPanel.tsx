import { Button } from "@romeo/ui";
import { useQuery } from "@tanstack/react-query";

import { getReadinessReport } from "../features/readiness";
import { useLocale, type MessageKey } from "../lib/i18n";
import { PanelState } from "../lib/panel-state";
import { LocalizedDateTime } from "../lib/locale-format";
import { PanelStats } from "./PanelStats";

const severityRank: Record<string, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

export function ReadinessPanel() {
  const { t } = useLocale();
  const readinessQuery = useQuery({
    queryKey: ["readiness"],
    queryFn: getReadinessReport,
  });

  return (
    <section className="rm-panel p-4">
      <div className="rm-card-header">
        <div className="rm-card-title">{t("overviewReadiness")}</div>
        <Button
          disabled={readinessQuery.isFetching}
          onClick={() => void readinessQuery.refetch()}
          type="button"
        >
          {readinessQuery.isFetching ? t("refreshing") : t("refresh")}
        </Button>
      </div>
      <div className="mt-4">
        <PanelState
          query={readinessQuery}
          isEmpty={(report) => report.checks.length === 0}
          empty={t("readinessNoChecks")}
        >
          {(report) => {
            const pass = report.checks.filter(
              (check) => check.status === "pass",
            ).length;
            const warn = report.checks.filter(
              (check) => check.status === "warn",
            ).length;
            const fail = report.checks.filter(
              (check) => check.status === "fail",
            ).length;
            const checks = [...report.checks].sort(
              (a, b) =>
                (severityRank[a.severity] ?? 3) -
                (severityRank[b.severity] ?? 3),
            );
            return (
              <div className="grid gap-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span
                    className={`rm-status ${report.status === "ready" ? "ok" : "warn"} text-sm font-medium`}
                  >
                    {report.status === "ready"
                      ? t("readinessReady")
                      : t("readinessAttention")}
                  </span>
                  <span className="text-xs text-muted">
                    {t("readinessGenerated")}{" "}
                    <LocalizedDateTime value={report.generatedAt} />
                  </span>
                </div>
                <PanelStats
                  items={[
                    { label: t("readinessPassing"), value: pass },
                    { label: t("readinessWarnings"), value: warn },
                    { label: t("readinessFailing"), value: fail },
                  ]}
                />
                <div className="grid gap-2">
                  {checks.map((check) => (
                    <div
                      className="flex items-start justify-between gap-3 rounded-md border border-border p-3"
                      key={check.id}
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium">{check.id}</div>
                        <div className="mt-0.5 break-words text-sm text-muted">
                          {check.message}
                        </div>
                      </div>
                      <span
                        className={`rm-status ${check.status} shrink-0 whitespace-nowrap text-xs font-medium`}
                      >
                        {t(readinessStatusMessageKey(check.status))}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          }}
        </PanelState>
      </div>
    </section>
  );
}

function readinessStatusMessageKey(status: string): MessageKey {
  if (status === "pass") return "readinessStatusPass";
  if (status === "warn") return "readinessStatusWarn";
  return "readinessStatusFail";
}
