export type UserRole = 'user' | 'org_admin' | 'global_admin'

export interface User {
  id: string
  orgId: string
  email: string
  name: string
  role: UserRole
  disabledAt?: string
}
