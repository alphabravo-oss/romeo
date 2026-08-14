export interface MessageIndexNode {
  id: string;
  parentId: string | null;
  childIds: string[];
}

export interface IncrementalMessageIndex {
  nodes: Record<string, MessageIndexNode>;
  rootIds: string[];
}

export type MessageIndexDelta =
  | { type: "insert"; id: string; parentId: string | null }
  | { type: "reparent"; id: string; parentId: string | null }
  | { type: "remove"; id: string };

export function emptyMessageIndex(): IncrementalMessageIndex {
  return { nodes: {}, rootIds: [] };
}

export function applyMessageIndexDelta(
  index: IncrementalMessageIndex,
  delta: MessageIndexDelta,
): IncrementalMessageIndex {
  const nodes = { ...index.nodes };
  const rootIds = [...index.rootIds];
  if (delta.type === "insert") {
    nodes[delta.id] = { id: delta.id, parentId: delta.parentId, childIds: [] };
    if (delta.parentId === null) rootIds.push(delta.id);
    else {
      const parent = nodes[delta.parentId];
      if (parent !== undefined)
        nodes[delta.parentId] = {
          ...parent,
          childIds: [...parent.childIds, delta.id],
        };
    }
    return { nodes, rootIds };
  }
  const current = nodes[delta.id];
  if (current === undefined) return index;
  if (delta.type === "remove") {
    detach(nodes, rootIds, current);
    delete nodes[delta.id];
    return { nodes, rootIds };
  }
  detach(nodes, rootIds, current);
  nodes[delta.id] = { ...current, parentId: delta.parentId };
  if (delta.parentId === null) rootIds.push(delta.id);
  else {
    const parent = nodes[delta.parentId];
    if (parent !== undefined)
      nodes[delta.parentId] = {
        ...parent,
        childIds: [...parent.childIds, delta.id],
      };
  }
  return { nodes, rootIds };
}

function detach(
  nodes: Record<string, MessageIndexNode>,
  rootIds: string[],
  node: MessageIndexNode,
): void {
  if (node.parentId === null) {
    const index = rootIds.indexOf(node.id);
    if (index >= 0) rootIds.splice(index, 1);
    return;
  }
  const parent = nodes[node.parentId];
  if (parent === undefined) return;
  nodes[node.parentId] = {
    ...parent,
    childIds: parent.childIds.filter((id) => id !== node.id),
  };
}
