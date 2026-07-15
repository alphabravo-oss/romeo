import type { RomeoEnv } from "@romeo/config";
import { bodyLimit } from "hono/body-limit";

export function requestBodyLimit(env: RomeoEnv) {
  return bodyLimit({
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
}
