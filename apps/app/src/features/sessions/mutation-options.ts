import type {
  SupportSessionReport,
  SupportSessionRequestReport,
  UserSession,
} from "@romeo/api-client/generated/sdk";
import type { QueryClient, QueryKey } from "@tanstack/react-query";

import * as appQueryKeys from "../../lib/app-query-keys";
import { serverMutationOptions } from "../../lib/server-mutation-options";
import {
  approveImpersonationRequest,
  rejectImpersonationRequest,
  revokeCurrentSession,
  revokeImpersonationSession,
  revokeOtherSessions,
  revokeSession,
} from "./mutations";

type SessionList = UserSession[] | undefined;

function restoreSessions(
  client: QueryClient,
  queryKey: QueryKey,
  snapshot: SessionList,
): void {
  if (snapshot === undefined) client.removeQueries({ exact: true, queryKey });
  else client.setQueryData(queryKey, snapshot);
}

function upsertSession(
  client: QueryClient,
  queryKey: QueryKey,
  session: UserSession,
): void {
  client.setQueryData<UserSession[]>(queryKey, (current) =>
    current?.map((item) => (item.id === session.id ? session : item)),
  );
}

function restoreList<T>(
  client: QueryClient,
  queryKey: QueryKey,
  snapshot: T[] | undefined,
): void {
  if (snapshot === undefined) client.removeQueries({ exact: true, queryKey });
  else client.setQueryData(queryKey, snapshot);
}

function updateById<T extends { id: string }>(
  client: QueryClient,
  queryKey: QueryKey,
  id: string,
  update: (item: T) => T,
): void {
  client.setQueryData<T[]>(queryKey, (current) =>
    current?.map((item) => (item.id === id ? update(item) : item)),
  );
}

function upsertById<T extends { id: string }>(
  client: QueryClient,
  queryKey: QueryKey,
  item: T,
): void {
  client.setQueryData<T[]>(queryKey, (current) => {
    if (current === undefined) return undefined;
    return current.some((entry) => entry.id === item.id)
      ? current.map((entry) => (entry.id === item.id ? item : entry))
      : [...current, item];
  });
}

export interface RevokeSessionInput {
  current: boolean;
  sessionId: string;
}

export function revokeSessionMutationOptions() {
  const queryKey = appQueryKeys.sessions();
  return serverMutationOptions<
    UserSession,
    Error,
    RevokeSessionInput,
    SessionList
  >({
    resource: "session.revoke",
    mutationFn: ({ current, sessionId }) =>
      current ? revokeCurrentSession() : revokeSession(sessionId),
    optimistic: {
      snapshot: async (client) => {
        await client.cancelQueries({ exact: true, queryKey });
        return client.getQueryData<UserSession[]>(queryKey);
      },
      update: (client, { sessionId }) => {
        client.setQueryData<UserSession[]>(queryKey, (current) =>
          current?.map((session) =>
            session.id === sessionId
              ? { ...session, revokedAt: new Date().toISOString() }
              : session,
          ),
        );
      },
      rollback: (client, snapshot) =>
        restoreSessions(client, queryKey, snapshot),
    },
    reconcile: (client, session) => upsertSession(client, queryKey, session),
  });
}

export function revokeOtherSessionsMutationOptions() {
  const queryKey = appQueryKeys.sessions();
  return serverMutationOptions<
    UserSession[],
    Error,
    { currentSessionId: string | undefined },
    SessionList
  >({
    resource: "session.revokeOthers",
    mutationFn: revokeOtherSessions,
    optimistic: {
      snapshot: async (client) => {
        await client.cancelQueries({ exact: true, queryKey });
        return client.getQueryData<UserSession[]>(queryKey);
      },
      update: (client, { currentSessionId }) => {
        if (currentSessionId === undefined) return;
        client.setQueryData<UserSession[]>(queryKey, (current) =>
          current?.map((session) =>
            session.id === currentSessionId
              ? session
              : { ...session, revokedAt: new Date().toISOString() },
          ),
        );
      },
      rollback: (client, snapshot) =>
        restoreSessions(client, queryKey, snapshot),
    },
    reconcile: (client, sessions) => {
      for (const session of sessions) upsertSession(client, queryKey, session);
    },
  });
}

export function approveImpersonationRequestMutationOptions() {
  const requestsKey = appQueryKeys.impersonationRequests();
  const sessionsKey = appQueryKeys.impersonationSessions();
  return serverMutationOptions<
    UserSession,
    Error,
    string,
    SupportSessionRequestReport[] | undefined
  >({
    ephemeral: true,
    resource: "impersonation.request.approve",
    mutationFn: approveImpersonationRequest,
    optimistic: {
      snapshot: async (client) => {
        await client.cancelQueries({ exact: true, queryKey: requestsKey });
        return client.getQueryData<SupportSessionRequestReport[]>(requestsKey);
      },
      update: (client, requestId) =>
        updateById<SupportSessionRequestReport>(
          client,
          requestsKey,
          requestId,
          (request) => ({ ...request, status: "approved" }),
        ),
      rollback: (client, snapshot) =>
        restoreList(client, requestsKey, snapshot),
    },
    reconcile: (client, session, requestId) =>
      updateById<SupportSessionRequestReport>(
        client,
        requestsKey,
        requestId,
        (request) => ({
          ...request,
          sessionId: session.id,
          status: "approved",
        }),
      ),
    invalidations: () => [
      { exact: true, queryKey: requestsKey },
      { exact: true, queryKey: sessionsKey },
    ],
  });
}

export function rejectImpersonationRequestMutationOptions() {
  const queryKey = appQueryKeys.impersonationRequests();
  return serverMutationOptions<
    SupportSessionRequestReport,
    Error,
    string,
    SupportSessionRequestReport[] | undefined
  >({
    resource: "impersonation.request.reject",
    mutationFn: rejectImpersonationRequest,
    optimistic: {
      snapshot: async (client) => {
        await client.cancelQueries({ exact: true, queryKey });
        return client.getQueryData<SupportSessionRequestReport[]>(queryKey);
      },
      update: (client, requestId) =>
        updateById<SupportSessionRequestReport>(
          client,
          queryKey,
          requestId,
          (request) => ({ ...request, status: "rejected" }),
        ),
      rollback: (client, snapshot) => restoreList(client, queryKey, snapshot),
    },
    reconcile: (client, request) => upsertById(client, queryKey, request),
    invalidations: () => [{ exact: true, queryKey }],
  });
}

export function revokeImpersonationSessionMutationOptions() {
  const queryKey = appQueryKeys.impersonationSessions();
  return serverMutationOptions<
    SupportSessionReport,
    Error,
    string,
    SupportSessionReport[] | undefined
  >({
    resource: "impersonation.session.revoke",
    mutationFn: revokeImpersonationSession,
    optimistic: {
      snapshot: async (client) => {
        await client.cancelQueries({ exact: true, queryKey });
        return client.getQueryData<SupportSessionReport[]>(queryKey);
      },
      update: (client, sessionId) => {
        client.setQueryData<SupportSessionReport[]>(queryKey, (current) =>
          current?.map((report) =>
            report.session.id === sessionId
              ? { ...report, status: "revoked" }
              : report,
          ),
        );
      },
      rollback: (client, snapshot) => restoreList(client, queryKey, snapshot),
    },
    reconcile: (client, report) => {
      client.setQueryData<SupportSessionReport[]>(queryKey, (current) =>
        current?.map((entry) =>
          entry.session.id === report.session.id ? report : entry,
        ),
      );
    },
    invalidations: () => [{ exact: true, queryKey }],
  });
}
