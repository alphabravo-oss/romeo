import { createHash } from "node:crypto";
import { isIP } from "node:net";

import type { AuthSubject } from "@romeo/auth";
import type { RomeoEnv } from "@romeo/config";
import type { Context, MiddlewareHandler } from "hono";

import { ApiError } from "../errors";
import {
  ValkeyGlideClient,
  type ValkeyValue,
} from "../services/valkey-glide-client";
import type { AppBindings } from "./context";
import { readCookie, sessionCookieName } from "./session-cookie";
import { normalizedRequestId } from "./request-id";

type RomeoContext = Context<AppBindings>;

type RateLimitScope =
  | "anonymous"
  | "auth"
  | "authenticated"
  | "credentialed"
  | "public"
  | "webhook";

interface RateLimitRule {
  key: string;
  limit: number;
  scope: RateLimitScope;
  windowSeconds: number;
}

interface RateLimitResult {
  count: number;
  resetAtMs: number;
}

interface RateLimitStore {
  increment(key: string, windowMs: number): Promise<RateLimitResult>;
}

const exemptPaths = new Set([
  "/api/v1/health",
  "/api/v1/docs",
  "/api/v1/openapi.json",
]);

const publicPaths = new Set([
  "/api/config",
  "/api/version",
  "/api/version/updates",
  "/api/v1/openwebui/config",
  "/api/v1/openwebui/version",
  "/api/v1/openwebui/version/updates",
]);

/** Headroom for many principals behind one client address. See preAuthRule. */
const credentialedPreAuthMultiplier = 10;

const webhookPaths = new Set([
  "/api/v1/billing/webhooks/generic",
  "/api/v1/billing/webhooks/stripe",
]);

const valkeyRateLimitScript = `
local current = redis.call("INCR", KEYS[1])
if current == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
local ttl = redis.call("PTTL", KEYS[1])
return {current, ttl}
`;

export function preAuthRateLimit(
  env: RomeoEnv,
): MiddlewareHandler<AppBindings> {
  const limiter = createHttpRateLimiter(env);
  return async (context, next) => {
    await limiter.consume(context, preAuthRule(context, env));
    await next();
  };
}

export function principalRateLimit(
  env: RomeoEnv,
): MiddlewareHandler<AppBindings> {
  const limiter = createHttpRateLimiter(env);
  return async (context, next) => {
    await limiter.consume(context, principalRule(context, env));
    await next();
  };
}

function createHttpRateLimiter(env: RomeoEnv): {
  consume(
    context: RomeoContext,
    rule: RateLimitRule | undefined,
  ): Promise<void>;
} {
  if (env.HTTP_RATE_LIMIT_DRIVER === "disabled") {
    return { async consume() {} };
  }
  const store =
    env.HTTP_RATE_LIMIT_DRIVER === "valkey"
      ? new ValkeyRateLimitStore(env)
      : new MemoryRateLimitStore();
  return {
    async consume(context, rule) {
      if (rule === undefined) return;
      ensureRequestId(context);
      const windowMs = rule.windowSeconds * 1_000;
      const result = await store.increment(
        [
          env.HTTP_RATE_LIMIT_KEY_PREFIX,
          rule.scope,
          hashKeyPart(rule.key),
        ].join(":"),
        windowMs,
      );
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((result.resetAtMs - Date.now()) / 1_000),
      );
      const remaining = Math.max(0, rule.limit - result.count);
      setRateLimitHeaders(context, {
        limit: rule.limit,
        remaining,
        retryAfterSeconds,
      });
      if (result.count <= rule.limit) return;
      context.header("retry-after", String(retryAfterSeconds));
      throw new ApiError(
        "rate_limit_exceeded",
        "Too many requests. Retry after the rate-limit window resets.",
        429,
        {
          limit: rule.limit,
          retryAfterSeconds,
          scope: rule.scope,
          windowSeconds: rule.windowSeconds,
        },
      );
    },
  };
}

function preAuthRule(
  context: RomeoContext,
  env: RomeoEnv,
): RateLimitRule | undefined {
  if (context.req.method === "OPTIONS") return undefined;
  const path = new URL(context.req.url).pathname;
  if (exemptPaths.has(path)) return undefined;
  const client = clientIdentity(context, env);
  const windowSeconds = env.HTTP_RATE_LIMIT_WINDOW_SECONDS;

  if (webhookPaths.has(path)) {
    return {
      key: `client:${client}`,
      limit: env.HTTP_RATE_LIMIT_WEBHOOK_MAX,
      scope: "webhook",
      windowSeconds,
    };
  }
  if (
    path.startsWith("/api/v1/auth/") ||
    path === "/api/v1/delegated-oauth/callback" ||
    path === "/api/v1/device-authorizations/refresh"
  ) {
    return {
      key: `client:${client}`,
      limit: env.HTTP_RATE_LIMIT_AUTH_MAX,
      scope: "auth",
      windowSeconds,
    };
  }
  if (publicPaths.has(path)) {
    return {
      key: `client:${client}`,
      limit: env.HTTP_RATE_LIMIT_PUBLIC_MAX,
      scope: "public",
      windowSeconds,
    };
  }
  if (env.DEV_SEEDED_LOGIN) return undefined;
  // A credential-shaped header is not proof of authentication. These requests
  // still get a client-keyed bucket, otherwise `Authorization: Bearer junk`
  // turns the limiter off before authenticate() rejects the token and no
  // bucket is ever incremented -- an unauthenticated flood that costs a
  // key/session lookup each.
  //
  // The ceiling is a multiple of the per-principal budget because one client
  // address legitimately carries many principals (shared egress, office NAT).
  // It is a backstop against invalid-token floods, not the primary control:
  // principalRule still applies the exact per-principal budget once
  // authentication succeeds, and must stay the binding limit for real traffic.
  if (hasRequestCredential(context)) {
    return {
      key: `client:${client}`,
      limit:
        env.HTTP_RATE_LIMIT_AUTHENTICATED_MAX * credentialedPreAuthMultiplier,
      scope: "credentialed",
      windowSeconds,
    };
  }
  return {
    key: `client:${client}`,
    limit: env.HTTP_RATE_LIMIT_PUBLIC_MAX,
    scope: "anonymous",
    windowSeconds,
  };
}

