import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  publicApiErrorDefinition,
  type PublicApiErrorCode,
} from "./public-api-error-registry";

export class ApiError extends Error {
  constructor(
    readonly code: PublicApiErrorCode,
    message: string,
    readonly status: ContentfulStatusCode = 400,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    const definition = publicApiErrorDefinition(code);
    if (
      definition === undefined ||
      !definition.acceptedHttpStatuses.includes(
        status as (typeof definition.acceptedHttpStatuses)[number],
      )
    ) {
      throw new TypeError("Public API error code/status is not registered.");
    }
  }
}

export class AuthenticationError extends Error {
  readonly code = "unauthorized";
}

export function notFound(resource: string): ApiError {
  return new ApiError("not_found", `${resource} was not found.`, 404);
}
