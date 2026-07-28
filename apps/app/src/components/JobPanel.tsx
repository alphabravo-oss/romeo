import { Button } from "@romeo/ui";
import { useQuery } from "@tanstack/react-query";

import { listJobs, type BackgroundJob } from "../features/jobs";
import { useLocale, type MessageKey } from "../lib/i18n";
import { PanelState } from "../lib/panel-state";
import { LocalizedDateTime } from "../lib/locale-format";
import { PanelStats } from "./PanelStats";
import { type ColumnDef, DataTable, createColumnHelper } from "./DataTable";

const col = createColumnHelper<BackgroundJob>();

export function JobPanel() {
  const { t } = useLocale();
  const jobsQuery = useQuery({ queryKey: ["jobs"], queryFn: listJobs });
  const columns: ColumnDef<BackgroundJob, any>[] = [
    col.accessor("type", {
      header: t("jobsType"),
      cell: (c) => <span className="font-medium">{c.getValue()}</span>,
    }),
    col.accessor("id", {
      header: t("jobsId"),
      cell: (c) => (
        <span className="rm-cell-muted rm-mono">{c.getValue()}</span>
      ),
    }),
    col.accessor("status", {
      header: t("status"),
      cell: (c) => {
        const status = c.getValue();
        const tone =
          status === "completed"
            ? "pass"
            : status === "failed"
              ? "fail"
              : "warn";
        return (
          <span className={`rm-status ${tone}`}>
            {t(jobStatusMessageKey(status))}
          </span>
        );
      },
    }),
    col.accessor("updatedAt", {
      header: t("jobsUpdated"),
      cell: (c) => (
        <span className="rm-cell-muted">
          <LocalizedDateTime value={c.getValue()} />
        </span>
      ),
    }),
  ];

  return (
    <section className="rm-panel p-4">
      <div className="rm-card-header">
        <div className="text-sm text-muted">{t("jobsTitle")}</div>
        <Button
          disabled={jobsQuery.isFetching}
          onClick={() => void jobsQuery.refetch()}
          type="button"
        >
          {jobsQuery.isFetching ? t("refreshing") : t("refresh")}
        </Button>
      </div>
      <PanelState query={jobsQuery} empty={t("jobsNone")}>
        {(jobs) => (
          <div className="grid gap-4">
            <PanelStats
              items={[
                { label: t("jobsTotal"), value: jobs.length },
                {
                  label: t("jobsRunning"),
                  value: jobs.filter((job) => job.status === "running").length,
                },
                {
                  label: t("jobsFailed"),
                  value: jobs.filter((job) => job.status === "failed").length,
                },
              ]}
            />
            <DataTable columns={columns} data={jobs} empty={t("jobsNone")} />
          </div>
        )}
      </PanelState>
    </section>
  );
}

function jobStatusMessageKey(status: string): MessageKey {
  if (status === "completed") return "jobsStatusCompleted";
  if (status === "failed") return "jobsStatusFailed";
  if (status === "running") return "jobsStatusRunning";
  return "jobsStatusQueued";
}
