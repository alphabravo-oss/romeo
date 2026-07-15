export interface DeviceAuthorization {
  id: string
  orgId: string
  userId: string
  name: string
  scopes: string[]
  accessApiKeyId: string
  expiresAt: string
  createdAt: string
  updatedAt: string
  lastRefreshedAt?: string
  revokedAt?: string
}

export interface CreatedDeviceAuthorization {
  authorization: DeviceAuthorization
  accessToken: string
  refreshToken: string
}
