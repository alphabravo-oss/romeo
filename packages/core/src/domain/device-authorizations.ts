import type { Scope } from '@romeo/auth'

export interface DeviceAuthorization {
  id: string
  orgId: string
  userId: string
  name: string
  scopes: Scope[]
  hashedRefreshToken: string
  accessApiKeyId: string
  expiresAt: string
  createdAt: string
  updatedAt: string
  lastRefreshedAt?: string
  revokedAt?: string
}

