import type { Message } from "../features/types";

// Messages form a tree: regenerating or editing a turn adds a sibling under the
// same parent instead of deleting the old one, and the chat's
// activeLeafMessageId names which leaf defines the conversation on screen.
// Every walk here is client-side over the full transcript listMessages already
// returns, so switching variants costs one PATCH and no extra read.
//
// ponytail: recomputed from scratch on every render of a memo rather than kept
// as an incrementally-updated index. A transcript is hundreds of rows, not
// hundreds of thousands, and a rebuild is the only thing that cannot go stale.
// If a chat ever grows past what one pass can afford, cache by message count.

// No message id is the empty string, so it cannot collide with a real parent.
const rootKey = "";

// Mirrors the server's compareChatMessages. Ids are random UUIDs rather than
// monotonic, so an assistant can sort before its own user turn on a shared
// millisecond; ranking user first recovers causal order without a sequence
// column, and the two orderings must agree or the branch shown here would not
// be the branch the model was replayed.
const roleRank = (role: Message["role"]): number => (role === "user" ? 0 : 1);

function compareMessages(left: Message, right: Message): number {
  return (
    left.createdAt.localeCompare(right.createdAt) ||
    roleRank(left.role) - roleRank(right.role) ||
    left.id.localeCompare(right.id)
  );
}

function childrenByParent(all: Message[]): Map<string, Message[]> {
  const children = new Map<string, Message[]>();
  for (const message of [...all].sort(compareMessages)) {
    const key = message.parentId ?? rootKey;
    children.set(key, [...(children.get(key) ?? []), message]);
  }
  return children;
}

/** True once anything in the chat carries a parent link. */
function isTree(all: Message[]): boolean {
  return all.some((message) => message.parentId !== undefined);
}

/**
 * The messages on the branch ending at `leafId`, root first. A chat with no
 * parent links anywhere is returned whole: the migration backfilled parent_id
 * for every existing message and both importers chain parents, so the only
 * genuinely flat transcripts left are the channel-backing chats minted
 * parentless by openwebui-channel-message-commands.ts, whose rows would
 * otherwise each read as a separate root variant.
 *
 * ponytail: the fallback is a shape sniff, not a flag on the chat. Ceiling: any
 * flat transcript arriving from somewhere else renders as one giant root
 * sibling group with a variant control on every row. Upgrade path: delete the
 * fallback once channel chats stop sharing the messages table.
 */
export function chatPath(
  all: Message[],
  leafId: string | undefined,
): Message[] {
  const ordered = [...all].sort(compareMessages);
  if (!isTree(ordered)) return ordered;
  const byId = new Map(ordered.map((message) => [message.id, message]));
  // The pointer is allowed to dangle: it is plain text with no foreign key, and
  // between sending a turn and the run persisting it names an optimistic row
  // the server has never heard of. The newest message is then the best
  // available guess at which branch the reader is looking at.
  const leaf =
    (leafId === undefined ? undefined : byId.get(leafId)) ?? ordered.at(-1);
  const path: Message[] = [];
  // Parent ids are plain text with no foreign key, so nothing at write time
  // guarantees the graph is acyclic; `seen` is what makes a cycle terminate.
  const seen = new Set<string>();
  for (let current = leaf; current !== undefined && !seen.has(current.id); ) {
    seen.add(current.id);
    path.push(current);
    current =
      current.parentId === undefined ? undefined : byId.get(current.parentId);
  }
  path.reverse();
  // Descending as well as ascending is what absorbs the lag between an
  // optimistic row appearing and the pointer catching up: a child appended
  // below the leaf joins the path without anyone having to move the pointer.
  const children = childrenByParent(ordered);
  for (let tip = path.at(-1); tip !== undefined; ) {
    const child = children.get(tip.id)?.at(-1);
    if (child === undefined || seen.has(child.id)) break;
    seen.add(child.id);
    path.push(child);
    tip = child;
  }
  return path;
}

/**
 * The bottom of the branch that starts at `messageId`, following the newest
 * child at each step — the same descent `chatPath` makes, so pointing the chat
 * here shows exactly this branch.
 */
export function deepestLeaf(all: Message[], messageId: string): string {
  const children = childrenByParent(all);
  const seen = new Set<string>([messageId]);
  let leaf = messageId;
  for (;;) {
    const child = children.get(leaf)?.at(-1);
    if (child === undefined || seen.has(child.id)) return leaf;
    seen.add(child.id);
    leaf = child.id;
  }
}

export interface MessageVariants {
  index: number;
  siblingIds: string[];
  total: number;
}

/**
 * Per-message sibling positions for the rows on `path`, keyed by message id and
 * present only where there is more than one variant to switch between.
 */
export function messageVariants(
  all: Message[],
  path: Message[],
): Record<string, MessageVariants> {
  // A parentless transcript is one enormous root sibling group, which would put
  // a variant control on every single row.
  if (!isTree(all)) return {};
  const children = childrenByParent(all);
  const variants: Record<string, MessageVariants> = {};
  for (const message of path) {
    const siblings = children.get(message.parentId ?? rootKey) ?? [];
    if (siblings.length < 2) continue;
    variants[message.id] = {
      index: siblings.findIndex((sibling) => sibling.id === message.id),
      siblingIds: siblings.map((sibling) => sibling.id),
      total: siblings.length,
    };
  }
  return variants;
}
