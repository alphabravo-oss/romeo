import type { PromptTemplateVisibility } from "../features/prompts";

export const promptTemplateVisibilities: readonly PromptTemplateVisibility[] = [
  "private",
  "workspace",
  "marketplace",
];

export function promptTemplateVisibilityKey(
  visibility: PromptTemplateVisibility,
):
  | "promptVisibilityMarketplace"
  | "promptVisibilityPrivate"
  | "promptVisibilityWorkspace" {
  if (visibility === "marketplace") return "promptVisibilityMarketplace";
  if (visibility === "workspace") return "promptVisibilityWorkspace";
  return "promptVisibilityPrivate";
}
