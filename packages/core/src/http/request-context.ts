import { seededSubject, type AuthSubject } from "@romeo/auth";
import { readEnv } from "@romeo/config";
import type { MiddlewareHandler } from "hono";

import type { RomeoRepository } from "../domain/repository";
import type { RepositoryRequestScope } from "../domain/repository-request-scope";
import { AuthenticationError } from "../errors";
import type { AppBindings } from "./context";
import type { AuthenticationServices, RomeoServices } from "../services";
import { readCookie, sessionCookieName } from "./session-cookie";
import { normalizedRequestId } from "./request-id";
import {
  runWithTelemetryContext,
  telemetryTraceId,
} from "../services/telemetry-context";
import { resolveTrustedProxy, trustedForwardedProtocol } from "./trusted-proxy";

export interface RequestContextOptions {
  appOriginSecure?: boolean;
  createScopedAuthenticationServices?: (
    repository: RomeoRepository,
  ) => AuthenticationServices;
  createScopedServices?: (repository: RomeoRepository) => RomeoServices;
  devSeededLogin?: boolean;
  production?: boolean;
  repositoryRequestScope?: RepositoryRequestScope;
  trustedProxy?: Pick<
    ReturnType<typeof readEnv>,
    | "EDGE_TRUSTED_PROXY_CIDRS"
    | "EDGE_TRUSTED_PROXY_HOPS"
    | "EDGE_TRUSTED_PROXY_MODE"
  >;
}

const publicPaths = new Set([
  "/api/v1/auth/oauth2/callback",
  "/api/v1/auth/oauth2/start",
  "/api/v1/auth/saml/callback",
  "/api/v1/auth/saml/metadata",
  "/api/v1/auth/saml/start",
  "/api/v1/auth/oidc/callback",
  "/api/v1/auth/oidc/start",
  "/api/v1/auth/ldap/login",
  "/api/v1/auth/local/login",
  "/api/v1/auth/local/mfa/verify",
  "/api/v1/delegated-oauth/callback",
  "/api/v1/device-authorizations/refresh",
  "/api/v1/health",
  "/api/v1/health/object-storage",
  "/api/v1/readyz",
  "/api/v1/openapi.json",
  "/api/v1/docs",
  "/api/v1/openwebui/config",
  "/api/v1/openwebui/version",
  "/api/v1/openwebui/version/updates",
  "/api/config",
  "/api/version",
  "/api/version/updates",
  "/api/v1/billing/webhooks/generic",
  "/api/v1/billing/webhooks/stripe",
]);

// These routes are repository-free and must retain the process-owned service
// instance. In particular, recreating readiness here would defeat its TTL and
// singleflight protection during kubelet probe bursts.
const runtimeOnlyPaths = new Set(["/api/v1/health", "/api/v1/readyz"]);

