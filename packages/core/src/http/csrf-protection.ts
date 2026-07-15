import type { RomeoEnv } from "@romeo/config";
import type { MiddlewareHandler } from "hono";

import { ApiError } from "../errors";
import type { AppBindings } from "./context";

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
