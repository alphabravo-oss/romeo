import { queryOptions } from "@tanstack/react-query";

import * as appQueryKeys from "../../lib/app-query-keys";
import {
  abortableQuery,
  serverQueryPolicy,
} from "../../lib/server-query-options";
import {
  getDelegatedOauthPosture,
  listDelegatedOAuthConnections,
  listDelegatedOAuthProviders,
} from "./queries";

export function delegatedOAuthProvidersQueryOptions() {
  return queryOptions({
    ...serverQueryPolicy("stable", "delegatedOAuthProviders"),
    queryKey: appQueryKeys.delegatedOAuthProviders(),
    queryFn: ({ signal }) =>
      abortableQuery(signal, listDelegatedOAuthProviders),
  });
}

export function delegatedOAuthConnectionsQueryOptions(workspaceId?: string) {
  return queryOptions({
    ...serverQueryPolicy("interactive", "delegatedOAuthConnections", {
      workspaceId,
    }),
    queryKey: appQueryKeys.delegatedOAuthConnections(workspaceId ?? null),
    queryFn: ({ signal }) =>
      abortableQuery(signal, () => listDelegatedOAuthConnections(workspaceId)),
  });
}

export function delegatedOAuthPostureQueryOptions() {
  return queryOptions({
    ...serverQueryPolicy("volatile", "delegatedOAuthPosture"),
    queryKey: appQueryKeys.delegatedOAuthPosture(),
    queryFn: ({ signal }) => abortableQuery(signal, getDelegatedOauthPosture),
  });
}
