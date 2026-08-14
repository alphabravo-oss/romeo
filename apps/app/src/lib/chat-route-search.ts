import { validatedRouteResourceId } from "./route-workspace-selection";

export interface ChatRouteSearch {
  agent?: string;
  chat?: string;
  leaf?: string;
  workspace?: string;
}

export function validateChatRouteSearch(
  search: Record<string, unknown>,
): ChatRouteSearch {
  const agent = validatedRouteResourceId(search.agent);
  const chat = validatedRouteResourceId(search.chat);
  const leaf = validatedRouteResourceId(search.leaf);
  const workspace = validatedRouteResourceId(search.workspace);
  return {
    ...(agent === undefined ? {} : { agent }),
    ...(chat === undefined ? {} : { chat }),
    ...(leaf === undefined ? {} : { leaf }),
    ...(workspace === undefined ? {} : { workspace }),
  };
}

export function selectChatSearch(
  previous: ChatRouteSearch,
  chat: string | undefined,
): ChatRouteSearch {
  const { chat: _chat, leaf: _leaf, ...rest } = previous;
  return { ...rest, ...(chat === undefined ? {} : { chat }) };
}

export function selectBranchSearch(
  previous: ChatRouteSearch,
  leaf: string | undefined,
): ChatRouteSearch {
  const { leaf: _leaf, ...rest } = previous;
  return { ...rest, ...(leaf === undefined ? {} : { leaf }) };
}
