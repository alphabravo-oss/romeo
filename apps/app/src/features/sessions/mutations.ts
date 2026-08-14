import {
  impersonationApproveRequest,
  impersonationRejectRequest,
  impersonationRevokeSession,
  sessionsRevokeById,
  sessionsRevokeCurrent,
  sessionsRevokeOthers,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

export async function revokeCurrentSession() {
  configureBrowserApiClients();
  const response = await sessionsRevokeCurrent({ throwOnError: true });
  return response.data.data;
}

export async function revokeSession(sessionId: string) {
  configureBrowserApiClients();
  const response = await sessionsRevokeById({
    path: { sessionId },
    throwOnError: true,
  });
  return response.data.data;
}

export async function revokeOtherSessions() {
  configureBrowserApiClients();
  const response = await sessionsRevokeOthers({ throwOnError: true });
  return response.data.data;
}

export async function approveImpersonationRequest(requestId: string) {
  configureBrowserApiClients();
  const response = await impersonationApproveRequest({
    path: { requestId },
    throwOnError: true,
  });
  // This panel manages the approval state; it never consumes the resulting
  // bearer credential. Return only the non-secret session projection so the
  // one-time token cannot enter React Query's mutation cache.
  return response.data.data.session;
}

export async function rejectImpersonationRequest(requestId: string) {
  configureBrowserApiClients();
  const response = await impersonationRejectRequest({
    path: { requestId },
    throwOnError: true,
  });
  return response.data.data;
}

export async function revokeImpersonationSession(sessionId: string) {
  configureBrowserApiClients();
  const response = await impersonationRevokeSession({
    path: { sessionId },
    throwOnError: true,
  });
  return response.data.data;
}
