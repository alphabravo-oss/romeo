import { useLocale } from "../lib/i18n";

interface AgentParameterControlsProps {
  disabled: boolean;
  maxOutputTokens: string;
  onMaxOutputTokensChange: (value: string) => void;
  onTemperatureChange: (value: string) => void;
  onTopPChange: (value: string) => void;
  temperature: string;
  topP: string;
}

export function AgentParameterControls({
  disabled,
  maxOutputTokens,
  onMaxOutputTokensChange,
  onTemperatureChange,
  onTopPChange,
  temperature,
  topP,
}: AgentParameterControlsProps) {
  const { t } = useLocale();
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      <Field label={t("agentTemperature")}>
        <Input
          disabled={disabled}
          max="2"
          min="0"
          onChange={(event) => onTemperatureChange(event.currentTarget.value)}
          step="0.1"
          type="number"
          value={temperature}
        />
      </Field>
      <Field label={t("agentTopP")}>
        <Input
          disabled={disabled}
          max="1"
          min="0"
          onChange={(event) => onTopPChange(event.currentTarget.value)}
          step="0.05"
          type="number"
          value={topP}
        />
      </Field>
      <Field label={t("agentMaxTokens")}>
        <Input
          disabled={disabled}
          min="1"
          onChange={(event) =>
            onMaxOutputTokensChange(event.currentTarget.value)
          }
          step="1"
          type="number"
          value={maxOutputTokens}
        />
      </Field>
    </div>
  );
}
import { Field, Input } from "@romeo/ui";
