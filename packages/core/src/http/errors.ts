import { AuthorizationError } from '@romeo/auth'
import type { ErrorHandler } from 'hono'
import { ZodError } from 'zod'

import { ApiError } from '../errors'
import type { AppBindings } from './context'

export const errorHandler: ErrorHandler<AppBindings> = (error, context) => {
  const requestId = context.get('requestId') ?? crypto.randomUUID()

  if (error instanceof ApiError) {
    return context.json({ error: { code: error.code, message: error.message, request_id: requestId, details: error.details } }, error.status)
  }

  if (error instanceof AuthorizationError) {
    return context.json({ error: { code: error.code, message: error.message, request_id: requestId, details: {} } }, 403)
  }

  if (error instanceof ZodError) {
    return context.json(
      {
        error: {
          code: 'invalid_request',
          message: 'The request payload is invalid.',
          request_id: requestId,
          details: { issues: error.issues }
        }
      },
      400
    )
  }

  return context.json(
    { error: { code: 'internal_error', message: 'Unexpected server error.', request_id: requestId, details: {} } },
    500
  )
}
