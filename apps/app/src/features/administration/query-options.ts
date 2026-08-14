import { keepPreviousData, queryOptions } from "@tanstack/react-query";

import * as appQueryKeys from "../../lib/app-query-keys";
import {
  abortableQuery,
  serverQueryPolicy,
} from "../../lib/server-query-options";
import {
  listApiKeys,
  listGroupMembers,
  listGroups,
  listServiceAccounts,
  listUsers,
} from "./queries";

export function apiKeysQueryOptions() {
  return queryOptions({
    ...serverQueryPolicy("interactive", "apiKeys"),
    queryKey: appQueryKeys.apiKeys(),
    queryFn: ({ signal }) => abortableQuery(signal, listApiKeys),
  });
}

export function serviceAccountsQueryOptions() {
  return queryOptions({
    ...serverQueryPolicy("interactive", "serviceAccounts"),
    queryKey: appQueryKeys.serviceAccounts(),
    queryFn: ({ signal }) => abortableQuery(signal, listServiceAccounts),
  });
}

export function groupsQueryOptions() {
  return queryOptions({
    ...serverQueryPolicy("interactive", "groups"),
    queryKey: appQueryKeys.groups(),
    queryFn: ({ signal }) => abortableQuery(signal, listGroups),
  });
}

export function groupMembersQueryOptions(groupId: string) {
  return queryOptions({
    ...serverQueryPolicy("interactive", "groupMembers", { groupId }),
    queryKey: appQueryKeys.groups(groupId || undefined, "members"),
    queryFn: ({ signal }) =>
      abortableQuery(signal, () => listGroupMembers(groupId)),
    enabled: groupId !== "",
  });
}

export interface UsersQueryInput {
  direction: "asc" | "desc";
  page: number;
  pageSize: number;
  query: string;
  sort: "email" | "name" | "role" | "status";
}

export function usersQueryOptions(input: UsersQueryInput) {
  const { direction, page, pageSize, query, sort } = input;
  return queryOptions({
    ...serverQueryPolicy("interactive", "users", {
      direction,
      page,
      query,
      sort,
    }),
    queryKey: appQueryKeys.users({ direction, page, query, sort }),
    queryFn: ({ signal }) =>
      abortableQuery(signal, () =>
        listUsers({
          direction,
          limit: pageSize,
          offset: page * pageSize,
          ...(query.trim() === "" ? {} : { query }),
          sort,
        }),
      ),
    placeholderData: keepPreviousData,
  });
}