export function requestContext(
  services: RomeoServices,
  options: RequestContextOptions = {},
): MiddlewareHandler<AppBindings> {
  const devSeededLogin = options.devSeededLogin ?? readEnv().DEV_SEEDED_LOGIN;

  return async (context, next) => {
    const requestId = normalizedRequestId(context.req.header("x-request-id"));
    const incomingTraceparent = context.req.header("traceparent");
    const incomingTraceId = context.req.header("x-romeo-trace-id");
    const traceId = telemetryTraceId({
      ...(incomingTraceparent === undefined
        ? {}
        : { traceparent: incomingTraceparent }),
      ...(incomingTraceId === undefined ? {} : { traceId: incomingTraceId }),
    });
    context.set("requestId", requestId);
    const trustedProxy =
      options.trustedProxy === undefined
        ? undefined
        : resolveTrustedProxy(context, options.trustedProxy);
    context.set(
      "secureCookie",
      options.production === true ||
        options.appOriginSecure === true ||
        new URL(context.req.url).protocol === "https:" ||
        (trustedProxy !== undefined &&
          trustedForwardedProtocol(context, trustedProxy) === "https"),
    );
    context.set("traceId", traceId);
    context.header("x-request-id", requestId);
    context.header("x-romeo-trace-id", traceId);
    await runWithTelemetryContext({ requestId, traceId }, async () => {
      const scope = options.repositoryRequestScope;
      const factory = options.createScopedServices;
      const authenticationFactory = options.createScopedAuthenticationServices;
      const requestPath = new URL(context.req.url).pathname;
      const workerBrokerRequest = isWorkerBrokerPath(requestPath);
      const authInput = {
        authorization: workerBrokerRequest
          ? undefined
          : context.req.header("authorization"),
        sessionToken: workerBrokerRequest
          ? undefined
          : readCookie(context.req.header("cookie"), sessionCookieName),
        allowAnonymous: workerBrokerRequest || publicPaths.has(requestPath),
        devSeededLogin: workerBrokerRequest ? false : devSeededLogin,
      };
      const subject =
        scope === undefined || factory === undefined
          ? await resolveSubjectWithInput(authInput, services)
          : await scope.runAsSystem((repository) =>
              resolveSubjectWithInput(
                authInput,
                authenticationFactory?.(repository) ?? factory(repository),
              ),
            );
      const runRequest = async (requestServices: RomeoServices) => {
        if (subject !== undefined) context.set("subject", subject);
        context.set("services", requestServices);
        await next();
        if (
          subject?.supportSession !== undefined &&
          subject.sessionId !== undefined
        ) {
          await auditSupportSessionRequest(
            subject,
            context.req.url,
            context.req.method,
            context.res.status,
            requestId,
            requestServices,
          );
        }
      };
      if (scope === undefined || factory === undefined) {
        await runRequest(services);
      } else if (
        subject === undefined &&
        (workerBrokerRequest || runtimeOnlyPaths.has(requestPath))
      ) {
        await runRequest(services);
      } else if (subject === undefined) {
        await scope.runAsSystem((repository) =>
          runRequest(factory(repository)),
        );
      } else if (
        repositoryScopeForRequest(
          subject,
          context.req.method,
          new URL(context.req.url).pathname,
        ) === "system"
      ) {
        await scope.runAsSystem((repository) =>
          runRequest(factory(repository)),
        );
      } else {
        await scope.runAsTenant(subject.orgId, (repository) =>
          runRequest(factory(repository)),
        );
      }
    });
  };
}

export function isWorkerBrokerPath(path: string): boolean {
  return /^\/api\/v1\/internal\/worker-broker\/[^/]+\/claims(?:\/(?:renew|complete))?$/u.test(
    path,
  );
}

export function repositoryScopeForRequest(
  subject: AuthSubject,
  method: string,
  path: string,
): "system" | "tenant" {
  if (subject.adminRole !== "global_admin") return "tenant";
  const normalizedMethod = method.toUpperCase();
  const requiredScope =
    normalizedMethod === "GET" ? "admin:read" : "admin:write";
  if (!subject.scopes.includes(requiredScope)) return "tenant";
  if (
    normalizedMethod === "GET" &&
    path === "/api/v1/admin/runtime-key-rotation/posture"
  ) {
    return "system";
  }
  if (path === "/api/v1/admin/organizations") {
    return normalizedMethod === "GET" || normalizedMethod === "POST"
      ? "system"
      : "tenant";
  }
  const match = /^\/api\/v1\/admin\/organizations\/[^/]+(?:\/(.+))?$/u.exec(
    path,
  );
  if (match === null) return "tenant";
  const suffix = match[1];
  if (suffix === undefined)
    return ["GET", "PATCH"].includes(normalizedMethod) ? "system" : "tenant";
  const allowedMethod = new Map<string, string>([
    ["suspend", "POST"],
    ["reactivate", "POST"],
    ["deletion-request", "POST"],
    ["deletion-request/cancel", "POST"],
    ["deletion-finalization-preview", "GET"],
    ["deletion-finalization-evidence", "POST"],
    ["deletion-finalization/execute", "POST"],
  ]).get(suffix);
  return allowedMethod === normalizedMethod ? "system" : "tenant";
}

function resolveSubjectWithInput(
  input: {
    allowAnonymous: boolean;
    authorization: string | undefined;
    devSeededLogin: boolean;
    sessionToken: string | undefined;
  },
  services: AuthenticationServices,
) {
  return resolveSubject(input.authorization, input.sessionToken, services, {
    allowAnonymous: input.allowAnonymous,
    devSeededLogin: input.devSeededLogin,
  });
}

async function resolveSubject(
  authorization: string | undefined,
  sessionToken: string | undefined,
  services: AuthenticationServices,
  options: { allowAnonymous: boolean; devSeededLogin: boolean },
) {
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
  if (token.length > 0) {
    if (isCompactJwt(token)) return services.oidc.authenticate(token);
    return services.apiKeys.authenticate(token);
  }
  if (sessionToken !== undefined && sessionToken.length > 0)
    return services.sessions.authenticate(sessionToken);
  if (options.devSeededLogin) return seededSubject;
  if (options.allowAnonymous) return undefined;
  throw new AuthenticationError("Authentication is required.");
}

