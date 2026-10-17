// Knowledge-base selection stays explicit so adding or renaming a base never
// silently changes which corpus an action targets.

export function resolveKnowledgeBaseBinding(input: {
  selectedKnowledgeBaseId: string | undefined;
  availableIds: readonly string[];
}):
  | { ok: true; knowledgeBaseId: string }
  | { ok: false; reason: "none-selected" | "no-bases" } {
  if (input.availableIds.length === 0) return { ok: false, reason: "no-bases" };
  if (input.selectedKnowledgeBaseId === undefined)
    return { ok: false, reason: "none-selected" };
  return { ok: true, knowledgeBaseId: input.selectedKnowledgeBaseId };
}
