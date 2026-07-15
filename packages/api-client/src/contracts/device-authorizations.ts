import type { Scope } from './common'

export interface DeviceAuthorization {
  id: string
  orgId: string
  userId: string
  name: string
  scopes: Scope[]
  accessApiKeyId: string
  expiresAt: string
  createdAt: string
  updatedAt: string
  lastRefreshedAt?: string
  revokedAt?: string
}

export interface CreateDeviceAuthorizationInput {
  name: string
  scopes: Scope[]
  ttlDays?: number
}

export interface CreatedDeviceAuthorization {
  authorization: DeviceAuthorization
  accessToken: string
  refreshToken: string
}

