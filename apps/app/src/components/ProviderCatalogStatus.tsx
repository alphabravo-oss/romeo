import { StatusBadge } from "@romeo/ui";

import type { Provider } from "../features/providers/types";
import { useLocale } from "../lib/i18n";

export function ProviderCatalogStatus({
  compact = false,
  provider,
}: {
  compact?: boolean;
  provider: Provider;
}) {
  const { t } = useLocale();
  const state = provider.catalogSync;
  const status = state?.status ?? "never";
  return (
    <div className="grid min-w-0 gap-1">
      <StatusBadge tone={catalogStatusTone(status)}>
        {t(catalogStatusTranslationKey(status))}
      </StatusBadge>
      {state?.lastSyncedAt ? (
        <time
          className="truncate text-xs text-muted"
          dateTime={state.lastSyncedAt}
          title={state.lastSyncedAt}
        >
          {compact ? "" : `${t("lastSynced")}: `}
          {formatCatalogTime(state.lastSyncedAt)}
        </time>
      ) : null}
      {!compact && state?.error ? (
        <p className="text-sm text-danger" role="alert">
          {state.error}
        </p>
      ) : null}
    </div>
  );
}

function catalogStatusTone(status: string) {
  if (status === "ready") return "success" as const;
  if (status === "error") return "danger" as const;
  if (status === "stale" || status === "syncing") return "warning" as const;
  return "neutral" as const;
}

function catalogStatusTranslationKey(status: string) {
  if (status === "ready") return "catalogCurrent";
  if (status === "error") return "catalogError";
  if (status === "stale") return "catalogStale";
  if (status === "syncing") return "syncing";
  return "catalogPending";
}

function formatCatalogTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}
