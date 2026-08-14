import type {
  SupportSessionReport,
  SupportSessionRequestReport,
  UserSession,
} from "@romeo/api-client/generated/sdk";
import { MutationObserver } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as appQueryKeys from "../../lib/app-query-keys";
import {
  completeMutationNetworkRevalidation,
  markMutationNetworkOffline,
} from "../../lib/connectivity";
import { advanceMutationSessionBoundary } from "../../lib/mutation-session-boundary";
import { createRomeoQueryClient } from "../../lib/query-client";
import { clearRouteDataForLogout } from "../../lib/route-intent";
import {
  approveImpersonationRequestMutationOptions,
  rejectImpersonationRequestMutationOptions,
  revokeImpersonationSessionMutationOptions,
  revokeOtherSessionsMutationOptions,
  revokeSessionMutationOptions,
} from "./mutation-options";

const mutationMocks = vi.hoisted(() => ({
  approveImpersonationRequest: vi.fn(),
  rejectImpersonationRequest: vi.fn(),
  revokeCurrentSession: vi.fn(),
  revokeImpersonationSession: vi.fn(),
  revokeOtherSessions: vi.fn(),
  revokeSession: vi.fn(),
}));

vi.mock("./mutations", () => mutationMocks);

const session = (id: string): UserSession => ({
  createdAt: "2026-01-01T00:00:00.000Z",
  expiresAt: "2027-01-01T00:00:00.000Z",
  id,
  isAdmin: false,
  name: id,
  orgId: "org-1",
  scopes: ["me:read"],
  userId: "user-1",
});

const request = (
  status: SupportSessionRequestReport["status"] = "pending",
): SupportSessionRequestReport => ({
  createdAt: "2026-01-01T00:00:00.000Z",
  id: "request-1",
  requestedByUserId: "admin-1",
  status,
  targetUserId: "user-1",
  ttlMinutes: 30,
});

const supportSession = (
  status: SupportSessionReport["status"] = "active",
): SupportSessionReport => ({
  adminUserId: "admin-1",
  createdAuditLogId: "audit-1",
  session: session("support-session-1"),
  status,
  targetUserId: "user-1",
});

