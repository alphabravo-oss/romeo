import type { QueryClient } from "@tanstack/react-query";

import * as appQueryKeys from "../../lib/app-query-keys";
import {
  invalidateCachedResourceExactly,
  serverMutationOptions,
} from "../../lib/server-mutation-options";
import {
  compareTieredKnowledgeReplay,
  createKnowledgeBase,
  createKnowledgeSource,
  deleteKnowledgeSource,
  extractKnowledgeSource,
  queryKnowledgeBase,
  queryTieredKnowledge,
  reindexKnowledgeSource,
  replayTieredKnowledge,
} from "./mutations";
import type { KnowledgeSource } from "./types";

interface WorkspaceKnowledgeScope {
  workspaceId?: string;
}

type CreateBaseInput = Parameters<typeof createKnowledgeBase>[0];
type CreateSourceInput = Parameters<typeof createKnowledgeSource>[0] &
  WorkspaceKnowledgeScope;
type DeleteSourceInput = Parameters<typeof deleteKnowledgeSource>[0] &
  WorkspaceKnowledgeScope;
type ExtractSourceInput = Parameters<typeof extractKnowledgeSource>[0] &
  WorkspaceKnowledgeScope;
type ReindexSourceInput = Parameters<typeof reindexKnowledgeSource>[0] &
  WorkspaceKnowledgeScope;

export function createKnowledgeBaseMutationOptions() {
  return serverMutationOptions({
    resource: "knowledge.base.create",
    mutationFn: (input: CreateBaseInput) => createKnowledgeBase(input),
    invalidations: (_base, input) => [
      {
        exact: true,
        queryKey: appQueryKeys.knowledgeBases(input.workspaceId),
      },
    ],
  });
}

export function createKnowledgeSourceMutationOptions() {
  return serverMutationOptions({
    ephemeral: true,
    resource: "knowledge.source.create",
    mutationFn: ({ workspaceId: _workspaceId, ...input }: CreateSourceInput) =>
      createKnowledgeSource(input),
    reconcile: (client, _source, input) =>
      invalidateKnowledgeSourceViewsExactly(client, input, { quotas: true }),
  });
}

export function ingestKnowledgeFileMutationOptions<
  TInput extends { knowledgeBaseId: string },
>(ingest: (input: TInput) => Promise<KnowledgeSource>) {
  type ScopedInput = TInput & WorkspaceKnowledgeScope;
  return serverMutationOptions<KnowledgeSource, Error, ScopedInput>({
    ephemeral: true,
    resource: "knowledge.source.fileIngest",
    mutationFn: ({ workspaceId: _workspaceId, ...input }) =>
      ingest(input as unknown as TInput),
    reconcile: (client, _source, input) =>
      invalidateKnowledgeSourceViewsExactly(client, input, { quotas: true }),
  });
}

export function deleteKnowledgeSourceMutationOptions() {
  return serverMutationOptions<
    KnowledgeSource,
    Error,
    DeleteSourceInput,
    KnowledgeSource[] | undefined
  >({
    resource: "knowledge.source.delete",
    mutationFn: ({ workspaceId: _workspaceId, ...input }) =>
      deleteKnowledgeSource(input),
    optimistic: {
      snapshot: async (client, input) => {
        const queryKey = appQueryKeys.knowledgeSources(input.knowledgeBaseId);
        await client.cancelQueries({ exact: true, queryKey });
        return client.getQueryData<KnowledgeSource[]>(queryKey);
      },
      update: (client, input) => {
        client.setQueryData<KnowledgeSource[]>(
          appQueryKeys.knowledgeSources(input.knowledgeBaseId),
          (current) => current?.filter(({ id }) => id !== input.sourceId),
        );
      },
      rollback: (client, snapshot, input) => {
        const queryKey = appQueryKeys.knowledgeSources(input.knowledgeBaseId);
        if (snapshot === undefined) {
          client.removeQueries({ exact: true, queryKey });
        } else {
          client.setQueryData(queryKey, snapshot);
        }
      },
    },
    reconcile: (client, _source, input) =>
      invalidateKnowledgeSourceViewsExactly(client, input),
  });
}

export function extractKnowledgeSourceMutationOptions() {
  return serverMutationOptions({
    resource: "knowledge.source.extract",
    mutationFn: ({ workspaceId: _workspaceId, ...input }: ExtractSourceInput) =>
      extractKnowledgeSource(input),
    reconcile: (client, _result, input) =>
      invalidateKnowledgeSourceViewsExactly(client, input, { jobs: true }),
  });
}

export function reindexKnowledgeSourceMutationOptions() {
  return serverMutationOptions({
    ephemeral: true,
    resource: "knowledge.source.reindex",
    mutationFn: ({ workspaceId: _workspaceId, ...input }: ReindexSourceInput) =>
      reindexKnowledgeSource(input),
    reconcile: (client, _source, input) =>
      invalidateKnowledgeSourceViewsExactly(client, input, {
        jobs: true,
        quotas: true,
      }),
  });
}

export function queryKnowledgeBaseMutationOptions() {
  return serverMutationOptions({
    ephemeral: true,
    resource: "knowledge.query.compute",
    mutationFn: queryKnowledgeBase,
  });
}

export function queryTieredKnowledgeMutationOptions() {
  return serverMutationOptions({
    resource: "knowledge.tieredQuery.compute",
    mutationFn: queryTieredKnowledge,
  });
}

export function replayTieredKnowledgeMutationOptions() {
  return serverMutationOptions({
    resource: "knowledge.replay.compute",
    mutationFn: replayTieredKnowledge,
  });
}

export function compareTieredKnowledgeReplayMutationOptions() {
  return serverMutationOptions({
    resource: "knowledge.replay.compare",
    mutationFn: compareTieredKnowledgeReplay,
  });
}

async function invalidateKnowledgeSourceViewsExactly(
  client: QueryClient,
  input: { knowledgeBaseId: string; workspaceId?: string },
  options: { jobs?: boolean; quotas?: boolean } = {},
) {
  const resources = [
    appQueryKeys.knowledgeSources(input.knowledgeBaseId),
    appQueryKeys.usageEvents(),
    appQueryKeys.usageSummary(),
    appQueryKeys.usageAlerts(),
    ...(input.workspaceId === undefined
      ? []
      : [appQueryKeys.knowledgeBases(input.workspaceId)]),
    ...(options.jobs === true ? [appQueryKeys.jobs()] : []),
    ...(options.quotas === true ? [appQueryKeys.quotas()] : []),
  ];
  await Promise.all(
    resources.map((resource) =>
      invalidateCachedResourceExactly(client, resource),
    ),
  );
}
