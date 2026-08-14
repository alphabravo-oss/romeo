import { queryOptions } from "@tanstack/react-query";

import * as appQueryKeys from "../lib/app-query-keys";
import { abortableQuery, serverQueryPolicy } from "../lib/server-query-options";
import {
  listContentPolicyApprovals,
  listContentPolicyDecisions,
  listContentPolicyVersions,
} from "./content-policy-lifecycle";

export function contentPolicyVersionsQueryOptions() {
  return queryOptions({
    ...serverQueryPolicy("stable", "contentPolicyVersions"),
    queryKey: appQueryKeys.contentPolicyVersions(),
    queryFn: ({ signal }) => abortableQuery(signal, listContentPolicyVersions),
  });
}

export function contentPolicyDecisionsQueryOptions() {
  return queryOptions({
    ...serverQueryPolicy("stable", "contentPolicyDecisions"),
    queryKey: appQueryKeys.contentPolicyDecisions(),
    queryFn: ({ signal }) => abortableQuery(signal, listContentPolicyDecisions),
  });
}

export function contentPolicyApprovalsQueryOptions() {
  return queryOptions({
    ...serverQueryPolicy("stable", "contentPolicyApprovals"),
    queryKey: appQueryKeys.contentPolicyApprovals(),
    queryFn: ({ signal }) => abortableQuery(signal, listContentPolicyApprovals),
  });
}
