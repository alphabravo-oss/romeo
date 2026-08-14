/**
 * The card's second line. Prompts are authored as markdown, so the first line
 * is often a heading — showing its hashes would read as a typo.
 */
export function suggestionSubtitle(prompt: string): string {
  const line = prompt
    .split("\n")
    .map((value) => value.trim())
    .find((value) => value !== "");
  return (line ?? "").replace(/^(?:>\s*)?#{1,6}\s+/u, "").trim();
}

/**
 * First-run value must not depend on an administrator having authored chat
 * experience suggestions. Workspace and custom-model suggestions always win.
 */
export function defaultStarterSuggestions(t: Translate): ChatSuggestion[] {
  return [
    {
      title: t("starterDecisionTitle"),
      prompt: t("starterDecisionPrompt"),
    },
    {
      title: t("starterResearchTitle"),
      prompt: t("starterResearchPrompt"),
    },
    {
      title: t("starterSummarizeTitle"),
      prompt: t("starterSummarizePrompt"),
    },
    {
      title: t("starterPlanTitle"),
      prompt: t("starterPlanPrompt"),
    },
  ];
}
import type { ChatSuggestion } from "../features/chat-experience";
import type { MessageKey } from "../lib/i18n";

type Translate = (
  key: MessageKey,
  values?: Record<string, boolean | number | string>,
) => string;
