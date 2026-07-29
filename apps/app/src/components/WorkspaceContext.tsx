import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  getBootstrap,
  subscribeToChatEvents,
  type AuthSubject,
  type ChatEventStreamStatus,
} from "../features";
import type { Workspace } from "../features/tenancy";
import { chatSyncFallbackInterval } from "../lib/chat-sync";
import { useOnlineStatus } from "../lib/connectivity";

const STORAGE_KEY = "hm.workspaceId";

interface WorkspaceContextValue {
  /** Current authenticated subject from the single bootstrap query. */
  subject: AuthSubject | undefined;
  /** Bootstrap request state for truthful root loading/error presentation. */
  bootstrapStatus: "error" | "pending" | "success";
  /** Retry the authoritative bootstrap query. */
  retryBootstrap: () => void;
  /** Health of the active workspace's live chat event stream. */
  chatSyncStatus: ChatEventStreamStatus;
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
  const queryClient = useQueryClient();
  const online = useOnlineStatus();
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
  const [chatSyncStatus, setChatSyncStatus] =
    useState<ChatEventStreamStatus>("connecting");

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

  useEffect(() => {
    if (workspaceId === undefined) {
      setChatSyncStatus("connecting");
      return;
    }
    const reconcileChats = () => {
      void queryClient.invalidateQueries({
        queryKey: ["chats", workspaceId],
      });
    };
    return subscribeToChatEvents(workspaceId, reconcileChats, {
      onStatus: setChatSyncStatus,
    });
  }, [queryClient, workspaceId]);

  useEffect(() => {
    const interval = chatSyncFallbackInterval(chatSyncStatus, online);
    if (interval === undefined || workspaceId === undefined) return;
    const reconcile = () => {
      void queryClient.invalidateQueries({
        queryKey: ["chats", workspaceId],
      });
    };
    reconcile();
    const timer = window.setInterval(reconcile, interval);
    return () => window.clearInterval(timer);
  }, [chatSyncStatus, online, queryClient, workspaceId]);

  const retryBootstrap = useCallback(() => {
    void bootstrapQuery.refetch();
  }, [bootstrapQuery]);
  const value = useMemo<WorkspaceContextValue>(
    () => ({
      bootstrapStatus: bootstrapQuery.status,
      chatSyncStatus,
      retryBootstrap,
      setWorkspaceId,
      subject: bootstrapQuery.data?.subject,
      workspace,
      workspaceId,
      workspaces,
    }),
    [
      bootstrapQuery.data?.subject,
      bootstrapQuery.status,
      chatSyncStatus,
      retryBootstrap,
      setWorkspaceId,
      workspace,
      workspaceId,
      workspaces,
    ],
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
