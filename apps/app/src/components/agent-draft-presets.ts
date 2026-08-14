import type { MessageKey } from "../lib/i18n";

export function agentPromptPresets(t: (key: MessageKey) => string) {
  return [
    { label: t("agentPresetSupport"), prompt: t("agentPresetSupportPrompt") },
    {
      label: t("agentPresetResearch"),
      prompt: t("agentPresetResearchPrompt"),
    },
    {
      label: t("agentPresetOperations"),
      prompt: t("agentPresetOperationsPrompt"),
    },
  ];
}
