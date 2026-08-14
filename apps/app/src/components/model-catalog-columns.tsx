import { StatusBadge, Switch } from "@romeo/ui";
import { useMemo } from "react";

import type { BaseModel, Provider } from "../features/providers/types";
import {
  catalogUnavailableReason,
  modelCatalogSurface,
  type CatalogSupportLevel,
} from "../lib/catalog-model-surface";
import { useLocale, type MessageKey } from "../lib/i18n";
import { LocalizedTokens } from "../lib/locale-format";
import { modelConfigIssues } from "../lib/model-config-attention";
import { modelCatalogColumnHelper as columnHelper } from "./model-catalog-table";

export function useModelCatalogColumns(input: {
  isUpdating: boolean;
  providerById: Map<string, Provider>;
  updateModelWithImpact: (input: {
    enabled: boolean;
    modelId: string;
  }) => Promise<void>;
}) {
  const { t } = useLocale();
  return useMemo(
    () => [
      columnHelper.accessor("displayName", {
        cell: ({ row }) => (
          <span className="block min-w-0">
            <strong className="block truncate">
              {row.original.displayName}
            </strong>
            <small className="block truncate text-muted">
              {row.original.name}
            </small>
          </span>
        ),
        header: t("models"),
      }),
      columnHelper.accessor("providerId", {
        cell: ({ getValue }) =>
          input.providerById.get(getValue())?.name ?? getValue(),
        enableSorting: false,
        header: t("provider"),
      }),
      columnHelper.accessor((model) => (model.available === false ? 0 : 1), {
        cell: ({ row }) => {
          const reason = catalogUnavailableReason(row.original);
          return (
            <span className="grid gap-1">
              <StatusBadge
                tone={row.original.available === false ? "danger" : "success"}
              >
                {row.original.available === false
                  ? t("unavailable")
                  : t("available")}
              </StatusBadge>
              {reason === undefined ? null : (
                <small className="text-muted">
                  {t(unavailableReasonKey(reason))}
                </small>
              )}
            </span>
          );
        },
        header: t("availability"),
        id: "availability",
      }),
      columnHelper.accessor("contextWindow", {
        cell: ({ getValue }) => <LocalizedTokens value={getValue()} />,
        header: t("context"),
      }),
      columnHelper.accessor(
        (model) =>
          modelCatalogSurface(model, input.providerById.get(model.providerId))
            .maxOutputTokens ?? 0,
        {
          cell: ({ row }) => {
            const max = modelCatalogSurface(
              row.original,
              input.providerById.get(row.original.providerId),
            ).maxOutputTokens;
            return max === undefined ? (
              <span className="text-muted">—</span>
            ) : (
              <LocalizedTokens value={max} />
            );
          },
          enableSorting: false,
          header: t("agentMaxOutputTokens"),
          id: "maxOutput",
        },
      ),
      columnHelper.accessor(
        (model) =>
          modelCatalogSurface(model, input.providerById.get(model.providerId))
            .tools,
        {
          cell: ({ getValue }) => (
            <SupportBadge level={getValue()} label={t("tools")} t={t} />
          ),
          enableSorting: false,
          header: t("tools"),
          id: "toolsSupport",
        },
      ),
      columnHelper.accessor(
        (model) =>
          modelCatalogSurface(model, input.providerById.get(model.providerId))
            .reasoning,
        {
          cell: ({ getValue }) => (
            <SupportBadge level={getValue()} label={t("reasoning")} t={t} />
          ),
          enableSorting: false,
          header: t("reasoning"),
          id: "reasoningSupport",
        },
      ),
      columnHelper.accessor(
        (model) =>
          modelCatalogSurface(model, input.providerById.get(model.providerId))
            .vision,
        {
          cell: ({ getValue }) => (
            <SupportBadge level={getValue()} label={t("vision")} t={t} />
          ),
          enableSorting: false,
          header: t("vision"),
          id: "visionSupport",
        },
      ),
      columnHelper.accessor(
        (model) =>
          modelCatalogSurface(
            model,
            input.providerById.get(model.providerId),
          ).modalities.join(", "),
        {
          cell: ({ getValue }) => (
            <span className="text-xs text-muted">{getValue() || "—"}</span>
          ),
          enableSorting: false,
          header: t("catalogModalities"),
          id: "modalities",
        },
      ),
      columnHelper.accessor(
        (model) =>
          modelCatalogSurface(model, input.providerById.get(model.providerId))
            .probeFreshness,
        {
          cell: ({ getValue }) => (
            <StatusBadge
              tone={
                getValue() === "fresh"
                  ? "success"
                  : getValue() === "stale"
                    ? "warning"
                    : "neutral"
              }
            >
              {t(probeFreshnessKey(getValue()))}
            </StatusBadge>
          ),
          enableSorting: false,
          header: t("catalogProbeFreshness"),
          id: "probeFreshness",
        },
      ),
      columnHelper.accessor(
        (model) =>
          modelCatalogSurface(model, input.providerById.get(model.providerId))
            .deploymentBoundary,
        {
          cell: ({ getValue }) =>
            getValue() === "local-runtime" ? t("localDeployment") : t("hosted"),
          enableSorting: false,
          header: t("deployment"),
          id: "deployment",
        },
      ),
      columnHelper.accessor(
        (model) =>
          modelCatalogSurface(model, input.providerById.get(model.providerId))
            .region ?? "",
        {
          cell: ({ getValue }) => getValue() || "—",
          enableSorting: false,
          header: t("catalogRegion"),
          id: "region",
        },
      ),
      columnHelper.accessor(
        (model) => {
          const pricing = modelCatalogSurface(
            model,
            input.providerById.get(model.providerId),
          ).pricing;
          return pricing === undefined
            ? ""
            : `${pricing.inputTokenUsd}/${pricing.outputTokenUsd}`;
        },
        {
          cell: ({ row }) => {
            const pricing = modelCatalogSurface(
              row.original,
              input.providerById.get(row.original.providerId),
            ).pricing;
            return pricing === undefined ? (
              <span className="text-muted">—</span>
            ) : (
              <span className="text-xs text-muted">
                {pricing.inputTokenUsd} / {pricing.outputTokenUsd}
              </span>
            );
          },
          enableSorting: false,
          header: t("modelPricing"),
          id: "pricing",
        },
      ),
      columnHelper.accessor((model) => modelConfigIssues(model).length, {
        cell: ({ row }) => {
          const issues = modelConfigIssues(row.original);
          if (issues.length === 0) return <span className="text-muted">—</span>;
          return (
            <StatusBadge tone="warning">{t("modelNeedsAttention")}</StatusBadge>
          );
        },
        enableSorting: false,
        header: t("modelNeedsAttention"),
        id: "attention",
      }),
      columnHelper.accessor("enabled", {
        cell: ({ row }) => (
          <Switch
            checked={row.original.enabled}
            disabled={input.isUpdating}
            label={t("enabled")}
            onCheckedChange={(checked) =>
              void input.updateModelWithImpact({
                enabled: checked === true,
                modelId: row.original.id,
              })
            }
          />
        ),
        header: t("enabled"),
      }),
    ],
    [input, t],
  );
}

function SupportBadge({
  label,
  level,
  t,
}: {
  label: string;
  level: CatalogSupportLevel;
  t: (key: MessageKey) => string;
}) {
  return (
    <StatusBadge
      tone={
        level === "native" ? "success" : level === "emulated" ? "warning" : "neutral"
      }
    >
      {label}: {t(supportLevelKey(level))}
    </StatusBadge>
  );
}

function supportLevelKey(level: CatalogSupportLevel): MessageKey {
  if (level === "native") return "catalogSupportNative";
  if (level === "emulated") return "catalogSupportEmulated";
  return "catalogSupportUnsupported";
}

function probeFreshnessKey(
  freshness: "fresh" | "never" | "stale",
): MessageKey {
  if (freshness === "fresh") return "catalogProbeFresh";
  if (freshness === "stale") return "catalogProbeStale";
  return "catalogProbeNever";
}

function unavailableReasonKey(
  reason: "not_entitled" | "not_in_latest_sync",
): MessageKey {
  return reason === "not_entitled"
    ? "catalogUnavailableNotEntitled"
    : "catalogUnavailableNotInSync";
}
