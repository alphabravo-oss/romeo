import { Input, NativeSelect, Button, Checkbox, StatusBadge } from "@romeo/ui";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { exportAuditLogsCsv, listAuditLogs } from "../features";
import type { AuditLog, AuditLogFilter } from "../features/types";
import { downloadCsv } from "../lib/csv";
import { useLocale, type MessageKey } from "../lib/i18n";
import { PanelState } from "../lib/panel-state";
import { LocalizedDateTime } from "../lib/locale-format";
import { toast } from "../lib/toast";
import { Section, StatRow } from "./console";
import { DateRangeSelect } from "./DateRangeSelect";
import { PageActions } from "./PageActions";
import { rangeToBounds, type RangePreset } from "./date-range";
import {
  type ColumnDef,
  DataTable,
  type ServerPagination,
  createColumnHelper,
} from "./DataTable";

const col = createColumnHelper<AuditLog>();
const AUDIT_PAGE_SIZE = 50;

const AUDIT_CATEGORIES = [
  "security",
  "admin",
  "access",
  "data",
  "chat",
  "run",
  "system",
] as const;

type AuditCategory = (typeof AUDIT_CATEGORIES)[number];
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
      cell: (c) => (
        <StatusBadge tone={categoryTone(c.getValue())}>
          {t(categoryMessageKey(c.getValue()))}
        </StatusBadge>
      ),
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
        <span className="rm-cell-muted rm-mono" translate="no">
          {c.getValue()}
        </span>
      ),
    }),
    col.accessor("actorId", {
      header: t("auditActor"),
      cell: (c) => (
        <span className="rm-cell-muted">
          {displayAuditActor(c.getValue(), t)}
        </span>
      ),
    }),
  ];
}

