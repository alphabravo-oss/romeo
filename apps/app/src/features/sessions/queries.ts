import {
  impersonationListRequests,
  impersonationListSessions,
  sessionsListCurrentUser,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

export async function listSessions() {
  configureBrowserApiClients();
  const response = await sessionsListCurrentUser({ throwOnError: true });
  return response.data.data;
}

export async function listImpersonationSessions() {
  configureBrowserApiClients();
  const response = await impersonationListSessions({ throwOnError: true });
  return response.data.data;
}

export async function listImpersonationRequests() {
  configureBrowserApiClients();
  const response = await impersonationListRequests({ throwOnError: true });
  return response.data.data;
}
