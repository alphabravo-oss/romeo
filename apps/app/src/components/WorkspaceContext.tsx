import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { getBootstrap } from "../api/client";
import type { Workspace } from "../api/workspace-types";

const STORAGE_KEY = "hm.workspaceId";

interface WorkspaceContextValue {
  /** The currently selected workspace, or undefined while the bootstrap query loads. */
  workspace: Workspace | undefined;
  /** Id of the selected workspace, or undefined while loading. */
  workspaceId: string | undefined;
  /** All workspaces the subject can access. */
  workspaces: Workspace[];
  /** Select a workspace by id. Persists the choice to localStorage. */
  setWorkspaceId: (id: string) => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | undefined>(
  undefined,
);

function readPersistedWorkspaceId(): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function persistWorkspaceId(id: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Ignore storage failures (private mode, quota) — selection stays in memory.
  }
}

/**
 * Owns the bootstrap query and the selected-workspace state for the app.
 * Must be rendered inside QueryClientProvider. All workspace-scoped hooks
 * (useWorkspaceData, etc.) read from this context rather than re-fetching.
 */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const bootstrapQuery = useQuery({
    queryKey: ["bootstrap"],
    queryFn: getBootstrap,
  });

  const workspaces = useMemo<Workspace[]>(
    () => bootstrapQuery.data?.workspaces ?? [],
    [bootstrapQuery.data?.workspaces],
  );
  const allowedIds = bootstrapQuery.data?.subject.workspaceIds;

  // Explicit user selection (from click or restored-and-validated storage).
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);

  // Once bootstrap resolves, reconcile the selection: keep a still-valid
  // selection, otherwise adopt a validated persisted id, otherwise fall back
  // to the first workspace. Validation guards against a stale/tampered
  // localStorage id pointing at a workspace the subject can no longer access.
  useEffect(() => {
    if (allowedIds === undefined) return;
    const allowed = new Set(allowedIds);
    const isAllowed = (id: string | undefined): id is string =>
      id !== undefined &&
      allowed.has(id) &&
      workspaces.some((workspace) => workspace.id === id);

    if (isAllowed(selectedId)) return;

    const persisted = readPersistedWorkspaceId();
    if (isAllowed(persisted)) {
      setSelectedId(persisted);
      return;
    }
    setSelectedId(workspaces[0]?.id);
  }, [allowedIds, workspaces, selectedId]);

  const setWorkspaceId = useCallback((id: string) => {
    setSelectedId(id);
    persistWorkspaceId(id);
  }, []);

  const workspaceId = selectedId;
  const workspace = useMemo(
    () => workspaces.find((candidate) => candidate.id === workspaceId),
    [workspaces, workspaceId],
  );

  const value = useMemo<WorkspaceContextValue>(
    () => ({ workspace, workspaceId, workspaces, setWorkspaceId }),
    [workspace, workspaceId, workspaces, setWorkspaceId],
  );

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

/** Access the selected workspace, the list of workspaces, and the setter. */
export function useWorkspace(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext);
  if (context === undefined) {
    throw new Error("useWorkspace must be used within a WorkspaceProvider");
  }
  return context;
}

/** Convenience accessor for just the selected workspace id (undefined while loading). */
export function useWorkspaceId(): string | undefined {
  return useWorkspace().workspaceId;
}
