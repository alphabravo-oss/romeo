import LayoutDashboard from "lucide-react/dist/esm/icons/layout-dashboard.mjs";

import { type BackgroundJob } from "../features/jobs";
import { useLocale, type MessageKey } from "../lib/i18n";
import { useInventoriedServerTable } from "../lib/inventoried-server-table";
import { PanelState } from "../lib/panel-state";
import { LocalizedDateTime } from "../lib/locale-format";
import { Section, StatRow } from "./console";
import { PageActions } from "./PageActions";
import { type ColumnDef, DataTable, createColumnHelper } from "./DataTable";

const col = createColumnHelper<BackgroundJob>();

export function JobPanel() {
  const { t } = useLocale();
  const table = useInventoriedServerTable<BackgroundJob>("background_jobs");
  const columns: ColumnDef<BackgroundJob, any>[] = [
    col.accessor("type", {
      header: t("jobsType"),
      cell: (c) => (
        <span className="font-medium">{humanizeJobType(c.getValue())}</span>
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
    <Section
      actions={
        <PageActions
          onRefresh={() => void table.query.refetch()}
          refreshLabel={t("refresh")}
          refreshing={table.query.isFetching}
        />
      }
      title={t("jobsTitle")}
    >
      <PanelState
        empty={t("jobsNone")}
        emptyDescription={t("jobsNoneDescription")}
        emptyIcon={<LayoutDashboard aria-hidden size={24} />}
        isEmpty={(page) =>
          page.items.length === 0 &&
          table.isFirstPage &&
          table.search.trim() === ""
        }
        query={table.query}
      >
        {() => (
          <div className="grid gap-4">
            <StatRow
              items={[
                { label: t("jobsTotal"), value: table.estimatedTotal },
                {
                  label: t("jobsRunning"),
                  value: table.rows.filter((job) => job.status === "running")
                    .length,
                },
                {
                  label: t("jobsFailed"),
                  value: table.rows.filter((job) => job.status === "failed")
                    .length,
                },
              ]}
            />
            <DataTable
              serverState={table.serverState}
              columns={columns}
              data={table.rows}
              empty={t("jobsNone")}
            />
          </div>
        )}
      </PanelState>
    </Section>
  );
}

function jobStatusMessageKey(status: string): MessageKey {
  if (status === "completed") return "jobsStatusCompleted";
  if (status === "failed") return "jobsStatusFailed";
  if (status === "running") return "jobsStatusRunning";
  return "jobsStatusQueued";
}

function humanizeJobType(type: string): string {
  const words = type.replace(/[._-]+/gu, " ").trim();
  if (words.length === 0) return "";
  return words.charAt(0).toUpperCase() + words.slice(1);
}
