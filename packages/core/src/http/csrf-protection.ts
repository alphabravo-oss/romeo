import type { RomeoEnv } from "@romeo/config";
import type { MiddlewareHandler } from "hono";

import { ApiError } from "../errors";
import type { AppBindings } from "./context";
import { readCookie, sessionCookieName } from "./session-cookie";

const unsafeMethods = new Set(["DELETE", "PATCH", "POST", "PUT"]);
const csrfExemptPaths = new Set([
  "/api/v1/auth/saml/callback",
  "/api/v1/billing/webhooks/generic",
  "/api/v1/billing/webhooks/stripe",
]);

export function csrfProtection(env: RomeoEnv): MiddlewareHandler<AppBindings> {
  return async (context, next) => {
    if (!unsafeMethods.has(context.req.method)) return next();
    const path = new URL(context.req.url).pathname;
    if (csrfExemptPaths.has(path)) return next();

    // CSRF is a confused-deputy risk only when the browser contributes ambient
    // session credentials. Bearer clients authenticate explicitly and must not
    // be forced to manufacture browser headers. When both are present the
    // request context deliberately prefers the bearer token, so it remains a
    // bearer-authenticated request here too.
    const authorization = context.req.header("authorization")?.trim() ?? "";
    const hasBearerAuthorization = /^Bearer\s+\S+/iu.test(authorization);
    const hasSessionCookie =
      readCookie(context.req.header("cookie"), sessionCookieName) !== undefined;
    if (!hasSessionCookie || hasBearerAuthorization) return next();

    const secFetchSite = context.req.header("sec-fetch-site")?.toLowerCase();
    if (secFetchSite === "cross-site") throw csrfError("fetch_metadata");

    const origin = context.req.header("origin");
    if (origin !== undefined && !isAllowedBrowserOrigin(origin, env)) {
      throw csrfError("origin");
    }

    const referer = context.req.header("referer");
    if (
      origin === undefined &&
      referer !== undefined &&
      !isAllowedBrowserOrigin(referer, env)
    ) {
      throw csrfError("referer");
    }

    if (origin === undefined && referer === undefined) {
      throw csrfError("missing_origin_proof");
    }

    await next();
  };
}

function csrfError(source: string): ApiError {
  return new ApiError(
    "csrf_origin_mismatch",
    "Browser-origin request is not allowed for this mutation.",
    403,
    { source },
  );
}

function isAllowedBrowserOrigin(value: string, env: RomeoEnv): boolean {
  const candidate = parseOrigin(value);
  if (candidate === undefined) return false;
  const allowed = allowedOrigins(env);
  if (allowed.has(candidate)) return true;
  const appOrigin = parseOrigin(env.APP_ORIGIN);
  return (
    appOrigin !== undefined &&
    isLoopbackOrigin(appOrigin) &&
    isLoopbackOrigin(candidate)
  );
}

function allowedOrigins(env: RomeoEnv): Set<string> {
  const origins = new Set<string>();
  const appOrigin = parseOrigin(env.APP_ORIGIN);
  if (appOrigin !== undefined) origins.add(appOrigin);
  for (const entry of env.EDGE_ALLOWED_ORIGINS.split(",")) {
    const origin = parseOrigin(entry.trim());
    if (origin !== undefined) origins.add(origin);
  }
  return origins;
}

function parseOrigin(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.origin;
  } catch {
    return undefined;
  }
}

function isLoopbackOrigin(origin: string): boolean {
  const url = new URL(origin);
  return (
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]"
  );
}
