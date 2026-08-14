import type {
  BootstrapResponse,
  Chat,
} from "@romeo/api-client/generated/query";
import type { GeneratedQueryClient } from "@romeo/api-client/runtime/generated-query-client";
import {
  queryOptions,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";

import { routeChatMetadataQueryOptions } from "../features/chats/query-options";
import { visibleWorkspaces } from "../components/workspace-selection";
import * as appQueryKeys from "./app-query-keys";
import { bootstrapQueryOptions } from "./api-query-options";
import { queryCacheProfiles } from "./query-cache-policy";
import { devQueryDiagnosticMeta } from "./query-cache-diagnostics";

export interface RouteWorkspaceSelectionRequest {
  chatId?: string | undefined;
  workspaceId?: string | undefined;
}

export function validatedRouteResourceId(value: unknown): string | undefined {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= 200 &&
    value.trim() === value
    ? value
    : undefined;
}

export function validatedWorkspaceRouteSearch(value: unknown): {
  workspace?: string;
} {
  const workspace = validatedRouteResourceId(value);
  return workspace === undefined ? {} : { workspace };
}

export interface RouteWorkspaceSelection {
  chatId?: string;
  source: "chat" | "default" | "workspace";
  workspaceId: string;
}

export type RouteWorkspaceSelectionErrorCode =
  | "chat_not_authorized"
  | "chat_workspace_mismatch"
  | "workspace_not_authorized"
  | "workspace_unavailable";

export class RouteWorkspaceSelectionError extends Error {
  readonly code: RouteWorkspaceSelectionErrorCode;
  /** Deliberately non-retryable and indistinguishable from a missing route. */
  readonly status = 404;

  constructor(code: RouteWorkspaceSelectionErrorCode) {
    super("The requested workspace or chat is unavailable.");
    this.name = "RouteWorkspaceSelectionError";
    this.code = code;
  }
}

export function resolveAuthorizedRouteWorkspace(input: {
  bootstrap: BootstrapResponse;
  chat: Chat | undefined;
  request: RouteWorkspaceSelectionRequest;
}): RouteWorkspaceSelection {
  const { bootstrap, chat, request } = input;
  const workspaces = visibleWorkspaces(
    bootstrap.workspaces,
    bootstrap.subject.workspaceIds,
  );
  const authorizedIds = new Set(workspaces.map(({ id }) => id));

  if (
    request.workspaceId !== undefined &&
    !authorizedIds.has(request.workspaceId)
  ) {
    throw new RouteWorkspaceSelectionError("workspace_not_authorized");
  }
  if (request.chatId !== undefined) {
    if (chat === undefined || !authorizedIds.has(chat.workspaceId)) {
      throw new RouteWorkspaceSelectionError("chat_not_authorized");
    }
    if (
      request.workspaceId !== undefined &&
      request.workspaceId !== chat.workspaceId
    ) {
      throw new RouteWorkspaceSelectionError("chat_workspace_mismatch");
    }
    return {
      chatId: chat.id,
      source: "chat",
      workspaceId: chat.workspaceId,
    };
  }
  if (request.workspaceId !== undefined) {
    return { source: "workspace", workspaceId: request.workspaceId };
  }
  const workspaceId = workspaces[0]?.id;
  if (workspaceId === undefined) {
    throw new RouteWorkspaceSelectionError("workspace_unavailable");
  }
  return { source: "default", workspaceId };
}

export function routeWorkspaceSelectionQueryOptions(
  request: RouteWorkspaceSelectionRequest,
  queryClient: QueryClient,
  apiClient: GeneratedQueryClient,
) {
  const queryKey = appQueryKeys.routeWorkspaceSelection(
    request.workspaceId,
    request.chatId,
  );
  return queryOptions({
    ...queryCacheProfiles.interactive,
    queryKey,
    queryFn: async ({ signal }) => {
      const bootstrapOptions = bootstrapQueryOptions(apiClient);
      const chatOptions =
        request.chatId === undefined
          ? undefined
          : routeChatMetadataQueryOptions(request.chatId, apiClient);
      // Bootstrap is a shared shell resource: cancelling a superseded chat
      // selection must not abort a newer selection or the session observer
      // that is deduplicating the same request. Chat metadata is resource-
      // exact, so it is safe and useful to cancel at the transport boundary.
      const nestedKeys: QueryKey[] =
        chatOptions === undefined ? [] : [chatOptions.queryKey];
      const cancelNested = () => {
        for (const nestedKey of nestedKeys) {
          void queryClient.cancelQueries({ exact: true, queryKey: nestedKey });
        }
      };
      signal.addEventListener("abort", cancelNested, { once: true });
      try {
        const bootstrapPromise = queryClient.fetchQuery(bootstrapOptions);
        const chatPromise =
          chatOptions === undefined
            ? Promise.resolve(undefined)
            : queryClient.fetchQuery(chatOptions).catch(() => {
                throw new RouteWorkspaceSelectionError("chat_not_authorized");
              });
        const [bootstrap, chat] = await Promise.all([
          bootstrapPromise,
          chatPromise,
        ]);
        signal.throwIfAborted();
        return resolveAuthorizedRouteWorkspace({ bootstrap, chat, request });
      } finally {
        signal.removeEventListener("abort", cancelNested);
      }
    },
    meta: {
      ssr: true,
      ...devQueryDiagnosticMeta("routeWorkspaceSelection", {
        ...(request.chatId === undefined ? {} : { chatId: request.chatId }),
        ...(request.workspaceId === undefined
          ? {}
          : { workspaceId: request.workspaceId }),
      }),
    },
  });
}