describe("session mutation policies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    completeMutationNetworkRevalidation();
    advanceMutationSessionBoundary();
  });

  it("uses the cookie-clearing endpoint for the current session", async () => {
    const client = createRomeoQueryClient();
    const current = session("session-current");
    client.setQueryData(appQueryKeys.sessions(), [current]);
    mutationMocks.revokeCurrentSession.mockResolvedValueOnce({
      ...current,
      revokedAt: "2026-02-01T00:00:00.000Z",
    });
    const observer = new MutationObserver(
      client,
      revokeSessionMutationOptions(),
    );

    await observer.mutate({ current: true, sessionId: current.id });

    expect(mutationMocks.revokeCurrentSession).toHaveBeenCalledOnce();
    expect(mutationMocks.revokeSession).not.toHaveBeenCalled();
    expect(
      client.getQueryData<UserSession[]>(appQueryKeys.sessions())?.[0]
        ?.revokedAt,
    ).toBe("2026-02-01T00:00:00.000Z");
  });

  it("rolls a remote-session optimistic revoke back on conflict", async () => {
    const client = createRomeoQueryClient();
    const remote = session("session-remote");
    client.setQueryData(appQueryKeys.sessions(), [remote]);
    mutationMocks.revokeSession.mockRejectedValueOnce(
      new Error("version_conflict"),
    );
    const observer = new MutationObserver(
      client,
      revokeSessionMutationOptions(),
    );

    await expect(
      observer.mutate({ current: false, sessionId: remote.id }),
    ).rejects.toThrow("version_conflict");
    expect(client.getQueryData(appQueryKeys.sessions())).toEqual([remote]);
  });

  it("optimistically preserves the current session when revoking all others", async () => {
    const client = createRomeoQueryClient();
    const current = session("session-current");
    const remote = session("session-remote");
    client.setQueryData(appQueryKeys.sessions(), [current, remote]);
    mutationMocks.revokeOtherSessions.mockResolvedValueOnce([
      { ...remote, revokedAt: "2026-02-01T00:00:00.000Z" },
    ]);
    const observer = new MutationObserver(
      client,
      revokeOtherSessionsMutationOptions(),
    );

    await observer.mutate({ currentSessionId: current.id });
    const cached = client.getQueryData<UserSession[]>(appQueryKeys.sessions());
    expect(cached?.find((item) => item.id === current.id)?.revokedAt).toBe(
      undefined,
    );
    expect(cached?.find((item) => item.id === remote.id)?.revokedAt).toBe(
      "2026-02-01T00:00:00.000Z",
    );
  });

  it("approves with exact request/session convergence and no credential cache", async () => {
    const client = createRomeoQueryClient();
    const requestsKey = appQueryKeys.impersonationRequests();
    const sessionsKey = appQueryKeys.impersonationSessions();
    client.setQueryData(requestsKey, [request()]);
    client.setQueryData(sessionsKey, []);
    mutationMocks.approveImpersonationRequest.mockResolvedValueOnce(
      session("support-session-1"),
    );
    const observer = new MutationObserver(
      client,
      approveImpersonationRequestMutationOptions(),
    );

    const result = await observer.mutate("request-1");

    expect(result.id).toBe("support-session-1");
    expect(
      client.getQueryData<SupportSessionRequestReport[]>(requestsKey)?.[0],
    ).toMatchObject({
      id: "request-1",
      sessionId: "support-session-1",
      status: "approved",
    });
    expect(client.getQueryState(requestsKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(sessionsKey)?.isInvalidated).toBe(true);
    expect(JSON.stringify(client.getMutationCache().getAll())).not.toContain(
      "token",
    );
  });

  it("rolls an approval projection back on conflict", async () => {
    const client = createRomeoQueryClient();
    const queryKey = appQueryKeys.impersonationRequests();
    const pending = request();
    client.setQueryData(queryKey, [pending]);
    mutationMocks.approveImpersonationRequest.mockRejectedValueOnce(
      new Error("version_conflict"),
    );
    const observer = new MutationObserver(
      client,
      approveImpersonationRequestMutationOptions(),
    );

    await expect(observer.mutate(pending.id)).rejects.toThrow(
      "version_conflict",
    );
    expect(client.getQueryData(queryKey)).toEqual([pending]);
    expect(client.getQueryState(queryKey)?.isInvalidated).toBe(false);
  });

  it("reconciles rejection and revocation into their exact projections", async () => {
    const client = createRomeoQueryClient();
    const requestsKey = appQueryKeys.impersonationRequests();
    const sessionsKey = appQueryKeys.impersonationSessions();
    const rejected = request("rejected");
    const revoked = supportSession("revoked");
    client.setQueryData(requestsKey, [request()]);
    client.setQueryData(sessionsKey, [supportSession()]);
    mutationMocks.rejectImpersonationRequest.mockResolvedValueOnce(rejected);
    mutationMocks.revokeImpersonationSession.mockResolvedValueOnce(revoked);

    await new MutationObserver(
      client,
      rejectImpersonationRequestMutationOptions(),
    ).mutate("request-1");
    await new MutationObserver(
      client,
      revokeImpersonationSessionMutationOptions(),
    ).mutate("support-session-1");

    expect(client.getQueryData(requestsKey)).toEqual([rejected]);
    expect(client.getQueryData(sessionsKey)).toEqual([revoked]);
    expect(client.getQueryState(requestsKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(sessionsKey)?.isInvalidated).toBe(true);
  });

  it("rolls a support-session revoke back on authorization failure", async () => {
    const client = createRomeoQueryClient();
    const queryKey = appQueryKeys.impersonationSessions();
    const active = supportSession();
    client.setQueryData(queryKey, [active]);
    mutationMocks.revokeImpersonationSession.mockRejectedValueOnce(
      new Error("forbidden"),
    );
    const observer = new MutationObserver(
      client,
      revokeImpersonationSessionMutationOptions(),
    );

    await expect(observer.mutate(active.session.id)).rejects.toThrow(
      "forbidden",
    );
    expect(client.getQueryData(queryKey)).toEqual([active]);
    expect(client.getQueryState(queryKey)?.isInvalidated).toBe(false);
  });

  it("executes no impersonation write while offline", async () => {
    const client = createRomeoQueryClient();
    markMutationNetworkOffline();
    const observer = new MutationObserver(
      client,
      rejectImpersonationRequestMutationOptions(),
    );

    await expect(observer.mutate("request-1")).rejects.toThrow(
      "Changes are unavailable until the secure connection is ready.",
    );
    expect(mutationMocks.rejectImpersonationRequest).not.toHaveBeenCalled();
  });

  it("ignores a late approval after the authenticated cache is cleared", async () => {
    const client = createRomeoQueryClient();
    const requestsKey = appQueryKeys.impersonationRequests();
    const sessionsKey = appQueryKeys.impersonationSessions();
    client.setQueryData(requestsKey, [request()]);
    client.setQueryData(sessionsKey, [supportSession()]);
    let resolveApproval: ((value: UserSession) => void) | undefined;
    mutationMocks.approveImpersonationRequest.mockImplementationOnce(
      () =>
        new Promise<UserSession>((resolve) => {
          resolveApproval = resolve;
        }),
    );
    const observer = new MutationObserver(
      client,
      approveImpersonationRequestMutationOptions(),
    );
    const pendingApproval = observer.mutate("request-1");
    await vi.waitFor(() => expect(resolveApproval).toBeDefined());

    await clearRouteDataForLogout(client);
    resolveApproval?.(session("support-session-2"));
    await pendingApproval;

    expect(client.getQueryData(requestsKey)).toBeUndefined();
    expect(client.getQueryData(sessionsKey)).toBeUndefined();
  });
});
