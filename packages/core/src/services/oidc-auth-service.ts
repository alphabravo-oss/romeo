import { AuthorizationError, type AuthSubject, type OidcMappedSubject } from '@romeo/auth'
import type { RomeoEnv } from '@romeo/config'

import type { RomeoRepository } from '../domain/repository'
import { OidcClient } from './oidc-client'

export interface OidcAuthenticator {
  readonly enabled: boolean
  authenticate(token: string): Promise<AuthSubject>
}

export const disabledOidcAuthenticator: OidcAuthenticator = {
  enabled: false,
  async authenticate() {
    throw new AuthorizationError('OIDC authentication is not configured.')
  }
}

export class DiscoveryOidcAuthenticator implements OidcAuthenticator {
  private readonly oidcClient: OidcClient

  constructor(
    repository: RomeoRepository,
    env: RomeoEnv,
    options: { fetchImpl?: typeof fetch } = {}
  ) {
    this.oidcClient = new OidcClient(repository, env, options)
  }

  get enabled(): boolean {
    return true
  }

  async authenticate(token: string): Promise<OidcMappedSubject> {
    try {
      return await this.oidcClient.authenticateJwt(token)
    } catch {
      throw new AuthorizationError('OIDC token is invalid.')
    }
  }
}
