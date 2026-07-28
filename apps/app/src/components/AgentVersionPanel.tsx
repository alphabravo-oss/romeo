import { useMemo } from "react";
import { Button, Select, StatusBadge } from "@romeo/ui";

import type { Agent, AgentVersion, AgentVersionDiff } from "../features/types";
import { useLocale, type MessageKey } from "../lib/i18n";
import { formatNumber, LocalizedDateTime } from "../lib/locale-format";
import { AgentVersionDiffSummary } from "./AgentVersionDiffSummary";
import { type ColumnDef, DataTable, createColumnHelper } from "./DataTable";

const col = createColumnHelper<AgentVersion>();

interface AgentVersionPanelProps {
  activeAgent: Agent | undefined;
  diff: AgentVersionDiff | undefined;
  isComparing: boolean;
  isRollingBack: boolean;
  leftVersionId: string;
  onCompare: () => void;
  onLeftVersionChange: (versionId: string) => void;
  onRightVersionChange: (versionId: string) => void;
  onRollback: (versionId: string) => void;
  rightVersionId: string;
  versions: AgentVersion[];
}

export function AgentVersionPanel({
  activeAgent,
  diff,
  isComparing,
  isRollingBack,
  leftVersionId,
  onCompare,
  onLeftVersionChange,
  onRightVersionChange,
  onRollback,
  rightVersionId,
  versions,
}: AgentVersionPanelProps) {
  const { locale, t } = useLocale();
  const columns = useMemo<ColumnDef<AgentVersion, any>[]>(
    () => [
      col.accessor("version", {
        header: t("agentVersion"),
        cell: (c) => (
          <span className="font-medium">
            {t("agentVersion")} {formatNumber(c.getValue(), locale)}
          </span>
        ),
      }),
      col.accessor("publishedAt", {
        header: t("agentPublished"),
        cell: (c) => (
          <span className="rm-cell-muted">
            <LocalizedDateTime value={c.getValue()} />
          </span>
        ),
      }),
      col.accessor((row) => row.evalSummary?.status ?? "", {
        id: "evals",
        header: t("agentEvals"),
        cell: (c) => {
          const summary = c.row.original.evalSummary;
          if (!summary) return <span className="rm-cell-muted">-</span>;
          return (
            <StatusBadge
              tone={
                summary.status === "passed"
                  ? "success"
                  : summary.status === "failed"
                    ? "danger"
                    : "warning"
              }
            >
              {t(evalStatusMessageKey(summary.status))}{" "}
              {formatNumber(summary.passedSuiteCount, locale)}/
              {formatNumber(summary.suiteCount, locale)}
              {summary.averageScore === null
                ? ""
                : ` - ${formatNumber(summary.averageScore, locale, { style: "percent", maximumFractionDigits: 0 })}`}
            </StatusBadge>
          );
        },
      }),
      col.display({
        id: "actions",
        header: "",
        cell: (c) => (
          <Button
            disabled={
              activeAgent?.publishedVersionId === c.row.original.id ||
              isRollingBack
            }
            onClick={() => onRollback(c.row.original.id)}
            pending={isRollingBack}
          >
            {activeAgent?.publishedVersionId === c.row.original.id
              ? t("agentCurrent")
              : t("agentRollback")}
          </Button>
        ),
      }),
    ],
    [activeAgent?.publishedVersionId, isRollingBack, locale, onRollback, t],
  );

  return (
    <>
      <div className="mt-5">
        <div className="mb-2 text-sm text-muted">{t("agentVersions")}</div>
        <DataTable
          columns={columns}
          data={versions}
          empty={t("agentNoPublishedVersions")}
        />
      </div>

      <div className="mt-5 grid gap-2">
        <div className="text-sm text-muted">{t("agentDiff")}</div>
        <Select
          onValueChange={onLeftVersionChange}
          options={versions.map((version) => ({
            label: `${t("agentVersion")} ${formatNumber(version.version, locale)}`,
            value: version.id,
          }))}
          value={leftVersionId}
        />
        <Select
          onValueChange={onRightVersionChange}
          options={versions.map((version) => ({
            label: `${t("agentVersion")} ${formatNumber(version.version, locale)}`,
            value: version.id,
          }))}
          value={rightVersionId}
        />
        <Button
          disabled={versions.length < 2 || isComparing}
          onClick={onCompare}
          pending={isComparing}
        >
          {t("agentCompare")}
        </Button>
        {diff ? <AgentVersionDiffSummary diff={diff} /> : null}
      </div>
    </>
  );
}

function evalStatusMessageKey(status: string): MessageKey {
  if (status === "passed") return "evalStatusPassed";
  if (status === "failed") return "evalStatusFailed";
  if (status === "not_required") return "evalStatusNotRequired";
  return "evalStatusMissing";
}
