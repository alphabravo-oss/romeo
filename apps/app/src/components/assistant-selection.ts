import type { AgentGalleryItem } from "../features/managed-models";

/**
 * Which assistant backs the chat surface.
 *
 * Deliberately blind to the assistants toggle. With assistants off the server
 * withholds the system prompt of whichever assistant is selected, so narrowing
 * the precedence here would guard nothing -- it would only make the pick less
 * deliberate, dropping the admin's workspace default, the user's own default
 * and a ?agent= deep link in favour of whichever assistant happens to be ready
 * first (which carries knowledge bindings and tools just the same). The toggle
 * decides what the surface SAYS (resolveChatAuthorNames) and which assistant
 * controls it shows; it does not narrow this pick.
 */
export function resolveActiveAssistant(input: {
  activeAgentId?: string;
  agents: AgentGalleryItem[];
  chatAgentId?: string;
  includeDrafts?: boolean;
  requestedAgentId?: string;
  userDefaultAgentId?: string;
  workspaceDefaultAgentId?: string;
}): AgentGalleryItem | undefined {
  const preferredIds = [
    input.chatAgentId,
    input.requestedAgentId,
    input.activeAgentId,
    input.userDefaultAgentId,
    input.workspaceDefaultAgentId,
  ];
  for (const id of preferredIds) {
    if (id === undefined) continue;
    const preferred = input.agents.find((agent) => agent.id === id);
    if (
      preferred !== undefined &&
      (input.includeDrafts || preferred.readinessStatus === "ready")
    )
      return preferred;
  }
  return input.includeDrafts
    ? input.agents[0]
    : input.agents.find((agent) => agent.readinessStatus === "ready");
}

/**
 * Product identity: provider → base model → custom model.
 *
 * A custom model is the selected model (a tweaked base), not a persona sitting
 * on top of it. `nextTurn` labels the empty chat / picker with that name.
 * `transcript` is the same custom name for rows already on screen when it
 * differs from the base model's display name.
 */
export function resolveChatAuthorNames(input: {
  /** Custom model (managed) name, if one is selected. */
  agentName: string | undefined;
  /** Kept for call-site compatibility; dual mode is retired. */
  assistantsEnabled: boolean | undefined;
  fallbackName: string;
  /** Base model display name for the next turn. */
  modelDisplayName: string | undefined;
}): { nextTurn: string | undefined; transcript: string | undefined } {
  const model = input.modelDisplayName?.trim() ?? "";
  const customRaw = input.agentName?.trim() ?? "";
  // Suppress product defaults like "Romeo Assistant" — they are not identity.
  const generic =
    customRaw.length === 0 ||
    ["romeo assistant", "custom model", "assistant", "default"].includes(
      customRaw.toLowerCase(),
    );
  const custom = generic ? "" : customRaw;

  // A custom model is the selected model. Do not treat it as a separate
  // assistant identity sitting on top of the base model.
  if (custom.length > 0) {
    return {
      nextTurn: custom,
      transcript: custom === model ? undefined : custom,
    };
  }
  if (model.length > 0) {
    return { nextTurn: model, transcript: undefined };
  }
  // No model/custom model resolved yet — stay quiet rather than invent a brand.
  if (input.assistantsEnabled === undefined) {
    return { nextTurn: undefined, transcript: undefined };
  }
  return { nextTurn: undefined, transcript: undefined };
}