export function AuditPanel() {
  const { t } = useLocale();
  const [range, setRange] = useState<RangePreset>("7d");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<AuditCategory | "">("");
  const [outcome, setOutcome] = useState<AuditLogFilter["outcome"] | "">("");
  const [includeNoise, setIncludeNoise] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string>();
  const [cursorStack, setCursorStack] = useState<(string | undefined)[]>([
    undefined,
  ]);
  const bounds = rangeToBounds(range, new Date());
  const filter = buildAuditFilter({
    bounds,
    category,
    includeNoise,
    outcome,
    query,
  });
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
    setSelectedId(undefined);
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
    <Section
      actions={
        <div className="flex gap-2">
          <PageActions
            onRefresh={() => void auditQuery.refetch()}
            refreshLabel={t("refresh")}
            refreshing={auditQuery.isFetching}
          />
          <Button
            disabled={isExporting}
            onClick={() => void handleExport()}
            type="button"
          >
            {isExporting ? t("analyticsExporting") : t("analyticsExportCsv")}
          </Button>
        </div>
      }
      description={t("auditIncludeBackgroundHelp")}
      title={t("auditTitle")}
    >
      {exportError ? (
        <div className="rm-composer-error mb-3" role="alert">
          {exportError}
        </div>
      ) : null}
      <div className="mb-3 flex flex-wrap gap-2">
        <DateRangeSelect
          onChange={(value) => {
            setRange(value);
            resetPaging();
          }}
          value={range}
        />
        <Input
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            resetPaging();
          }}
          aria-label={t("auditFilterAction")}
          placeholder={t("auditSearch")}
          style={{ maxWidth: 280 }}
          value={query}
        />
        <NativeSelect
          aria-label={t("auditCategory")}
          onChange={(event) => {
            setCategory(event.currentTarget.value as AuditCategory | "");
            resetPaging();
          }}
          style={{ maxWidth: 180 }}
          value={category}
        >
          <option value="">{t("auditCategoryAll")}</option>
          {AUDIT_CATEGORIES.map((value) => (
            <option key={value} value={value}>
              {t(categoryMessageKey(value))}
            </option>
          ))}
        </NativeSelect>
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
        <Checkbox
          checked={includeNoise}
          label={t("auditIncludeBackground")}
          onCheckedChange={(checked) => {
            setIncludeNoise(checked === true);
            resetPaging();
          }}
        />
      </div>
      <PanelState
        query={auditQuery}
        empty={t("auditNoEvents")}
        isEmpty={(page) => page.data.length === 0}
      >
        {(page) => {
          const events = page.data;
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
                columns={auditColumns(t)}
                data={events}
                empty={t("auditNoEvents")}
                getRowId={(row) => row.id}
                maxBodyHeight={620}
                onRowActivate={(row) => setSelectedId(row.id)}
                rowAriaLabel={(row) => humanizeAuditAction(row.action)}
                serverPagination={serverPagination}
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

function buildAuditFilter(input: {
  bounds: { from: Date | undefined; to: Date };
  category: AuditCategory | "";
  includeNoise: boolean;
  outcome: AuditLogFilter["outcome"] | "";
  query: string;
}): AuditLogFilter {
  const filter: AuditLogFilter = {
    includeNoise: input.includeNoise ? "true" : "false",
    to: input.bounds.to.toISOString(),
  };
  if (input.bounds.from !== undefined)
    filter.from = input.bounds.from.toISOString();
  if (input.query.trim().length > 0) filter.q = input.query.trim();
  if (input.category !== "") filter.category = input.category;
  if (input.outcome === "success" || input.outcome === "failure") {
    filter.outcome = input.outcome;
  }
  return filter;
}

function humanizeAuditAction(action: string): string {
  const words = action.replaceAll(".", " ").replaceAll("_", " ").trim();
  if (words.length === 0) return action;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function displayAuditActor(actorId: string, t: Translate): string {
  if (
    actorId.startsWith("system_") ||
    actorId.includes("service_account_audit")
  ) {
    return t("auditActorSystem");
  }
  const words = actorId.replace(/[._-]+/gu, " ").trim();
  if (words.length === 0) return actorId;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function classifyAuditAction(action: string): AuditCategory {
  if (
    action === "provider.models.sync" ||
    action === "worker.enqueue" ||
    action === "model.request" ||
    action.startsWith("worker.")
  ) {
    return "system";
  }
  if (
    action.startsWith("local_auth.") ||
    action.startsWith("auth.") ||
    action.startsWith("support.") ||
    action.startsWith("scim.") ||
    action.startsWith("directory_sync.")
  ) {
    return "security";
  }
  if (
    action.includes("share") ||
    action.includes("favorite") ||
    action.startsWith("group.") ||
    action.startsWith("api_key.") ||
    action.startsWith("service_account.")
  ) {
    return "access";
  }
  if (
    action.startsWith("knowledge.") ||
    action.startsWith("file.") ||
    action.startsWith("connector.") ||
    action.startsWith("folder.")
  ) {
    return "data";
  }
  if (action.startsWith("chat.") || action.startsWith("chat_experience.")) {
    return "chat";
  }
  if (
    action.startsWith("run.") ||
    action.startsWith("tool.") ||
    action.startsWith("eval.") ||
    action.startsWith("workflow.") ||
    action.startsWith("voice.")
  ) {
    return "run";
  }
  return "admin";
}

function categoryMessageKey(category: AuditCategory): MessageKey {
  if (category === "security") return "auditCategorySecurity";
  if (category === "admin") return "auditCategoryAdmin";
  if (category === "access") return "auditCategoryAccess";
  if (category === "data") return "auditCategoryData";
  if (category === "chat") return "auditCategoryChat";
  if (category === "run") return "auditCategoryRun";
  return "auditCategorySystem";
}

function categoryTone(
  category: AuditCategory,
): "danger" | "info" | "neutral" | "success" | "warning" {
  if (category === "security") return "danger";
  if (category === "admin") return "info";
  if (category === "system") return "neutral";
  if (category === "run") return "success";
  return "warning";
}
