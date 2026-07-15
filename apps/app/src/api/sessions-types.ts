export interface Session {
  id: string
  orgId: string
  userId: string
  name: string
  scopes: string[]
  isAdmin: boolean
  expiresAt: string
  revokedAt?: string
  lastSeenAt?: string
  createdAt: string
}