function isCompactJwt(token: string): boolean {
  return token.split(".").length === 3;
}

async function auditSupportSessionRequest(
  subject: AuthSubject,
  requestUrl: string,
  method: string,
  status: number,
  requestId: string,
  services: RomeoServices,
): Promise<void> {
  const url = new URL(requestUrl);
  const resourceAccess = classifySupportResourceAccess(method, url.pathname);
  const input: Parameters<
    RomeoServices["sessions"]["auditSupportSessionRequest"]
  >[0] = {
    subject,
    method,
    path: url.pathname,
    status,
    queryKeys: Array.from(new Set(url.searchParams.keys())).sort(),
    requestId,
  };
  if (resourceAccess !== undefined) input.resourceAccess = resourceAccess;
  await services.sessions.auditSupportSessionRequest(input);
}

interface SupportResourceAccess {
  resourceType: string;
  resourceId: string;
  accessType: string;
}

function classifySupportResourceAccess(
  method: string,
  path: string,
): SupportResourceAccess | undefined {
  const segments = path.split("/").filter(Boolean).map(safeDecodePathSegment);
  if (segments[0] !== "api" || segments[1] !== "v1") return undefined;

  if (
    method === "GET" &&
    segments[2] === "agents" &&
    segments[3] !== undefined
  ) {
    if (segments.length === 5 && segments[4] === "export")
      return resourceAccess("agent", segments[3], "export");
    if (segments.length === 5 && segments[4] === "versions")
      return resourceAccess("agent", segments[3], "versions");
    if (
      segments.length === 7 &&
      segments[4] === "versions" &&
      segments[5] !== undefined &&
      segments[6] === "diff"
    ) {
      return resourceAccess("agent_version", segments[5], "diff");
    }
  }

  if (
    method === "GET" &&
    segments[2] === "chats" &&
    segments[3] !== undefined
  ) {
    if (segments.length === 4)
      return resourceAccess("chat", segments[3], "read");
    if (segments.length === 5 && segments[4] === "messages")
      return resourceAccess("chat", segments[3], "messages");
    if (segments.length === 5 && segments[4] === "comments")
      return resourceAccess("chat", segments[3], "comments");
    if (
      segments.length === 8 &&
      segments[4] === "messages" &&
      segments[6] === "attachments"
    ) {
      return resourceAccess("chat", segments[3], "message_attachment");
    }
  }

  if (method === "GET" && segments[2] === "runs" && segments[3] !== undefined) {
    if (segments.length === 4)
      return resourceAccess("run", segments[3], "read");
    if (segments.length === 5 && segments[4] === "events")
      return resourceAccess("run", segments[3], "events");
  }

  if (segments[2] === "files" && segments[3] !== undefined) {
    if (
      segments[3] === "uploads" &&
      segments[4] !== undefined &&
      segments.length <= 6
    ) {
      return resourceAccess("file", segments[4], "upload");
    }
    if (method === "GET" && segments.length === 4)
      return resourceAccess("file", segments[3], "read");
    if (method === "GET" && segments.length === 5 && segments[4] === "content")
      return resourceAccess("file", segments[3], "content");
    if (segments.length === 5 && segments[4] === "shares")
      return resourceAccess("file", segments[3], "shares");
  }

  if (segments[2] === "knowledge-bases" && segments[3] !== undefined) {
    if (method === "GET" && segments.length === 5 && segments[4] === "sources")
      return resourceAccess("knowledge_base", segments[3], "sources");
    if (method === "POST" && segments.length === 5 && segments[4] === "query")
      return resourceAccess("knowledge_base", segments[3], "query");
  }

  if (
    method === "GET" &&
    segments[2] === "browser-automation-artifacts" &&
    segments[3] !== undefined &&
    segments.length === 4
  ) {
    return resourceAccess("browser_automation_artifact", segments[3], "read");
  }

  if (
    method === "GET" &&
    segments[2] === "voice-artifacts" &&
    segments[3] !== undefined &&
    segments.length === 4
  ) {
    return resourceAccess("voice_artifact", segments[3], "read");
  }

  return undefined;
}

function resourceAccess(
  resourceType: string,
  resourceId: string,
  accessType: string,
): SupportResourceAccess | undefined {
  const boundedId = resourceId.trim().slice(0, 200);
  if (boundedId.length === 0) return undefined;
  return { resourceType, resourceId: boundedId, accessType };
}

function safeDecodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
