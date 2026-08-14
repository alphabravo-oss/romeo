import { queryOptions } from "@tanstack/react-query";

import * as appQueryKeys from "../../lib/app-query-keys";
import {
  abortableQuery,
  serverQueryPolicy,
} from "../../lib/server-query-options";
import {
  listImpersonationRequests,
  listImpersonationSessions,
  listSessions,
} from "./queries";

export function sessionsQueryOptions() {
  return queryOptions({
    ...serverQueryPolicy("interactive", "sessions"),
    queryKey: appQueryKeys.sessions(),
    queryFn: ({ signal }) => abortableQuery(signal, listSessions),
  });
}

export function impersonationRequestsQueryOptions() {
  return queryOptions({
    ...serverQueryPolicy("volatile", "impersonationRequests"),
    queryKey: appQueryKeys.impersonationRequests(),
    queryFn: ({ signal }) => abortableQuery(signal, listImpersonationRequests),
  });
}

export function impersonationSessionsQueryOptions() {
  return queryOptions({
    ...serverQueryPolicy("volatile", "impersonationSessions"),
    queryKey: appQueryKeys.impersonationSessions(),
    queryFn: ({ signal }) => abortableQuery(signal, listImpersonationSessions),
  });
}
