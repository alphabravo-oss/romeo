import type { buildModelGroups } from "./agent-draft-model";

export function findAgentDraftModel(
  groups: ReturnType<typeof buildModelGroups>,
  modelId: string,
) {
  return groups
    .flatMap((group) => group.models)
    .find((model) => model.id === modelId);
}
