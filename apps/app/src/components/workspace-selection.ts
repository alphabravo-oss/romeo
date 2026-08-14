// Pure workspace-selection logic for WorkspaceProvider. Kept UI-free so
// membership fallbacks can be tested without a QueryClient or localStorage.

export function visibleWorkspaces<T extends { id: string }>(
  workspaces: readonly T[],
  allowedIds: readonly string[] | undefined,
): T[] {
  if (allowedIds === undefined) return [];
  const allowed = new Set(allowedIds);
  return workspaces.filter((workspace) => allowed.has(workspace.id));
}

export function resolveWorkspaceSelection(input: {
  persistedId: string | undefined;
  selectedId: string | undefined;
  workspaces: readonly { id: string }[];
}): string | undefined {
  const allowed = new Set(input.workspaces.map((workspace) => workspace.id));
  if (input.selectedId !== undefined && allowed.has(input.selectedId)) {
    return input.selectedId;
  }
  if (input.persistedId !== undefined && allowed.has(input.persistedId)) {
    return input.persistedId;
  }
  return input.workspaces[0]?.id;
}

export function canSelectWorkspace(
  id: string,
  workspaces: readonly { id: string }[],
): boolean {
  return workspaces.some((workspace) => workspace.id === id);
}

type WorkspaceRouteSearch = {
  agent?: string;
  chat?: string;
  leaf?: string;
  workspace?: string;
};

export function withWorkspaceRouteSearch<T extends WorkspaceRouteSearch>(
  previous: T,
  workspaceId: string,
): T {
  return { ...previous, workspace: workspaceId };
}

export function switchWorkspaceRouteSearch<T extends WorkspaceRouteSearch>(
  previous: T,
  workspaceId: string,
): T {
  const { agent: _agent, chat: _chat, leaf: _leaf, ...rest } = previous;
  return { ...rest, workspace: workspaceId } as T;
}
