import { useMemo } from "react";

import type { EvalReasoningComparison } from "../features/types";
import { useLocale } from "../lib/i18n";
import { LocalizedNumber } from "../lib/locale-format";
import { createColumnHelper, DataTable } from "./DataTable";

type Variant = EvalReasoningComparison["variants"][number];
const column = createColumnHelper<Variant>();

export function EvalReasoningComparisonPanel({
  comparison,
}: {
  comparison: EvalReasoningComparison;
}) {
  const { t } = useLocale();
  const columns = useMemo(
    () => [
      column.display({
        id: "policy",
        header: t("evalReasoningPolicy"),
        cell: ({ row }) => (
          <span>
            {policyLabel(row.original.requested, t)}
            {JSON.stringify(row.original.requested) ===
            JSON.stringify(row.original.effective)
              ? null
              : ` → ${policyLabel(row.original.effective, t)}`}
          </span>
        ),
      }),
      column.accessor("runCount", {
        header: t("evalRuns"),
        cell: ({ getValue }) => <LocalizedNumber value={getValue()} />,
      }),
      column.accessor("averageScore", {
        header: t("evalAverageScore"),
        cell: ({ getValue }) => (
          <LocalizedNumber
            options={{ maximumFractionDigits: 0, style: "percent" }}
            value={getValue()}
          />
        ),
      }),
      column.accessor("averageLatencyMs", {
        header: t("evalAverageLatency"),
        cell: ({ getValue }) => (
          <LocalizedNumber
            options={{ maximumFractionDigits: 0 }}
            value={getValue()}
          />
        ),
      }),
      column.accessor("reportedReasoningTokens", {
        header: t("evalReasoningTokensTotal"),
        cell: ({ getValue }) =>
          getValue() === null ? (
            t("evalIncompleteUsage")
          ) : (
            <LocalizedNumber value={getValue()!} />
          ),
      }),
      column.accessor("reportedInputTokens", {
        header: t("evalInputTokensTotal"),
        cell: ({ getValue }) =>
          getValue() === null ? (
            t("evalIncompleteUsage")
          ) : (
            <LocalizedNumber value={getValue()!} />
          ),
      }),
      column.accessor("reportedOutputTokens", {
        header: t("evalOutputTokensTotal"),
        cell: ({ getValue }) =>
          getValue() === null ? (
            t("evalIncompleteUsage")
          ) : (
            <LocalizedNumber value={getValue()!} />
          ),
      }),
      column.accessor("estimatedCostUsd", {
        header: t("evalReportedCostTotal"),
        cell: ({ getValue }) =>
          getValue() === null ? (
            t("evalIncompleteUsage")
          ) : (
            <LocalizedNumber
              options={{ currency: "USD", style: "currency" }}
              value={getValue()!}
            />
          ),
      }),
      column.display({
        id: "trend",
        header: t("evalScoreTrend"),
        cell: ({ row }) => (
          <span
            aria-label={t("evalScoreTrendRuns", {
              count: row.original.trend.length,
            })}
            className="flex h-6 items-end gap-0.5"
            role="img"
          >
            {row.original.trend.slice(-12).map((point) => (
              <span
                className="w-1.5 bg-accent"
                key={point.runId}
                style={{ height: `${Math.max(2, point.score * 24)}px` }}
                title={`${Math.round(point.score * 100)}%`}
              />
            ))}
          </span>
        ),
      }),
    ],
    [t],
  );
  if (comparison.variants.length === 0)
    return <p className="rm-list-empty">{t("evalNoReasoningComparisons")}</p>;
  return (
    <section aria-labelledby="eval-reasoning-comparison-title">
      <h3 id="eval-reasoning-comparison-title">
        {t("evalReasoningComparison")}
      </h3>
      <p className="text-xs text-muted">{t("evalComparisonTotalsHelp")}</p>
      <DataTable
        columns={columns}
        data={comparison.variants}
        getRowId={(variant) =>
          `${variant.modelId}:${JSON.stringify(variant.requested)}`
        }
        minTableWidth={920}
        preferenceKey="eval-reasoning-comparison"
        rowAriaLabel={(variant) => policyLabel(variant.requested, t)}
        searchVisibility="hidden"
      />
    </section>
  );
}

function policyLabel(
  policy: Variant["requested"],
  t: ReturnType<typeof useLocale>["t"],
) {
  if (policy.mode === "off") return t("evalReasoningOff");
  if (policy.mode === "summary") return t("evalReasoningSummary");
  return policy.effort === undefined
    ? t("evalReasoningAuto")
    : t(`evalReasoning${capitalize(policy.effort)}` as const);
}

function capitalize(value: "high" | "low" | "medium") {
  return `${value[0]!.toUpperCase()}${value.slice(1)}` as
    | "High"
    | "Low"
    | "Medium";
}
