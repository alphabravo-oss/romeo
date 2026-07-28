import {
  impersonationApproveRequest,
  impersonationCreateRequest,
  impersonationCreateSession,
  impersonationListRequests,
  impersonationListSessions,
  impersonationRejectRequest,
  sessionsCreateCurrentUser,
  sessionsListCurrentUser,
  sessionsRevokeCurrent,
  type CreateSupportSessionRequest,
} from "@romeo/api-client/generated/sdk";
import type { GeneratedApiClient } from "@romeo/api-client/runtime/generated-client";

import { flagValue, type ParsedArgs } from "./args";
import { optionalIntegerFlag, requiredFlag } from "./command-flags";
import type { CliIo } from "./io";
import { writeJson } from "./io";

interface SessionCommandContext {
  generatedClient?: GeneratedApiClient;
  io: CliIo;
  parsed: ParsedArgs;
}

export function executeSessionCommand(
  area: string,
  action: string | undefined,
  context: SessionCommandContext,
): Promise<number> | undefined {
  if (area !== "sessions") return undefined;
  const command = sessionCommand(action, context);
  return command === undefined ? undefined : result(context, command);
}

function sessionCommand(
  action: string | undefined,
  context: SessionCommandContext,
): Promise<unknown> | undefined {
  if (action === "list") return listSessions(context);
  if (action === "create") return createSession(context);
  if (action === "impersonate") return createSupportSession(context);
  if (action === "impersonation-report") return listSupportSessions(context);
  if (action === "impersonation-requests") return listSupportRequests(context);
  if (action === "request-impersonation") return requestSupportSession(context);
  if (action === "approve-impersonation") return approveSupportRequest(context);
  if (action === "reject-impersonation") return rejectSupportRequest(context);
  if (action === "revoke-current") return revokeCurrentSession(context);
  return undefined;
}

function listSessions(context: SessionCommandContext) {
  return sessionsListCurrentUser({
    client: generatedClient(context),
    throwOnError: true,
  }).then(dataEnvelope);
}

function createSession(context: SessionCommandContext) {
  const name = flagValue(context.parsed.flags, "name");
  const ttlHours = optionalIntegerFlag(context.parsed, "ttl-hours");
  const body = {
    ...(name === undefined ? {} : { name }),
    ...(ttlHours === undefined ? {} : { ttlHours }),
  };
  return sessionsCreateCurrentUser({
    body,
    client: generatedClient(context),
    throwOnError: true,
  }).then(dataEnvelope);
}

function createSupportSession(context: SessionCommandContext) {
  const body = supportSessionBody(context);
  return impersonationCreateSession({
    body,
    client: generatedClient(context),
    throwOnError: true,
  }).then(dataEnvelope);
}

function listSupportSessions(context: SessionCommandContext) {
  return impersonationListSessions({
    client: generatedClient(context),
    throwOnError: true,
  }).then(dataEnvelope);
}

function listSupportRequests(context: SessionCommandContext) {
  return impersonationListRequests({
    client: generatedClient(context),
    throwOnError: true,
  }).then(dataEnvelope);
}

function requestSupportSession(context: SessionCommandContext) {
  const body = supportSessionBody(context);
  return impersonationCreateRequest({
    body,
    client: generatedClient(context),
    throwOnError: true,
  }).then(dataEnvelope);
}

function approveSupportRequest(context: SessionCommandContext) {
  const requestId = requiredFlag(context.parsed, "request", "request-id");
  return impersonationApproveRequest({
    client: generatedClient(context),
    path: { requestId },
    throwOnError: true,
  }).then(dataEnvelope);
}

function rejectSupportRequest(context: SessionCommandContext) {
  const requestId = requiredFlag(context.parsed, "request", "request-id");
  return impersonationRejectRequest({
    client: generatedClient(context),
    path: { requestId },
    throwOnError: true,
  }).then(dataEnvelope);
}

function revokeCurrentSession(context: SessionCommandContext) {
  return sessionsRevokeCurrent({
    client: generatedClient(context),
    throwOnError: true,
  }).then(dataEnvelope);
}

function generatedClient(context: SessionCommandContext): GeneratedApiClient {
  if (context.generatedClient === undefined)
    throw new Error("The generated Romeo API client is required.");
  return context.generatedClient;
}

function supportSessionBody(
  context: SessionCommandContext,
): CreateSupportSessionRequest {
  const ttlMinutes = optionalIntegerFlag(context.parsed, "ttl-minutes");
  const ticketRef = flagValue(context.parsed.flags, "ticket", "ticket-ref");
  return {
    targetUserId: requiredFlag(context.parsed, "target-user", "target-user-id"),
    confirmTargetUserId: requiredFlag(
      context.parsed,
      "confirm-target-user",
      "confirm-target-user-id",
    ),
    reason: requiredFlag(context.parsed, "reason"),
    ...(ticketRef === undefined ? {} : { ticketRef }),
    ...(ttlMinutes === undefined ? {} : { ttlMinutes }),
  };
}

function dataEnvelope<T>(response: { data: { data: T } }): T {
  return response.data.data;
}

async function result(
  context: SessionCommandContext,
  value: Promise<unknown>,
): Promise<number> {
  writeJson(context.io, await value);
  return 0;
}
