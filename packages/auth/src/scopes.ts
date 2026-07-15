import { AuthorizationError } from './errors'
import type { AuthSubject, Scope } from './types'

export function hasScope(subject: AuthSubject, scope: Scope): boolean {
  return subject.isAdmin === true || subject.scopes.includes(scope)
}

export function assertScope(subject: AuthSubject, scope: Scope): void {
  if (!hasScope(subject, scope)) {
    throw new AuthorizationError(`Missing required scope: ${scope}`)
  }
}
