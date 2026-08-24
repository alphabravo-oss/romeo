import { queryOptions } from "@tanstack/react-query";

import * as appQueryKeys from "../../lib/app-query-keys";
import {
  abortableQuery,
  serverQueryPolicy,
} from "../../lib/server-query-options";
import { listWorkspaceContentPage } from "./queries";
import type { ContentKind } from "./types";

export function workspaceContentPageQueryOptions(input: {
  enabled: boolean;
  kind: ContentKind;
  page: number;
  pageSize: number;
  query: string;
  workspaceId: string | undefined;
}) {
  const { enabled, kind, page, pageSize, query, workspaceId } = input;
  const normalizedQuery = query.trim();
  return queryOptions({
    ...serverQueryPolicy("interactive", "personalContent", {
      kind,
      page,
      ...(normalizedQuery === "" ? {} : { query: normalizedQuery }),
      workspaceId,
    }),
    queryKey: appQueryKeys.personalContent(kind, workspaceId, {
      page,
      query: normalizedQuery,
    }),
    queryFn: ({ signal }) =>
      abortableQuery(signal, () =>
        listWorkspaceContentPage(kind, workspaceId!, {
          limit: pageSize,
          offset: page * pageSize,
          query: normalizedQuery,
        }),
      ),
    enabled: enabled && workspaceId !== undefined,
    refetchInterval: (current) =>
      current.state.data?.items.some((item) =>
        [
          "uploading",
          "quarantined",
          "scanning",
          "extracting",
          "transcoding",
        ].includes(item.lifecycleStatus),
      )
        ? 1_000
        : false,
  });
}
