import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate, useSearch } from "@tanstack/react-router";
import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  subscribeToChatEvents,
  type ChatChangedEvent,
  type ChatEventStreamStatus,
} from "../features/chats/events";
import type { AuthSubject } from "../features/identity";
import type { Workspace } from "../features/tenancy";
import { reconcileWorkspaceChatEvent } from "../features/chats/cache-policy";
import { chatSyncFallbackInterval } from "../lib/chat-sync";
import { useOnlineStatus } from "../lib/connectivity";
import { bootstrapQueryOptions } from "../lib/api-query-options";
import { useLocale } from "../lib/i18n";
import { useRouterApiClient } from "../lib/router-context";
import { routerSessionQueryOptions } from "../lib/router-runtime-data";
import * as appQueryKeys from "../lib/app-query-keys";
import { invalidateCachedResourceExactly } from "../lib/server-mutation-options";
import { cancelWorkspaceIntentData } from "../lib/route-intent";
import {
  canSelectWorkspace,
  resolveWorkspaceSelection,
  switchWorkspaceRouteSearch,
  visibleWorkspaces,
  withWorkspaceRouteSearch,
} from "./workspace-selection";
import {
  routeWorkspaceSelectionQueryOptions,
  validatedRouteResourceId,
} from "../lib/route-workspace-selection";

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
  /** Most recent durable chat mutation observed for the selected workspace. */
  latestChatEvent: ChatChangedEvent | undefined;
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
  const apiClient = useRouterApiClient();
  const { locale } = useLocale();
  const pathname = useLocation({ select: (location) => location.pathname });
  const navigateChat = useNavigate({ from: "/" });
  const navigateWorkspace = useNavigate({ from: "/workspace" });
  const navigateAdmin = useNavigate({ from: "/admin" });
  const navigateSettings = useNavigate({ from: "/settings" });
  const routeSearch = useSearch({ strict: false }) as Record<string, unknown>;
  const requestedWorkspaceId = validatedRouteResourceId(routeSearch.workspace);
  const requestedChatId = validatedRouteResourceId(routeSearch.chat);
  const online = useOnlineStatus();
  const bootstrapQuery = useQuery(bootstrapQueryOptions(apiClient));
  const sessionQuery = useQuery(
    routerSessionQueryOptions(locale, queryClient, apiClient),
  );
  const routeSelectionQuery = useQuery(
    routeWorkspaceSelectionQueryOptions(
      {
        ...(requestedChatId === undefined ? {} : { chatId: requestedChatId }),
        ...(requestedWorkspaceId === undefined
          ? {}
          : { workspaceId: requestedWorkspaceId }),
      },
      queryClient,
      apiClient,
    ),
  );

  const workspaces = useMemo<Workspace[]>(
    () =>
      visibleWorkspaces(
        bootstrapQuery.data?.workspaces ?? sessionQuery.data?.workspaces ?? [],
        bootstrapQuery.data?.subject.workspaceIds ??
          sessionQuery.data?.subject.workspaceIds,
      ),
    [
      bootstrapQuery.data?.subject.workspaceIds,
      bootstrapQuery.data?.workspaces,
      sessionQuery.data?.subject.workspaceIds,
      sessionQuery.data?.workspaces,
    ],
  );

  const [pendingWorkspaceId, setPendingWorkspaceId] = useState<
    string | undefined
  >();
  const [chatSyncStatus, setChatSyncStatus] =
    useState<ChatEventStreamStatus>("connecting");
  const [latestChatEvent, setLatestChatEvent] = useState<ChatChangedEvent>();
  const previousWorkspaceId = useRef<string | undefined>(undefined);

  const validatedWorkspaceId = routeSelectionQuery.data?.workspaceId;

  const navigateWorkspaceSelection = useCallback(
    (
      workspaceId: string,
      replace: boolean,
      clearResourceSelection: boolean,
    ) => {
      const updateSearch = <T extends Record<string, unknown>>(previous: T) =>
        clearResourceSelection
          ? switchWorkspaceRouteSearch(previous, workspaceId)
          : withWorkspaceRouteSearch(previous, workspaceId);
      if (pathname === "/admin") {
        return navigateAdmin({ replace, search: updateSearch });
      }
      if (pathname === "/settings") {
        return navigateSettings({ replace, search: updateSearch });
      }
      if (pathname === "/workspace") {
        return navigateWorkspace({ replace, search: updateSearch });
      }
      return navigateChat({ replace, search: updateSearch });
    },
    [
      navigateAdmin,
      navigateChat,
      navigateSettings,
      navigateWorkspace,
      pathname,
    ],
  );

  // Route selection is authoritative for SSR, deep links, and history. Browser
  // storage is reconciled only after hydration and can request a replacement
  // navigation only when the URL itself carried no workspace/chat dimension.
  useEffect(() => {
    if (validatedWorkspaceId === undefined || workspaces.length === 0) return;
    if (requestedWorkspaceId !== undefined || requestedChatId !== undefined) {
      persistWorkspaceId(validatedWorkspaceId);
      if (requestedWorkspaceId !== undefined) return;
      void navigateWorkspaceSelection(validatedWorkspaceId, true, false);
      return;
    }
    const nextId = resolveWorkspaceSelection({
      persistedId: readPersistedWorkspaceId(),
      selectedId: undefined,
      workspaces,
    });
    if (nextId === undefined) return;
    persistWorkspaceId(nextId);
    void navigateWorkspaceSelection(nextId, true, false);
  }, [
    navigateWorkspaceSelection,
    requestedChatId,
    requestedWorkspaceId,
    validatedWorkspaceId,
    workspaces,
  ]);

  const setWorkspaceId = useCallback(
    (id: string) => {
      if (!canSelectWorkspace(id, workspaces)) return;
      setPendingWorkspaceId(id);
      persistWorkspaceId(id);
      void navigateWorkspaceSelection(id, false, true).finally(() =>
        setPendingWorkspaceId(undefined),
      );
    },
    [navigateWorkspaceSelection, workspaces],
  );

  const workspaceId = pendingWorkspaceId ?? validatedWorkspaceId;
  useEffect(() => {
    const previous = previousWorkspaceId.current;
    previousWorkspaceId.current = workspaceId;
    if (previous === undefined || previous === workspaceId) return;
    void cancelWorkspaceIntentData(queryClient, previous);
  }, [queryClient, workspaceId]);
  const workspace = useMemo(
    () => workspaces.find((candidate) => candidate.id === workspaceId),
    [workspaces, workspaceId],
  );

  useEffect(() => {
    if (workspaceId === undefined) {
      setChatSyncStatus("connecting");
      setLatestChatEvent(undefined);
      return;
    }
    setLatestChatEvent(undefined);
    const reconcileChats: Parameters<typeof subscribeToChatEvents>[1] = (
      event,
    ) => {
      if (event !== undefined) setLatestChatEvent(event);
      void reconcileWorkspaceChatEvent(queryClient, workspaceId, event);
    };
    return subscribeToChatEvents(workspaceId, reconcileChats, {
      onStatus: setChatSyncStatus,
    });
  }, [queryClient, workspaceId]);

  useEffect(() => {
    const interval = chatSyncFallbackInterval(chatSyncStatus, online);
    if (interval === undefined || workspaceId === undefined) return;
    const reconcile = () => {
      void invalidateCachedResourceExactly(
        queryClient,
        appQueryKeys.chats(workspaceId),
      );
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
      latestChatEvent,
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
      latestChatEvent,
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
