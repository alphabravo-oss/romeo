import type { AgentPromptSuggestion } from "../domain/entities";

export function normalizeAgentTags(tags: string[] | undefined): string[] {
  return [
    ...new Set(
      (tags ?? [])
        .map((tag) => tag.trim())
        .filter(Boolean)
        .map((tag) => tag.slice(0, 60)),
    ),
  ].slice(0, 20);
}

export function normalizePromptSuggestions(
  suggestions: AgentPromptSuggestion[] | undefined,
): AgentPromptSuggestion[] {
  return (suggestions ?? [])
    .map((suggestion) => ({
      title: suggestion.title.trim().slice(0, 120),
      prompt: suggestion.prompt.trim().slice(0, 2_000),
    }))
    .filter((suggestion) => suggestion.title && suggestion.prompt)
    .slice(0, 12);
}
