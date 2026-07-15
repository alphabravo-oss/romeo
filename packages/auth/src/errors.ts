export class AuthorizationError extends Error {
  readonly code = 'forbidden'

  constructor(message = 'You do not have access to this resource.') {
    super(message)
  }
}
