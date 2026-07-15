import { apiJson } from './http'
import type { Envelope } from './types'
import type { User, UserRole } from './users-types'

export async function listUsers(): Promise<User[]> {
  const response = await apiJson<Envelope<User[]>>('/api/v1/users')
  return response.data
}

export async function disableUser(userId: string): Promise<User> {
  const response = await apiJson<Envelope<User>>(`/api/v1/users/${encodeURIComponent(userId)}/disable`, { method: 'POST' })
  return response.data
}

/** confirmUserId must match the target (backend guard against acting on the wrong user). */
export async function updateUserRole(input: { userId: string; role: UserRole }): Promise<User> {
  const response = await apiJson<Envelope<User>>(`/api/v1/users/${encodeURIComponent(input.userId)}/role`, {
    method: 'PATCH',
    body: JSON.stringify({ confirmUserId: input.userId, role: input.role })
  })
  return response.data
}

export async function setUserPassword(input: { userId: string; newPassword: string }): Promise<void> {
  await apiJson<Envelope<unknown>>(`/api/v1/users/${encodeURIComponent(input.userId)}/local-password`, {
    method: 'POST',
    body: JSON.stringify({ confirmUserId: input.userId, newPassword: input.newPassword })
  })
}
