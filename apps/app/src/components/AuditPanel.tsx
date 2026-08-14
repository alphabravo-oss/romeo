import { Button, InlineError, StatusBadge } from "@romeo/ui";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";

import { exportAuditLogsCsv } from "../features";
import type { AuditLog, AuditLogFilter } from "../features/types";
import { downloadCsv } from "../lib/csv";
import { useLocale, type MessageKey } from "../lib/i18n";
import { PanelState } from "../lib/panel-state";
import { LocalizedDateTime } from "../lib/locale-format";
import { toast } from "../lib/toast";
import { Section, StatRow } from "./console";
import { PageActions } from "./PageActions";
import { rangeToBounds, type RangePreset } from "./date-range";
import { type ColumnDef, DataTable, createColumnHelper } from "./DataTable";
import { safeUserErrorMessage } from "../lib/safe-user-error";
import type { AuditRouteState } from "../lib/audit-route-state";
import {
  type AuditCategory,
  auditLogTableQueryOptions,
  buildAuditExportFilter,
  buildAuditTableRequest,
  hasAuditFilters,
  isAuditSearchTooShort,
  isInvalidAuditCursorError,
} from "./audit-table-query";
import { useAuditTableController } from "./useAuditTableController";
import {
  categoryMessageKey,
  categoryTone,
  classifyAuditAction,
  displayAuditActor,
  humanizeAuditAction,
} from "./audit-table-display";
import { AuditTableFilters } from "./AuditTableFilters";

const col = createColumnHelper<AuditLog>();
type Translate = (key: MessageKey) => string;

function auditColumns(t: Translate): ColumnDef<AuditLog, any>[] {
  return [
    col.accessor("createdAt", {
      header: t("auditTime"),
      enableSorting: true,
      cell: (c) => (
        <span className="rm-cell-muted">
          <LocalizedDateTime value={c.getValue()} />
        </span>
      ),
    }),
    col.accessor("action", {
      header: t("auditAction"),
      enableSorting: false,
      cell: (c) => (
        <span className="grid min-w-0">
          <span className="truncate font-medium">
            {humanizeAuditAction(c.getValue())}
          </span>
          <span className="rm-mono truncate text-xs text-muted" translate="no">
            {c.getValue()}
          </span>
        </span>
      ),
    }),
    col.accessor((row) => classifyAuditAction(row.action), {
      id: "category",
      header: t("auditCategory"),
      enableSorting: false,
      cell: (c) => (
        <StatusBadge tone={categoryTone(c.getValue())}>
          {t(categoryMessageKey(c.getValue()))}
        </StatusBadge>
      ),
    }),
    col.accessor("outcome", {
      header: t("auditOutcome"),
      enableSorting: false,
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
      enableSorting: false,
      cell: (c) => (
        <span className="rm-cell-muted rm-mono" translate="no">
          {c.getValue()}
        </span>
      ),
    }),
    col.accessor("actorId", {
      header: t("auditActor"),
      enableSorting: false,
      cell: (c) => (
        <span className="rm-cell-muted">
          {displayAuditActor(c.getValue(), t)}
        </span>
      ),
    }),
  ];
}

