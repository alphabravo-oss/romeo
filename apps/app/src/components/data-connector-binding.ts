// A data connector's knowledge-base binding cannot be changed after creation.
// Keep selection explicit so adding or renaming a base never changes which
// corpus receives future connector data.

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
