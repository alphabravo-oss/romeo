import type { RunContextPreview } from "../features/chat";
import { useLocale, type MessageKey } from "../lib/i18n";
import { reasoningModeFromPolicy } from "./composer-reasoning-policy";

const modeKeys = {
  automatic: "reasoningAutomatic",
  default: "reasoningAgentDefault",
  high: "reasoningHigh",
  low: "reasoningLow",
  medium: "reasoningMedium",
  off: "reasoningOff",
} as const satisfies Record<string, MessageKey>;

const reasonKeys = {
  capped_by_governance: "reasoningAdjustedGovernanceCap",
  summary_persistence_not_implemented: "reasoningAdjustedSummaryUnavailable",
  unsupported_by_dialect: "reasoningAdjustedDialectUnsupported",
  unsupported_by_model_or_provider: "reasoningAdjustedModelUnsupported",
} as const satisfies Record<string, MessageKey>;

export function ReasoningPolicyPreview({
  policy,
}: {
  policy: NonNullable<RunContextPreview["reasoningPolicy"]>;
}) {
  const { t } = useLocale();
  const sourceKey =
    policy.source === "agent_default"
      ? "reasoningSourceAgentDefault"
      : "reasoningSourceRunRequest";
  return (
    <section>
      <h3>{t("reasoningPolicy")}</h3>
      <dl className="rm-context-stats">
        <div>
          <dt>{t("reasoningPolicyRequested")}</dt>
          <dd>{t(modeKeys[reasoningModeFromPolicy(policy.requested)])}</dd>
        </div>
        <div>
          <dt>{t("reasoningPolicyEffective")}</dt>
          <dd>{t(modeKeys[reasoningModeFromPolicy(policy.effective)])}</dd>
        </div>
        <div>
          <dt>{t("reasoningPolicySource")}</dt>
          <dd>{t(sourceKey)}</dd>
        </div>
      </dl>
      {policy.rejected ? (
        <p className="rm-context-notice" role="alert">
          {t("reasoningPolicyRejected")}
        </p>
      ) : null}
      {policy.adjustments.length > 0 ? (
        <ul>
          {policy.adjustments.map((adjustment, index) => (
            <li key={`${adjustment.parameter}:${adjustment.reason}:${index}`}>
              {t(reasonKeys[adjustment.reason])}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
