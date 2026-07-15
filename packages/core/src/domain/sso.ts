export interface SsoOidcSettings {
  orgId: string
  enabled: boolean
  issuerUrl: string
  clientId: string
  groupClaim: string
  adminGroups: string[]
  groupMap: Record<string, string>
  workspaceGroupMap: Record<string, string>
  workspaceGroupPrefix: string
  createdBy: string
  updatedBy: string
  createdAt: string
  updatedAt: string
}
