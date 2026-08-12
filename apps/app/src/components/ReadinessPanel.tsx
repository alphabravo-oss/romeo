import { useQuery } from "@tanstack/react-query";

import { getReadinessReport, type ReadinessCheck } from "../features/readiness";
import { useLocale, type MessageKey } from "../lib/i18n";
import { PanelState } from "../lib/panel-state";
import { LocalizedDateTime } from "../lib/locale-format";
import { Section, StatRow } from "./console";
import { type ColumnDef, DataTable, createColumnHelper } from "./DataTable";
import { PageActions } from "./PageActions";
import {
  orderReadinessChecks,
  summarizeReadinessChecks,
} from "./readiness-presentation";

const col = createColumnHelper<ReadinessCheck>();

export function ReadinessPanel() {
  const { t } = useLocale();
  const readinessQuery = useQuery({
    queryKey: ["readiness"],
    queryFn: getReadinessReport,
  });

  return (
    <Section
      actions={
        <PageActions
          onRefresh={() => void readinessQuery.refetch()}
          refreshLabel={t("refresh")}
          refreshing={readinessQuery.isFetching}
        />
      }
      title={t("overviewReadiness")}
    >
      <PanelState
        query={readinessQuery}
        isEmpty={(report) => report.checks.length === 0}
        empty={t("readinessNoChecks")}
      >
        {(report) => {
          const summary = summarizeReadinessChecks(report.checks);
          const checks = orderReadinessChecks(report.checks);
          const columns: ColumnDef<ReadinessCheck, any>[] = [
            col.accessor("id", {
              header: t("readinessCheck"),
              cell: (cell) => (
                <span className="font-medium rm-mono" translate="no">
                  {cell.getValue()}
                </span>
              ),
            }),
            col.accessor("status", {
              header: t("status"),
              cell: (cell) => {
                const status = cell.getValue();
                return (
                  <span
                    className={`rm-status ${status} whitespace-nowrap font-medium`}
                  >
                    {t(readinessStatusMessageKey(status))}
                  </span>
                );
              },
            }),
            col.accessor("message", {
              header: t("readinessResult"),
              cell: (cell) => (
                <span className="break-words text-muted">
                  {cell.getValue()}
                </span>
              ),
            }),
          ];
          return (
            <div className="grid gap-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span
                  className={`rm-status ${
                    summary.tone === "pass" ? "ok" : (summary.tone ?? "warn")
                  } text-sm font-medium`}
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
              <StatRow
                items={[
                  {
                    label: t("readinessPassing"),
                    value: summary.pass,
                  },
                  {
                    label: t("readinessWarnings"),
                    value: summary.warn,
                  },
                  {
                    label: t("readinessFailing"),
                    value: summary.fail,
                  },
                ]}
              />
              <DataTable
                columns={columns}
                data={checks}
                empty={t("readinessNoChecks")}
                getRowId={(check) => check.id}
                maxBodyHeight={620}
                minTableWidth={760}
              />
            </div>
          );
        }}
      </PanelState>
    </Section>
  );
}

function readinessStatusMessageKey(status: string): MessageKey {
  if (status === "pass") return "readinessStatusPass";
  if (status === "warn") return "readinessStatusWarn";
  return "readinessStatusFail";
}
