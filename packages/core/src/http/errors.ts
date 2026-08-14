import { AuthorizationError } from "@romeo/auth";
import type { ErrorHandler } from "hono";
import { ZodError } from "zod";
import { createHash } from "node:crypto";

import { ApiError, AuthenticationError } from "../errors";
import type { AppBindings } from "./context";

export const errorHandler: ErrorHandler<AppBindings> = (error, context) => {
  const requestId = context.get("requestId") ?? crypto.randomUUID();

  if (error instanceof ApiError) {
    return context.json(
      {
        error: {
          code: error.code,
          message: error.message,
          request_id: requestId,
          details: error.details,
        },
      },
      error.status,
    );
  }

  if (error instanceof AuthorizationError) {
    return context.json(
      {
        error: {
          code: error.code,
          message: error.message,
          request_id: requestId,
          details: {},
        },
      },
      403,
    );
  }

  if (error instanceof AuthenticationError) {
    context.header("www-authenticate", 'Bearer realm="romeo"');
    return context.json(
      {
        error: {
          code: error.code,
          message: error.message,
          request_id: requestId,
          details: {},
        },
      },
      401,
    );
  }

  if (error instanceof ZodError) {
    return context.json(
      {
        error: {
          code: "invalid_request",
          message: "The request payload is invalid.",
          request_id: requestId,
          details: { issues: error.issues },
        },
      },
      400,
    );
  }

  // Genuinely unexpected: emit correlation metadata without serializing the
  // request path/query or the exception message, stack, cause, code, or payload.
  // Provider libraries routinely embed response bodies and credentials in
  // errors, so the raw Error object must never cross the logging boundary.
  console.error("unhandled request error", {
    requestIdFingerprint: fingerprint(requestId),
    method: context.req.method,
    errorKind: safeErrorKind(error),
  });

  return context.json(
    {
      error: {
        code: "internal_error",
        message: "Unexpected server error.",
        request_id: requestId,
        details: {},
      },
    },
    500,
  );
};

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function safeErrorKind(error: unknown): string {
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof RangeError) return "RangeError";
  if (error instanceof ReferenceError) return "ReferenceError";
  if (error instanceof SyntaxError) return "SyntaxError";
  if (error instanceof Error) return "Error";
  return "NonErrorThrow";
}
