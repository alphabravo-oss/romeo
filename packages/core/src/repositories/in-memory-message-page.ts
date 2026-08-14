import type * as E from "../domain/entities";
import type * as R from "../domain/repository";
import type { SeedData } from "./seed-data";

export function queryInMemoryMessagePage(
  data: SeedData,
  input: R.AuthorizedMessagePageQuery,
): R.MessagePageQueryResult {
  const chat = data.chats.find(
    (item) =>
      item.id === input.chatId &&
      item.orgId === input.orgId &&
      item.workspaceId === input.workspaceId,
  );
  if (chat === undefined)
    return {
      branchVariants: [],
      hasMore: false,
      invalidTranscriptVersion: true,
      items: [],
      transcriptVersion: input.transcriptVersion,
    };
  const transcriptVersion = chat.transcriptVersion ?? "0";
  if (transcriptVersion !== input.transcriptVersion)
    return {
      branchVariants: [],
      hasMore: false,
      invalidTranscriptVersion: true,
      items: [],
      transcriptVersion,
    };
  return input.mode === "linear"
    ? queryLinear(data.messages, input, transcriptVersion)
    : queryBranch(data.messages, input, transcriptVersion);
}

function queryLinear(
  messages: E.Message[],
  input: R.AuthorizedMessagePageQuery,
  transcriptVersion: string,
): R.MessagePageQueryResult {
  const candidates = messages
    .filter((message) => message.chatId === input.chatId)
    .filter((message) => {
      if (input.linearCursor === undefined) return true;
      return (
        (message.createdAt.localeCompare(input.linearCursor.createdAt) ||
          message.id.localeCompare(input.linearCursor.id)) < 0
      );
    })
    .sort(
      (left, right) =>
        right.createdAt.localeCompare(left.createdAt) ||
        right.id.localeCompare(left.id),
    );
  const selected = candidates.slice(0, input.limit + 1);
  const items = selected.slice(0, input.limit);
  const hasMore = selected.length > input.limit;
  const oldest = items.at(-1);
  items.reverse();
  return {
    branchVariants: [],
    hasMore,
    items,
    transcriptVersion,
    ...(hasMore && oldest !== undefined
      ? {
          nextPosition: {
            createdAt: oldest.createdAt,
            id: oldest.id,
            mode: "linear" as const,
          },
        }
      : {}),
  };
}

function queryBranch(
  messages: E.Message[],
  input: R.AuthorizedMessagePageQuery,
  transcriptVersion: string,
): R.MessagePageQueryResult {
  if ((input.branchTraversalOffset ?? 0) + input.limit > 100_000)
    return invalidBranch(transcriptVersion);
  const byId = new Map(
    messages
      .filter((message) => message.chatId === input.chatId)
      .map((message) => [message.id, message]),
  );
  let current = byId.get(
    input.branchStartMessageId ?? input.branchLeafMessageId ?? "",
  );
  if (current === undefined) return invalidBranch(transcriptVersion);
  if (input.branchExpectedChildId !== undefined) {
    const child = byId.get(input.branchExpectedChildId);
    if (
      child?.parentId !== current.id ||
      (current.parentId ?? null) !== input.branchExpectedParentId
    ) {
      return invalidBranch(transcriptVersion);
    }
  }
  const selected: E.Message[] = [];
  const visited = new Set<string>();
  while (current !== undefined && selected.length <= input.limit) {
    if (visited.has(current.id)) return invalidBranch(transcriptVersion);
    visited.add(current.id);
    selected.push(current);
    if (current.parentId === undefined) current = undefined;
    else {
      current = byId.get(current.parentId);
      if (current === undefined) return invalidBranch(transcriptVersion);
    }
  }
  const hasMore = selected.length > input.limit;
  const next = selected.at(input.limit);
  const items = selected.slice(0, input.limit).reverse();
  return {
    branchVariants: branchVariants(messages, input.chatId, items),
    hasMore,
    items,
    transcriptVersion,
    ...(hasMore && next !== undefined
      ? {
          nextPosition: {
            expectedChildId: selected[input.limit - 1]?.id ?? next.id,
            expectedParentId: next.parentId ?? null,
            messageId: next.id,
            mode: "branch" as const,
            traversed: (input.branchTraversalOffset ?? 0) + input.limit,
          },
        }
      : {}),
  };
}

function invalidBranch(transcriptVersion: string): R.MessagePageQueryResult {
  return {
    branchVariants: [],
    hasMore: false,
    invalidBranch: true,
    items: [],
    transcriptVersion,
  };
}

function branchVariants(
  messages: E.Message[],
  chatId: string,
  selectedPath: E.Message[],
): R.MessageBranchVariantNavigation[] {
  const ordered = messages
    .filter((message) => message.chatId === chatId)
    .sort(compareMessages);
  const children = new Map<string, E.Message[]>();
  for (const message of ordered) {
    const parent = message.parentId ?? "";
    const siblings = children.get(parent);
    if (siblings === undefined) children.set(parent, [message]);
    else siblings.push(message);
  }
  const navigation: R.MessageBranchVariantNavigation[] = [];
  for (const message of selectedPath) {
    const siblings = children.get(message.parentId ?? "") ?? [];
    if (siblings.length <= 1) continue;
    const index = siblings.findIndex(
      (candidate) => candidate.id === message.id,
    );
    if (index < 0) continue;
    const previous = siblings[index - 1];
    const next = siblings[index + 1];
    navigation.push({
      index,
      messageId: message.id,
      ...(next === undefined
        ? {}
        : { nextLeafMessageId: descendantLeaf(next, children) }),
      ...(previous === undefined
        ? {}
        : { previousLeafMessageId: descendantLeaf(previous, children) }),
      total: siblings.length,
    });
  }
  return navigation;
}

function descendantLeaf(
  start: E.Message,
  children: ReadonlyMap<string, E.Message[]>,
): string {
  const visited = new Set<string>();
  let current = start;
  for (let depth = 0; depth < 100_000; depth += 1) {
    if (visited.has(current.id)) return current.id;
    visited.add(current.id);
    const child = children.get(current.id)?.at(-1);
    if (child === undefined || visited.has(child.id)) return current.id;
    current = child;
  }
  return current.id;
}

function compareMessages(left: E.Message, right: E.Message): number {
  return (
    left.createdAt.localeCompare(right.createdAt) ||
    Number(left.role !== "user") - Number(right.role !== "user") ||
    left.id.localeCompare(right.id)
  );
}
