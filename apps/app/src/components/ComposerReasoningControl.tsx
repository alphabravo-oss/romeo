import { Button, DropdownMenu } from "@romeo/ui";
import Brain from "lucide-react/dist/esm/icons/brain.mjs";

import { useLocale, type MessageKey } from "../lib/i18n";
import type { ComposerReasoningMode } from "./composer-reasoning-policy";

const choices: Array<{
  label: MessageKey;
  mode: ComposerReasoningMode;
}> = [
  { label: "reasoningAgentDefault", mode: "default" },
  { label: "reasoningOff", mode: "off" },
  { label: "reasoningAutomatic", mode: "automatic" },
  { label: "reasoningLow", mode: "low" },
  { label: "reasoningMedium", mode: "medium" },
  { label: "reasoningHigh", mode: "high" },
];

export function ComposerReasoningControl({
  disabled,
  mode,
  modelSupportsReasoning,
  onChange,
}: {
  disabled: boolean;
  mode: ComposerReasoningMode;
  modelSupportsReasoning: boolean;
  onChange: (mode: ComposerReasoningMode) => void;
}) {
  const { t } = useLocale();
  if (!modelSupportsReasoning && mode === "default") return null;
  const label = t(
    choices.find((choice) => choice.mode === mode)?.label ??
      "reasoningAgentDefault",
  );
  const unavailable = !modelSupportsReasoning && mode !== "default";
  return (
    <>
      <span className="sr-only" id="composer-reasoning-disclosure">
        {unavailable ? `${t("reasoningUnavailable")} ` : ""}
        {t("reasoningCostDisclosure")}
      </span>
      <DropdownMenu
        align="start"
        items={[
          {
            disabled: true,
            label: t("reasoningCostDisclosure"),
          },
          ...(unavailable
            ? [{ disabled: true, label: t("reasoningUnavailable") }]
            : []),
          ...choices.map((choice) => ({
            disabled:
              disabled ||
              (!modelSupportsReasoning &&
                choice.mode !== "default" &&
                choice.mode !== "off"),
            label: (
              <span>
                <span aria-hidden="true">
                  {choice.mode === mode ? "✓" : " "}{" "}
                </span>
                {t(choice.label)}
              </span>
            ),
            onSelect: () => onChange(choice.mode),
          })),
        ]}
        trigger={
          <Button
            aria-describedby="composer-reasoning-disclosure"
            aria-invalid={unavailable || undefined}
            aria-label={`${t("reasoningControl")}: ${label}`}
            className={`rm-icon-button${unavailable ? " invalid" : ""}`}
            disabled={disabled}
            title={
              unavailable
                ? t("reasoningUnavailable")
                : `${label}. ${t("reasoningCostDisclosure")}`
            }
            type="button"
          >
            <Brain aria-hidden="true" size={17} />
          </Button>
        }
      />
    </>
  );
}
