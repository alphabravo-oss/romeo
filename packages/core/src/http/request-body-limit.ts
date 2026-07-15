import type { RomeoEnv } from "@romeo/config";
import type { MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";

import type { AppBindings } from "./context";

export function requestBodyLimit(env: RomeoEnv): MiddlewareHandler<AppBindings> {
  const limit = bodyLimit({
    maxSize: env.REQUEST_BODY_MAX_BYTES,
    onError: (context) => {
      const requestId = context.req.header("x-request-id") ?? crypto.randomUUID();
      context.header("x-request-id", requestId);
      return context.json(
        {
          error: {
            code: "request_body_too_large",
            message: "Request body exceeds the configured limit.",
            request_id: requestId,
            details: { maxBytes: env.REQUEST_BODY_MAX_BYTES },
          },
        },
        413,
      );
    },
  });

  return async (context, next) => {
    // RFC 9112 6.3: a request with neither Content-Length nor Transfer-Encoding
    // has a body length of zero, so there is nothing for the limiter to measure.
    // The Node adapter (srvx) still hands us a non-null ReadableStream because it
    // decides purely from the method -- only GET/HEAD get null -- which defeats
    // hono's own `if (!c.req.raw.body) return next()` guard and makes bodyLimit
    // crash while reconstructing the Request (undici #state TypeError). Skipping
    // here only skips work the RFC already defines as a no-op.
    if (
      context.req.header("content-length") === undefined &&
      context.req.header("transfer-encoding") === undefined
    ) {
      return next();
    }
    return limit(context, next);
  };
}
