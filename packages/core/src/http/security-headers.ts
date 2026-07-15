import type { RomeoEnv } from "@romeo/config";
import type { MiddlewareHandler } from "hono";

export function securityHeaders(env: RomeoEnv): MiddlewareHandler {
  return async (context, next) => {
    await next();
    context.header("x-content-type-options", "nosniff");
    context.header("x-frame-options", "DENY");
    context.header("referrer-policy", "no-referrer");
    context.header("cross-origin-opener-policy", "same-origin");
    context.header("permissions-policy", "camera=(), microphone=(), geolocation=()");
    if (env.EDGE_HSTS_ENABLED && env.EDGE_HSTS_MAX_AGE_SECONDS > 0) {
      context.header("strict-transport-security", hstsHeader(env));
    }
  };
}

function hstsHeader(env: RomeoEnv): string {
  const directives = [`max-age=${env.EDGE_HSTS_MAX_AGE_SECONDS}`];
  if (env.EDGE_HSTS_INCLUDE_SUBDOMAINS) directives.push("includeSubDomains");
  if (env.EDGE_HSTS_PRELOAD) directives.push("preload");
  return directives.join("; ");
}
