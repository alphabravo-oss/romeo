import type { Agent } from "../domain/entities";

type ManagedModelPresentation = Pick<
  Agent,
  "avatarUrl" | "description" | "icon"
>;

export function managedModelPresentation(input: {
  avatarUrl: string | undefined;
  description: string | undefined;
  icon: string | undefined;
}): Partial<ManagedModelPresentation> {
  const presentation: Partial<ManagedModelPresentation> = {};
  if (input.description !== undefined)
    presentation.description = input.description;
  if (input.icon !== undefined) presentation.icon = input.icon;
  if (input.avatarUrl !== undefined) presentation.avatarUrl = input.avatarUrl;
  return presentation;
}
