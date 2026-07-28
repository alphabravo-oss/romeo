// Pure prompt-template field normalization for PromptTemplatePanel. Kept
// UI-free (and import-free) so create and edit dialogs share the same parsing
// rules without requiring a DOM test environment.
//
// Authors naturally paste tags as comma-separated text, one-per-line text, or
// a mixture of both. Empty fragments are never meaningful API tags. Case
// normalization and deduplication deliberately remain server-owned so this
// helper does not change the text the author entered beyond trimming.

export function parsePromptTemplateTags(value: string): string[] {
  return value
    .split(/[\n,]/u)
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}