function principalRule(
  context: RomeoContext,
  env: RomeoEnv,
): RateLimitRule | undefined {
  if (context.req.method === "OPTIONS") return undefined;
  const path = new URL(context.req.url).pathname;
  if (exemptPaths.has(path)) return undefined;
  const subject = context.get("subject") as AuthSubject | undefined;
  if (subject === undefined) return undefined;
  return {
    key: principalIdentity(subject),
    limit: env.HTTP_RATE_LIMIT_AUTHENTICATED_MAX,
    scope: "authenticated",
    windowSeconds: env.HTTP_RATE_LIMIT_WINDOW_SECONDS,
  };
}

class MemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<
    string,
    { count: number; resetAtMs: number }
  >();
  private pruneAfterMs = Date.now() + 60_000;

  async increment(key: string, windowMs: number): Promise<RateLimitResult> {
    const now = Date.now();
    if (now >= this.pruneAfterMs) this.prune(now);
    const existing = this.buckets.get(key);
    if (existing === undefined || existing.resetAtMs <= now) {
      const bucket = { count: 1, resetAtMs: now + windowMs };
      this.buckets.set(key, bucket);
      return bucket;
    }
    existing.count += 1;
    return { count: existing.count, resetAtMs: existing.resetAtMs };
  }

  private prune(now: number): void {
    for (const [key, bucket] of this.buckets.entries()) {
      if (bucket.resetAtMs <= now) this.buckets.delete(key);
    }
    this.pruneAfterMs = now + 60_000;
  }
}

class ValkeyRateLimitStore implements RateLimitStore {
  private readonly client: ValkeyGlideClient;

  constructor(private readonly env: RomeoEnv) {
    this.client = new ValkeyGlideClient({
      timeoutMs: env.QUOTA_COORDINATION_TIMEOUT_MS,
      url: env.VALKEY_URL,
    });
  }

  async increment(key: string, windowMs: number): Promise<RateLimitResult> {
    try {
      const response = await this.client.command([
        "EVAL",
        valkeyRateLimitScript,
        "1",
        key,
        String(windowMs),
      ]);
      const { count, ttlMs } = parseValkeyRateLimitResponse(response);
      return {
        count,
        resetAtMs: Date.now() + Math.max(1_000, ttlMs),
      };
    } catch (error) {
      void error;
      throw new ApiError(
        "rate_limit_unavailable",
        "Request rate limiting is unavailable.",
        503,
        { driver: "valkey" },
      );
    }
  }
}

function parseValkeyRateLimitResponse(response: ValkeyValue): {
  count: number;
  ttlMs: number;
} {
  if (!Array.isArray(response) || response.length < 2) {
    throw new Error("rate_limit_response_invalid");
  }
  const count = Number(response[0]);
  const ttlMs = Number(response[1]);
  if (!Number.isFinite(count) || !Number.isFinite(ttlMs)) {
    throw new Error("rate_limit_response_invalid");
  }
  return { count, ttlMs };
}

function clientIdentity(context: RomeoContext, env: RomeoEnv): string {
  if (env.EDGE_TRUSTED_PROXY_MODE !== "trusted_proxy") {
    // Direct mode is development-only. A lightweight browser fingerprint keeps
    // one local client from exhausting every other client's shared bucket.
    return `direct:${hashKeyPart(
      [
        context.req.header("user-agent") ?? "unknown-agent",
        context.req.header("accept-language") ?? "unknown-language",
      ].join("|"),
    )}`;
  }
  const chain = (context.req.header("x-forwarded-for") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  const candidate = chain.at(-env.EDGE_TRUSTED_PROXY_HOPS);
  return candidate !== undefined && isIP(candidate) !== 0
    ? `ip:${hashKeyPart(candidate)}`
    : "ip:unknown";
}

function principalIdentity(subject: AuthSubject): string {
  const principal =
    subject.apiKeyId === undefined
      ? `${subject.type}:${subject.id}`
      : `api_key:${subject.apiKeyId}`;
  return `org:${hashKeyPart(subject.orgId)}:${hashKeyPart(principal)}`;
}

function hasRequestCredential(context: RomeoContext): boolean {
  const authorization = context.req.header("authorization");
  if (authorization?.startsWith("Bearer ") === true) return true;
  return (
    readCookie(context.req.header("cookie"), sessionCookieName) !== undefined
  );
}

function setRateLimitHeaders(
  context: RomeoContext,
  input: { limit: number; remaining: number; retryAfterSeconds: number },
): void {
  context.header("ratelimit-limit", String(input.limit));
  context.header("ratelimit-remaining", String(input.remaining));
  context.header("ratelimit-reset", String(input.retryAfterSeconds));
}

function ensureRequestId(context: RomeoContext): void {
  const existing = context.get("requestId") as string | undefined;
  if (existing !== undefined) return;
  const requestId = normalizedRequestId(context.req.header("x-request-id"));
  context.set("requestId", requestId);
  context.header("x-request-id", requestId);
}

function hashKeyPart(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}
