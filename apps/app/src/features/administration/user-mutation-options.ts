import type { QueryClient, QueryKey } from "@tanstack/react-query";

import * as appQueryKeys from "../../lib/app-query-keys";
import { currentMutationSessionVersion } from "../../lib/mutation-session-boundary";
import {
  invalidateCachedResourceExactly,
  serverMutationOptions,
} from "../../lib/server-mutation-options";
import { disableUser, setUserPassword, updateUserRole } from "./mutations";
import type { User, UserPage, UserRole } from "./types";

interface UserPagesSnapshot {
  pages: Array<{ data: UserPage | undefined; queryKey: QueryKey }>;
}

function userQueries(client: QueryClient) {
  return client.getQueryCache().findAll({ queryKey: appQueryKeys.users() });
}

async function snapshotUserPages(
  client: QueryClient,
): Promise<UserPagesSnapshot> {
  const queries = userQueries(client);
  await Promise.all(
    queries.map((query) =>
      client.cancelQueries({ exact: true, queryKey: query.queryKey }),
    ),
  );
  return {
    pages: queries.map((query) => ({
      data: client.getQueryData<UserPage>(query.queryKey),
      queryKey: query.queryKey,
    })),
  };
}

function restoreUserPages(
  client: QueryClient,
  snapshot: UserPagesSnapshot,
): void {
  for (const page of snapshot.pages) {
    if (page.data === undefined)
      client.removeQueries({ exact: true, queryKey: page.queryKey });
    else client.setQueryData(page.queryKey, page.data);
  }
}

function findCachedUser(client: QueryClient, userId: string): User | undefined {
  for (const query of userQueries(client)) {
    const user = client
      .getQueryData<UserPage>(query.queryKey)
      ?.data.find((entry) => entry.id === userId);
    if (user !== undefined) return user;
  }
  return undefined;
}

function updateCachedUserPages(
  client: QueryClient,
  userId: string,
  update: (user: User) => User,
  updateMeta: (meta: UserPage["meta"], previous: User) => UserPage["meta"],
): void {
  const previous = findCachedUser(client, userId);
  if (previous === undefined) return;
  for (const query of userQueries(client)) {
    client.setQueryData<UserPage>(query.queryKey, (current) =>
      current === undefined
        ? undefined
        : {
            data: current.data.map((user) =>
              user.id === userId ? update(user) : user,
            ),
            meta: updateMeta(current.meta, previous),
          },
    );
  }
}

function reconcileUser(client: QueryClient, user: User): void {
  for (const query of userQueries(client)) {
    client.setQueryData<UserPage>(query.queryKey, (current) =>
      current === undefined
        ? undefined
        : {
            ...current,
            data: current.data.map((entry) =>
              entry.id === user.id ? user : entry,
            ),
          },
    );
  }
}

export function disableUserMutationOptions() {
  return serverMutationOptions<User, Error, string, UserPagesSnapshot>({
    resource: "user.disable",
    mutationFn: disableUser,
    optimistic: {
      snapshot: snapshotUserPages,
      update: (client, userId) =>
        updateCachedUserPages(
          client,
          userId,
          (user) => ({ ...user, disabledAt: new Date().toISOString() }),
          (meta, previous) => ({
            ...meta,
            activeGlobalAdminTotal:
              previous.role === "global_admin" &&
              previous.disabledAt === undefined
                ? Math.max(0, meta.activeGlobalAdminTotal - 1)
                : meta.activeGlobalAdminTotal,
            disabledTotal:
              previous.disabledAt === undefined
                ? meta.disabledTotal + 1
                : meta.disabledTotal,
          }),
        ),
      rollback: restoreUserPages,
    },
    reconcile: async (client, user) => {
      reconcileUser(client, user);
      await invalidateCachedResourceExactly(client, appQueryKeys.users());
    },
  });
}

export interface UpdateUserRoleInput {
  role: UserRole;
  userId: string;
}

export function updateUserRoleMutationOptions() {
  return serverMutationOptions<
    User,
    Error,
    UpdateUserRoleInput,
    UserPagesSnapshot
  >({
    resource: "user.role.update",
    mutationFn: updateUserRole,
    optimistic: {
      snapshot: snapshotUserPages,
      update: (client, input) =>
        updateCachedUserPages(
          client,
          input.userId,
          (user) => ({ ...user, role: input.role }),
          (meta, previous) => {
            const wasAdmin = previous.role !== "user";
            const isAdmin = input.role !== "user";
            const wasActiveGlobal =
              previous.role === "global_admin" &&
              previous.disabledAt === undefined;
            const isActiveGlobal =
              input.role === "global_admin" &&
              previous.disabledAt === undefined;
            return {
              ...meta,
              activeGlobalAdminTotal:
                meta.activeGlobalAdminTotal +
                Number(isActiveGlobal) -
                Number(wasActiveGlobal),
              adminTotal: meta.adminTotal + Number(isAdmin) - Number(wasAdmin),
            };
          },
        ),
      rollback: restoreUserPages,
    },
    reconcile: async (client, user) => {
      reconcileUser(client, user);
      await invalidateCachedResourceExactly(client, appQueryKeys.users());
    },
  });
}

export interface SetUserPasswordInput {
  newPassword: string;
  userId: string;
}

export function setUserPasswordMutationOptions() {
  return serverMutationOptions<void, Error, SetUserPasswordInput>({
    ephemeral: true,
    resource: "user.localPassword.set",
    mutationFn: async (input) => {
      const sessionVersion = currentMutationSessionVersion();
      await setUserPassword(input);
      if (sessionVersion !== currentMutationSessionVersion()) {
        throw new Error("The authentication session changed.");
      }
    },
  });
}
