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
 * Who the chat surface says is answering, split by tense because the two
 * questions stop agreeing the moment assistants are off.
 *
 * `nextTurn` heads a chat with no transcript yet: it names who will answer the
 * message being composed. That has not happened, so the current selection is
 * exactly right.
 *
 * `transcript` heads each assistant row that is already on screen. With
 * assistants off it is undefined, because which model produced a given row is
 * not knowable from here: a Message carries no model, agent or run id, and the
 * composer's picker can move between turns. Naming the current selection would
 * relabel the whole history every time it moves, and no heading beats a wrong
 * one.
 *
 * Undefined generally means "say nothing" rather than "say something generic":
 * printing a product name over a base model's answer is the lie this setting
 * exists to stop.
 */
export function resolveChatAuthorNames(input: {
  agentName: string | undefined;
  /** Undefined until the chat-experience setting has loaded. */
  assistantsEnabled: boolean | undefined;
  /** Stands in for an assistant that has not resolved yet. */
  fallbackName: string;
  modelDisplayName: string | undefined;
}): { nextTurn: string | undefined; transcript: string | undefined } {
  // Not known yet, so claim nothing. Guessing costs a visible relabel a moment
  // later, and in an assistants-on workspace the guess is wrong in the worst
  // direction: a model's name over an answer a persona is about to write.
  if (input.assistantsEnabled === undefined)
    return { nextTurn: undefined, transcript: undefined };
  if (input.assistantsEnabled) {
    const name = input.agentName ?? input.fallbackName;
    return { nextTurn: name, transcript: name };
  }
  const model = input.modelDisplayName?.trim() ?? "";
  return {
    nextTurn: model.length === 0 ? undefined : model,
    transcript: undefined,
  };
}
