import type { Workspace } from "@romeo/api-client/generated/sdk";
import type { QueryClient } from "@tanstack/react-query";

import * as appQueryKeys from "../../lib/app-query-keys";
import { apiQueryKeys } from "../../lib/api-query-options";
import { currentMutationSessionVersion } from "../../lib/mutation-session-boundary";
import {
  invalidateCachedResourceExactly,
  serverMutationOptions,
} from "../../lib/server-mutation-options";
import { archiveWorkspace, updateWorkspaceDefaultAgent } from "./mutations";
import { exportWorkspace } from "./queries";

type WorkspaceCatalogSnapshot = Workspace[] | undefined;

async function withinCurrentSession<T>(operation: () => Promise<T>) {
  const sessionVersion = currentMutationSessionVersion();
  const result = await operation();
  if (sessionVersion !== currentMutationSessionVersion()) {
    throw new Error("The authentication session changed.");
  }
  return result;
}

function reconcileWorkspace(client: QueryClient, workspace: Workspace): void {
  client.setQueryData<Workspace[]>(appQueryKeys.workspaces(), (current) =>
    current?.map((entry) => (entry.id === workspace.id ? workspace : entry)),
  );
}

async function snapshotWorkspaces(
  client: QueryClient,
): Promise<WorkspaceCatalogSnapshot> {
  const queryKey = appQueryKeys.workspaces();
  await client.cancelQueries({ exact: true, queryKey });
  return client.getQueryData<Workspace[]>(queryKey);
}

function restoreWorkspaces(
  client: QueryClient,
  snapshot: WorkspaceCatalogSnapshot,
): void {
  const queryKey = appQueryKeys.workspaces();
  if (snapshot === undefined) client.removeQueries({ exact: true, queryKey });
  else client.setQueryData(queryKey, snapshot);
}

export function updateWorkspaceDefaultAgentMutationOptions() {
  return serverMutationOptions({
    resource: "workspace.defaultAgent.update",
    mutationFn: updateWorkspaceDefaultAgent,
    reconcile: (client, workspace) => {
      client.setQueryData<Workspace[]>(appQueryKeys.workspaces(), (current) =>
        current?.map((entry) =>
          entry.id === workspace.id ? workspace : entry,
        ),
      );
    },
    invalidations: () => [
      { exact: true, queryKey: apiQueryKeys.bootstrap() },
      { exact: true, queryKey: appQueryKeys.workspaces() },
    ],
  });
}

export function archiveWorkspaceMutationOptions() {
  return serverMutationOptions<
    Workspace,
    Error,
    string,
    WorkspaceCatalogSnapshot
  >({
    resource: "workspace.archive",
    mutationFn: (workspaceId) =>
      withinCurrentSession(() => archiveWorkspace(workspaceId)),
    optimistic: {
      snapshot: snapshotWorkspaces,
      update: (client, workspaceId) => {
        client.setQueryData<Workspace[]>(appQueryKeys.workspaces(), (current) =>
          current?.map((workspace) =>
            workspace.id === workspaceId
              ? { ...workspace, archivedAt: new Date().toISOString() }
              : workspace,
          ),
        );
      },
      rollback: restoreWorkspaces,
    },
    reconcile: async (client, workspace) => {
      reconcileWorkspace(client, workspace);
      await Promise.all([
        invalidateCachedResourceExactly(
          client,
          appQueryKeys.chats(workspace.id),
        ),
        invalidateCachedResourceExactly(client, appQueryKeys.auditLogs()),
      ]);
    },
    invalidations: (_workspace, workspaceId) => [
      { exact: true, queryKey: apiQueryKeys.bootstrap() },
      { exact: true, queryKey: apiQueryKeys.agents(workspaceId) },
      { exact: true, queryKey: apiQueryKeys.agentGallery(workspaceId) },
      { exact: true, queryKey: appQueryKeys.workspaces() },
      { exact: true, queryKey: appQueryKeys.knowledgeBases(workspaceId) },
      { exact: true, queryKey: appQueryKeys.workspaceMembers(workspaceId) },
      {
        exact: true,
        queryKey: appQueryKeys.workspaceCapabilities(workspaceId),
      },
      { exact: true, queryKey: appQueryKeys.accessReview() },
    ],
  });
}

export function exportWorkspaceMutationOptions() {
  return serverMutationOptions({
    ephemeral: true,
    resource: "workspace.export",
    mutationFn: (workspaceId: string) =>
      withinCurrentSession(() => exportWorkspace(workspaceId)),
    reconcile: (client) =>
      invalidateCachedResourceExactly(client, appQueryKeys.auditLogs()),
  });
}