export function AuditPanel({
  routeState,
  onRouteStateChange,
}: {
  routeState?: AuditRouteState;
  onRouteStateChange?: (
    state: AuditRouteState,
    options?: { replace?: boolean },
  ) => void;
}) {
  const { t } = useLocale();
  const columns = useMemo(() => auditColumns(t), [t]);
  const [internalRange, setInternalRange] = useState<RangePreset>("7d");
  const [internalCategory, setInternalCategory] = useState<AuditCategory | "">(
    "",
  );
  const [internalOutcome, setInternalOutcome] = useState<
    AuditLogFilter["outcome"] | ""
  >("");
  const [internalIncludeNoise, setInternalIncludeNoise] = useState(false);
  const range = routeState?.range ?? internalRange;
  const category = routeState?.category ?? internalCategory;
  const outcome = routeState?.outcome ?? internalOutcome;
  const includeNoise = routeState?.includeNoise ?? internalIncludeNoise;
  const [selectedId, setSelectedId] = useState<string>();
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string>();
  const {
    cursor,
    debouncedSearch,
    pageSize,
    recoverStaleCursor,
    recoveredStaleCursor,
    resetPaging: resetTablePaging,
    search,
    searchReady,
    searchTooShort,
    sortDirection,
    tableState,
  } = useAuditTableController(
    routeState === undefined
      ? {}
      : {
          pageSize: routeState.pageSize,
          resetKey: JSON.stringify(routeState),
          sortDirection: routeState.sortDirection,
          onPageSizeChange: (nextPageSize: number) =>
            updateRoute({ pageSize: auditPageSize(nextPageSize) }),
          onSortDirectionChange: (
            nextSortDirection: AuditRouteState["sortDirection"],
          ) => updateRoute({ sortDirection: nextSortDirection }),
        },
  );
  const bounds = useMemo(() => rangeToBounds(range, new Date()), [range]);
  const filterInput = useMemo(
    () => ({
      bounds,
      category,
      includeNoise,
      outcome,
      search: debouncedSearch,
    }),
    [bounds, category, debouncedSearch, includeNoise, outcome],
  );
  const request = useMemo(
    () =>
      buildAuditTableRequest({
        ...filterInput,
        ...(cursor === undefined ? {} : { cursor }),
        pageSize,
        sortDirection,
      }),
    [cursor, filterInput, pageSize, sortDirection],
  );
  const auditQuery = useQuery(auditLogTableQueryOptions(request, searchReady));

  useEffect(() => {
    if (cursor !== undefined && isInvalidAuditCursorError(auditQuery.error)) {
      recoverStaleCursor();
      setSelectedId(undefined);
    }
  }, [auditQuery.error, cursor, recoverStaleCursor]);

  function resetPaging() {
    resetTablePaging();
    setSelectedId(undefined);
  }

  const resetFilters = useCallback(() => {
    if (routeState === undefined) {
      setInternalRange("7d");
      setInternalCategory("");
      setInternalOutcome("");
      setInternalIncludeNoise(false);
    } else {
      onRouteStateChange?.({
        ...routeState,
        category: "",
        includeNoise: false,
        outcome: "",
        range: "7d",
      });
    }
    setSelectedId(undefined);
    resetTablePaging();
  }, [onRouteStateChange, resetTablePaging, routeState]);

  function updateRoute(
    patch: Partial<AuditRouteState>,
    options?: { replace?: boolean },
  ) {
    if (routeState === undefined) return;
    onRouteStateChange?.({ ...routeState, ...patch }, options);
    setSelectedId(undefined);
  }

  async function handleExport() {
    if (isAuditSearchTooShort(search)) return;
    setExportError(undefined);
    setIsExporting(true);
    try {
      const csv = await exportAuditLogsCsv(
        buildAuditExportFilter({ ...filterInput, search }),
      );
      downloadCsv(csv, "romeo-audit-logs.csv");
    } catch (caught) {
      setExportError(safeUserErrorMessage(caught, t("auditUnableExport")));
      toast(t("auditUnableExport"), "error");
    } finally {
      setIsExporting(false);
    }
  }

  const nextCursor = auditQuery.data?.page.nextCursor ?? undefined;
  const serverState = tableState({
    filters: request.filters ?? [],
    isFetching: auditQuery.isFetching,
    ...(nextCursor === undefined ? {} : { nextCursor }),
    onFiltersChange: resetFilters,
    total:
      auditQuery.data?.page.estimatedTotal === undefined
        ? { mode: "unknown" }
        : {
            mode: "estimated",
            value: auditQuery.data.page.estimatedTotal,
          },
  });

  return (
    <Section
      actions={
        <div className="flex gap-2">
          <PageActions
            onRefresh={() => void auditQuery.refetch()}
            refreshDisabled={!searchReady}
            refreshLabel={t("refresh")}
            refreshing={auditQuery.isFetching}
          />
          <Button
            disabled={isExporting || searchTooShort}
            onClick={() => void handleExport()}
            type="button"
          >
            {isExporting ? t("analyticsExporting") : t("analyticsExportCsv")}
          </Button>
        </div>
      }
      description={t("auditIncludeBackgroundHelp")}
    >
      {exportError ? (
        <div className="rm-composer-error mb-3" role="alert">
          {exportError}
        </div>
      ) : null}
      {recoveredStaleCursor ? (
        <div
          className="rm-attention-note mb-3"
          aria-live="polite"
          role="status"
        >
          {t("auditStaleCursorRecovered")}
        </div>
      ) : null}
      {auditQuery.isError && auditQuery.data !== undefined ? (
        <InlineError
          className="mb-3 flex flex-wrap items-center gap-2"
          role="alert"
        >
          <span>{t("auditUnableLoad")}</span>
          <Button
            onClick={() => void auditQuery.refetch()}
            size="sm"
            type="button"
            variant="outline"
          >
            {t("tryAgain")}
          </Button>
        </InlineError>
      ) : null}
      <AuditTableFilters
        category={category}
        includeNoise={includeNoise}
        onCategoryChange={(value) => {
          if (routeState === undefined) setInternalCategory(value);
          else updateRoute({ category: value });
          resetPaging();
        }}
        onIncludeNoiseChange={(value) => {
          if (routeState === undefined) setInternalIncludeNoise(value);
          else updateRoute({ includeNoise: value });
          resetPaging();
        }}
        onOutcomeChange={(value) => {
          if (routeState === undefined) setInternalOutcome(value);
          else updateRoute({ outcome: value });
          resetPaging();
        }}
        onRangeChange={(value) => {
          if (routeState === undefined) setInternalRange(value);
          else updateRoute({ range: value });
          resetPaging();
        }}
        onSearchChange={(value) => {
          serverState.onSearchChange?.(value);
          setSelectedId(undefined);
        }}
        outcome={outcome ?? ""}
        range={range}
        search={search}
        searchTooShort={searchTooShort}
      />
      <PanelState
        query={auditQuery}
        empty={
          hasAuditFilters(filterInput)
            ? t("auditNoMatches")
            : t("auditNoEvents")
        }
        isEmpty={(page) => page.items.length === 0}
      >
        {(page) => {
          const events = page.items;
          const failureCount = events.filter(
            (event) => event.outcome === "failure",
          ).length;
          const selected =
            events.find((event) => event.id === selectedId) ?? events[0];

          return (
            <div
              className="grid gap-4"
              data-audit-event-count={events.length}
              data-audit-failure-count={failureCount}
            >
              <StatRow
                items={[
                  { label: t("auditEvents"), value: events.length },
                  { label: t("auditFailures"), value: failureCount },
                  {
                    label: t("auditBackgroundHidden"),
                    value: includeNoise
                      ? t("auditCategoryAll")
                      : t("auditCategorySystem"),
                  },
                ]}
              />
              <DataTable
                columns={columns}
                data={events}
                empty={t("auditNoEvents")}
                getRowId={(row) => row.id}
                maxBodyHeight={620}
                onRowActivate={(row) => setSelectedId(row.id)}
                rowAriaLabel={(row) => humanizeAuditAction(row.action)}
                searchVisibility="hidden"
                serverState={serverState}
              />
              <div className="rm-attention-note">
                <strong>{t("auditSelectedEvent")}</strong>
                {selected ? (
                  <pre className="mt-2 overflow-auto text-xs" translate="no">
                    {JSON.stringify(
                      {
                        action: selected.action,
                        actorId: selected.actorId,
                        category: classifyAuditAction(selected.action),
                        createdAt: selected.createdAt,
                        metadata: selected.metadata,
                        outcome: selected.outcome,
                        resourceId: selected.resourceId,
                        resourceType: selected.resourceType,
                      },
                      null,
                      2,
                    )}
                  </pre>
                ) : (
                  <p>{t("auditNoSelection")}</p>
                )}
              </div>
            </div>
          );
        }}
      </PanelState>
    </Section>
  );
}

function auditPageSize(value: number): AuditRouteState["pageSize"] {
  return value === 10 || value === 25 || value === 100 ? value : 50;
}
