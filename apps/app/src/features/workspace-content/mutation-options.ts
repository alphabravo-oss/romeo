import type { QueryClient, QueryKey } from "@tanstack/react-query";

import * as appQueryKeys from "../../lib/app-query-keys";
import { currentMutationSessionVersion } from "../../lib/mutation-session-boundary";
import {
  invalidateCachedResourceExactly,
  serverMutationOptions,
} from "../../lib/server-mutation-options";
import {
  createWorkspaceContent,
  deleteWorkspaceContent,
  updateWorkspaceContent,
} from "./mutations";
import type {
  ContentKind,
  CreateWorkspaceContentRequest,
  UpdateWorkspaceContentRequest,
  WorkspaceContentItem,
  WorkspaceContentPage,
} from "./types";

interface ContentScope {
  kind: ContentKind;
  workspaceId: string;
}

export type SaveWorkspaceContentInput =
  | (ContentScope & {
      operation: "create";
      input: CreateWorkspaceContentRequest;
    })
  | (ContentScope & {
      operation: "update";
      contentId: string;
      input: UpdateWorkspaceContentRequest;
    });

export interface DeleteWorkspaceContentInput extends ContentScope {
  contentId: string;
}

type ContentSnapshot = Array<
  readonly [QueryKey, WorkspaceContentPage | undefined]
>;

async function withinCurrentSession<T>(operation: () => Promise<T>) {
  const sessionVersion = currentMutationSessionVersion();
  const result = await operation();
  if (sessionVersion !== currentMutationSessionVersion()) {
    throw new Error("The authentication session changed.");
  }
  return result;
}

function contentPrefix({ kind, workspaceId }: ContentScope) {
  return appQueryKeys.personalContent(kind, workspaceId);
}

async function snapshotContentPages(
  client: QueryClient,
  scope: ContentScope,
): Promise<ContentSnapshot> {
  const queries = client.getQueryCache().findAll({
    queryKey: contentPrefix(scope),
  });
  await Promise.all(
    queries.map(({ queryKey }) =>
      client.cancelQueries({ exact: true, queryKey }),
    ),
  );
  return contentPageSnapshot(
    client,
    queries.map(({ queryKey }) => queryKey),
  );
}

function contentPageSnapshot(
  client: QueryClient,
  queryKeys: QueryKey[],
): ContentSnapshot {
  return queryKeys.map(
    (queryKey) =>
      [queryKey, client.getQueryData<WorkspaceContentPage>(queryKey)] as const,
  );
}

function currentContentPages(
  client: QueryClient,
  scope: ContentScope,
): ContentSnapshot {
  return contentPageSnapshot(
    client,
    client
      .getQueryCache()
      .findAll({ queryKey: contentPrefix(scope) })
      .map(({ queryKey }) => queryKey),
  );
}

function restoreContentPages(
  client: QueryClient,
  snapshot: ContentSnapshot,
): void {
  for (const [queryKey, page] of snapshot) {
    if (page === undefined) client.removeQueries({ exact: true, queryKey });
    else client.setQueryData(queryKey, page);
  }
}

function patchContentItem(
  item: WorkspaceContentItem,
  input: UpdateWorkspaceContentRequest,
): WorkspaceContentItem {
  const next = { ...item };
  if (input.body !== undefined) next.body = input.body;
  if (input.enabled !== undefined) next.enabled = input.enabled;
  if (input.pinned !== undefined) next.pinned = input.pinned;
  if (input.scope !== undefined) next.scope = input.scope;
  if (input.title !== undefined) next.title = input.title;
  if (input.expiresAt === null) delete next.expiresAt;
  else if (input.expiresAt !== undefined) next.expiresAt = input.expiresAt;
  return next;
}

function updateCachedContent(
  client: QueryClient,
  snapshot: ContentSnapshot,
  contentId: string,
  update: (item: WorkspaceContentItem) => WorkspaceContentItem | undefined,
): void {
  for (const [queryKey] of snapshot) {
    client.setQueryData<WorkspaceContentPage>(queryKey, (current) => {
      if (current === undefined) return current;
      const hadItem = current.items.some((item) => item.id === contentId);
      const items = current.items.flatMap((item) => {
        if (item.id !== contentId) return [item];
        const updated = update(item);
        return updated === undefined ? [] : [updated];
      });
      return {
        ...current,
        items,
        total:
          hadItem && items.length < current.items.length
            ? Math.max(0, current.total - 1)
            : current.total,
      };
    });
  }
}

async function invalidateContentPages(
  client: QueryClient,
  scope: ContentScope,
): Promise<void> {
  await invalidateCachedResourceExactly(client, contentPrefix(scope));
}

export function saveWorkspaceContentMutationOptions() {
  return serverMutationOptions<
    WorkspaceContentItem,
    Error,
    SaveWorkspaceContentInput,
    ContentSnapshot
  >({
    ephemeral: true,
    resource: "workspaceContent.save",
    mutationFn: (variables) =>
      withinCurrentSession(() =>
        variables.operation === "create"
          ? createWorkspaceContent(variables.kind, variables.input)
          : updateWorkspaceContent(
              variables.kind,
              variables.contentId,
              variables.input,
            ),
      ),
    optimistic: {
      snapshot: snapshotContentPages,
      update: (client, variables) => {
        if (variables.operation !== "update") return;
        updateCachedContent(
          client,
          currentContentPages(client, variables),
          variables.contentId,
          (item) => patchContentItem(item, variables.input),
        );
      },
      rollback: restoreContentPages,
    },
    reconcile: async (client, item, variables) => {
      if (variables.operation === "update") {
        updateCachedContent(
          client,
          currentContentPages(client, variables),
          variables.contentId,
          () => item,
        );
      }
      await invalidateContentPages(client, variables);
    },
  });
}

export function deleteWorkspaceContentMutationOptions() {
  return serverMutationOptions<
    WorkspaceContentItem,
    Error,
    DeleteWorkspaceContentInput,
    ContentSnapshot
  >({
    ephemeral: true,
    resource: "workspaceContent.delete",
    mutationFn: ({ kind, contentId }) =>
      withinCurrentSession(() => deleteWorkspaceContent(kind, contentId)),
    optimistic: {
      snapshot: snapshotContentPages,
      update: (client, variables) =>
        updateCachedContent(
          client,
          currentContentPages(client, variables),
          variables.contentId,
          () => undefined,
        ),
      rollback: restoreContentPages,
    },
    reconcile: async (client, _item, variables) => {
      updateCachedContent(
        client,
        currentContentPages(client, variables),
        variables.contentId,
        () => undefined,
      );
      await invalidateContentPages(client, variables);
    },
  });
}
