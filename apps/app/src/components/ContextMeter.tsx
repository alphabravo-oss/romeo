import { Button } from "@romeo/ui";

import type { RunContextPreview } from "../features/chat";
import { useLocale, type Locale } from "../lib/i18n";
import { formatNumber } from "../lib/locale-format";
import { contextMeterValue } from "./context-meter";

/**
 * How full the next request is, in the composer where the decision is made.
 * Clicking it opens the inspector that explains the number — the meter itself
 * never calls the inspect endpoint, which does real retrieval work per call.
 *
 * ponytail: the preview costs the chat's ACTIVE branch, so after switching
 * sibling variants the number can describe a branch the reader is no longer
 * looking at (same ceiling as run-context-inspection-service.ts:68). Upgrade
 * path: key the cached preview by the active leaf message.
 */
export function ContextMeter({
  contextWindow,
  disabled,
  draft,
  onInspect,
  preview,
}: {
  contextWindow: number | undefined;
  disabled: boolean;
  draft: string;
  onInspect: () => void;
  preview: RunContextPreview | undefined;
}) {
  const { locale, t } = useLocale();
  const value = contextMeterValue({ contextWindow, draft, preview });
  const used = `${value.exact ? "" : "~"}${compactTokens(value.usedTokens, locale)}`;
  return (
    // No aria-label: the numbers ARE the accessible name, and overriding them
    // with "open the inspector" would hide the one thing the control reports.
    // The title supplies the purpose as a description instead.
    <Button
      className="rm-context-meter"
      disabled={disabled}
      onClick={onInspect}
      size="sm"
      title={t("contextMeterLabel")}
      variant="ghost"
    >
      <span aria-hidden="true" className="rm-context-meter-track">
        <span
          className="rm-context-meter-fill"
          style={{ width: `${value.percent ?? 0}%` }}
        />
      </span>
      <span className="rm-context-meter-usage">
        {value.contextWindow === undefined
          ? t("contextMeterUsageOnly", { used })
          : t("contextMeterUsage", {
              total: compactTokens(value.contextWindow, locale),
              used,
            })}
      </span>
      {value.retainedFiles > 0 ? (
        <span className="rm-context-meter-files">
          {t("contextMeterFiles", { files: value.retainedFiles })}
        </span>
      ) : null}
    </Button>
  );
}

function compactTokens(value: number, locale: Locale): string {
  return formatNumber(value, locale, {
    maximumFractionDigits: 1,
    notation: "compact",
  });
}
