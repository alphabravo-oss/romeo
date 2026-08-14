import type { QueryClient } from "@tanstack/react-query";

import * as appQueryKeys from "../../lib/app-query-keys";
import { currentMutationSessionVersion } from "../../lib/mutation-session-boundary";
import { serverMutationOptions } from "../../lib/server-mutation-options";
import { addGroupMember, createGroup, removeGroupMember } from "./mutations";
import type { Group, GroupMember } from "./types";

export interface GroupMemberInput {
  groupId: string;
  userId: string;
}

async function withinCurrentSession<T>(operation: () => Promise<T>) {
  const sessionVersion = currentMutationSessionVersion();
  const result = await operation();
  if (sessionVersion !== currentMutationSessionVersion()) {
    throw new Error("The authentication session changed.");
  }
  return result;
}

function upsertGroup(client: QueryClient, group: Group): void {
  client.setQueryData<Group[]>(appQueryKeys.groups(), (current) => {
    if (current === undefined) return undefined;
    return current.some((entry) => entry.id === group.id)
      ? current.map((entry) => (entry.id === group.id ? group : entry))
      : [...current, group];
  });
}

function upsertMember(client: QueryClient, member: GroupMember): void {
  const queryKey = appQueryKeys.groups(member.groupId, "members");
  client.setQueryData<GroupMember[]>(queryKey, (current) => {
    if (current === undefined) return undefined;
    return current.some((entry) => entry.userId === member.userId)
      ? current.map((entry) =>
          entry.userId === member.userId ? member : entry,
        )
      : [...current, member];
  });
}

export function createGroupMutationOptions() {
  const queryKey = appQueryKeys.groups();
  return serverMutationOptions({
    resource: "group.create",
    mutationFn: (input: { name: string; slug?: string }) =>
      withinCurrentSession(() => createGroup(input)),
    reconcile: upsertGroup,
    invalidations: () => [{ exact: true, queryKey }],
  });
}

export function addGroupMemberMutationOptions() {
  return serverMutationOptions({
    resource: "group.member.add",
    mutationFn: (input: GroupMemberInput) =>
      withinCurrentSession(() => addGroupMember(input)),
    reconcile: (client, member) => upsertMember(client, member),
    invalidations: (_member, input) => [
      {
        exact: true,
        queryKey: appQueryKeys.groups(input.groupId, "members"),
      },
    ],
  });
}

export function removeGroupMemberMutationOptions() {
  return serverMutationOptions<
    GroupMember,
    Error,
    GroupMemberInput,
    GroupMember[] | undefined
  >({
    resource: "group.member.remove",
    mutationFn: (input) => withinCurrentSession(() => removeGroupMember(input)),
    optimistic: {
      snapshot: async (client, input) => {
        const queryKey = appQueryKeys.groups(input.groupId, "members");
        await client.cancelQueries({ exact: true, queryKey });
        return client.getQueryData<GroupMember[]>(queryKey);
      },
      update: (client, input) => {
        const queryKey = appQueryKeys.groups(input.groupId, "members");
        client.setQueryData<GroupMember[]>(queryKey, (current) =>
          current?.filter((member) => member.userId !== input.userId),
        );
      },
      rollback: (client, snapshot, input) => {
        const queryKey = appQueryKeys.groups(input.groupId, "members");
        if (snapshot === undefined)
          client.removeQueries({ exact: true, queryKey });
        else client.setQueryData(queryKey, snapshot);
      },
    },
    reconcile: (client, removed) => {
      const queryKey = appQueryKeys.groups(removed.groupId, "members");
      client.setQueryData<GroupMember[]>(queryKey, (current) =>
        current?.filter((member) => member.userId !== removed.userId),
      );
    },
    invalidations: (_removed, input) => [
      {
        exact: true,
        queryKey: appQueryKeys.groups(input.groupId, "members"),
      },
    ],
  });
}
