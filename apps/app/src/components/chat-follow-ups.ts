/**
 * Lightweight client-side follow-ups for the last assistant turn.
 * No model round-trip: keep them cheap and always available.
 */

export interface ChatFollowUp {
  label: string;
  prompt: string;
}

export function suggestFollowUps(input: {
  assistantContent: string;
  labels: {
    explainSimpler: string;
    giveExample: string;
    makeShorter: string;
    goDeeper: string;
    explainCode: string;
    addTests: string;
    tradeoffs: string;
  };
}): ChatFollowUp[] {
  const content = input.assistantContent.trim();
  if (content.length === 0) return [];

  const hasCode = /```[\s\S]*?```/u.test(content) || /`[^`\n]+`/u.test(content);
  const isLong = content.length > 900;
  const looksList =
    /^(\s*[-*]|\s*\d+\.)\s+/mu.test(content) || content.includes("\n- ");

  const picks: ChatFollowUp[] = [];

  if (hasCode) {
    picks.push({
      label: input.labels.explainCode,
      prompt: "Explain the code you just wrote, step by step.",
    });
    picks.push({
      label: input.labels.addTests,
      prompt: "Add tests for the code you just wrote.",
    });
  } else {
    picks.push({
      label: input.labels.explainSimpler,
      prompt: "Explain that more simply, as if to a smart beginner.",
    });
    picks.push({
      label: input.labels.giveExample,
      prompt: "Give a concrete example of that.",
    });
  }

  if (isLong || looksList) {
    picks.push({
      label: input.labels.makeShorter,
      prompt:
        "Rewrite your last answer more concisely, keeping the key points.",
    });
  } else {
    picks.push({
      label: input.labels.goDeeper,
      prompt: "Go deeper on the most important part of your last answer.",
    });
  }

  picks.push({
    label: input.labels.tradeoffs,
    prompt: "What are the main tradeoffs or alternatives?",
  });

  // Cap at 4 chips so the rail stays scannable.
  return picks.slice(0, 4);
}
