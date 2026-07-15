import type { ContentfulStatusCode } from 'hono/utils/http-status'

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: ContentfulStatusCode = 400,
    readonly details: Record<string, unknown> = {}
  ) {
    super(message)
  }
}

export function notFound(resource: string): ApiError {
  return new ApiError('not_found', `${resource} was not found.`, 404)
}
