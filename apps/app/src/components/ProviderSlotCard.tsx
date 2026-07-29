import { StatusBadge } from "@romeo/ui";

import { useLocale } from "../lib/i18n";

/**
 * A rich operational card for one active provider slot.
 */
export function ProviderSlotCard(props: {
  name: string;
  icon: React.ReactNode;
  protocol: string;
  enabled: boolean;
  configured: boolean;
  testStatus?: "passed" | "partial" | "failed" | "not_tested";
  facts?: { label: string; value: string }[];
  actions: React.ReactNode;
}): React.ReactNode {
  const { t } = useLocale();
  return (
    <article className="rm-provider-card">
      <div className="rm-provider-card__head">
        <span className="shrink-0">{props.icon}</span>
        <span className="rm-provider-card__name" translate="no">
          {props.name}
        </span>
        <StatusBadge tone={props.enabled ? "success" : "neutral"}>
          {props.enabled ? t("authOn") : t("authOff")}
        </StatusBadge>
      </div>
      <div className="rm-provider-card__facts">
        <span translate="no">{props.protocol}</span>
        {props.configured ? null : (
          <StatusBadge tone="warning">{t("authNotConfigured")}</StatusBadge>
        )}
        {props.testStatus && props.testStatus !== "not_tested" ? (
          <StatusBadge
            tone={
              props.testStatus === "passed"
                ? "success"
                : props.testStatus === "partial"
                  ? "warning"
                  : "danger"
            }
          >
            {props.testStatus === "passed"
              ? t("authTestPassed")
              : props.testStatus === "partial"
                ? t("authTestPartial")
                : t("authTestFailed")}
          </StatusBadge>
        ) : null}
        {(props.facts ?? []).map((fact) => (
          <span key={fact.label}>
            {fact.label}: {fact.value}
          </span>
        ))}
      </div>
      <div className="rm-provider-card__actions">{props.actions}</div>
    </article>
  );
}
