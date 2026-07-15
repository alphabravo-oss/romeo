import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { exportAuditLogsCsv, listAuditLogs } from "../api/client";
import type { AuditLog, AuditLogFilter } from "../api/types";
import { downloadCsv } from "../lib/csv";
import { PanelState } from "../lib/panel-state";
import { PanelStats } from "./PanelStats";
import { type ColumnDef, DataTable, type ServerPagination, createColumnHelper } from "./DataTable";

const col = createColumnHelper<AuditLog>();

const columns: ColumnDef<AuditLog, any>[] = [
  col.accessor("createdAt", {
    header: "Time",
    cell: (c) => (
      <span className="rm-cell-muted">
        {new Date(c.getValue()).toLocaleString()}
      </span>
    ),
  }),
  col.accessor("action", {
    header: "Action",
    cell: (c) => <span className="rm-mono">{c.getValue()}</span>,
  }),
  col.accessor("outcome", {
    header: "Outcome",
    cell: (c) => (
      <span
        className={`rm-status ${c.getValue() === "success" ? "pass" : "fail"}`}
      >
        {c.getValue()}
      </span>
    ),
  }),
  col.accessor((row) => `${row.resourceType}:${row.resourceId}`, {
    id: "resource",
    header: "Resource",
    cell: (c) => <span className="rm-cell-muted rm-mono">{c.getValue()}</span>,
  }),
  col.accessor("actorId", {
    header: "Actor",
    cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>,
  }),
];

const AUDIT_PAGE_SIZE = 50;

export function AuditPanel() {
  const [action, setAction] = useState("");
  const [outcome, setOutcome] = useState<AuditLogFilter["outcome"] | "">("");
  // Cursor stack: cursorStack[i] is the cursor used to fetch page i.
  // The first page uses `undefined`; each subsequent entry is a nextCursor.
  const [cursorStack, setCursorStack] = useState<(string | undefined)[]>([undefined]);
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
    const csv = await exportAuditLogsCsv(filter);
    downloadCsv(csv, "romeo-audit-logs.csv");
  }

  const nextCursor = auditQuery.data?.nextCursor;
  const serverPagination: ServerPagination = {
    pageSize: AUDIT_PAGE_SIZE,
    hasNextPage: nextCursor !== undefined,
    isFetching: auditQuery.isFetching,
    onNextPage: () => {
      if (nextCursor !== undefined) setCursorStack((stack) => [...stack, nextCursor]);
    },
  };
  if (cursorStack.length > 1) {
    serverPagination.onPrevPage = () => setCursorStack((stack) => stack.slice(0, -1));
  }

  return (
    <section className="rm-panel p-4">
      <div className="rm-card-header">
        <div className="text-sm text-muted">Audit log</div>
        <div className="flex gap-2">
          <button
            className="rm-button"
            disabled={auditQuery.isFetching}
            onClick={() => void auditQuery.refetch()}
            type="button"
          >
            {auditQuery.isFetching ? "Refreshing" : "Refresh"}
          </button>
          <button
            className="rm-button"
            onClick={() => void handleExport()}
            type="button"
          >
            Export CSV
          </button>
        </div>
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        <input
          className="rm-input"
          onChange={(event) => {
            setAction(event.currentTarget.value);
            resetPaging();
          }}
          placeholder="Filter by action…"
          style={{ maxWidth: 260 }}
          value={action}
        />
        <select
          className="rm-input"
          onChange={(event) => {
            setOutcome(event.currentTarget.value as AuditLogFilter["outcome"] | "");
            resetPaging();
          }}
          style={{ maxWidth: 180 }}
          value={outcome}
        >
          <option value="">Any outcome</option>
          <option value="success">Success</option>
          <option value="failure">Failure</option>
        </select>
      </div>
      <PanelState
        query={auditQuery}
        empty="No audit events yet."
        isEmpty={(page) => page.data.length === 0}
      >
        {(page) => (
          <div className="grid gap-4">
            <PanelStats
              items={[
                { label: "Events", value: page.data.length },
                { label: "Failures", value: page.data.filter((event) => event.outcome === "failure").length },
              ]}
            />
            <DataTable
              columns={columns}
              data={page.data}
              empty="No audit events yet."
              serverPagination={serverPagination}
            />
          </div>
        )}
      </PanelState>
    </section>
  );
}
