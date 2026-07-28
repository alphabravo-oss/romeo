import { Input, NativeSelect, Button } from "@romeo/ui";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { exportAuditLogsCsv, listAuditLogs } from "../features";
import type { AuditLog, AuditLogFilter } from "../features/types";
import { downloadCsv } from "../lib/csv";
import { useLocale, type MessageKey } from "../lib/i18n";
import { PanelState } from "../lib/panel-state";
import { LocalizedDateTime } from "../lib/locale-format";
import { toast } from "../lib/toast";
import { PanelStats } from "./PanelStats";
import {
  type ColumnDef,
  DataTable,
  type ServerPagination,
  createColumnHelper,
} from "./DataTable";

const col = createColumnHelper<AuditLog>();

type Translate = (key: MessageKey) => string;

function auditColumns(t: Translate): ColumnDef<AuditLog, any>[] {
  return [
    col.accessor("createdAt", {
      header: t("auditTime"),
      cell: (c) => (
        <span className="rm-cell-muted">
          <LocalizedDateTime value={c.getValue()} />
        </span>
      ),
    }),
    col.accessor("action", {
      header: t("auditAction"),
      cell: (c) => <span className="rm-mono">{c.getValue()}</span>,
    }),
    col.accessor("outcome", {
      header: t("auditOutcome"),
      cell: (c) => (
        <span
          className={`rm-status ${c.getValue() === "success" ? "pass" : "fail"}`}
        >
          {c.getValue() === "success" ? t("auditSuccess") : t("auditFailure")}
        </span>
      ),
    }),
    col.accessor((row) => `${row.resourceType}:${row.resourceId}`, {
      id: "resource",
      header: t("auditResource"),
      cell: (c) => (
        <span className="rm-cell-muted rm-mono">{c.getValue()}</span>
      ),
    }),
    col.accessor("actorId", {
      header: t("auditActor"),
      cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>,
    }),
  ];
}

const AUDIT_PAGE_SIZE = 50;

export function AuditPanel() {
  const { t } = useLocale();
  const [action, setAction] = useState("");
  const [outcome, setOutcome] = useState<AuditLogFilter["outcome"] | "">("");
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string>();
  // Cursor stack: cursorStack[i] is the cursor used to fetch page i.
  // The first page uses `undefined`; each subsequent entry is a nextCursor.
  const [cursorStack, setCursorStack] = useState<(string | undefined)[]>([
    undefined,
  ]);
  const filter: AuditLogFilter = {};
  if (action.trim().length > 0) filter.action = action.trim();
  if (outcome === "success" || outcome === "failure") filter.outcome = outcome;
  const cursor = cursorStack[cursorStack.length - 1];
  const auditQuery = useQuery({
    queryKey: ["auditLogs", filter, cursor ?? null],
    queryFn: () =>
      listAuditLogs(
        filter,
        cursor !== undefined
          ? { limit: AUDIT_PAGE_SIZE, cursor }
          : { limit: AUDIT_PAGE_SIZE },
      ),
  });

  function resetPaging() {
    setCursorStack([undefined]);
  }

  async function handleExport() {
    setExportError(undefined);
    setIsExporting(true);
    try {
      const csv = await exportAuditLogsCsv(filter);
      downloadCsv(csv, "romeo-audit-logs.csv");
    } catch (caught) {
      setExportError(
        caught instanceof Error ? caught.message : t("auditUnableExport"),
      );
      toast(t("auditUnableExport"), "error");
    } finally {
      setIsExporting(false);
    }
  }

  const nextCursor = auditQuery.data?.nextCursor;
  const serverPagination: ServerPagination = {
    pageSize: AUDIT_PAGE_SIZE,
    hasNextPage: nextCursor !== undefined,
    isFetching: auditQuery.isFetching,
    onNextPage: () => {
      if (nextCursor !== undefined)
        setCursorStack((stack) => [...stack, nextCursor]);
    },
  };
  if (cursorStack.length > 1) {
    serverPagination.onPrevPage = () =>
      setCursorStack((stack) => stack.slice(0, -1));
  }

  return (
    <section className="rm-panel p-4">
      <div className="rm-card-header">
        <div className="text-sm text-muted">{t("auditTitle")}</div>
        <div className="flex gap-2">
          <Button
            disabled={auditQuery.isFetching}
            onClick={() => void auditQuery.refetch()}
            type="button"
          >
            {auditQuery.isFetching ? t("refreshing") : t("refresh")}
          </Button>
          <Button
            disabled={isExporting}
            onClick={() => void handleExport()}
            type="button"
          >
            {isExporting ? t("analyticsExporting") : t("analyticsExportCsv")}
          </Button>
        </div>
      </div>
      {exportError ? (
        <div className="rm-composer-error mb-3" role="alert">
          {exportError}
        </div>
      ) : null}
      <div className="mb-3 flex flex-wrap gap-2">
        <Input
          onChange={(event) => {
            setAction(event.currentTarget.value);
            resetPaging();
          }}
          aria-label={t("auditFilterAction")}
          placeholder={t("auditFilterAction")}
          style={{ maxWidth: 260 }}
          value={action}
        />
        <NativeSelect
          aria-label={t("auditOutcome")}
          onChange={(event) => {
            setOutcome(
              event.currentTarget.value as AuditLogFilter["outcome"] | "",
            );
            resetPaging();
          }}
          style={{ maxWidth: 180 }}
          value={outcome}
        >
          <option value="">{t("auditAnyOutcome")}</option>
          <option value="success">{t("auditSuccess")}</option>
          <option value="failure">{t("auditFailure")}</option>
        </NativeSelect>
      </div>
      <PanelState
        query={auditQuery}
        empty={t("auditNoEvents")}
        isEmpty={(page) => page.data.length === 0}
      >
        {(page) => (
          <div className="grid gap-4">
            <PanelStats
              items={[
                { label: t("auditEvents"), value: page.data.length },
                {
                  label: t("auditFailures"),
                  value: page.data.filter(
                    (event) => event.outcome === "failure",
                  ).length,
                },
              ]}
            />
            <DataTable
              columns={auditColumns(t)}
              data={page.data}
              empty={t("auditNoEvents")}
              serverPagination={serverPagination}
            />
          </div>
        )}
      </PanelState>
    </section>
  );
}
